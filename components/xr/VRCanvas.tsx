'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { XR, Controllers, VRButton, useXR } from '@react-three/xr';
import { OrbitControls, Stars } from '@react-three/drei';
import { Headset, TriangleAlert } from 'lucide-react';
import SceneErrorBoundary from './SceneErrorBoundary';
import TransformRig, { type TransformApi } from './TransformRig';
import VRHud from './VRHud';
import Graph3D from './Graph3D';
import { useCapabilities, summarise } from '@/utils/webxrProbe';
import type { GraphData, GraphNode } from '@/utils/jsonToGraph';

interface Props {
  graph: GraphData;
  hoveredId: string | null;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode) => void;
  onDragNode: (id: string, point: THREE.Vector3) => void;
  onClearSelection: () => void;
  onBudget?: (shown: number, total: number) => void;
  /** Rendered vs. eligible nodes — surfaced in the HUD when clipped. */
  budget: { shown: number; total: number } | null;
  /** Identifies the current dataset so a failed scene retries on the next load. */
  resetKey: string;
  /** Hands the transform API up so the page can drive a desktop reset. */
  onRigReady?: (api: React.RefObject<TransformApi | null>) => void;
}

/**
 * Keeps the framebuffer opaque black in VR and transparent in AR.
 *
 * Passthrough is not a post-processing trick: the AR session composites what
 * the headset cameras see behind the drawing buffer, which only works if the
 * buffer actually has a transparent background.
 */
function SessionSurface() {
  const session = useXR((s) => s.session);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const isAR = (session as { mode?: string } | null)?.mode === 'immersive-ar';
    if (isAR) {
      scene.background = null;
      gl.setClearColor(new THREE.Color('#000000'), 0);
    } else {
      scene.background = new THREE.Color('#000000');
      gl.setClearColor(new THREE.Color('#000000'), 1);
    }
  }, [session, gl, scene]);

  return null;
}

/** Neutralises the library's default inline button placement. */
const BTN_STYLE: React.CSSProperties = {
  position: 'static',
  transform: 'none',
  zIndex: 'auto',
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  outline: 'none',
};

export default function VRCanvas(props: Props) {
  const { onClearSelection, budget, resetKey } = props;
  const caps = useCapabilities();
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  // Shared between the in-headset HUD and the desktop reset button
  const rigApi = useRef<TransformApi | null>(null);
  props.onRigReady?.(rigApi);

  const onSceneError = useCallback((e: Error) => setSceneError(e.message), []);

  const clipped = budget !== null && budget.shown < budget.total;
  const blocked = caps.webgl === 'fail';

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black md:h-[640px]">
      <Canvas
        // Quest renders through a multisampled, per-eye pipeline; a high dpr
        // here buys nothing and makes context creation the failure point.
        dpr={1}
        // Required for passthrough: the AR session composites the real room
        // behind a transparent framebuffer.
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 1.6, 7], fov: 60, near: 0.1, far: 300 }}
        onPointerMissed={onClearSelection}
        fallback={
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <TriangleAlert className="h-5 w-5 text-amber-400" />
            <p className="text-xs text-zinc-400">WebGL unavailable on this device</p>
          </div>
        }
      >
        <ambientLight intensity={0.55} />
        <pointLight position={[5, 7, 5]} intensity={55} />
        <pointLight position={[-5, -3, -5]} intensity={18} color="#8b5cf6" />
        <Stars radius={90} depth={50} count={1400} factor={2.4} fade speed={0.35} />
        <SceneErrorBoundary onError={onSceneError}>
          <Suspense fallback={null}>
            <XR referenceSpace="local-floor" frameRate={90}>
              {/* Must live inside <XR>: it reads the session to decide between
                  an opaque VR framebuffer and a transparent AR one. */}
              <SessionSurface />
              {/* Controllers only: <Hands> injects an Oculus hand model that
                  needs a granted hand-tracking session and is not needed for
                  the trigger + grip interaction this app is built around. */}
              <Controllers rayMaterial={{ color: '#a78bfa' }} />
              <TransformRig apiRef={rigApi} onGrabChange={setGrabbing}>
                <Graph3D {...props} />
              </TransformRig>
              <VRHud apiRef={rigApi} />
              <OrbitControls
                makeDefault
                enableDamping
                dampingFactor={0.1}
                minDistance={1.5}
                maxDistance={40}
                enablePan={false}
              />
            </XR>
          </Suspense>
        </SceneErrorBoundary>
      </Canvas>

      {/* --- HUD ---------------------------------------------------------- */}

      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <VRButton
          sessionInit={{ optionalFeatures: ['local-floor'] }}
          style={BTN_STYLE}
          disabled={caps.immersiveVR === 'unsupported' || caps.immersiveVR === 'error'}
          className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium backdrop-blur transition ${
            caps.immersiveVR === 'supported'
              ? 'border-white/15 bg-black/60 text-white hover:bg-white/10'
              : 'border-amber-400/30 bg-amber-500/10 text-amber-300/90'
          }`}
        >
          {(status) => (
            <>
              <Headset className="h-3.5 w-3.5" />
              {status === 'entered' ? 'Exit VR' : caps.immersiveVR === 'pending' ? 'Checking…' : 'Enter VR'}
            </>
          )}
        </VRButton>

        {/* Capability readout — this is the diagnostic that turns a blank
            stage into an explanation. */}
        <div className="pointer-events-auto max-w-[58%] rounded-lg border border-white/10 bg-black/70 px-2.5 py-1.5 font-mono text-[9px] leading-relaxed text-zinc-500 backdrop-blur">
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {summarise(caps).map((r) => (
              <span key={r.k} className={r.bad ? 'text-amber-400' : 'text-zinc-400'}>
                {r.k}={r.v}
              </span>
            ))}
          </div>
          <div className="truncate text-zinc-600" title={caps.renderer}>
            {caps.renderer}
          </div>
          {caps.note && <div className="truncate text-amber-400/80">{caps.note}</div>}
          {sceneError && <div className="truncate text-rose-400/90">scene: {sceneError}</div>}
        </div>
      </div>

      {blocked && (
        <div className="pointer-events-none absolute inset-x-3 top-16 rounded-lg border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-[10px] leading-relaxed text-amber-200/80">
          This browser could not create a WebGL context. Desktop Chromium works; if you are on a headset,
          try disabling "Developer WebView" or check the browser permissions.
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-4 bottom-3 flex flex-col items-center gap-1.5">
        {clipped && (
          <p className="rounded-full bg-amber-500/10 px-3 py-1 text-[10px] text-amber-300/90 backdrop-blur">
            rendering {budget.shown} of {budget.total} nodes · frame budget
          </p>
        )}
        <p className="rounded-full bg-black/50 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-500 backdrop-blur">
          point · trigger · grip-drag
        </p>
      </div>
    </div>
  );
}