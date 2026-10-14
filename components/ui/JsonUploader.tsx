'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, ChevronDown, Check } from 'lucide-react';
import { SAMPLES, SAMPLE_CATEGORIES, categoryOf } from '@/utils/samples';
import { jsonToGraph, visibleSubgraph } from '@/utils/jsonToGraph';

interface Props {
  onJson: (data: unknown, label: string) => void;
  current?: string;
}

/** Node counts are computed lazily: jsonToGraph is cheap, but 17 payloads on
 *  every render is wasteful, and the dropdown is usually closed. */
const countCache = new Map<string, [number, number]>();

function countsFor(name: string): [number, number] {
  const hit = countCache.get(name);
  if (hit) return hit;
  const g = jsonToGraph(SAMPLES[name]);
  const v = visibleSubgraph(g);
  const out: [number, number] = [g.nodes.length, v.nodes.length];
  countCache.set(name, out);
  return out;
}

export default function JsonUploader({ onJson, current }: Props) {
  const [drag, setDrag] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const parse = useCallback(
    (raw: string, name: string) => {
      try {
        const data = JSON.parse(raw);
        setError(null);
        setText('');
        onJson(data, name);
      } catch {
        setError('Parse error');
      }
    },
    [onJson],
  );

  const read = useCallback(
    (f?: File) => {
      if (!f) return;
      const r = new FileReader();
      r.onload = () => parse(String(r.result ?? ''), f.name);
      r.readAsText(f);
    },
    [parse],
  );

  // Dismiss on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const names = Object.keys(SAMPLES);

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          read(e.dataTransfer.files?.[0]);
        }}
        onClick={() => input.current?.click()}
        className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition ${
          drag ? 'border-white/30 bg-white/[0.04]' : 'border-white/10 hover:border-white/20'
        }`}
      >
        <FileUp className="h-4 w-4 text-zinc-500 transition group-hover:text-zinc-300" strokeWidth={1.5} />
        <span className="text-[11px] text-zinc-400">drop .json or click to browse</span>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => read(e.target.files?.[0])}
        />
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) parse(text, 'inline.json');
          }}
          placeholder="…or paste JSON"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-700 outline-none transition focus:border-white/25"
        />
        <button
          onClick={() => text.trim() && parse(text, 'inline.json')}
          disabled={!text.trim()}
          className="shrink-0 rounded-lg border border-white/10 px-3 text-[11px] text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.04] disabled:opacity-30"
        >
          Run
        </button>
      </div>

      {/* Preset dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-left transition hover:border-white/25"
        >
          <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            presets · {names.length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="max-w-[140px] truncate font-mono text-[10px] text-zinc-300">
              {current && names.includes(current) ? current : 'choose sample…'}
            </span>
            <ChevronDown className={`h-3 w-3 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {open && (
          <div
            data-preset-menu=""
            className="absolute z-50 mt-1 max-h-[340px] w-full overflow-auto rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
          >
            {SAMPLE_CATEGORIES.map((cat) => {
              const items = names.filter((n) => categoryOf(n) === cat.id);
              if (!items.length) return null;
              return (
                <div key={cat.id} className="mb-1 last:mb-0">
                  <p className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                    {cat.label}
                  </p>
                  {items.map((name) => {
                    const [total, visible] = countsFor(name);
                    const isStress = categoryOf(name) === 'stress';
                    const active = current === name;
                    return (
                      <button
                        key={name}
                        onClick={() => {
                          onJson(SAMPLES[name], `${name}.json`);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                          active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        {active ? (
                          <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                        ) : (
                          <span className="h-3 w-3 shrink-0" />
                        )}
                        <span
                          className={`truncate font-mono text-[11px] ${isStress ? 'text-amber-300/80' : 'text-zinc-300'}`}
                        >
                          {name}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">
                          {visible}/{total}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <p className="border-t border-white/[0.06] px-2 pt-2 text-[9px] leading-relaxed text-zinc-700">
              visible/total nodes · amber = stress test
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-[10px] text-rose-400">{error}</p>}
    </div>
  );
}