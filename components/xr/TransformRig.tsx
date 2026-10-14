'use client';

import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useXREvent, type XRController } from '@react-three/xr';

export interface TransformApi {
  reset: () => void;
  /** Discrete nudges, for when the two-handed gesture is awkward. */
  scaleBy: (factor: number) => void;
  rotateBy: (radians: number) => void;
}

interface Props {
  children: React.ReactNode;
  apiRef?: React.RefObject<TransformApi | null>;
  onGrabChange?: (grabbing: boolean) => void;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
const UP = new THREE.Vector3(0, 1, 0);

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpOffset = new THREE.Vector3();

function clampScale(v: number) {
  return THREE.MathUtils.clamp(v, MIN_SCALE, MAX_SCALE);
}

/**
 * Head-driven transform of the whole graph.
 *
 * Grip semantics, which is what people expect from a "grab the universe"
 * gesture and leaves the trigger free for node selection:
 *
 *   - one grip  -> translate, following the hand 1:1
 *   - two grips -> translate + rotate + scale at once, using the classic
 *                 two-hand rule: hand separation drives scale, the angle
 *                 between the hands drives rotation, the midpoint drives
 *                 translation.
 *
 * Targets are written on grab and interpolated every frame, so a dropped
 * frame or a noisy tracking sample shows up as slight smoothing rather than a
 * jump — without that a 90Hz headset visibly stutters the graph.
 */
export default function TransformRig({ children, apiRef, onGrabChange }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  const target = useRef({
    pos: new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  });
  const current = useRef({
    pos: new THREE.Vector3(0, 0, 0),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  });

  const held = useRef(new Map<'left' | 'right', THREE.Vector3>());
  const controllers = useRef(new Map<'left' | 'right', XRController>());

  const origin = useRef({
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
    center: new THREE.Vector3(),
    vec: new THREE.Vector3(1, 0, 0),
    dist: 1,
    offset: new THREE.Vector3(),
    hand: new THREE.Vector3(),
  });

  const wasGrabbed = useRef(false);
  const grabbing = held.current.size > 0;
  useEffect(() => {
    if (grabbing !== wasGrabbed.current) {
      wasGrabbed.current = grabbing;
      onGrabChange?.(grabbing);
    }
  }, [grabbing, onGrabChange]);

  const gripPos = (c: XRController | undefined, out: THREE.Vector3) => {
    if (c?.grip) return c.grip.getWorldPosition(out);
    if (c) return c.getWorldPosition(out);
    return out.set(0, 0, 0);
  };

  /** Re-seed the reference frame from the current target. */
  const seed = useCallback(() => {
    const t = target.current;
    const o = origin.current;
    o.pos.copy(t.pos);
    o.quat.copy(t.quat);
    o.scale.copy(t.scale);
  }, []);

  const begin = useCallback(
    (hand: 'left' | 'right', controller: XRController) => {
      controllers.current.set(hand, controller);
      gripPos(controller, tmpVec);
      held.current.set(hand, tmpVec.clone());
      seed();

      if (held.current.size === 2) {
        const [a, b] = Array.from(held.current.values());
        const o = origin.current;
        o.center.copy(a).add(b).multiplyScalar(0.5);
        o.vec.copy(b).sub(a);
        o.dist = Math.max(o.vec.length(), 1e-3);
        o.vec.normalize();
        // Keep the graph rigidly attached to the grab point while rotating
        o.offset.copy(o.pos).sub(o.center);
      } else {
        origin.current.hand.copy(tmpVec);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const end = useCallback(
    (hand: 'left' | 'right') => {
      held.current.delete(hand);
      seed();
    },
    [seed],
  );

  useXREvent('squeezestart', (e) => {
    const h = e.nativeEvent.data?.handedness;
    if (h === 'left' || h === 'right') begin(h, e.nativeEvent.target as XRController);
  });
  useXREvent('squeezeend', (e) => {
    const h = e.nativeEvent.data?.handedness;
    if (h === 'left' || h === 'right') end(h);
  });
  useXREvent('connected', (e) => {
    const h = e.nativeEvent.data?.handedness;
    if (h === 'left' || h === 'right') controllers.current.set(h, e.nativeEvent.target as XRController);
  });
  useXREvent('disconnected', (e) => {
    const h = e.nativeEvent.data?.handedness;
    if (h === 'left' || h === 'right') {
      controllers.current.delete(h);
      end(h);
    }
  });

  useImperativeHandle(
    apiRef,
    () => ({
      reset() {
        const t = target.current;
        t.pos.set(0, 0, 0);
        t.quat.identity();
        t.scale.setScalar(1);
        held.current.clear();
      },
      scaleBy(factor) {
        const t = target.current;
        t.scale.setScalar(clampScale(t.scale.x * factor));
      },
      rotateBy(radians) {
        target.current.quat.premultiply(tmpQuat.setFromAxisAngle(UP, radians));
      },
    }),
    [],
  );

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const t = target.current;
    const c = current.current;
    const o = origin.current;

    const hands = Array.from(held.current.entries());
    for (const [hand, vec] of hands) vec.copy(gripPos(controllers.current.get(hand), tmpA));

    if (hands.length === 2) {
      const [a, b] = hands.map(([, v]) => v);
      tmpA.copy(a).add(b).multiplyScalar(0.5); // new midpoint
      tmpB.copy(b).sub(a); // new separation
      const dist = Math.max(tmpB.length(), 1e-3);
      tmpB.normalize();

      tmpQuat.setFromUnitVectors(o.vec, tmpB);
      const factor = clampScale((dist / o.dist) * o.scale.x) / o.scale.x;

      t.quat.copy(tmpQuat).multiply(o.quat);
      t.scale.copy(o.scale).multiplyScalar(factor);
      // Rotate the grab offset as well, otherwise the graph swings around the
      // world origin while you turn your hands
      t.pos.copy(tmpA).add(tmpOffset.copy(o.offset).applyQuaternion(tmpQuat));
    } else if (hands.length === 1) {
      const [, v] = hands[0];
      t.pos.copy(o.pos).add(tmpB.copy(v).sub(o.hand));
    }

    const k = 1 - Math.exp(-dt * 18);
    c.pos.lerp(t.pos, k);
    c.scale.lerp(t.scale, k);
    c.quat.slerp(t.quat, k);

    g.position.copy(c.pos);
    g.quaternion.copy(c.quat);
    g.scale.copy(c.scale);
  });

  return <group ref={groupRef}>{children}</group>;
}