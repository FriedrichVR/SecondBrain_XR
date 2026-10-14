'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CARD_W } from './JsonCard';

interface Props {
  /** Parent card id → child card id, one entry per drawn connector. */
  links: Array<{ source: string; target: string }>;
  /** Live rendered positions, written every frame by the cards. */
  posMap: React.MutableRefObject<Map<string, THREE.Vector3>>;
  /** Ids on the focus path (hovered/selected chain). */
  chain: Set<string>;
  /** Same uniform scale as cards and layout — edge offsets must match. */
  cardScale: number;
}

/** Segments per connector — fixed so the buffer never reallocates. */
const SEG = 22;
const CORNER_R = 0.32;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function sign(v: number): number {
  return v >= 0 ? 1 : -1;
}

/**
 * Orthogonal elbow from a parent card's right edge to a child card's left
 * edge, with rounded corners: horizontal run → curve → vertical run → curve →
 * horizontal run. Z lerps from parent depth to child depth so connectors stay
 * glued to their cards during expand/collapse glides.
 */
function elbowPoints(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: THREE.Vector3[]): void {
  const midX = (x0 + x1) / 2;
  const pts: THREE.Vector3[] = [];
  const sy = y1 === y0 ? 0 : sign(y1 - y0);
  const run = Math.max(Math.abs(midX - x0) - CORNER_R, 0.01);
  const run2 = Math.max(Math.abs(x1 - midX) - CORNER_R, 0.01);
  const vert = Math.abs(y1 - y0);

  const push = (x: number, y: number, t: number) => {
    pts.push(new THREE.Vector3(x, y, z0 + (z1 - z0) * t));
  };

  // Horizontal run out of the parent
  const hSteps = 4;
  for (let i = 0; i <= hSteps; i++) {
    const f = i / hSteps;
    push(x0 + (midX - sign(midX - x0) * CORNER_R - x0) * f, y0, (f * run) / Math.max(run + vert + run2, 1e-3));
  }
  // Corner 1
  if (sy !== 0) {
    const cx = midX - sign(midX - x0) * CORNER_R;
    for (let i = 1; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      push(cx + Math.sin(a) * CORNER_R * sign(midX - x0), y0 + (1 - Math.cos(a)) * CORNER_R * sy, 0.3);
    }
  }
  // Vertical run
  const vSteps = 6;
  const yStart = sy === 0 ? y0 : y0 + sy * CORNER_R;
  const yEnd = sy === 0 ? y1 : y1 - sy * CORNER_R;
  for (let i = 1; i <= vSteps; i++) {
    const f = i / vSteps;
    push(midX, yStart + (yEnd - yStart) * f, 0.35 + 0.3 * f);
  }
  // Corner 2: vertical run -> horizontal run into the child
  if (sy !== 0) {
    const sx2 = sign(x1 - midX);
    for (let i = 1; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      push(midX + Math.sin(a) * CORNER_R * sx2, y1 - sy * CORNER_R + (1 - Math.cos(a)) * CORNER_R * sy, 0.7);
    }
  }
  // Horizontal run into the child
  for (let i = 1; i <= hSteps; i++) {
    const f = i / hSteps;
    push(midX + sign(x1 - midX) * CORNER_R + (x1 - (midX + sign(x1 - midX) * CORNER_R)) * f, y1, 0.75 + 0.25 * f);
  }

  // Resample uniformly to SEG+1 points
  const total = pts.length;
  for (let i = 0; i <= SEG; i++) {
    const f = (i / SEG) * (total - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, total - 1);
    out[i].copy(pts[i0]).lerp(pts[i1], f - i0);
  }
}

/**
 * All connectors in ONE draw call. Geometry is rebuilt every frame from the
 * cards' live positions (cheap: fixed-size buffer, no allocation), while
 * colours update only when the focus chain changes.
 */
export default function TreeLinks({ links, posMap, chain, cardScale }: Props) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = Math.max(links.length, 1);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * SEG * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * SEG * 2 * 3), 3));
    return g;
  }, [links.length]);
  useEffect(() => () => geo.dispose(), [geo]);

  const EDGE_BASE = useMemo(() => new THREE.Color('#4c4f8f'), []);
  const EDGE_PATH = useMemo(() => new THREE.Color('#ffffff'), []);

  useEffect(() => {
    const attr = geo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < links.length; i++) {
      const onPath = chain.has(links[i].source) && chain.has(links[i].target);
      const c = onPath ? EDGE_PATH : EDGE_BASE;
      for (let s = 0; s < SEG; s++) {
        attr.setXYZ(i * SEG + s * 2, c.r, c.g, c.b);
        attr.setXYZ(i * SEG + s * 2 + 1, c.r, c.g, c.b);
      }
    }
    attr.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, links, chain]);

  const sample = useRef<Array<THREE.Vector3>>(Array.from({ length: SEG + 1 }, () => new THREE.Vector3()));
  const linksRef = useRef(links);
  linksRef.current = links;

  useFrame(() => {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const map = posMap.current;
    const ls = linksRef.current;
    for (let i = 0; i < ls.length; i++) {
      const s = map.get(ls[i].source);
      const t = map.get(ls[i].target);
      if (!s || !t) {
        // Park degenerate connectors at the origin (zero-length = invisible)
        for (let k = 0; k < SEG * 2; k++) pos.setXYZ(i * SEG + k, 0, 0, 0);
        continue;
      }
      tmpA.set(s.x + (CARD_W * cardScale) / 2, s.y, s.z);
      tmpB.set(t.x - (CARD_W * cardScale) / 2, t.y, t.z);
      elbowPoints(tmpA.x, tmpA.y, tmpA.z, tmpB.x, tmpB.y, tmpB.z, sample.current);
      for (let k = 0; k < SEG; k++) {
        const p = sample.current[k];
        const q = sample.current[k + 1];
        pos.setXYZ(i * SEG + k * 2, p.x, p.y, p.z);
        pos.setXYZ(i * SEG + k * 2 + 1, q.x, q.y, q.z);
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geo} frustumCulled={false} raycast={() => null}>
      <lineBasicMaterial color="#ffffff" vertexColors transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
  );
}
