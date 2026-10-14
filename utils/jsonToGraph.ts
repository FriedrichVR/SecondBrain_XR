export type NodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'root';

export interface GraphNode {
  id: string;
  key: string;
  /** Breadcrumb path e.g. root.users.0.name */
  path: string;
  type: NodeType;
  /** Primitive display value (undefined for object/array) */
  value?: string;
  depth: number;
  parentId: string | null;
  childIds: string[];
  /** false = collapsed (children hidden) */
  expanded: boolean;
  /** false = hidden because an ancestor is collapsed */
  visible: boolean;
  /** Hints for force layout */
  size: number;
  /** 3D position mutated by force sim */
  x?: number;
  y?: number;
  z?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const NODE_COLORS: Record<NodeType, string> = {
  root: '#ffffff',
  object: '#8b5cf6',
  array: '#06b6d4',
  string: '#22c55e',
  number: '#f59e0b',
  boolean: '#ec4899',
  null: '#64748b',
};

const MAX_NODES = 2500;

function typeOf(v: unknown): NodeType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'null';
  }
}

function shortValue(v: unknown): string | undefined {
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * Convert arbitrary JSON into a flat node/link graph with
 * parent-child tracking + expand/collapse bookkeeping.
 */
export function jsonToGraph(jsonData: unknown): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  let counter = 0;

  function addNode(opts: Omit<GraphNode, 'id' | 'childIds' | 'expanded' | 'visible' | 'size'>): GraphNode {
    const id = `n${counter++}`;
    const isBranch = opts.type === 'object' || opts.type === 'array' || opts.type === 'root';
    const node: GraphNode = {
      ...opts,
      id,
      childIds: [],
      expanded: opts.depth < 2, // auto-expand first two levels
      visible: true,
      size: isBranch ? 1 : 0.7,
    };
    // Seed on a small sphere per depth band. Kept tight (not 4+depth*3) so the
    // warm-tick sim starts inside the target cluster radius instead of an
    // empty shell the repulsion force would otherwise preserve.
    const r = 1.2 + Math.min(opts.depth, 5) * 0.45;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    node.x = r * Math.sin(phi) * Math.cos(theta);
    node.y = r * Math.cos(phi) * 0.7;
    node.z = r * Math.sin(phi) * Math.sin(theta);
    nodes.push(node);
    return node;
  }

  function walk(value: unknown, key: string, path: string, depth: number, parent: GraphNode | null): void {
    if (nodes.length >= MAX_NODES) return;
    const type = parent === null ? 'root' : typeOf(value);
    const node = addNode({
      key: parent === null ? 'root' : key,
      path,
      type,
      value: shortValue(value),
      depth,
      parentId: parent ? parent.id : null,
    });
    if (parent) {
      parent.childIds.push(node.id);
      links.push({ source: parent.id, target: node.id });
    }
    if (value !== null && typeof value === 'object') {
      const entries = Array.isArray(value)
        ? (value as unknown[]).map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);
      for (const [k, v] of entries) {
        if (nodes.length >= MAX_NODES) break;
        walk(v, k, `${path}.${k}`, depth + 1, node);
      }
    }
  }

  walk(jsonData, 'root', 'root', 0, null);
  applyVisibility({ nodes, links });
  return { nodes, links };
}

/** Recompute `visible` from expanded flags. Call after any toggle. */
export function applyVisibility(graph: GraphData): GraphData {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) {
    // A node is visible only when every ancestor on its path to the root is
    // expanded — the root itself is always expanded by definition.
    n.visible = isChainExpanded(byId, n);
  }
  return graph;
}

/** True when no ancestor of `node` is collapsed. */
function isChainExpanded(byId: Map<string, GraphNode>, node: GraphNode): boolean {
  let cur: GraphNode | undefined = node;
  while (cur.parentId !== null) {
    const parent = byId.get(cur.parentId);
    if (!parent) return true;
    if (!parent.expanded) return false;
    cur = parent;
  }
  return true;
}

/** Toggle expanded on one node, then refresh visibility. Returns new arrays (immutable for React). */
export function toggleNode(graph: GraphData, id: string): GraphData {
  const nodes = graph.nodes.map((n) => (n.id === id ? { ...n } : n));
  const next: GraphData = { nodes, links: graph.links };
  const target = nodes.find((n) => n.id === id);
  if (target && (target.type === 'object' || target.type === 'array' || target.type === 'root')) {
    target.expanded = !target.expanded;
  }
  return applyVisibility(next);
}

/** Expand or collapse every branch node, then refresh visibility. */
export function setAllExpanded(graph: GraphData, expanded: boolean): GraphData {
  const nodes = graph.nodes.map((n) =>
    n.type === 'object' || n.type === 'array' || n.type === 'root' ? { ...n, expanded } : n,
  );
  return applyVisibility({ nodes, links: graph.links });
}

export function visibleSubgraph(graph: GraphData): { nodes: GraphNode[]; links: GraphLink[] } {  const visibleIds = new Set(graph.nodes.filter((n) => n.visible).map((n) => n.id));
  return {
    nodes: graph.nodes.filter((n) => n.visible),
    links: graph.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target)),
  };
}
