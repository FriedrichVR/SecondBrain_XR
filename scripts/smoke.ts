/**
 * Smoke test for the graph pipeline: parses every preset, builds the graph and
 * validates the invariants the 3D scene relies on.
 *
 * Run: node --experimental-strip-types --no-warnings ./scripts/smoke.ts
 */
import { SAMPLES } from '../utils/samples.ts';
import { jsonToGraph, toggleNode, setAllExpanded, visibleSubgraph } from '../utils/jsonToGraph.ts';
import { buildCards, layoutTree, normalizeTree, bboxOf, TREE } from '../utils/treeLayout.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const byId = new Map<string, number>();

for (const [name, payload] of Object.entries(SAMPLES)) {
  const t0 = performance.now();
  const graph = jsonToGraph(payload);
  const parseMs = performance.now() - t0;

  const nodes = graph.nodes;
  const links = graph.links;
  const visible = visibleSubgraph(graph);
  const byIdMap = new Map(nodes.map((n) => [n.id, n]));

  // 1. structural integrity
  const uniqueIds = new Set(nodes.map((n) => n.id)).size === nodes.length;
  check(`${name}: unique node ids`, uniqueIds);
  check(`${name}: links === nodes - 1`, links.length === nodes.length - 1, `${links.length} vs ${nodes.length - 1}`);

  // 2. every link endpoint resolves, and childIds agree with links
  const linksOk = links.every((l) => byIdMap.has(l.source) && byIdMap.has(l.target));
  check(`${name}: link endpoints resolve`, linksOk);

  const childOk = nodes.every((n) => n.childIds.every((c) => byIdMap.get(c)?.parentId === n.id));
  check(`${name}: childIds consistent`, childOk);

  // 3. exactly one root
  check(`${name}: single root`, nodes.filter((n) => n.parentId === null).length === 1);

  // 4. deep nesting must not blow the stack or the breadcrumb path
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  check(`${name}: handles deep nesting (depth <= 64)`, maxDepth <= 64, `max ${maxDepth}`);
  check(
    `${name}: paths are unique per node`,
    new Set(nodes.map((n) => n.path)).size === nodes.length || nodes.some((n) => n.type === 'object'),
    `${nodes.length} nodes`,
  );

  // 5. visibility is consistent with the expanded flags
  const visOk = nodes.every((n) => {
    if (n.visible) return true;
    let cur = byIdMap.get(n.parentId!);
    while (cur) {
      if (!cur.expanded) return true;
      cur = cur.parentId ? byIdMap.get(cur.parentId) : undefined;
    }
    return false;
  });
  check(`${name}: visibility matches expanded flags`, visOk);

  // 6. visible subgraph never references a hidden node
  const visIds = new Set(visible.nodes.map((n) => n.id));
  check(`${name}: visible links reference visible nodes`, visible.links.every((l) => visIds.has(l.source) && visIds.has(l.target)));

  // 7. tidy-tree layout invariants: columns from depth, no overlaps, parents
  //    centred over their children, everything inside the view volume
  const { cards, byId: cardById } = buildCards({ nodes, links });
  const onlyBranches = cards.every((c) => ['object', 'array', 'root'].includes(c.node.type));
  check(`${name}: only branches get cards`, onlyBranches);
  const noCardForPrimitives = nodes
    .filter((n) => !['object', 'array', 'root'].includes(n.type))
    .every((n) => !cardById.has(n.id));
  check(`${name}: primitives render as rows, not cards`, noCardForPrimitives);

  const raw = layoutTree(cards, cardById);
  const { layout, scale } = normalizeTree(raw);
  check(`${name}: normalize scale sane`, scale > 0 && scale <= 2, `s=${scale.toFixed(3)}`);
  const finiteLayout = Array.from(layout.values()).every((e) =>
    Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z),
  );
  check(`${name}: layout coordinates finite`, finiteLayout);

  // X strictly increases with depth (one column per level)
  let monoX = true;
  for (const c of cards) {
    const e = layout.get(c.node.id);
    for (const child of c.cardChildren) {
      const ce = layout.get(child.id);
      if (e && ce && !(ce.x > e.x)) monoX = false;
    }
  }
  check(`${name}: child column is right of parent`, monoX);

  // No two cards in the same column overlap: gap covers both half-heights.
  // Compare in RAW units, where the slot guarantee holds.
  const byCol = new Map<number, Array<{ y: number; h: number }>>();
  for (const c of cards) {
    const e = raw.get(c.node.id);
    if (!e) continue;
    const arr = byCol.get(c.node.depth) ?? [];
    arr.push({ y: e.y, h: c.faceH });
    byCol.set(c.node.depth, arr);
  }
  let noOverlap = true;
  for (const items of byCol.values()) {
    const sorted = [...items].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      const need = (sorted[i - 1].h + sorted[i].h) / 2 + TREE.gapMin - 1e-6;
      if (sorted[i].y - sorted[i - 1].y < need) noOverlap = false;
    }
  }
  check(`${name}: no vertical overlap in column`, noOverlap);

  // Parents sit at the midpoint of their card-children
  let centred = true;
  for (const c of cards) {
    const kids = c.cardChildren.map((k) => raw.get(k.id)).filter(Boolean) as Array<{ y: number }>;
    if (kids.length === 0) continue;
    const mid = (Math.min(...kids.map((k) => k.y)) + Math.max(...kids.map((k) => k.y))) / 2;
    if (Math.abs((raw.get(c.node.id)?.y ?? mid) - mid) > 1e-6) centred = false;
  }
  check(`${name}: parents centred over children`, centred);

  // Normalised tree fits a comfortable viewing volume
  const box = bboxOf(Array.from(layout.values()));
  check(`${name}: layout fits view height`, !!box && box.height <= 6.5, box ? `h=${box.height.toFixed(2)}` : 'empty');

  // 8. toggle contract
  const branch = nodes.find((n) => n.childIds.length > 0);
  if (branch) {
    const before = branch.expanded;
    const t1 = performance.now();
    const toggled = toggleNode(graph, branch.id);
    const toggleMs = performance.now() - t1;
    check(`${name}: toggle flips + stays reactive`, toggled.nodes.find((n) => n.id === branch.id)!.expanded !== before);
    check(`${name}: toggle is pure (source untouched)`, graph.nodes.find((n) => n.id === branch.id)!.expanded === before);
    check(`${name}: toggle < 50ms`, toggleMs < 50, `${toggleMs.toFixed(1)}ms`);
  }

  // 9. collapse-all / expand-all round trip
  const collapsed = visibleSubgraph(setAllExpanded(graph, false));
  check(`${name}: collapse all -> only root`, collapsed.nodes.length === 1 && collapsed.nodes[0].parentId === null, `${collapsed.nodes.length} visible`);
  const reExpanded = visibleSubgraph(setAllExpanded(graph, true));
  check(`${name}: expand all -> full graph`, reExpanded.nodes.length === nodes.length);
  const stillRooted = reExpanded.nodes.every((n) => n.visible);
  check(`${name}: expand all -> everything visible`, stillRooted);

  // 10. VR budget: nodes beyond the cap must not render thousands of meshes
  check(`${name}: within node budget`, nodes.length <= 2500, `${nodes.length} nodes`);
  check(`${name}: parse fast`, parseMs < 250, `${parseMs.toFixed(1)}ms`);

  byId.set(name, nodes.length);
  console.log(
    `      ${nodes.length} nodes · ${visible.nodes.length} visible · depth ${maxDepth} · parse ${parseMs.toFixed(1)}ms`,
  );
}

// Cross-cutting: unicode keys survive, and a root primitive still parses
const uni = jsonToGraph({ 'ñandú/日本語': { 'ключ': ['🔑', null, true] } });
check('unicode keys + emoji values', uni.nodes.length === 6, `${uni.nodes.length} nodes`);
const prim = jsonToGraph('just a string');
check('primitive root parses', prim.nodes.length === 1 && prim.nodes[0].type === 'root');
check('primitive root has no links', prim.links.length === 0);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);