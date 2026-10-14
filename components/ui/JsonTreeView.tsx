'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { NODE_COLORS, type NodeType } from '@/utils/jsonToGraph';

function typeOf(value: unknown): NodeType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
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

function Row({ k, v, depth }: { k: string; v: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isBranch = v !== null && typeof v === 'object';
  const t = typeOf(v);
  const children = isBranch ? Object.entries(v as Record<string, unknown>) : [];

  if (!isBranch) {
    return (
      <div className="flex items-baseline gap-2 rounded px-1.5 py-[3px] text-[11px] transition hover:bg-white/[0.03]">
        <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: NODE_COLORS[t] }} />
        <span className="shrink-0 font-mono text-zinc-400">{k}</span>
        <span className="truncate font-mono text-zinc-600">{JSON.stringify(v)}</span>
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left transition hover:bg-white/[0.03]"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 text-zinc-700 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: NODE_COLORS[t] }} />
        <span className="font-mono text-[11px] text-zinc-400">{k}</span>
        <span className="font-mono text-[10px] text-zinc-700">{children.length}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-white/[0.06] pl-1.5">
          {children.map(([ck, cv]) => (
            <Row key={ck} k={ck} v={cv} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JsonTreeView({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object') {
    return <p className="font-mono text-[11px] text-zinc-600">{JSON.stringify(data)}</p>;
  }
  return (
    <div className="max-h-[320px] overflow-auto rounded-xl border border-white/[0.07] bg-black/30 p-2">
      {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
        <Row key={k} k={k} v={v} depth={0} />
      ))}
    </div>
  );
}