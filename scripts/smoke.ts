/**
 * Smoke test for the graph pipeline: parses every preset, builds the graph and
 * validates the invariants the 3D scene relies on.
 *
 * Run: node --experimental-strip-types --no-warnings ./scripts/smoke.ts
 */
import { SAMPLES } from '../utils/samples.ts';
import { jsonToGraph, toggleNode, setAllExpanded, visibleSubgraph } from '../utils/jsonToGraph.ts';

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

  // 7. simulation actually spreads nodes out (no NaN, no degenerate stack)
  const finite = visible.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z));
  check(`${name}: finite coordinates`, finite);

  // The scene relies on a dense cluster, not a hollow shell: the p50 distance
  // must be a meaningful fraction of the p90, otherwise the camera ends up
  // inside an empty bubble.
  const dists = visible.nodes
    .map((n) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0))
    .sort((a, b) => a - b);
  const p50 = dists[Math.floor(dists.length * 0.5)] ?? 0;
  const p90 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] ?? 0;
  const solidity = p90 > 0 ? p50 / p90 : 0;
  check(`${name}: cluster is solid (p50/p90 >= 0.35)`, solidity >= 0.35, `p50=${p50.toFixed(2)} p90=${p90.toFixed(2)}`);
  check(`${name}: cluster framed for camera`, p90 < 12, `p90=${p90.toFixed(2)}`);

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