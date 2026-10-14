import type { GraphData, GraphNode } from './jsonToGraph';

/** Face canvas geometry — the single source of truth shared with cardTexture. */
export const FACE_W = 512;
const FACE_PAD = 28;
const FACE_HEADER_H = 66;
const FACE_ROW_H = 46;
const FACE_FOOTER_H = 50;

/** Canvas pixel height for a card face with the given visible rows. */
export function faceHeightPx(rowCount: number, hasFooter: boolean): number {
  return FACE_PAD * 2 + FACE_HEADER_H + rowCount * FACE_ROW_H + (hasFooter ? FACE_FOOTER_H : 0);
}

export interface CardSpec {
  node: GraphNode;
  /** Visible children rendered as cards (branches only; primitives are rows). */
  cardChildren: GraphNode[];
  /** Primitive children rendered as rows inside this card. */
  rowChildren: GraphNode[];
  /** Total children (cards + rows), for the `{n}` / `+N more` labels. */
  childCount: number;
  /** Card face height in world units at scale 1 — drives slot reservation. */
  faceH: number;
}

/**
 * Single source of truth for what a card shows: branch children first, then
 * primitives, capped by card role. cardTexture draws exactly this.
 */
export function rowsForCard(cardChildren: GraphNode[], rowChildren: GraphNode[]): {
  rows: GraphNode[];
  hidden: number;
} {
  const cap = cardChildren.length > 0 ? TREE.maxRowsBranch : TREE.maxRowsPerCard;
  const kids = [...cardChildren, ...rowChildren];
  return { rows: kids.slice(0, cap), hidden: Math.max(0, kids.length - cap) };
}

export interface LayoutEntry {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Layout constants — world units before view normalization. */
export const TREE = {
  /** Must clear CARD_W plus elbow run space on both sides. */
  columnGap: 3.2,
  /** World width of every card face; height derives from the face aspect. */
  cardW: 1.7,
  /** Minimum clear air between stacked cards (world units at scale 1). */
  gapMin: 0.35,
  /** Z layering per depth column: real parallax without breaking readability. */
  layerGap: 0.55,
  /** Padding INSIDE the normalized view volume (0..1 fraction kept as margin). */
  viewMargin: 0.12,
  /** Rows shown on a leaf-branch card (no card-children: slots are exact). */
  maxRowsPerCard: 8,
  /**
   * Rows shown on a branch that also has card-children. Kept small on purpose:
   * detail lives in the child columns (like the reference), and a short face
   * guarantees the parent never sticks out past its slot accounting.
   */
  maxRowsBranch: 3,
} as const;

function isBranch(n: GraphNode): boolean {
  return n.type === 'object' || n.type === 'array' || n.type === 'root';
}

function splitChildren(node: GraphNode, byId: Map<string, GraphNode>): { cards: GraphNode[]; rows: GraphNode[] } {
  const cards: GraphNode[] = [];
  const rows: GraphNode[] = [];
  for (const id of node.childIds) {
    const c = byId.get(id);
    if (!c || !c.visible) continue;
    if (isBranch(c)) cards.push(c);
    else rows.push(c);
  }
  return { cards, rows };
}

/**
 * Build the card inventory for the current visible set. Primitives never get
 * cards — they render as rows inside their parent card, exactly like the
 * JSONCrack reference.
 */
export function buildCards(graph: GraphData): { cards: CardSpec[]; byId: Map<string, CardSpec> } {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const cards: CardSpec[] = [];
  const byId = new Map<string, CardSpec>();
  for (const node of graph.nodes) {
    if (!node.visible || !isBranch(node)) continue;
    const { cards: cardChildren, rows: rowChildren } = splitChildren(node, nodeById);
    const { rows, hidden } = rowsForCard(cardChildren, rowChildren);
    const spec: CardSpec = {
      node,
      cardChildren,
      rowChildren,
      // Total children, hidden included: a collapsed card still advertises
      // what expanding it would reveal, like the `{5 keys}` reference.
      childCount: node.childIds.length,
      faceH: (TREE.cardW * faceHeightPx(rows.length, hidden > 0)) / 512,
    };
    cards.push(spec);
    byId.set(node.id, spec);
  }
  return { cards, byId };
}

/**
 * Classic tidy-tree layout in two passes:
 *  1. leaves (cards without card-children) stack with unit spacing,
 *  2. every branch sits at the midpoint of its first/last card-child.
 *
 * Columns come from depth, so X is monotonic by construction. Returns raw
 * coordinates; call `normalizeTree` to fit the view volume.
 */
export function layoutTree(cards: CardSpec[], byId: Map<string, CardSpec>): Map<string, LayoutEntry> {
  const out = new Map<string, LayoutEntry>();
  let cursor = 0;

  // Returns the centre Y of the node. Slots follow each card's real height,
  // and every subtree reports the span it truly occupies — including the
  // parent's own face, which can stick out past a small set of children.
  // Siblings stack past the previous subtree's bottom edge; if the parent's
  // face pokes above the entry cursor, the whole just-built subtree shifts
  // down as one rigid block, so the midpoint invariant survives the shift.
  const spans = new Map<string, { center: number; top: number; bottom: number }>();
  const visit = (spec: CardSpec): number => {
    const known = spans.get(spec.node.id);
    if (known !== undefined) return known.center;

    const h = spec.faceH;
    const entry = cursor;
    const kidCentres: number[] = [];
    let top = Infinity;
    let bottom = -Infinity;
    const ids: string[] = [spec.node.id];
    for (const child of spec.cardChildren) {
      const childSpec = byId.get(child.id);
      if (!childSpec) continue;
      kidCentres.push(visit(childSpec));
      const cs = spans.get(child.id);
      if (cs) {
        top = Math.min(top, cs.top);
        bottom = Math.max(bottom, cs.bottom);
        collectIds(child.id, ids);
      }
    }

    let y: number;
    if (kidCentres.length === 0) {
      y = cursor + h / 2;
      cursor = y + h / 2 + TREE.gapMin;
      top = y - h / 2;
      bottom = y + h / 2;
    } else {
      y = (Math.min(...kidCentres) + Math.max(...kidCentres)) / 2;
      top = Math.min(top, y - h / 2);
      bottom = Math.max(bottom, y + h / 2);
      const shift = entry - top;
      if (shift > 0) {
        for (const id of ids) {
          const e = out.get(id);
          if (e) e.y += shift;
        }
        y += shift;
        top += shift;
        bottom += shift;
      }
      cursor = Math.max(cursor, bottom + TREE.gapMin);
    }
    spans.set(spec.node.id, { center: y, top, bottom });
    out.set(spec.node.id, { id: spec.node.id, x: spec.node.depth * TREE.columnGap, y, z: -spec.node.depth * TREE.layerGap });
    return y;
  };

  const collectIds = (id: string, into: string[]): void => {
    into.push(id);
    const spec = byId.get(id);
    if (!spec) return;
    for (const child of spec.cardChildren) collectIds(child.id, into);
  };

  for (const spec of cards) {
    if (spec.node.parentId === null) visit(spec);
  }
  // Orphan cards (budget clip kept a card whose parent was dropped)
  for (const spec of cards) {
    if (!spans.has(spec.node.id)) visit(spec);
  }
  return out;
}

export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cy: number;
  cz: number;
  width: number;
  height: number;
  depth: number;
}

export function bboxOf(entries: LayoutEntry[]): BBox | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let n = 0;
  for (const e of entries) {
    n++;
    minX = Math.min(minX, e.x);
    maxX = Math.max(maxX, e.x);
    minY = Math.min(minY, e.y);
    maxY = Math.max(maxY, e.y);
    minZ = Math.min(minZ, e.z);
    maxZ = Math.max(maxZ, e.z);
  }
  if (n === 0) return null;
  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    cz: (minZ + maxZ) / 2,
    width: Math.max(maxX - minX, 1e-3),
    height: Math.max(maxY - minY, 1e-3),
    depth: Math.max(maxZ - minZ, 1e-3),
  };
}

/**
 * Fit the tree into a comfortable viewing volume, preserving aspect.
 * `targetHeight` is world units; width follows the tree's own proportions.
 *
 * Returns the uniform scale applied. Callers must apply the SAME scale to
 * card geometry: scaling positions without scaling cards is what causes
 * overlaps in tall trees (slots shrink, cards don't).
 */
export function normalizeTree(
  layout: Map<string, LayoutEntry>,
  targetHeight = 5.2,
): { layout: Map<string, LayoutEntry>; scale: number } {
  const box = bboxOf(Array.from(layout.values()));
  if (!box) return { layout, scale: 1 };
  const usable = 1 - TREE.viewMargin * 2;
  // Clamp both ends: a one-card tree has ~zero height (avoid 4000× blowups),
  // and a giant tree keeps shrinking (the camera frames it, the user zooms).
  const scale = Math.min(2, (targetHeight * usable) / box.height);
  const out = new Map<string, LayoutEntry>();
  layout.forEach((e, id) => {
    out.set(id, {
      id,
      x: (e.x - box.cx) * scale,
      y: (e.y - box.cy) * scale,
      z: (e.z - box.cz) * scale,
    });
  });
  return { layout: out, scale };
}
