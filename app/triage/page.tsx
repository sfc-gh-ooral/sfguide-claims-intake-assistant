'use client';

// Triage board: open claims by handling tier, adjuster workload, and cycle-time trend.
import Link from 'next/link';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Flag, Kpi, PoweredBy, SourceBadge, Thinking, TIER_COLOR, TierPill } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { TIERS } from '@/lib/types';

export default function TriagePage() {
  const { data: board, error, loading } = useAsync(() => data.board(), []);
  const trend = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>();
    for (const c of board?.cycle ?? []) { const r = m.get(c.month) ?? { month: c.month }; r[c.tier] = c.avgDays; m.set(c.month, r); }
    return [...m.values()];
  }, [board]);
  if (loading) return <Thinking label="Loading the triage board" />;
  if (error || !board) return <Card title="Could not load the board"><p className="text-sm">{error}</p></Card>;
  const name = (id: string | null) => board.adjusters.find((a) => a.adjusterId === id)?.name ?? '—';
  const open = board.claims.filter((c) => c.status !== 'Closed');
  const waiting = open.filter((c) => c.status === 'New');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Triage board</h1>
          <p className="text-sm muted">Tiers come from AI_CLASSIFY until an adjuster accepts or changes them. New claims show the suggested adjuster.</p>
        </div>
        <div className="flex gap-2 flex-wrap"><PoweredBy>AI_CLASSIFY</PoweredBy><SourceBadge p={board.provenance} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIERS.map((t) => <Kpi key={t} label={t} value={String(open.filter((c) => c.tier === t).length)} sub={`${waiting.filter((c) => c.tier === t).length} new, not yet routed`} />)}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        {TIERS.map((t) => {
          const list = open.filter((c) => c.tier === t).sort((a, b) => Number(b.status === 'New') - Number(a.status === 'New') || b.flags.length - a.flags.length);
          return (
            <section key={t} className="lane" aria-label={`${t} lane`}>
              <div className="flex items-center justify-between mb-2"><TierPill tier={t} /><span className="text-xs muted">{list.length}</span></div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {list.slice(0, 40).map((c) => (
                  <Link key={c.claimId} href={`/claim?id=${c.claimId}`} className="card card-hover block p-2.5 no-underline" style={{ borderLeft: `3px solid ${TIER_COLOR[t]}` }}>
                    <div className="flex justify-between gap-2 text-sm font-semibold"><span>{c.claimId}</span>
                      <span className="text-[11px] font-medium" style={{ color: c.status === 'New' ? 'var(--accent)' : 'var(--muted)' }}>{c.status}</span></div>
                    <div className="text-xs muted">{c.insured} · {c.lossType} · {c.reportedDate}</div>
                    <div className="text-xs mt-1">{c.status === 'New' ? `Suggested: ${name(c.suggestedAdjuster)}` : `Adjuster: ${name(c.adjuster)}`}</div>
                    {c.flags.length > 0 && <div className="flex gap-1 flex-wrap mt-1.5">{c.flags.map((f) => <Flag key={f}>{f}</Flag>)}</div>}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Adjuster workload (open claims vs capacity)" className="min-w-0">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={board.adjusters.map((a) => ({ name: a.name.split(' ')[0], open: a.openClaims, free: Math.max(0, a.capacity - a.openClaims) }))} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-2)' }} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="open" stackId="a" name="Open claims" fill="var(--chart-1)" />
                <Bar dataKey="free" stackId="a" name="Remaining capacity" fill="var(--surface-2)" stroke="var(--border)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] muted">{board.adjusters.map((a) => `${a.name.split(' ')[0]}: ${a.skills}`).join(' · ')}</p>
        </Card>
        <Card title="Average cycle time by tier (closed claims, days)" className="min-w-0">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {TIERS.map((t) => <Line key={t} dataKey={t} stroke={TIER_COLOR[t]} strokeWidth={2} dot={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] muted">On this synthetic history, complex claims take longer each month while fast-track and standard claims close slightly faster.</p>
        </Card>
      </div>
    </div>
  );
}
