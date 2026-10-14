/**
 * Preset payloads for the uploader.
 *
 * Three tiers on purpose:
 *  - `basics`  : small, readable, good for a first look
 *  - `real`    : realistic documents with deep, mixed, uneven structures
 *  - `stress`  : adversarial cases that specifically try to break the graph
 *                builder, the force layout or the WebXR frame budget
 *
 * The stress tier is where the interesting bugs live: cyclic-looking graphs,
 * thousands of siblings, unicode that breaks label rendering, huge strings and
 * pathological key names.
 */

type Category = 'basics' | 'real' | 'stress';

const csv = (rows: Array<[string, unknown]>): string =>
  rows.map(([k, v]) => `${k}=${v}`).join(', ');

/* ── generators (kept compact; the point is shape, not data realism) ──────── */

const employees = Array.from({ length: 14 }, (_, i) => ({
  id: `EMP-${String(i + 1).padStart(3, '0')}`,
  name: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine J.', 'Radia Perlman'][i % 5],
  role: i === 0 ? 'CTO' : i < 3 ? 'Engineering Manager' : 'Senior Engineer',
  active: i !== 7,
  contact: { email: `dev${i}@corp.dev`, phone: `+34 6${10000000 + i}`, verified: i % 2 === 0 },
  profile: {
    timezone: 'Europe/Madrid',
    remote: i % 3 !== 0,
    skills: ['webxr', 'typescript', 'rust', 'gpu'].slice(0, (i % 4) + 1),
    badges: i % 2 === 0 ? ['on-call', 'mentor'] : [],
  },
  metrics: {
    tasksClosed: 12 + i * 7,
    avgCycleHours: +(4.5 + (i % 5) * 1.2).toFixed(1),
    satisfaction: i % 4 === 3 ? null : +(0.6 + (i % 5) * 0.08).toFixed(2),
  },
}));

const timeSeries = Array.from({ length: 30 }, (_, i) => ({
  t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  value: +(Math.sin(i / 4) * 12 + 50).toFixed(2),
  metrics: {
    cpu: +(20 + Math.abs(Math.sin(i / 3)) * 60).toFixed(1),
    memoryMb: 512 + ((i * 37) % 900),
    netIn: 1024 * (i % 17),
    netOut: 1024 * (i % 11),
  },
  tags: i % 4 === 0 ? ['peak', 'alert'] : [],
}));

const wideMatrix = Array.from({ length: 24 }, (_, r) => ({
  id: r,
  label: `row_${r}`,
  values: Array.from({ length: 16 }, (_, c) => r * 16 + c),
  meta: { rowSum: r * 120, parity: r % 2 === 0 },
}));

/* ── the presets ────────────────────────────────────────────────────────── */

export const SAMPLES: Record<string, unknown> = {
  /* ═══ basics ═════════════════════════════════════════════════════════ */

  'second brain': {
    user: { name: 'Ada', role: 'Researcher', tags: ['xr', 'graphs', 'pkm'], active: true },
    notes: [
      { id: 1, title: 'Spatial memory', links: 12, published: true },
      { id: 2, title: 'Force layouts in VR', links: 8, published: false },
    ],
    stats: { nodes: 128, edges: 214, score: 9.7, archived: null },
    settings: { theme: 'dark', vr: { refreshHz: 90, controllers: 2 } },
  },

  'deep tree': {
    a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } },
    list: [
      [1, 2],
      [3, 4],
      [5, 6],
    ],
    empty: {},
    emptyList: [],
    zero: 0,
    flag: false,
    nothing: null,
  },

  wide: Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`field_${i}`, { id: i, ok: i % 3 === 0 }]),
  ),

  /* ═══ real-world documents ════════════════════════════════════════════ */

  'rest api': {
    meta: {
      requestId: '8f14e45f-ea8f-4b1a-9c3d-2b7a1f0e9d55',
      generatedAt: '2026-02-11T09:14:22.481Z',
      pagination: { page: 3, perPage: 25, total: 412, hasNext: true, cursor: 'eyJvZmZzZXQiOjI1fQ==' },
    },
    data: Array.from({ length: 8 }, (_, i) => ({
      type: ['order', 'refund', 'invoice', 'shipment'][i % 4],
      id: `ord_${1000 + i}`,
      status: ['settled', 'pending', 'failed'][i % 3],
      totals: {
        gross: +(19.99 + i * 13.4).toFixed(2),
        discount: i % 2 === 0 ? 5 : 0,
        tax: +(2.1 + i * 0.35).toFixed(2),
        currency: 'EUR',
      },
      customer: {
        id: `cus_${40 + i}`,
        email: `user${i}@example.io`,
        verified: i % 2 === 1,
        profile: {
          name: { first: ['Ada', 'Lin', 'Nour', 'Tom'][i % 4], last: 'Lovelace' },
          locale: i % 2 === 0 ? 'en-GB' : 'es-ES',
          marketing: { optedIn: i % 4 < 2, tags: ['vip', 'beta', 'newsletter'].slice(0, (i % 3) + 1) },
        },
      },
      items: Array.from({ length: (i % 3) + 1 }, (_, j) => ({
        sku: `SKU-${i}${j}`,
        qty: j + 1,
        price: +(4.5 * (j + 1)).toFixed(2),
        meta: { warehouse: ['mad', 'bcn', 'ams'][j % 3], backordered: j === 2 && i % 2 === 0 },
      })),
      timeline: [
        { at: '2026-02-09T11:02:00Z', event: 'created', actor: 'system' },
        { at: '2026-02-10T08:44:12Z', event: 'authorized', actor: 'stripe' },
        ...(i % 2 === 0 ? [{ at: '2026-02-11T09:14:22Z', event: 'captured', actor: 'stripe' }] : []),
      ],
    })),
    errors: null,
  },

  'knowledge graph': {
    graph: {
      directed: true,
      multigraph: false,
      nodes: [
        { id: 'quantum', label: 'Quantum Computing', group: 'field', weight: 0.92 },
        { id: 'cryptography', label: 'Cryptography', group: 'field', weight: 0.88 },
        { id: 'entanglement', label: 'Entanglement', group: 'concept', weight: 0.74 },
        { id: 'qbit', label: 'Qubit', group: 'primitive', weight: 0.81 },
        { id: 'shor', label: 'Shor’s algorithm', group: 'algorithm', weight: 0.69 },
        { id: 'rsa', label: 'RSA', group: 'algorithm', weight: 0.83 },
        { id: 'blockchain', label: 'Blockchain', group: 'system', weight: 0.77 },
        { id: 'zk', label: 'Zero-Knowledge Proof', group: 'concept', weight: 0.65 },
      ],
      links: [
        { source: 'quantum', target: 'entanglement', relation: 'studies', weight: 0.9 },
        { source: 'quantum', target: 'qbit', relation: 'uses', weight: 1 },
        { source: 'quantum', target: 'shor', relation: 'enables', weight: 0.8 },
        { source: 'cryptography', target: 'rsa', relation: 'includes', weight: 0.95 },
        { source: 'cryptography', target: 'entanglement', relation: 'threatened-by', weight: 0.7 },
        { source: 'blockchain', target: 'cryptography', relation: 'depends-on', weight: 0.88 },
        { source: 'blockchain', target: 'zk', relation: 'applies', weight: 0.6 },
        { source: 'zk', target: 'rsa', relation: 'relates-to', weight: 0.4 },
      ],
      metadata: {
        generated: '2026-02-11',
        sourceCount: 4,
        confidence: { min: 0.4, max: 0.95, avg: 0.775 },
      },
    },
  },

  'infra config': {
    environment: 'production',
    regions: [
      {
        id: 'eu-west-1',
        primary: true,
        services: [
          {
            name: 'api-gateway',
            replicas: 6,
            resources: { cpu: '2000m', memory: '4Gi', gpu: null },
            health: { status: 'healthy', uptimeDays: 214.7, lastDeploy: '2026-02-10T22:04:00Z' },
            routes: Array.from({ length: 5 }, (_, i) => ({
              path: `/api/v${1 + (i % 2)}/${['auth', 'users', 'orders', 'search', 'media'][i]}`,
              method: ['GET', 'POST', 'PUT', 'DELETE'][i],
              auth: i === 0 ? 'public' : 'bearer',
              rateLimit: i % 2 === 0 ? 1000 : 100,
            })),
          },
          {
            name: 'vector-db',
            replicas: 3,
            resources: { cpu: '8000m', memory: '64Gi', gpu: 'a100-40gb' },
            health: { status: 'degraded', uptimeDays: 98.2, lastDeploy: '2026-01-28T11:20:00Z' },
            indexes: [
              { name: 'embeddings', type: 'hnsw', dims: 1536, metric: 'cosine', shards: 8 },
              { name: 'metadata', type: 'btree', dims: null, metric: null, shards: 2 },
            ],
          },
          {
            name: 'worker',
            replicas: 12,
            resources: { cpu: '1000m', memory: '2Gi', gpu: null },
            health: { status: 'healthy', uptimeDays: 214.7, lastDeploy: '2026-02-11T06:00:00Z' },
            queues: {
              critical: { depth: 0, concurrency: 4 },
              bulk: { depth: 18422, concurrency: 32 },
              retry: { depth: 17, concurrency: 2 },
            },
          },
        ],
      },
      {
        id: 'us-east-1',
        primary: false,
        services: [
          {
            name: 'api-gateway',
            replicas: 4,
            resources: { cpu: '2000m', memory: '4Gi', gpu: null },
            health: { status: 'healthy', uptimeDays: 41.3, lastDeploy: '2026-02-09T19:41:00Z' },
            routes: [
              { path: '/api/v1/auth', method: 'POST', auth: 'public', rateLimit: 1000 },
              { path: '/api/v1/users', method: 'GET', auth: 'bearer', rateLimit: 500 },
            ],
          },
        ],
      },
    ],
    featureFlags: {
      newRenderer: true,
      spatialAudio: false,
      handTracking: true,
      rolloutPercentage: { newRenderer: 100, spatialAudio: 0, handTracking: 35 },
    },
  },

  'org chart': {
    company: { name: 'Neural Works', founded: 2019, legalEntity: 'NV Labs S.L.', offices: 4 },
    leadership: {
      ceo: { name: 'M. Rivera', since: 2019, directReports: 3 },
      cto: { name: 'A. Nakamura', since: 2020, directReports: 2, stack: ['WebXR', 'Rust'] },
    },
    departments: [
      {
        name: 'Engineering',
        headcount: 42,
        budget: { amount: 2_400_000, currency: 'EUR', period: '2026' },
        teams: [
          { name: 'Platform', members: ['Dev-1', 'Dev-2'], oncall: true, sla: 99.9 },
          { name: 'Rendering', members: ['Dev-3', 'Dev-4'], oncall: false, sla: 99.5 },
          { name: 'Infra', members: ['Dev-5'], oncall: true, sla: 99.99 },
        ],
        roadmap: [
          { quarter: 'Q1', items: ['depth clipping', 'hand tracking polish'], done: true },
          { quarter: 'Q2', items: ['multi-user'], done: false },
        ],
      },
      {
        name: 'Design',
        headcount: 9,
        budget: { amount: 780_000, currency: 'EUR', period: '2026' },
        teams: [{ name: 'UX', members: ['Des-1'], oncall: false, sla: null }],
        roadmap: [],
      },
      {
        name: 'Research',
        headcount: 6,
        budget: { amount: 1_100_000, currency: 'EUR', period: '2026' },
        teams: [{ name: 'Prototypes', members: ['Res-1', 'Res-2'], oncall: false, sla: null }],
        roadmap: [{ quarter: 'Q1', items: ['novel input'], done: false }],
      },
    ],
    directory: employees,
  },

  'time series': {
    dataset: 'production-telemetry',
    resolution: '1d',
    range: { start: '2026-01-01', end: '2026-01-30', tz: 'UTC' },
    series: [
      {
        id: 'latency_p95',
        unit: 'ms',
        points: timeSeries,
        stats: { min: 38.2, max: 62.4, mean: 50.1, p95: 59.8, stddev: 6.7 },
      },
      {
        id: 'throughput',
        unit: 'req/s',
        points: timeSeries.map((p) => ({ ...p, value: +(p.value * 120).toFixed(1) })),
        stats: { min: 4200, max: 7890, mean: 6012, p95: 7410, stddev: 812 },
      },
    ],
    alerts: [
      { at: '2026-01-14T03:12:00Z', severity: 'warning', metric: 'latency_p95', value: 61.2 },
      { at: '2026-01-22T18:40:00Z', severity: 'critical', metric: 'throughput', value: 7820 },
    ],
    matrix: wideMatrix,
  },

  /* ═══ stress / adversarial ════════════════════════════════════════════ */

  'deep × 40': (() => {
    // 40 levels of nesting — stresses recursion, label depth and the layout
    let node: unknown = 'bottom';
    for (let i = 0; i < 40; i++) node = { [`level_${i}`]: node, index: i, wide: i % 5 === 0 };
    return node;
  })(),

  '1k siblings': {
    note: 'thousands of siblings under one key — the classic frame-budget killer',
    items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item_${i}`, ok: i % 2 === 0 })),
  },

  'unicode torture': {
    'ключ': { '日本語': { 'مفتاح': { 'κλειδί': { emoji: '🧠🔗', mixed: 'ascii + ünïcödé + 中文 + العربية' } } } },
    longKey: 'k'.repeat(180),
    longValue: 'The quick brown fox jumps over the lazy dog. '.repeat(12),
    combining: 'ȩ́à̴b̃c̄d̨',
    zeroWidth: 'a‌b‍c',
    rtl: { arabic: 'مرحبا بالعالم', hebrew: 'שלום עולם' },
    surrogatePair: '𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
  },

  'pathological keys': {
    '': 'empty string key',
    ' ': 'single space',
    'key.with.dots': 'dots are breadcrumb separators — watch the path column',
    'key/with/slashes': 'slashes',
    'emoji🎯key': 'emoji in key',
    'constructor': 'prototype-ish name',
    '__proto__': 'dangerous name',
    'toString': 'also prototype-ish',
    [csv([
      ['very', 'long'],
      ['csv', 'row'],
    ])]: 'generated key',
    numeric_like: { 0: 'zero key', 1: 'one key', 42: 'answer' },
  },

  'big strings': {
    description: 'x'.repeat(50_000),
    readme: ['# Project', '', 'Lorem ipsum dolor sit amet...'.repeat(500)].join('\n'),
    blob: { payload: '9f86d081884c7d65'.repeat(2000), encoding: 'base64' },
  },

  'mixed empties': {
    a: {},
    b: [],
    c: null,
    d: '',
    e: 0,
    f: false,
    g: { nested: {} },
    h: [[], {}, null],
    i: { a: { b: { c: { d: { e: { f: null } } } } } },
    j: [{ a: [] }, { b: {} }, { c: null }],
  },

  'numbers': {
    zero: 0,
    negativeZero: -0,
    floats: [0.1, 0.2, 0.30000000000000004, 1 / 3],
    scientific: [1e21, 1e-7, -2.5e10, 6.02e23],
    limits: { maxSafe: Number.MAX_SAFE_INTEGER, minSafe: Number.MIN_SAFE_INTEGER, epsilon: Number.EPSILON },
    infinities: null,
    longDecimal: 3.141592653589793238462643383279,
  },
};

export const SAMPLE_CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'basics', label: 'Basics' },
  { id: 'real', label: 'Real-world documents' },
  { id: 'stress', label: 'Stress tests' },
];

const BASIC = ['second brain', 'deep tree', 'wide'];
const STRESS = [
  'deep × 40',
  '1k siblings',
  'unicode torture',
  'pathological keys',
  'big strings',
  'mixed empties',
  'numbers',
];

export function categoryOf(name: string): Category {
  if (STRESS.includes(name)) return 'stress';
  if (BASIC.includes(name)) return 'basics';
  return 'real';
}

export type SampleName = keyof typeof SAMPLES;