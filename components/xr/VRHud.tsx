'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { createPortal } from '@react-three/fiber';
import { Interactive, startSession, stopSession, useXR, type XRInteractionEvent } from '@react-three/xr';
import { Text } from '@react-three/drei';
import { pulse } from '@/utils/haptics';
import type { TransformApi } from './TransformRig';

interface Props {
  apiRef: React.RefObject<TransformApi | null>;
  grabbing: boolean;
}

/**
 * In-headset control panel.
 *
 * The DOM overlay in the page is invisible once a session starts, so any
 * control that has to be reachable in VR has to exist in the scene. This is a
 * small head-relative panel parented to the XR player group, which keeps it
 * pinned in front of you without needing to place it in world space.
 *
 * Sizing rule: no touch target smaller than ~8cm at 0.85m distance — Meta's
 * comfort / usability guidance. Every press confirms with a haptic tick.
 */
export default function VRHud({ apiRef, grabbing }: Props) {
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

  const press = (e: XRInteractionEvent, fn: () => void) => {
    pulse(e.target, 0.5, 25);
    fn();
  };

  return createPortal(
    <group position={[0, 1.18, -0.8]} rotation={[-0.3, 0, 0]}>
      {/* Header */}
      <Text position={[0, 0.155, 0]} fontSize={0.026} color="#a1a1aa" anchorX="center" anchorY="middle">
        GRAPH CONTROLS
      </Text>

      {/* Row 1 — session + view */}
      <HudButton
        position={[-0.155, 0.045, 0]}
        label="RESET VIEW"
        hint="view home"
        accent={grabbing}
        onPress={(e) => press(e, () => apiRef.current?.reset())}
      />
      <HudButton
        position={[0.155, 0.045, 0]}
        label={busy ? '…' : passthrough ? 'VR MODE' : 'PASSTHROUGH'}
        hint="room on/off"
        accent={passthrough}
        onPress={(e) => void press(e, togglePassthrough)}
      />

      {/* Row 2 — fine transform, for when the two-hand gesture is awkward */}
      <Text position={[-0.285, -0.062, 0]} fontSize={0.02} color="#52525b" anchorX="center" anchorY="middle">
        SIZE
      </Text>
      <HudButton position={[-0.155, -0.062, 0]} label="−" small onPress={(e) => press(e, () => apiRef.current?.scaleBy(1 / 1.25))} />
      <HudButton position={[-0.03, -0.062, 0]} label="+" small onPress={(e) => press(e, () => apiRef.current?.scaleBy(1.25))} />
      <Text position={[0.1, -0.062, 0]} fontSize={0.02} color="#52525b" anchorX="center" anchorY="middle">
        TURN
      </Text>
      <HudButton position={[0.21, -0.062, 0]} label="⟲" small onPress={(e) => press(e, () => apiRef.current?.rotateBy(Math.PI / 12))} />
      <HudButton position={[0.315, -0.062, 0]} label="⟳" small onPress={(e) => press(e, () => apiRef.current?.rotateBy(-Math.PI / 12))} />
      {/* Row 3 — controller map, because nobody remembers a HUD they see once */}
      <Text
        position={[0, -0.165, 0]}
        fontSize={0.02}
        color="#71717a"
        anchorX="center"
        anchorY="middle"
        maxWidth={0.7}
        textAlign="center"
      >
        {grabbing
          ? 'holding — move hands'
          : 'grip: move · 2 grips: scale+turn · sticks: move/scale/turn'}
      </Text>
      <Text
        position={[0, -0.2, 0]}
        fontSize={0.02}
        color="#52525b"
        anchorX="center"
        anchorY="middle"
        maxWidth={0.7}
        textAlign="center"
      >
        trigger: expand node
      </Text>
    </group>,
    player,
  );
}

function HudButton({
  position,
  label,
  hint,
  onPress,
  accent,
  small,
}: {
  position: [number, number, number];
  label: string;
  hint?: string;
  onPress: (e: XRInteractionEvent) => void;
  accent?: boolean;
  small?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const w = small ? 0.085 : 0.26;
  const h = 0.075;

  return (
    <group position={position}>
      <Interactive
        onSelectStart={onPress}
        onHover={(e: XRInteractionEvent) => {
          pulse(e.target, 0.2, 12);
          setHover(true);
        }}
        onBlur={() => setHover(false)}
      >
        <group>
          <mesh raycast={() => null}>
            <planeGeometry args={[w, h + (hint ? 0.035 : 0)]} />
            <meshBasicMaterial color="#09090b" transparent opacity={0.72} depthWrite={false} />
          </mesh>
          <mesh>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial
              color={accent ? '#a78bfa' : hover ? '#e4e4e7' : '#3f3f46'}
              transparent
              opacity={hover || accent ? 0.95 : 0.85}
              depthWrite={false}
            />
          </mesh>
          <Text
            position={[0, hint ? 0.012 : 0, 0.001]}
            fontSize={small ? 0.05 : 0.032}
            color={accent || hover ? '#09090b' : '#fafafa'}
            anchorX="center"
            anchorY="middle"
            maxWidth={w * 0.92}
            textAlign="center"
            outlineWidth={0.003}
            outlineColor="#000000"
          >
            {label}
          </Text>
          {hint && (
            <Text
              position={[0, -0.032, 0.001]}
              fontSize={0.017}
              color="#a1a1aa"
              anchorX="center"
              anchorY="middle"
              maxWidth={w}
              textAlign="center"
            >
              {hint}
            </Text>
          )}
        </group>
      </Interactive>
    </group>
  );
}
