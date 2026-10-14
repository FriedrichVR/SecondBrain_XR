'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import JsonCard from './JsonCard';
import TreeLinks from './TreeLinks';
import { bboxOf, buildCards, layoutTree, normalizeTree, type LayoutEntry } from '@/utils/treeLayout';
import type { GraphData, GraphNode } from '@/utils/jsonToGraph';
import { visibleSubgraph } from '@/utils/jsonToGraph';

interface Props {
  graph: GraphData;
  hoveredId: string | null;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode) => void;
  /** Retained for API compatibility — cards follow the tree layout. */
  onDragNode: (id: string, point: THREE.Vector3) => void;
  onBudget?: (shown: number, total: number) => void;
}

/**
 * Cards are textures, not spheres: each one costs a CanvasTexture plus a few
 * hundred triangles, so the ceiling sits well below the old sphere budget.
 */
const MAX_CARDS = 220;

export default function Graph3D({
  graph,
  hoveredId,
  selectedId,
  onToggle,
  onHover,
  onSelect,
  onBudget,
}: Props) {
  const full = useMemo(() => visibleSubgraph(graph), [graph]);
  const { cards, byId } = useMemo(() => buildCards(full), [full]);

  // Budget: shallow cards first — they carry the structure.
  const shown = useMemo(() => {
    if (cards.length <= MAX_CARDS) return cards;
    return [...cards].sort((a, b) => a.node.depth - b.node.depth).slice(0, MAX_CARDS);
  }, [cards]);

  useEffect(() => {
    onBudget?.(shown.length, cards.length);
  }, [shown.length, cards.length, onBudget]);

  const shownIds = useMemo(() => new Set(shown.map((c) => c.node.id)), [shown]);

  // Tidy-tree layout, normalized into the viewing volume. The returned scale
  // is shared with card geometry so slots and cards stay consistent.
  const { layout, scale: cardScale } = useMemo(() => {
    const raw = layoutTree(shown, byId);
    return normalizeTree(raw);
  }, [shown, byId]);

  // Live rendered positions: cards write here every frame (drives spawn
  // positions and the connector buffer).
  const posMap = useRef(new Map<string, THREE.Vector3>());

  // Drop positions of cards that no longer exist (collapsed subtrees).
  useEffect(() => {
    const ids = new Set(layout.keys());
    posMap.current.forEach((_, id) => {
      if (!ids.has(id)) posMap.current.delete(id);
    });
  }, [layout]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const handleHover = (id: string | null) => onHover(id ? (nodeById.get(id) ?? null) : null);
  const handleSelect = (id: string) => {
    const n = nodeById.get(id);
    if (n) onSelect(n);
  };

  // Focus chain for the breadcrumb highlight.
  const focusId = hoveredId ?? selectedId;
  const chain = useMemo(() => {
    const set = new Set<string>();
    let cur = focusId ? nodeById.get(focusId) : undefined;
    while (cur) {
      set.add(cur.id);
      cur = cur.parentId ? nodeById.get(cur.parentId) : undefined;
    }
    return set;
  }, [nodeById, focusId]);

  const links = useMemo(() => {
    const out: Array<{ source: string; target: string }> = [];
    for (const c of shown) {
      for (const child of c.cardChildren) {
        if (shownIds.has(child.id)) out.push({ source: c.node.id, target: child.id });
      }
    }
    return out;
  }, [shown, shownIds]);

  const spawnFor = (cardId: string, parentId: string | null, fallback: LayoutEntry): THREE.Vector3 => {
    const live = parentId ? posMap.current.get(parentId) : undefined;
    if (live) return live.clone();
    const prev = posMap.current.get(cardId);
    if (prev) return prev.clone();
    return new THREE.Vector3(fallback.x, fallback.y, fallback.z);
  };

  return (
    <group>
      <TreeLinks links={links} posMap={posMap} chain={chain} cardScale={cardScale} />
      <CameraFrame layout={layout} dataKey={`${graph.nodes.length}:${shown.length}:${shown[0]?.node.id ?? ''}`} />

      {shown.map((c) => {
        const t = layout.get(c.node.id);
        if (!t) return null;
        return (
          <JsonCard
            key={c.node.id}
            spec={c}
            target={t}
            from={spawnFor(c.node.id, c.node.parentId, t)}
            posMap={posMap}
            cardScale={cardScale}
            hovered={hoveredId === c.node.id}
            selected={selectedId === c.node.id}
            spotlight={chain.size === 0 || chain.has(c.node.id)}
            onToggle={onToggle}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        );
      })}
    </group>
  );
}

/**
 * Frames the tree's bounding box. Re-frames on new datasets, stands down once
 * the user orbits, stays inert in VR.
 */
function CameraFrame({ layout, dataKey }: { layout: Map<string, LayoutEntry>; dataKey: string }) {
  type OrbitLike = {
    target: THREE.Vector3;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
  };

  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: OrbitLike | null;
    size: { width: number; height: number };
  };
  const userMoved = useRef(false);

  useEffect(() => {
    const ctrl = controls;
    if (!ctrl) return;
    const onStart = () => {
      userMoved.current = true;
    };
    ctrl.addEventListener('start', onStart);
    return () => ctrl.removeEventListener('start', onStart);
  }, [controls]);

  useEffect(() => {
    const xr = (camera as unknown as { xr?: { isPresenting: boolean } }).xr;
    if (!camera.isPerspectiveCamera || xr?.isPresenting) return;
    if (userMoved.current) return;
    const box = bboxOf(Array.from(layout.values()));
    if (!box) return;

    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Fit both axes with breathing room; half-extents plus a card margin.
    const halfH = box.height / 2 + 1.2;
    const halfW = box.width / 2 + 1.4;
    const dist = Math.max(halfH / Math.tan(vFov / 2), halfW / Math.tan(hFov / 2)) * 1.12;

    camera.position.set(box.cx, box.cy + dist * 0.12, dist);
    camera.lookAt(box.cx, box.cy, box.cz);
    if (controls) controls.target.set(box.cx, box.cy, box.cz);
    camera.updateProjectionMatrix();
  }, [dataKey, layout, camera, controls, size.width, size.height]);

  return null;
}
