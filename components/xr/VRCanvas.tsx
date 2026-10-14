'use client';

import { Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { XR, Controllers, Hands, VRButton } from '@react-three/xr';
import { OrbitControls, Stars } from '@react-three/drei';
import { Headset } from 'lucide-react';
import Graph3D from './Graph3D';
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
  /** Reports how many nodes the 3D scene could actually draw. */
  onBudget?: (shown: number, total: number) => void;
  /** Rendered vs. eligible nodes — surfaced in the HUD when clipped. */
  budget: { shown: number; total: number } | null;
}

export default function VRCanvas(props: Props) {
  const { onClearSelection, budget } = props;
  const clipped = budget !== null && budget.shown < budget.total;
  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black md:h-[640px]">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 1.6, 7], fov: 60, near: 0.1, far: 300 }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color('#000000'))}
        onPointerMissed={onClearSelection}
      >
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.55} />
        <pointLight position={[5, 7, 5]} intensity={55} />
        <pointLight position={[-5, -3, -5]} intensity={18} color="#8b5cf6" />
        <Stars radius={90} depth={50} count={1400} factor={2.4} fade speed={0.35} />
        <Suspense fallback={null}>
          <XR referenceSpace="local-floor" frameRate={90}>
            <Controllers rayMaterial={{ color: '#a78bfa' }} />
            <Hands />
            <Graph3D {...props} />
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
      </Canvas>

      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-center justify-between gap-3">
        <VRButton
          sessionInit={{ optionalFeatures: ['local-floor', 'hand-tracking'] }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs font-medium text-white backdrop-blur transition hover:bg-white/10"
        >
          {(status) => (
            <>
              <Headset className="h-3.5 w-3.5" />
              {status === 'entered' ? 'Exit' : status === 'unsupported' ? 'No WebXR' : 'Enter VR'}
            </>
          )}
        </VRButton>
      </div>

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