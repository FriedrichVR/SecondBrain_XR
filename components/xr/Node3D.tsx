'use client';

import { memo, Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Text, Billboard } from '@react-three/drei';
import { ThreeEvent, useFrame } from '@react-three/fiber';
import SceneErrorBoundary from './SceneErrorBoundary';
import type { GraphNode } from '@/utils/jsonToGraph';
import { NODE_COLORS } from '@/utils/jsonToGraph';

interface Props {
  node: GraphNode;
  /** Global shrink factor so dense graphs don't turn into one solid mass. */
  sizeScale: number;
  hovered: boolean;
  selected: boolean;
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

function Node3DImpl({ node, sizeScale, hovered, selected, onToggle, onHover, onSelect, onDrag }: Props) {
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
    const byDepth = node.depth === 0 ? 1.7 : 1;
    const byFanout = isBranch ? 1 + Math.min(node.childIds.length, 12) * 0.035 : 1;
    return byKind * byDepth * byFanout * sizeScale;
  }, [isBranch, node.depth, node.childIds.length, sizeScale]);

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

    // Orbits fade out as the camera approaches, and never pop back in
    const orbitFade = showOrbits ? Math.min(1, Math.max(0, (d - baseRadius * 2.4) / (baseRadius * 3))) : 0;
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

    // Labels: tighter budget in dense graphs, and never when the camera is inside
    if (labelRef.current) labelRef.current.visible = d > 1.4 && (sizeScale > 0.7 || hovered || selected || node.depth === 0);
    if (ringRef.current) ringRef.current.visible = d > 0.7 && d < 9;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (isBranch) onToggle(node.id);
    onSelect(node);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    onDrag(node.id, e.point);
  };

  const showLabel = node.depth <= 1 || hovered || selected;

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
                  fontSize={node.depth === 0 ? 0.2 : 0.14}
                  maxWidth={2.6}
                  textAlign="center"
                  color={hovered || selected ? '#ffffff' : color}
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