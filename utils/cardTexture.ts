import * as THREE from 'three';
import { NODE_COLORS, type GraphNode, type NodeType } from './jsonToGraph';
import type { CardSpec } from './treeLayout';
import { FACE_W, TREE, faceHeightPx, rowsForCard } from './treeLayout';

const W = FACE_W;
const PAD = 28;
const HEADER_H = 66;
const ROW_H = 46;
const FOOTER_H = 50;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const VALUE_COLORS: Record<NodeType, string> = {
  root: '#e4e4e7',
  object: '#c4b5fd',
  array: '#67e8f9',
  string: '#86efac',
  number: '#fbbf24',
  boolean: '#f9a8d4',
  null: '#94a3b8',
};

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + '…';
}

export interface RowSpec {
  key: string;
  keyColor: string;
  value: string;
  valueColor: string;
}

/** Rows for a card: branch children first (`key: {n}`), then primitives (`key: value`). */
export function cardRows(spec: CardSpec): { rows: RowSpec[]; hidden: number } {
  // Row selection lives in treeLayout.rowsForCard so faces and slot
  // reservation can never disagree; drawing only maps to colours here.
  const picked = rowsForCard(spec.cardChildren, spec.rowChildren);
  const rows: RowSpec[] = [];
  for (const child of picked.rows) {
    if (child.type === 'object' || child.type === 'array') {
      rows.push({
        key: `– ${child.key}`,
        keyColor: NODE_COLORS[child.type],
        value: `{${child.childIds.length}}`,
        valueColor: '#a1a1aa',
      });
    } else if (child.type === 'root') {
      rows.push({ key: `– ${child.key}`, keyColor: NODE_COLORS.root, value: '', valueColor: '#a1a1aa' });
    } else {
      rows.push({
        key: child.key,
        keyColor: NODE_COLORS[child.type] ?? '#e4e4e7',
        value: child.value ?? 'null',
        valueColor: VALUE_COLORS[child.type] ?? '#e4e4e7',
      });
    }
  }
  return { rows, hidden: picked.hidden };
}

export interface CardFace {
  texture: THREE.CanvasTexture;
  /** height / width — the plane geometry must match or text stretches. */
  aspect: number;
}

export function drawCardTexture(spec: CardSpec, opts?: { selected?: boolean; hovered?: boolean }): CardFace {
  const { rows, hidden } = cardRows(spec);
  const H = faceHeightPx(rows.length, hidden > 0);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');

  // Body
  const sel = opts?.selected;
  const hov = opts?.hovered;
  ctx.fillStyle = sel ? 'rgba(24,20,38,0.96)' : 'rgba(12,12,16,0.94)';
  roundRect(ctx, 2, 2, W - 4, H - 4, 26);
  ctx.fill();
  ctx.lineWidth = sel || hov ? 3 : 2;
  ctx.strokeStyle = sel ? '#a78bfa' : hov ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)';
  ctx.stroke();

  // Header: key + count chip
  const n = spec.node;
  ctx.textBaseline = 'middle';
  ctx.font = `600 31px ${FONT}`;
  const headerColor = n.type === 'root' ? '#ffffff' : (NODE_COLORS[n.type] ?? '#e4e4e7');
  const count = n.type === 'object' ? `{${spec.childCount}}` : n.type === 'array' ? `[${spec.childCount}]` : '';
  const headerKey = truncate(ctx, n.key, W - PAD * 2 - ctx.measureText(count ? `  ${count}` : '').width - 10);
  let y = PAD + HEADER_H / 2;
  ctx.fillStyle = headerColor;
  ctx.fillText(headerKey, PAD, y);
  if (count) {
    const kw = ctx.measureText(headerKey).width;
    ctx.fillStyle = '#71717a';
    ctx.font = `400 27px ${FONT}`;
    ctx.fillText(`  ${count}`, PAD + kw, y);
  }

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD, PAD + HEADER_H);
  ctx.lineTo(W - PAD, PAD + HEADER_H);
  ctx.stroke();

  // Rows
  ctx.font = `400 27px ${FONT}`;
  rows.forEach((r, i) => {
    const ry = PAD + HEADER_H + i * ROW_H + ROW_H / 2;
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, PAD + HEADER_H + i * ROW_H);
      ctx.lineTo(W - PAD, PAD + HEADER_H + i * ROW_H);
      ctx.stroke();
    }
    ctx.fillStyle = r.keyColor;
    const key = truncate(ctx, r.key, W - PAD * 2 - 160);
    ctx.fillText(key, PAD, ry);
    if (r.value) {
      ctx.fillStyle = r.valueColor;
      ctx.fillText(truncate(ctx, r.value, 300), W - PAD - Math.min(300, ctx.measureText(truncate(ctx, r.value, 300)).width), ry);
    }
  });

  // Footer
  if (hidden > 0) {
    const fy = H - PAD - FOOTER_H / 2;
    ctx.fillStyle = '#71717a';
    ctx.font = `400 25px ${FONT}`;
    ctx.fillText(`+${hidden} more`, PAD, fy);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: H / W };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type { GraphNode };
