'use client';

// Triage board: open claims in handling-tier lanes, adjuster workload, and cycle-time trend.
import { Clock3, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisTick, chartTooltip, CountUp, ErrorState, Flag, PageSkeleton, Panel, PoweredBy, SourceBadge, TIER_COLOR } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { TIERS, type BoardClaim } from '@/lib/types';

const HEX: Record<string, string> = { 'Fast track': '#13795B', Standard: '#3D5A99', Complex: '#975406', 'SIU referral': '#B4235A' };
const LANE_NOTE: Record<string, string> = {
  'Fast track': 'Glass and minor damage, clear coverage',
  Standard: 'Collision, theft and weather losses',
  Complex: 'Injury, rising bills or discrepancies',
  'SIU referral': 'Fraud indicators for special investigation',
};
const initials = (n?: string) => (n ?? '?').split(' ').map((p) => p[0]).join('').slice(0, 2);

function ClaimCard({ c, name }: { c: BoardClaim; name: (id: string | null) => string | undefined }) {
  const who = c.status === 'New' ? name(c.suggestedAdjuster) : name(c.adjuster);
  return (
    <Link href={`/claim?id=${c.claimId}`} className="panel panel-hover block p-3 no-underline" style={{ borderLeft: `3px solid ${TIER_COLOR[c.tier]}` }}>
      <div className="flex justify-between items-center gap-2">
        <span className="mono font-bold text-[13px]">{c.claimId}</span>
        {c.status === 'New' ? <span className="pill" style={{ background: 'var(--marker)', color: '#2E2400' }}>New</span> : <span className="text-[11px] muted">{c.status}</span>}
      </div>
      <div className="text-[12.5px] font-semibold mt-1 truncate">{c.insured}</div>
      <div className="text-[11.5px] muted">{c.lossType} · <span className="mono">{c.reportedDate.slice(5)}</span></div>
      {c.flags.length > 0 && <div className="flex gap-1 flex-wrap mt-2">{c.flags.map((f) => <Flag key={f}>{f}</Flag>)}</div>}
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t text-[11.5px]" style={{ borderColor: 'var(--line)' }}>
        <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: HEX[c.tier] }} aria-hidden>{initials(who)}</span>
        <span className="muted truncate">{c.status === 'New' ? 'Suggested: ' : ''}<span style={{ color: 'var(--ink)' }} className="font-semibold">{who ?? 'Unassigned'}</span></span>
      </div>
    </Link>
  );
}

export default function TriagePage() {
  const { data: board, error, loading } = useAsync(() => data.board(), []);
  const [onlyNew, setOnlyNew] = useState(false);
  const [q, setQ] = useState('');
  const trend = useMemo(() => {
    const m = new Map<string, Record<string, number | string>>();
    for (const c of board?.cycle ?? []) {
      const r = m.get(c.month) ?? { month: new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) };
      r[c.tier] = c.avgDays; m.set(c.month, r);
    }
    return [...m.values()];
  }, [board]);

  if (loading) return <PageSkeleton label="Loading the triage board" />;
  if (error || !board) return <ErrorState title="Could not load the triage board" detail={error} />;
  const name = (id: string | null) => board.adjusters.find((a) => a.adjusterId === id)?.name;
  const open = board.claims.filter((c) => c.status !== 'Closed');
  const needle = q.trim().toLowerCase();
  const shown = open.filter((c) => (!onlyNew || c.status === 'New') && (!needle || `${c.claimId} ${c.insured} ${c.lossType}`.toLowerCase().includes(needle)));
  const lastCycle = (t: string) => [...board.cycle].reverse().find((c) => c.tier === t);
  const workload = board.adjusters.map((a) => ({ name: a.name, short: a.name.split(' ')[0], open: a.openClaims, free: Math.max(0, a.capacity - a.openClaims), load: a.openClaims / a.capacity, skills: a.skills }))
    .sort((a, b) => b.load - a.load);
  const totalOpen = board.adjusters.reduce((s, a) => s + a.openClaims, 0), totalCap = board.adjusters.reduce((s, a) => s + a.capacity, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13.5px] muted max-w-3xl">Each claim&apos;s tier comes from AI_CLASSIFY over its fact sheet until an adjuster accepts or changes it. New claims show the least-loaded qualified adjuster as a suggestion.</p>
        <div className="flex gap-2 flex-wrap"><PoweredBy>AI_CLASSIFY</PoweredBy><SourceBadge p={board.provenance} /></div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {TIERS.map((t) => {
          const n = open.filter((c) => c.tier === t).length, nw = open.filter((c) => c.tier === t && c.status === 'New').length;
          const cyc = lastCycle(t);
          return (
            <div key={t} className="panel panel-hover p-4 relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: TIER_COLOR[t] }} aria-hidden />
              <div className="flex items-center justify-between"><span className="eyebrow" style={{ color: TIER_COLOR[t] }}>{t}</span>{t === 'SIU referral' && <ShieldAlert className="w-4 h-4" style={{ color: TIER_COLOR[t] }} aria-hidden />}</div>
              <div className="text-[30px] font-extrabold tabular leading-none mt-1.5"><CountUp value={n} /></div>
              <div className="text-[12px] muted mt-2">{nw} new, not routed{cyc ? <> · <Clock3 className="inline w-3 h-3 -mt-0.5" aria-hidden /> {cyc.avgDays} d avg</> : ''}</div>
            </div>
          );
        })}
      </div>

      <Panel pad="p-4" eyebrow="Open claims" title="Lanes by handling tier" right={<>
        <label className="flex items-center gap-2 text-[12.5px] font-semibold cursor-pointer"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="accent-[var(--spruce-2)]" />Only new</label>
        <input className="input w-full sm:w-48" placeholder="Filter claims…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter claims" />
      </>}>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
          {TIERS.map((t) => {
            const list = shown.filter((c) => c.tier === t).sort((a, b) => Number(b.status === 'New') - Number(a.status === 'New') || b.flags.length - a.flags.length || b.reportedDate.localeCompare(a.reportedDate));
            return (
              <section key={t} className="lane lane-head" style={{ ['--c' as string]: TIER_COLOR[t] }} aria-label={`${t} lane`}>
                <div className="flex items-center justify-between mb-0.5"><h3 className="font-bold text-[13.5px]">{t}</h3><span className="spine-count !bg-[var(--surface-3)] !text-[var(--ink)]">{list.length}</span></div>
                <p className="text-[11.5px] muted mb-2.5">{LANE_NOTE[t]}</p>
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
                  {list.slice(0, 30).map((c) => <ClaimCard key={c.claimId} c={c} name={name} />)}
                  {!list.length && <p className="text-[12px] muted text-center py-6 rounded-lg border border-dashed" style={{ borderColor: 'var(--line-strong)' }}>No {onlyNew ? 'new ' : ''}claims in this lane</p>}
                  {list.length > 30 && <p className="text-[11.5px] muted text-center">+ {list.length - 30} more</p>}
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel eyebrow={`${totalOpen} of ${totalCap} slots used`} title="Adjuster workload" right={<Users className="w-4 h-4 muted" aria-hidden />}>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={workload} layout="vertical" margin={{ left: 0, right: 12 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="short" width={70} tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip {...chartTooltip} labelFormatter={(_l, p) => p?.[0]?.payload ? `${p[0].payload.name} · ${p[0].payload.skills}` : ''} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={8} />
                <Bar dataKey="open" stackId="a" name="Open claims" fill="#136B5C" radius={[4, 0, 0, 4]} />
                <Bar dataKey="free" stackId="a" name="Remaining capacity" fill="var(--surface-3)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel eyebrow="Closed claims, last 12 months" title="Average cycle time by tier (days)">
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -14, right: 10, top: 6 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} />
                <Tooltip {...chartTooltip} formatter={(v) => `${v} days`} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={8} />
                {TIERS.map((t) => <Line key={t} dataKey={t} stroke={HEX[t]} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[12px] muted">On this synthetic history, complex and SIU claims take several times longer to close than fast-track claims, which is why routing them early matters. SIU months with no closures show as gaps bridged by the line.</p>
        </Panel>
      </div>
    </div>
  );
}
