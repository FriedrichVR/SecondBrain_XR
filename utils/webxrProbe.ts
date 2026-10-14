'use client';

import { useEffect, useState } from 'react';

export interface Capabilities {
  secureContext: boolean;
  protocol: string;
  webgl: 'pending' | 'ok' | 'fail';
  renderer: string;
  xr: boolean;
  immersiveVR: 'pending' | 'supported' | 'unsupported' | 'error';
  dpr: number;
  /** Anything that went wrong while probing. */
  note: string;
}

const INITIAL: Capabilities = {
  secureContext: false,
  protocol: '?',
  webgl: 'pending',
  renderer: '?',
  xr: false,
  immersiveVR: 'pending',
  dpr: 1,
  note: '',
};

/**
 * Reports what this browser actually supports, so a blank 3D stage can be
 * explained instead of guessed at.
 *
 * This matters most on headset browsers: the failure modes there (no WebGL
 * context, insecure context, WebXR unsupported) all look identical from the
 * outside — a black rectangle and no button.
 */
export function useCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const next: Capabilities = {
      secureContext: typeof window !== 'undefined' && window.isSecureContext,
      protocol: location.protocol.replace(':', ''),
      webgl: 'pending',
      renderer: '?',
      xr: typeof navigator !== 'undefined' && 'xr' in navigator,
      immersiveVR: 'pending',
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      note: '',
    };

    // Probe WebGL on a throwaway canvas and release it immediately —
    // browsers cap the number of live contexts.
    try {
      const c = document.createElement('canvas');
      const gl = (c.getContext('webgl2') ||
        c.getContext('webgl')) as WebGLRenderingContext | null;
      if (!gl) {
        next.webgl = 'fail';
        next.note = 'no WebGL context';
      } else {
        next.webgl = 'ok';
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        next.renderer = String(
          (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '?',
        ).slice(0, 48);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch (e) {
      next.webgl = 'fail';
      next.note = e instanceof Error ? e.message : 'webgl probe threw';
    }

    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      next.immersiveVR = 'unsupported';
      next.note = next.note || 'navigator.xr missing';
    } else {
      xr.isSessionSupported('immersive-vr')
        .then((ok) => {
          if (cancelled) return;
          next.immersiveVR = ok ? 'supported' : 'unsupported';
          setCaps({ ...next });
        })
        .catch((err) => {
          if (cancelled) return;
          next.immersiveVR = 'error';
          next.note = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 80) : 'isSessionSupported rejected';
          setCaps({ ...next });
        });
    }

    setCaps({ ...next });
    return () => {
      cancelled = true;
    };
  }, []);

  return caps;
}

/** Human-readable summary for the HUD strip. */
export function summarise(c: Capabilities): Array<{ k: string; v: string; bad?: boolean }> {
  return [
    { k: 'webgl', v: c.webgl, bad: c.webgl === 'fail' },
    { k: 'xr', v: c.xr ? 'yes' : 'no', bad: !c.xr },
    { k: 'vr', v: c.immersiveVR, bad: c.immersiveVR !== 'supported' },
    { k: 'proto', v: c.protocol, bad: !c.secureContext },
    { k: 'dpr', v: String(c.dpr) },
  ];
}