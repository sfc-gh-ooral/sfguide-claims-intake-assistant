'use client';

// Shared UI: panels, KPI tiles with counters and sparklines, pills, badges, skeletons,
// a streaming text reveal and a small markdown renderer (text is escaped by React).
import { AlertTriangle, Bot, Database, Sparkles, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import type { Provenance } from '@/lib/types';

export const usd = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? '—' : `$${x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const TIER_COLOR: Record<string, string> = {
  'Fast track': 'var(--fast)', Standard: 'var(--std)', Complex: 'var(--cx)', 'SIU referral': 'var(--siu)',
};
export const TIER_HEX = { light: { 'Fast track': '#13795B', Standard: '#3D5A99', Complex: '#975406', 'SIU referral': '#B4235A' } };

export function Pill({ children, c, title, className = '' }: { children: ReactNode; c: string; title?: string; className?: string }) {
  return <span title={title} className={`pill pill-tint ${className}`} style={{ ['--c' as string]: c }}>{children}</span>;
}
export const TierPill = ({ tier }: { tier: string }) => <Pill c={TIER_COLOR[tier] ?? 'var(--ink-2)'}><span className="w-1.5 h-1.5 rounded-full" style={{ background: TIER_COLOR[tier] }} aria-hidden />{tier}</Pill>;
export const Flag = ({ children }: { children: ReactNode }) => <Pill c="var(--siu)"><AlertTriangle className="w-3 h-3" aria-hidden />{children}</Pill>;
export function StatusPill({ status }: { status: string }) {
  if (status === 'Needs review') return <span className="pill" style={{ background: 'color-mix(in srgb, var(--marker) 38%, transparent)', color: 'var(--marker-ink)' }}>Needs review</span>;
  if (status === 'Queued') return <span className="pill pill-outline">Queued</span>;
  return <Pill c="var(--spruce-2)">{status}</Pill>;
}
export function Confidence({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return null;
  const c = score >= 0.9 ? 'var(--fast)' : score >= 0.8 ? 'var(--std)' : 'var(--cx)';
  return (
    <span className="inline-flex items-center gap-1.5" title="AI_EXTRACT confidence score">
      <span className="w-10 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${score * 100}%`, background: c }} />
      </span>
      <span className="mono text-[11.5px] font-semibold" style={{ color: c }}>{Math.round(score * 100)}%</span>
    </span>
  );
}

export function Panel({ title, eyebrow, right, children, className = '', pad = 'p-5', id }: {
  title?: ReactNode; eyebrow?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: string; id?: string }) {
  return (
    <section id={id} className={`panel ${pad} ${className}`}>
      {(title || right || eyebrow) && (
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow mb-0.5">{eyebrow}</div>}
            {title && <h2 className="text-[15px] font-bold">{title}</h2>}
          </div>
          {right && <div className="flex items-center gap-2 flex-wrap min-w-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Counts up once to the target value. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString('en-US') }: { value: number; format?: (n: number) => string }) {
  const [n, setN] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return; }
    done.current = true;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 700); setN(value * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(n)}</>;
}

export function Kpi({ label, value, format, sub, delta, deltaLabel, goodWhenUp = true, spark, color = 'var(--spruce-2)', icon }: {
  label: string; value: number; format?: (n: number) => string; sub?: ReactNode; delta?: number; deltaLabel?: string;
  goodWhenUp?: boolean; spark?: number[]; color?: string; icon?: ReactNode }) {
  const up = (delta ?? 0) >= 0;
  const good = up === goodWhenUp;
  return (
    <div className="panel panel-hover p-4 relative overflow-hidden">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {icon && <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <div className="text-[30px] leading-none font-extrabold tabular tracking-tight"><CountUp value={value} format={format} /></div>
        {spark && spark.length > 1 && (
          <div className="w-24 h-9 -mb-1" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                <defs><linearGradient id={`sp-${label.replace(/\W/g, '')}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
                <Area dataKey="v" type="monotone" stroke={color} strokeWidth={2} fill={`url(#sp-${label.replace(/\W/g, '')})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px] muted">
        {delta !== undefined && (
          <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: good ? 'var(--fast)' : 'var(--siu)' }}>
            {up ? <TrendingUp className="w-3.5 h-3.5" aria-hidden /> : <TrendingDown className="w-3.5 h-3.5" aria-hidden />}
            {up ? '+' : ''}{delta.toLocaleString('en-US')}
          </span>
        )}
        {deltaLabel && <span>{deltaLabel}</span>}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/** Names the Snowflake capability behind a component. */
export function PoweredBy({ children }: { children: ReactNode }) {
  return <span className="pill pill-outline !text-[11px]"><Sparkles className="w-3 h-3" style={{ color: 'var(--spruce-2)' }} aria-hidden />Powered by {children}</span>;
}
export function SampleAiBadge() {
  return <Pill c="var(--sample)" title="Captured from the live pipeline on this synthetic data; not a live Cortex call"><Bot className="w-3 h-3" aria-hidden />Sample AI response</Pill>;
}
export function SourceBadge({ p }: { p?: Provenance }) {
  if (!p) return null;
  if (p.source === 'mock') return <span className="pill pill-outline"><Database className="w-3 h-3" aria-hidden />Sample data</span>;
  return <Pill c="var(--spruce-2)" title="Measured round trip from the app server to Snowflake"><Timer className="w-3 h-3" aria-hidden />Live{p.latencyMs !== undefined ? ` · ${p.latencyMs.toLocaleString()} ms` : ''}</Pill>;
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />;
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px]" />)}</div>
      <div className="grid lg:grid-cols-3 gap-4"><Skeleton className="h-72" /><Skeleton className="h-72 lg:col-span-2" /></div>
      <Skeleton className="h-64" />
    </div>
  );
}
export function ErrorState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="panel p-6 flex gap-3 items-start" role="alert">
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--siu) 12%, transparent)', color: 'var(--siu)' }}><AlertTriangle className="w-4 h-4" /></span>
      <div><h2 className="font-bold">{title}</h2>{detail && <p className="text-sm muted mt-1 break-words">{detail}</p>}
        <p className="text-sm muted mt-2">Live mode never falls back to sample data. Check the connection in <code>.env.local</code> or switch to Sample.</p></div>
    </div>
  );
}

export const chartTooltip = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' },
  labelStyle: { color: 'var(--ink)', fontWeight: 700 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'var(--surface-3)', opacity: 0.6 },
};
export const axisTick = { fontSize: 11, fill: 'var(--ink-2)' };

/** Reveals text word by word, then hands it to Markdown. */
export function StreamText({ text, onCite, activeCite, speed = 22 }: { text: string; onCite?: (n: string) => void; activeCite?: string | null; speed?: number }) {
  const words = text.split(/(\s+)/);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(words.length); return; }
    setN(0);
    const id = window.setInterval(() => setN((x) => { if (x >= words.length) { window.clearInterval(id); return x; } return x + 3; }), speed);
    return () => window.clearInterval(id);
  }, [text, words.length, speed]);
  const done = n >= words.length;
  return <div className={done ? '' : 'stream-caret'} aria-live="polite"><Markdown text={done ? text : words.slice(0, n).join('')} onCite={onCite} activeCite={activeCite} /></div>;
}

// Minimal markdown: lists, tables, bold/italic, and [n] citations as buttons.
function inline(s: string, key: number, onCite?: (n: string) => void, activeCite?: string | null): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|\[\d+(?:,\s*\d+)*\]|_[^_\s][^_]*_|\*[^*\s][^*]*\*)/g).filter(Boolean);
  return <span key={key}>{parts.map((p, i) => {
    if (p.startsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    const cite = p.match(/^\[(\d+(?:,\s*\d+)*)\]$/);
    if (cite) return cite[1].split(/,\s*/).map((c) => onCite
      ? <button key={`${i}-${c}`} type="button" className={`cite ${activeCite === c ? 'on' : ''}`} onClick={() => onCite(c)} aria-label={`Source ${c}`}>{c}</button>
      : <span key={`${i}-${c}`} className="cite">{c}</span>);
    if ((p.startsWith('_') && p.endsWith('_')) || (p.startsWith('*') && p.endsWith('*'))) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  })}</span>;
}
export function Markdown({ text, onCite, activeCite }: { text: string; onCite?: (n: string) => void; activeCite?: string | null }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  const il = (s: string, j: number) => inline(s, j, onCite, activeCite);
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      out.push(<div key={k++} className="relative overflow-x-auto"><table><thead><tr>{body[0].map((c, j) => <th key={j}>{il(c, j)}</th>)}</tr></thead>
        <tbody>{body.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{il(c, j)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length) {
        if (/^\s*([-*•]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+\.)\s+/, '')); i++; continue; }
        if (!lines[i].trim() && i + 1 < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i + 1])) { i++; continue; }
        break;
      }
      const li = items.map((t, j) => <li key={j}>{il(t, j)}</li>);
      out.push(ordered ? <ol key={k++}>{li}</ol> : <ul key={k++}>{li}</ul>);
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { i++; continue; }
    if (/^#{1,4}\s/.test(l)) { out.push(<p key={k++}><strong>{l.replace(/^#+\s/, '')}</strong></p>); i++; continue; }
    if (l.trim()) out.push(<p key={k++}>{il(l, 0)}</p>);
    i++;
  }
  return <div className="prose-ai text-[13.5px] leading-relaxed">{out}</div>;
}

/** Small transient confirmation. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  return { toast: setMsg, node: msg ? <div className="toast" role="status">{msg}</div> : null };
}
