'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force-3d';
import Node3D from './Node3D';
import type { GraphData, GraphNode } from '@/utils/jsonToGraph';
import { visibleSubgraph } from '@/utils/jsonToGraph';

interface Props {
  graph: GraphData;
  hoveredId: string | null;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode) => void;
  onDragNode: (id: string, point: THREE.Vector3) => void;
  onBudget?: (shown: number, total: number) => void;
}

/**
 * Hard ceiling on drawn nodes. Each node is an individual mesh with its own
 * per-frame callback, so this is what actually bounds the Quest frame cost.
 * Above this we keep the simulation intact and render a prioritised subset
 * (branches first — they carry the structure) instead of silently dropping
 * data or tanking to a slideshow.
 */
const RENDER_BUDGET = 700;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimNode = GraphNode & { index?: number; vx?: number; vy?: number; vz?: number };

/**
 * Viewing radius for a given node count. Cubic-root growth: a handful of nodes
 * stays intimate, while a few hundred spread into a galaxy instead of an
 * unreadable ball of overlapping spheres.
 */
function targetRadius(count: number): number {
  if (count <= 1) return 1.2;
  return Math.min(9, 2 + Math.cbrt(count) * 0.42);
}

/**
 * Recentre + rescale the layout so the cluster always fills a comfortable
 * viewing volume. Without this the repulsion force settles nodes on a large
 * hollow shell, which puts the camera inside the graph and reads as "empty".
 * Uses the 90th percentile so a few stragglers can't zoom everything out.
 */
function normalize(simNodes: SimNode[], target: number) {
  if (simNodes.length === 0) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const n of simNodes) {
    cx += n.x ?? 0;
    cy += n.y ?? 0;
    cz += n.z ?? 0;
  }
  cx /= simNodes.length;
  cy /= simNodes.length;
  cz /= simNodes.length;

  const dists = simNodes.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy, (n.z ?? 0) - cz));
  dists.sort((a, b) => a - b);
  const p90 = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] || 1;
  const scale = target / p90;

  for (const n of simNodes) {
    n.x = ((n.x ?? 0) - cx) * scale;
    n.y = ((n.y ?? 0) - cy) * scale;
    n.z = ((n.z ?? 0) - cz) * scale;
  }
}

export default function Graph3D({
  graph,
  hoveredId,
  selectedId,
  onToggle,
  onHover,
  onSelect,
  onDragNode,
  onBudget,
}: Props) {
  const full = useMemo(() => visibleSubgraph(graph), [graph]);

  // Prioritise branches, then shallow nodes, then the rest — the first slice
  // is the most informative view of a huge document.
  const { nodes, links, shown, total } = useMemo(() => {
    if (full.nodes.length <= RENDER_BUDGET) {
      return { ...full, shown: full.nodes.length, total: full.nodes.length };
    }
    const ranked = [...full.nodes].sort((a, b) => {
      const rank = (n: GraphNode) =>
        (n.type === 'object' || n.type === 'array' || n.type === 'root' ? 0 : 1) * 1000 + n.depth;
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
    const kept = ranked.slice(0, RENDER_BUDGET);
    const ids = new Set(kept.map((n) => n.id));
    return {
      nodes: kept,
      links: full.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
      shown: kept.length,
      total: full.nodes.length,
    };
  }, [full]);

  useEffect(() => {
    onBudget?.(shown, total);
  }, [shown, total, onBudget]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Compact cluster like the reference: short links, strong centering,
  // sphere-like repulsion. Warm ticks are synchronous so VR stays at 72–90 FPS.
  useEffect(() => {
    if (nodes.length === 0) return;
    const simNodes = nodes as SimNode[];
    const simLinks = links.map((l) => ({ ...l }));
    const sim = forceSimulation(simNodes, 3)
      .force('charge', forceManyBody().strength(-26).distanceMax(5))
      .force(
        'link',
        forceLink(simLinks)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .id((d: any) => d.id)
          .distance((l: { source: SimNode | string }) => {
            const depth = typeof l.source === 'string' ? 1 : (l.source.depth ?? 1);
            return 0.55 + depth * 0.3;
          })
          .strength(1),
      )
      .force('center', forceCenter(0, 0, 0).strength(0.35))
      .force('collide', forceCollide().radius((d: SimNode) => (d.depth === 0 ? 0.5 : 0.22)).strength(1))
      .stop();
    const ticks = Math.min(320, 90 + nodes.length * 2);
    for (let i = 0; i < ticks; i++) sim.tick();
    normalize(simNodes, targetRadius(nodes.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Focus chain: hovering or pinning a node lights its whole root path so the
  // JSON hierarchy reads as a breadcrumb instead of a cloud.
  const focusId = hoveredId ?? selectedId;
  const chain = useMemo(() => {
    const set = new Set<string>();
    let cur = focusId ? byId.get(focusId) : undefined;
    while (cur) {
      set.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return set;
  }, [byId, focusId]);

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(links.length * 6, 6)), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(links.length * 6, 6)), 3));
    return g;
  }, [links.length]);

  // Edge colours, baked per link: the focus path glows white, everything else
  // stays dim indigo. One buffer update per focus change, zero per-frame cost.
  const EDGE_BASE = useMemo(() => new THREE.Color('#5b5fd6'), []);
  const EDGE_PATH = useMemo(() => new THREE.Color('#ffffff'), []);
  useEffect(() => {
    const attr = lineGeo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < links.length; i++) {
      const onPath = chain.has(links[i].source) && chain.has(links[i].target);
      const c = onPath ? EDGE_PATH : EDGE_BASE;
      attr.setXYZ(i * 2, c.r, c.g, c.b);
      attr.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, links, chain]);

  useEffect(() => () => lineGeo.dispose(), [lineGeo]);

  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const linksRef = useRef(links);
  linksRef.current = links;

  useFrame(() => {
    const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute;
    const map = byIdRef.current;
    const ls = linksRef.current;
    for (let i = 0; i < ls.length; i++) {
      const s = map.get(ls[i].source);
      const t = map.get(ls[i].target);
      if (!s || !t) continue;
      pos.setXYZ(i * 2, s.x ?? 0, s.y ?? 0, s.z ?? 0);
      pos.setXYZ(i * 2 + 1, t.x ?? 0, t.y ?? 0, t.z ?? 0);
    }
    pos.needsUpdate = true;
  });

  // Framing extent. Uses a high percentile (not p90) so the outer tail of a big
  // cluster doesn't spill outside the viewport.
  const radius = useMemo(() => {
    if (!nodes.length) return 1.5;
    const d = nodes.map((n) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0)).sort((a, b) => a - b);
    return d[Math.min(d.length - 1, Math.floor(d.length * 0.98))] || 1.5;
  }, [nodes]);

  // One global size factor so a 400-node graph doesn't render 400
  // full-size spheres on top of each other
  const sizeScale = useMemo(() => Math.max(0.42, Math.min(1, 4.6 / Math.cbrt(Math.max(nodes.length, 1)))), [nodes.length]);

  // Widest sphere + its orbit ring: the framing distance must clear the actual
  // geometry, not just the centroid spread, or small graphs clip their own root.
  const extent = useMemo(() => {
    let max = 0.4;
    for (const n of nodes) {
      const isBranch = n.type === 'object' || n.type === 'array' || n.type === 'root';
      const r =
        (isBranch ? 0.2 : 0.11) * (n.depth === 0 ? 1.7 : 1) * (isBranch ? 1 + Math.min(n.childIds.length, 12) * 0.035 : 1) * sizeScale;
      max = Math.max(max, r * (isBranch ? 3.9 : 1.4));
    }
    return max;
  }, [nodes, sizeScale]);

  return (
    <group>
      {/* Global orbital rings — the signature of the reference look */}
      <GlobalOrbits radius={radius} />
      <CameraFrame radius={radius + extent} dataKey={nodes.length + ':' + (nodes[0]?.id ?? '')} />

      <lineSegments geometry={lineGeo} frustumCulled={false} raycast={() => null}>
        <lineBasicMaterial
          color="#ffffff"
          vertexColors
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>

      {nodes.map((n) => (
        <Node3D
          key={n.id}
          node={n}
          sizeScale={sizeScale}
          hovered={hoveredId === n.id}
          selected={selectedId === n.id}
          spotlight={chain.size === 0 || chain.has(n.id)}
          onToggle={onToggle}
          onHover={onHover}
          onSelect={onSelect}
          onDrag={onDragNode}
        />
      ))}
    </group>
  );
}

const ringGeo = new THREE.TorusGeometry(1, 0.004, 4, 160);

/**
 * Frames the cluster for the viewport. Re-frames whenever a new dataset is
 * loaded, but stands down permanently as soon as the user grabs the scene so
 * it never fights their manual orbit. Fully inert in VR, where the headset
 * owns the viewpoint.
 */
function CameraFrame({ radius, dataKey }: { radius: number; dataKey: string }) {
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

    const aspect = size.width / Math.max(1, size.height);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Frame the whole bounding volume with a little breathing room
    const dist = (radius * 1.25) / Math.tan(Math.min(vFov, hFov) / 2);

    camera.position.set(0, dist * 0.2, dist);
    camera.lookAt(0, 0, 0);
    if (controls) controls.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [dataKey, radius, camera, controls, size.width, size.height]);

  return null;
}

/** Slow elliptical rings encircling the whole cluster. */
function GlobalOrbits({ radius }: { radius: number }) {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  const c = useRef<THREE.Group>(null);

  const matA = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#8b5cf6'),
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const matB = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#22d3ee'),
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const matC = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#f472b6'),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      matA.dispose();
      matB.dispose();
      matC.dispose();
    },
    [matA, matB, matC],
  );

  useFrame((state, dt) => {
    // Sit just outside the cluster, not far beyond it
    const r = radius * 1.12;
    const camDist = state.camera.position.length();
    // Hidden only when the camera is genuinely inside the shell
    const near = camDist < r * 0.55;
    if (a.current) {
      a.current.scale.set(r, r * 0.8, r);
      a.current.rotation.y += dt * 0.06;
      a.current.visible = !near;
    }
    if (b.current) {
      b.current.scale.set(r * 0.9, r * 1.06, r);
      b.current.rotation.y -= dt * 0.045;
      b.current.visible = !near;
    }
    if (c.current) {
      c.current.scale.set(r * 1.06, r * 0.72, r);
      c.current.rotation.y += dt * 0.03;
      c.current.visible = !near;
    }
  });

  return (
    <group raycast={() => null}>
      <group ref={a} rotation={[Math.PI / 2 + 0.25, 0, 0.1]}>
        <mesh geometry={ringGeo} material={matA} raycast={() => null} />
      </group>
      <group ref={b} rotation={[Math.PI / 2 - 0.35, 0.4, -0.2]}>
        <mesh geometry={ringGeo} material={matB} raycast={() => null} />
      </group>
      <group ref={c} rotation={[Math.PI / 2 + 0.6, -0.3, 0.45]}>
        <mesh geometry={ringGeo} material={matC} raycast={() => null} />
      </group>
    </group>
  );
}