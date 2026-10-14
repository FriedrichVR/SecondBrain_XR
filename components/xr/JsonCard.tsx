'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { Interactive, type XRInteractionEvent } from '@react-three/xr';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import SceneErrorBoundary from './SceneErrorBoundary';
import { drawCardTexture } from '@/utils/cardTexture';
import { pulse } from '@/utils/haptics';
import type { CardSpec, LayoutEntry } from '@/utils/treeLayout';

/** World width of every card; height derives from the face aspect. */
export const CARD_W = 1.7;

interface Props {
  spec: CardSpec;
  target: LayoutEntry;
  /** Spawn position for enter transitions (usually the parent's current pos). */
  from: THREE.Vector3;
  /** Shared map of currently rendered positions (drives spawn + connectors). */
  posMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
  /** Uniform scale shared with the layout — keeps slots and cards consistent. */
  cardScale: number;
  hovered: boolean;
  selected: boolean;
  spotlight: boolean;
  onToggle: (id: string) => void;
  onHover: (nodeId: string | null) => void;
  onSelect: (nodeId: string) => void;
}

const tmpTarget = new THREE.Vector3();

function JsonCardImpl({ spec, target, from, posMap, cardScale, hovered, selected, spotlight, onToggle, onHover, onSelect }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const cur = useRef<THREE.Vector3 | null>(null);
  if (cur.current === null) cur.current = from.clone();

  const id = spec.node.id;

  // Face texture: rebaked only when content or focus state changes. Hover
  // touches at most two cards, so this never happens scene-wide.
  const face = useMemo(() => drawCardTexture(spec, { selected, hovered }), [spec, selected, hovered]);
  useEffect(() => () => face.texture.dispose(), [face]);

  const h = CARD_W * face.aspect;
  const active = hovered || selected;
  const dim = spotlight ? 1 : 0.35;

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g || !cur.current) return;
    tmpTarget.set(target.x, target.y, target.z);
    // Glide, never snap: new cards spawn at the parent and slide out.
    const k = 1 - Math.exp(-dt * 7);
    cur.current.lerp(tmpTarget, k);
    g.position.copy(cur.current);
    posMap.current.set(id, cur.current);
  });

  // Desktop pointer path (the XR ray path is `activate` below)
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    activate();
  };

  const activate = (controller?: { inputSource?: XRInputSource | null }) => {
    pulse(controller, 0.8, 40);
    onToggle(id);
    onSelect(id);
  };

  return (
    <group ref={groupRef} position={[from.x, from.y, from.z]}>
      {/* Inner group carries the uniform layout scale; the outer group only
          positions. Scaling here would also scale the position — it must not. */}
      <group scale={cardScale}>
      <Interactive
        onSelectStart={(e: XRInteractionEvent) => activate(e.target)}
        onHover={(e: XRInteractionEvent) => {
          pulse(e.target, 0.25, 15);
          onHover(id);
        }}
        onBlur={() => onHover(null)}
      >
        <group>
          {/* Thickness: thin dark slab behind the face for real depth */}
          <RoundedBox args={[CARD_W, h, 0.09]} radius={0.03} smoothness={3} position={[0, 0, -0.055]} raycast={() => null}>
            <meshStandardMaterial
              color={selected ? '#1e1b2e' : '#0b0b10'}
              emissive={selected ? '#8b5cf6' : hovered ? '#ffffff' : '#000000'}
              emissiveIntensity={selected ? 0.55 : hovered ? 0.28 : 0}
              transparent
              opacity={dim}
              roughness={0.6}
              metalness={0.05}
            />
          </RoundedBox>
          {/* Face: all text baked into one texture = one draw call per card.
              This plane is the raycast target for hover + trigger. */}
          <mesh>
            <planeGeometry args={[CARD_W, h]} />
            <meshBasicMaterial map={face.texture} transparent opacity={dim} toneMapped={false} />
          </mesh>
        </group>
      </Interactive>
      </group>
    </group>
  );
}

export default memo(JsonCardImpl);
