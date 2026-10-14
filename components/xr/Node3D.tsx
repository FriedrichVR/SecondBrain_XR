'use client';

import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Text, Billboard } from '@react-three/drei';
import { Interactive, type XRController, type XRInteractionEvent } from '@react-three/xr';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import SceneErrorBoundary from './SceneErrorBoundary';
import { pulse } from '@/utils/haptics';
import type { GraphNode } from '@/utils/jsonToGraph';
import { NODE_COLORS } from '@/utils/jsonToGraph';

interface Props {
  node: GraphNode;
  /** Global shrink factor so dense graphs don't turn into one solid mass. */
  sizeScale: number;
  hovered: boolean;
  selected: boolean;
  /** False when another subtree has the focus — node renders dimmed. */
  spotlight: boolean;
  onToggle: (id: string) => void;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode) => void;
  onDrag: (id: string, point: THREE.Vector3) => void;
}

const sphereGeo = new THREE.SphereGeometry(1, 16, 16);
// Low segment count: these rings are thin, and every extra segment is another
// vertex pushed through the Quest GPU on every frame.
const orbitGeo = new THREE.TorusGeometry(1, 0.008, 4, 48);
const tmpVec = new THREE.Vector3();

function Node3DImpl({ node, sizeScale, hovered, selected, spotlight, onToggle, onHover, onSelect, onDrag }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const orbitA = useRef<THREE.Group>(null);
  const orbitB = useRef<THREE.Group>(null);
  const labelRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const dragging = useRef(false);
  const scaleRef = useRef(1);

  const color = NODE_COLORS[node.type] ?? '#ffffff';
  const isBranch = node.type === 'object' || node.type === 'array' || node.type === 'root';

  // Hierarchy reads at a glance: bigger sphere = deeper branch with more children
  const baseRadius = useMemo(() => {
    const byKind = isBranch ? 0.2 : 0.11;
    const byDepth = node.depth === 0 ? 1.7 : node.depth === 1 ? 1.25 : 1;
    const byFanout = isBranch ? 1 + Math.min(node.childIds.length, 12) * 0.035 : 1;
    return byKind * byDepth * byFanout * sizeScale;
  }, [isBranch, node.depth, node.childIds.length, sizeScale]);

  // Outside the focus chain everything dims toward the background so the eye
  // follows the highlighted path instead of the whole cloud.
  const dim = spotlight ? 1 : 0.32;

  // Tags always face the observer (Billboard) and follow a depth budget:
  // root + hover/selected always, then progressively deeper levels, culled by
  // camera distance so a 700-node cloud doesn't pay for 700 SDF labels.
  const showLabel = node.depth <= 3 || hovered || selected;
  const fontSize = (node.depth === 0 ? 0.22 : node.depth === 1 ? 0.16 : 0.12) * Math.max(sizeScale, 0.6);

  // Persistent materials — never recreated on hover (no shader recompiles)
  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: isBranch ? 0.85 : 0.6,
        roughness: 0.25,
        metalness: 0.05,
      }),
    [color, isBranch],
  );
  const orbitMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color],
  );
  const orbitMatB = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color],
  );
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#ffffff'),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      coreMat.dispose();
      orbitMat.dispose();
      orbitMatB.dispose();
      ringMat.dispose();
    },
    [coreMat, orbitMat, orbitMatB, ringMat],
  );

  // Smooth lerp between states — no instant scale snap (which read as a pop)
  // Per-node orbits are a real cost (2 extra draw calls each). Only branches
  // and whatever the user is touching get them — leaves stay clean dots.
  const showOrbits = isBranch || hovered || selected;

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    g.position.set(x, y, z);

    const d = state.camera.position.distanceTo(tmpVec.set(x, y, z));

    // Only ever GROW toward hover emphasis, and never below the base size.
    // Shrinking was the flicker source: the mesh slipped out from under the
    // pointer -> pointerout -> regrow -> pointerover, in a loop.
    const target = hovered || selected ? 1.4 : 1;
    scaleRef.current += (target - scaleRef.current) * Math.min(1, dt * 12);
    if (coreRef.current) coreRef.current.scale.setScalar(baseRadius * scaleRef.current);
    coreMat.emissiveIntensity = (hovered || selected ? 1.5 : isBranch ? 0.85 : 0.6) * dim;

    // Orbits fade out as the camera approaches, and never pop back in
    const orbitFade = (showOrbits ? Math.min(1, Math.max(0, (d - baseRadius * 2.4) / (baseRadius * 3))) : 0) * dim;
    if (orbitA.current) {
      orbitA.current.scale.setScalar(baseRadius * 2.6 * orbitFade);
      orbitA.current.rotation.y += dt * 0.5;
      orbitA.current.visible = orbitFade > 0.02;
      orbitMat.opacity = (hovered || selected ? 0.5 : 0.32) * orbitFade;
    }
    if (orbitB.current) {
      orbitB.current.scale.setScalar(baseRadius * 3.9 * orbitFade);
      orbitB.current.rotation.y -= dt * 0.34;
      orbitB.current.rotation.x += dt * 0.12;
      orbitB.current.visible = orbitFade > 0.02;
      orbitMatB.opacity = (hovered || selected ? 0.28 : 0.16) * orbitFade;
    }

    // Labels always face the observer via Billboard; culled only when the
    // camera is basically inside them or too far to read anything.
    if (labelRef.current) labelRef.current.visible = d > 0.45 && d < 12;
    if (ringRef.current) ringRef.current.visible = d > 0.7 && d < 9;
  });

  // Shared by the desktop pointer path and the XR controller ray
  const activate = (controller?: XRController) => {
    pulse(controller, 0.8, 40);
    if (isBranch) onToggle(node.id);
    onSelect(node);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    activate();
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    onDrag(node.id, e.point);
  };

  return (
    <group ref={groupRef} position={[node.x ?? 0, node.y ?? 0, node.z ?? 0]}>
      {/* Orbit A — tight ring */}
      {showOrbits && (
        <group ref={orbitA} raycast={() => null}>
          <mesh geometry={orbitGeo} material={orbitMat} rotation={[Math.PI / 2 + 0.4, 0, 0.18]} raycast={() => null} />
        </group>
      )}

      {/* Orbit B — wide, counter-tilted ring */}
      {showOrbits && (
        <group ref={orbitB} raycast={() => null}>
          <mesh geometry={orbitGeo} material={orbitMatB} rotation={[Math.PI / 2 - 0.72, 0.5, -0.32]} raycast={() => null} />
        </group>
      )}

      {/*
        `Interactive` is what actually wires the XR controller ray to this node.
        The R3F pointer props below only fire for mouse/touch, so without this
        wrapper the nodes responded on desktop and did nothing in VR.
        Trigger = select (expand/collapse), grip stays free for the rig.
      */}
      <Interactive
        onSelectStart={(e: XRInteractionEvent) => activate(e.target)}
        onHover={(e: XRInteractionEvent) => {
          pulse(e.target, 0.25, 15);
          onHover(node);
        }}
        onBlur={() => onHover(null)}
      >
        <mesh
          ref={coreRef}
          geometry={sphereGeo}
          material={coreMat}
          scale={baseRadius}
          onClick={handleClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(node);
          }}
          onPointerOut={() => onHover(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = true;
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerMove={handlePointerMove}
        />
      </Interactive>

      {selected && (
        <mesh ref={ringRef} material={ringMat} raycast={() => null}>
          <torusGeometry args={[baseRadius * 2.2, 0.012, 8, 48]} />
        </mesh>
      )}

      {showLabel && (
        <group ref={labelRef}>
          {/* The label gets its own Suspense + boundary on purpose. drei's Text
              loads a font and a WASM binary asynchronously; while it is pending
              it suspends. Without a local boundary that suspension propagates
              to the <Suspense fallback={null}> wrapping the whole scene, which
              blanks the entire graph instead of just this label. */}
          <Billboard position={[0, baseRadius + 0.45, 0]}>
            <Suspense fallback={null}>
              <SceneErrorBoundary>
                <Text
                  fontSize={fontSize}
                  maxWidth={2.6}
                  textAlign="center"
                  color={hovered || selected ? '#ffffff' : spotlight ? color : '#52525b'}
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.012}
                  outlineColor="#000000"
                >
                  {node.key}
                  {node.value !== undefined ? `: ${node.value.slice(0, 20)}` : ''}
                  {isBranch && !node.expanded ? `  +${node.childIds.length}` : ''}
                </Text>
              </SceneErrorBoundary>
            </Suspense>
          </Billboard>
        </group>
      )}
    </group>
  );
}

export default memo(Node3DImpl);