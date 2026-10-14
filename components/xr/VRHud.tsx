'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { createPortal } from '@react-three/fiber';
import { Interactive, startSession, stopSession, useXR } from '@react-three/xr';
import { Text } from '@react-three/drei';
import type { TransformApi } from './TransformRig';

interface Props {
  apiRef: React.RefObject<TransformApi | null>;
}

/**
 * In-headset control panel.
 *
 * The DOM overlay in the page is invisible once a session starts, so any
 * control that has to be reachable in VR has to exist in the scene. This is a
 * small head-relative panel parented to the XR player group, which keeps it
 * pinned in front of you without needing to place it in world space.
 */
export default function VRHud({ apiRef }: Props) {
  const player = useXR((s) => s.player);
  const isPresenting = useXR((s) => s.isPresenting);
  const session = useXR((s) => s.session);

  // Keep the panel alive across the brief gap while switching VR <-> AR
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (isPresenting || session) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), 1200);
    return () => clearTimeout(t);
  }, [isPresenting, session]);

  const [busy, setBusy] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const passthrough = (session as { mode?: string } | null)?.mode === 'immersive-ar';

  const togglePassthrough = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopSession();
      const next = passthrough ? 'immersive-vr' : 'immersive-ar';
      await startSession(next, { optionalFeatures: ['local-floor', 'local', 'hand-tracking'] });
    } catch {
      // Failed to switch (e.g. AR refused): fall back to plain VR so the user
      // is not left with no session at all.
      try {
        await startSession('immersive-vr', { optionalFeatures: ['local-floor'] });
      } catch {
        /* give up; the Enter VR button outside still works */
      }
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || !player) return null;

  return createPortal(
    <group position={[0, 1.25, -0.85]} rotation={[-0.32, 0, 0]}>
      <HudRow>
        <HudButton
          label="RESET"
          hint="or: both grips"
          accent={grabbing}
          onSelect={() => apiRef.current?.reset()}
        />
        <HudButton
          label={passthrough ? 'VR' : 'PASSTHROUGH'}
          hint="toggle room view"
          accent={passthrough}
          onSelect={togglePassthrough}
        />
      </HudRow>

      <HudRow y={-0.13}>
        <HudButton label="−" onSelect={() => apiRef.current?.scaleBy(1 / 1.25)} small />
        <HudButton label="+" onSelect={() => apiRef.current?.scaleBy(1.25)} small />
        <HudButton label="⟲" onSelect={() => apiRef.current?.rotateBy(Math.PI / 12)} small />
        <HudButton label="⟳" onSelect={() => apiRef.current?.rotateBy(-Math.PI / 12)} small />
      </HudRow>

      <Text
        position={[0, 0.13, 0]}
        fontSize={0.032}
        color="#71717a"
        anchorX="center"
        anchorY="middle"
        maxWidth={0.7}
        textAlign="center"
      >
        {grabbing ? 'holding — move hands to transform' : 'grip to grab · trigger to expand'}
      </Text>
    </group>,
    player,
  );
}

function HudRow({ children, y = 0 }: { children: React.ReactNode; y?: number }) {
  return (
    <group position={[0, y, 0]} scale={0.9}>
      {children}
    </group>
  );
}

function HudButton({
  label,
  hint,
  onSelect,
  accent,
  small,
}: {
  label: string;
  hint?: string;
  onSelect: () => void;
  accent?: boolean;
  small?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const w = small ? 0.075 : 0.15;
  const h = small ? 0.06 : 0.05;

  return (
    <Interactive
      onSelectStart={onSelect}
      onHover={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <group>
        <mesh>
          <planeGeometry args={[w * 2.1, h * 2.6]} />
          <meshBasicMaterial
            color={accent ? '#a78bfa' : hover ? '#ffffff' : '#27272a'}
            transparent
            opacity={hover || accent ? 0.95 : 0.7}
            depthWrite={false}
          />
        </mesh>
        <Text
          position={[0, small ? 0 : 0.008, 0.001]}
          fontSize={small ? 0.05 : 0.03}
          color={accent || hover ? '#ffffff' : '#d4d4d8'}
          anchorX="center"
          anchorY="middle"
          maxWidth={w * 2}
          textAlign="center"
          outlineWidth={0.004}
          outlineColor="#000000"
        >
          {label}
        </Text>
        {hint && (
          <Text
            position={[0, -h * 1.7, 0.001]}
            fontSize={0.016}
            color="#71717a"
            anchorX="center"
            anchorY="middle"
            maxWidth={w * 2.2}
            textAlign="center"
          >
            {hint}
          </Text>
        )}
      </group>
    </Interactive>
  );
}