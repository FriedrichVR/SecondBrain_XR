'use client';

import type { XRController } from '@react-three/xr';

/**
 * Haptic pulses through the controller that owns the interaction.
 *
 * Convención de Meta (Quest): el trigger es "select" y el grip es "grab"; la
 * confirmación táctil acompaña a ambos más el hover del ray. Esto usa la
 * vibrationActuator moderna cuando existe y cae al hapticActuators legacy.
 * Nunca lanza: en desktop o sin actuador simplemente no hace nada.
 */
export function pulse(
  controller: XRController | { inputSource?: XRInputSource | null } | null | undefined,
  strength = 0.6,
  ms = 25,
): void {
  try {
    const gamepad = controller?.inputSource?.gamepad as
      | (Gamepad & {
          vibrationActuator?: { playEffect?: (t: string, p: Record<string, number>) => unknown };
          hapticActuators?: Array<{ pulse?: (v: number, d: number) => unknown }>;
        })
      | null
      | undefined;
    if (!gamepad) return;

    const modern = gamepad.vibrationActuator;
    if (modern?.playEffect) {
      void modern.playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: strength,
        weakMagnitude: strength * 0.6,
      });
      return;
    }
    const legacy = gamepad.hapticActuators?.[0];
    legacy?.pulse?.(strength, ms);
  } catch {
    /* haptics must never break input */
  }
}
