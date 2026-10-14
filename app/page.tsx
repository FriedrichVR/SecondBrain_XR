'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { Expand, Shrink, RotateCcw, X } from 'lucide-react';
import JsonUploader from '@/components/ui/JsonUploader';
import JsonTreeView from '@/components/ui/JsonTreeView';
import SceneErrorBoundary from '@/components/xr/SceneErrorBoundary';
import type { TransformApi } from '@/components/xr/TransformRig';
import {
  jsonToGraph,
  toggleNode,
  setAllExpanded,
  visibleSubgraph,
  NODE_COLORS,
  type GraphData,
  type GraphNode,
} from '@/utils/jsonToGraph';

const VRCanvas = dynamic(() => import('@/components/xr/VRCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-2xl border border-white/10 text-xs uppercase tracking-[0.2em] text-zinc-600">
      Initializing
    </div>
  ),
});

const DEFAULT_DATA = {
  second_brain: {
    user: { name: 'Ada', role: 'Researcher', tags: ['xr', 'graphs', 'pkm'], active: true },
    notes: [
      { id: 1, title: 'Spatial memory', links: 12, published: true },
      { id: 2, title: 'Force layouts in VR', links: 8, published: false },
    ],
    stats: { nodes: 128, edges: 214, score: 9.7, archived: null },
  },
};

const LEGEND: Array<keyof typeof NODE_COLORS> = ['object', 'array', 'string', 'number', 'boolean', 'null'];

export default function Home() {
  const [label, setLabel] = useState('second_brain.json');
  const [graph, setGraph] = useState<GraphData>(() => jsonToGraph(DEFAULT_DATA));
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [keys, setKeys] = useState(Object.keys(DEFAULT_DATA).length);
  const [budget, setBudget] = useState<{ shown: number; total: number } | null>(null);
  // Ref, not state: the transform API lives inside the R3F/XR tree and we only
  // ever call methods on it, never read render-relevant data from it.
  const [rigApi, setRigApi] = useState<React.RefObject<TransformApi | null> | null>(null);
  const resetView = useCallback(() => rigApi?.current?.reset(), [rigApi]);
  const onBudget = useCallback((shown: number, total: number) => {
    setBudget((b) => (b && b.shown === shown && b.total === total ? b : { shown, total }));
  }, []);

  const visible = useMemo(() => visibleSubgraph(graph), [graph]);
  const inspected = hovered ?? selected;

  const load = useCallback((data: unknown, name: string) => {
    setLabel(name);
    setGraph(jsonToGraph(data));
    setHovered(null);
    setSelected(null);
    setKeys(data && typeof data === 'object' ? Object.keys(data as object).length : 1);
  }, []);

  const toggle = useCallback((id: string) => setGraph((g) => toggleNode(g, id)), []);
  const expandAll = useCallback(() => setGraph((g) => setAllExpanded(g, true)), []);
  const collapseAll = useCallback(() => setGraph((g) => setAllExpanded(g, false)), []);
  const clearSelection = useCallback(() => setSelected(null), []);

  // Grip/mouse drag mutates in place; the frame loop reads it without re-rendering
  const drag = useCallback(
    (id: string, point: THREE.Vector3) => {
      const n = graph.nodes.find((x) => x.id === id);
      if (n) {
        n.x = point.x;
        n.y = point.y;
        n.z = point.z;
      }
    },
    [graph],
  );

  return (
    <main className="mx-auto max-w-[1100px] px-5 pb-14 pt-8">
      {/* Compact header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-medium tracking-tight text-zinc-100">SECOND BRAIN</h1>
          <span className="h-px w-8 bg-white/15" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">WebXR JSON Graph</span>
        </div>
<div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
              title="Expand all"
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={collapseAll}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
              title="Collapse all"
            >
              <Shrink className="h-3.5 w-3.5" />
            </button>
            <span className="mx-1 h-3.5 w-px bg-white/10" />
            <button
              onClick={resetView}
              className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
              title="Reset view (also on the in-headset HUD)"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
      </header>

      {/* Main stage: 3D + docked inspector */}
      <section className="mt-5 grid gap-3 lg:grid-cols-[1fr_264px]">
        {/* Last-resort guard: if the 3D stage itself throws while mounting, the
            dashboard stays usable and the reason is shown in place. */}
        <SceneErrorBoundary
          resetKey={label}
          fallback={(err) => (
            <div className="flex h-[560px] flex-col items-center justify-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-6 text-center md:h-[640px]">
              <p className="text-xs uppercase tracking-[0.2em] text-rose-300/70">3D stage failed</p>
              <p className="max-w-md break-words font-mono text-[11px] leading-relaxed text-zinc-400">{err.message}</p>
            </div>
          )}
        >
          <VRCanvas
            graph={graph}
            hoveredId={hovered?.id ?? null}
            selectedId={selected?.id ?? null}
            onToggle={toggle}
            onHover={setHovered}
            onSelect={setSelected}
            onDragNode={drag}
            onClearSelection={clearSelection}
            onBudget={onBudget}
            budget={budget}
            resetKey={label}
            onRigReady={setRigApi}
          />
        </SceneErrorBoundary>

        {/* Inspector — replaces the old floating HTML tooltip */}
        <aside className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Inspector</span>
            {selected && (
              <button
                onClick={clearSelection}
                className="rounded p-0.5 text-zinc-600 transition hover:text-zinc-300"
                title="Clear selection"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {inspected ? (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: NODE_COLORS[inspected.type] }}
                />
                <p className="truncate font-mono text-[13px] text-zinc-100">{inspected.key}</p>
              </div>
              <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-zinc-600">
                {inspected.path}
              </p>

              <dl className="mt-4 space-y-2.5 border-t border-white/[0.07] pt-3.5">
                <Meta label="type" value={inspected.type} />
                <Meta label="depth" value={String(inspected.depth)} />
                {inspected.value !== undefined && <Meta label="value" value={inspected.value} mono />}
                {inspected.childIds.length > 0 && (
                  <Meta label="children" value={String(inspected.childIds.length)} />
                )}
                {inspected.childIds.length > 0 && (
                  <Meta label="state" value={inspected.expanded ? 'expanded' : 'collapsed'} />
                )}
              </dl>

              <div className="mt-4 space-y-1 border-t border-white/[0.07] pt-3.5">
                {inspected.childIds.length > 0 && (
                  <button
                    onClick={() => toggle(inspected.id)}
                    className="w-full rounded-lg border border-white/10 py-1.5 text-[11px] text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.04]"
                  >
                    {inspected.expanded ? 'Collapse subtree' : `Expand ${inspected.childIds.length} children`}
                  </button>
                )}
                <p className="pt-1 text-center text-[10px] leading-relaxed text-zinc-700">
                  {hovered && !selected ? 'Click to pin' : 'Click empty space to release'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center">
              <p className="text-[11px] leading-relaxed text-zinc-700">
                Hover a node to inspect it. Trigger or click expands and collapses its subtree.
              </p>
            </div>
          )}

          <div className="border-t border-white/[0.07] pt-3.5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {LEGEND.map((t) => (
                <span key={t} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_COLORS[t] }} />
                  {t}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {/* Stats strip */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        <span className="text-zinc-400">{label}</span>
        <span>{visible.nodes.length} nodes</span>
        <span>{visible.links.length} edges</span>
        <span>{graph.nodes.length} total</span>
        <span className="ml-auto normal-case tracking-normal">HTTPS required · Meta Browser</span>
      </div>

      {/* Data entry */}
      <section className="mt-10 grid gap-3 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">01 — Source</h2>
          <JsonUploader onJson={load} current={label.replace(/\.json$/, '')} />
        </div>
        <div>
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
            02 — Structure · {keys} keys
          </h2>
          <JsonTreeView data={reconstructPreview(graph)} />
        </div>
      </section>
    </main>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">{label}</dt>
      <dd className={`truncate text-right text-[11px] text-zinc-300 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

/** Rebuild a plain preview object from the graph for the tree view. */
function reconstructPreview(graph: GraphData): unknown {
  const root = graph.nodes.find((n) => n.parentId === null);
  if (!root) return {};
  const byParent = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  const build = (id: string): unknown => {
    const kids = byParent.get(id) ?? [];
    if (kids.length === 0) return graph.nodes.find((n) => n.id === id)?.value ?? null;
    const self = graph.nodes.find((n) => n.id === id);
    if (self?.type === 'array') return kids.map((k) => build(k.id));
    const obj: Record<string, unknown> = {};
    for (const k of kids) obj[k.key] = build(k.id);
    return obj;
  };
  const out: Record<string, unknown> = {};
  for (const c of byParent.get(root.id) ?? []) out[c.key] = build(c.id);
  return out;
}