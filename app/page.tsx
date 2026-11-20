'use client';

// Intake: every document that landed on the claims stage, with pipeline status and extraction
// confidence. KPIs and charts are computed from the same rows the table shows.
import { ArrowDown, ArrowUp, ArrowUpDown, FileStack, Inbox as InboxIcon, ScanSearch, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DocView } from '@/components/DocView';
import { axisTick, chartTooltip, Confidence, ErrorState, Kpi, PageSkeleton, Panel, PoweredBy, Skeleton, SourceBadge, StatusPill, TierPill } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { DOC_TYPE_LABEL, type ClaimFile, type InboxDoc } from '@/lib/types';

const TYPE_COLOR: Record<string, string> = {
  fnol_email: '#136B5C', repair_estimate: '#3D5A99', claim_form: '#5FA897', police_report: '#975406', medical_bill: '#B4235A', damage_photo: '#C9A300',
};
const SOURCES = ['Email', 'Shop upload', 'Portal upload', 'Agency portal', 'Provider fax', 'Mobile app'];
const SOURCE_COLOR = ['#136B5C', '#3D5A99', '#5FA897', '#975406', '#B4235A', '#C9A300'];
type SortKey = 'receivedAt' | 'docType' | 'claimId' | 'status' | 'confidence';

function Preview({ doc, onClose }: { doc: InboxDoc; onClose: () => void }) {
  const { data: file, loading } = useAsync<ClaimFile | null>(() => data.claim(doc.claimId), [doc.claimId]);
  const d = file?.docs.find((x) => x.docId === doc.docId);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="drawer p-5" role="dialog" aria-modal="true" aria-label={`Preview ${doc.docId}`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="eyebrow">{DOC_TYPE_LABEL[doc.docType ?? ''] ?? 'Document'} · {doc.source}</div>
            <h2 className="text-lg font-extrabold mono">{doc.docId}</h2>
            <p className="text-[13px] muted">{doc.claimId} · {doc.insured} · {doc.lossType}</p>
          </div>
          <button className="btn !px-2" onClick={onClose} aria-label="Close preview" autoFocus><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-2 flex-wrap mb-4">
          <StatusPill status={doc.status} />{doc.confidence !== null && <Confidence score={doc.confidence} />}
          {file?.triage && <TierPill tier={file.triage.tier} />}
        </div>
        {loading || !d ? <Skeleton className="h-96" /> : (
          <>
            <DocView doc={d} active={null} maxH={420} />
            {Object.keys(d.fields).length > 0 && (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                {Object.entries(d.fields).slice(0, 8).map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className="eyebrow !text-[10.5px]">{k.replace(/_/g, ' ')}</dt><dd className="mono truncate" title={v}>{v || '—'}</dd></div>
                ))}
              </dl>
            )}
          </>
        )}
        <Link href={`/claim?id=${doc.claimId}&doc=${doc.docId}`} className="btn btn-primary w-full justify-center mt-5">Open claim file</Link>
      </aside>
    </>
  );
}

export default function IntakePage() {
  const { data: inbox, error, loading } = useAsync(() => data.inbox(), []);
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'receivedAt', dir: -1 });
  const [limit, setLimit] = useState(40);
  const [open, setOpen] = useState<InboxDoc | null>(null);

  const docs = useMemo(() => inbox?.docs ?? [], [inbox]);
  const days = useMemo(() => {
    const last = docs.reduce((m, d) => (d.receivedAt > m ? d.receivedAt : m), '').slice(0, 10);
    if (!last) return [];
    const out: { day: string; label: string; total: number; [k: string]: number | string }[] = [];
    for (let i = 20; i >= 0; i--) {
      const dt = new Date(`${last}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() - i);
      const day = dt.toISOString().slice(0, 10);
      const row: (typeof out)[number] = { day, label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), total: 0 };
      for (const s of SOURCES) row[s] = 0;
      out.push(row);
    }
    const idx = new Map(out.map((r, i) => [r.day, i]));
    for (const d of docs) { const i = idx.get(d.receivedAt.slice(0, 10)); if (i !== undefined) { out[i][d.source] = (out[i][d.source] as number) + 1; out[i].total += 1; } }
    return out;
  }, [docs]);
  const conf = useMemo(() => {
    const bins = [['< 80%', 0, 0.8], ['80–85%', 0.8, 0.85], ['85–90%', 0.85, 0.9], ['90–95%', 0.9, 0.95], ['≥ 95%', 0.95, 1.01]] as const;
    return bins.map(([label, lo, hi]) => ({ label, count: docs.filter((d) => d.confidence !== null && d.confidence >= lo && d.confidence < hi).length, low: hi <= 0.8 }));
  }, [docs]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const r = docs.filter((d) => (type === 'all' || d.docType === type) && (status === 'all' || d.status === status) &&
      (!needle || `${d.docId} ${d.claimId} ${d.insured} ${d.lossType}`.toLowerCase().includes(needle)));
    const v = (d: InboxDoc) => (sort.key === 'confidence' ? d.confidence ?? 2 : sort.key === 'docType' ? DOC_TYPE_LABEL[d.docType ?? ''] ?? '' : d[sort.key]);
    return [...r].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * sort.dir);
  }, [docs, type, status, q, sort]);

  if (loading) return <PageSkeleton label="Loading the intake inbox" />;
  if (error || !inbox) return <ErrorState title="Could not load the intake inbox" detail={error} />;
  const k = inbox.kpis;
  const week = days.slice(-7).reduce((s, d) => s + d.total, 0), prior = days.slice(-14, -7).reduce((s, d) => s + d.total, 0);
  const typeData = inbox.byType.map((b) => ({ ...b, label: DOC_TYPE_LABEL[b.docType] ?? b.docType }));
  const th = (key: SortKey, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'receivedAt' ? -1 : 1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13.5px] muted max-w-3xl">Files land on a Snowflake stage. A stream on its directory table queues each new file, and a task parses, classifies and extracts it, then re-triages the claim.</p>
        <div className="flex gap-2 flex-wrap"><PoweredBy>stage + stream + task</PoweredBy><SourceBadge p={inbox.provenance} /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="Documents received" value={k.received} icon={<InboxIcon className="w-4 h-4" />} spark={days.slice(-14).map((d) => d.total)}
          delta={week - prior} deltaLabel="last 7 days vs prior 7" />
        <Kpi label="Extracted" value={k.extracted} icon={<ScanSearch className="w-4 h-4" />} color="var(--std)"
          sub={`${Math.round((k.extracted / Math.max(1, k.received)) * 100)}% of received · AI_EXTRACT`} />
        <Kpi label="Need review" value={k.needsReview} icon={<Sparkles className="w-4 h-4" />} color="var(--cx)"
          sub="a field scored under 80% confidence" />
        <Kpi label="New claims to triage" value={k.newClaims} icon={<FileStack className="w-4 h-4" />} color="var(--siu)"
          sub={k.typeAccuracy !== null ? `doc type matched the generator label on ${Math.round(k.typeAccuracy * 100)}%` : undefined} />
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        <Panel className="lg:col-span-7" eyebrow="Arrivals" title="Documents received per day, by channel" right={<span className="text-[12px] muted">last 21 days</span>}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ left: -18, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} interval={3} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip {...chartTooltip} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="circle" iconSize={8} />
                {SOURCES.map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={SOURCE_COLOR[i]} radius={i === SOURCES.length - 1 ? [4, 4, 0, 0] : 0} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel className="lg:col-span-5" eyebrow="Classification" title="Document types" right={<PoweredBy>AI_CLASSIFY</PoweredBy>}>
          <div className="grid grid-cols-[150px_1fr] gap-3 items-center">
            <div className="h-[150px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typeData} dataKey="count" nameKey="label" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none">
                    {typeData.map((t) => <Cell key={t.docType} fill={TYPE_COLOR[t.docType] ?? '#888'} />)}
                  </Pie>
                  <Tooltip {...chartTooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-extrabold tabular">{k.received}</span><span className="text-[10.5px] muted">documents</span>
              </div>
            </div>
            <ul className="space-y-1.5 min-w-0">
              {typeData.map((t) => (
                <li key={t.docType}>
                  <button className={`w-full flex items-center gap-2 text-[12.5px] rounded-md px-1.5 py-0.5 text-left ${type === t.docType ? 'font-bold' : ''}`}
                    style={{ background: type === t.docType ? 'var(--surface-3)' : undefined }} onClick={() => setType(type === t.docType ? 'all' : t.docType)}>
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: TYPE_COLOR[t.docType] }} aria-hidden />
                    <span className="truncate">{t.label}</span><span className="ml-auto mono">{t.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-1">Lowest field confidence per document</div>
            <div className="h-[92px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={conf} margin={{ left: -24, right: 4 }}>
                  <XAxis dataKey="label" tick={{ ...axisTick, fontSize: 10.5 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ ...axisTick, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="count" name="Documents" radius={[4, 4, 0, 0]}>{conf.map((c) => <Cell key={c.label} fill={c.low ? '#E8B800' : '#5FA897'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>
      </div>

      <Panel pad="p-0" className="overflow-hidden">
        <div className="p-5 pb-3 flex items-center gap-3 flex-wrap">
          <div className="min-w-0 mr-auto"><div className="eyebrow">Work queue</div><h2 className="text-[15px] font-bold">Incoming documents</h2></div>
          <div className="mode-switch" role="radiogroup" aria-label="Status filter">
            {['all', 'Needs review', 'Extracted'].map((s) => (
              <button key={s} role="radio" aria-checked={status === s} onClick={() => setStatus(s)}>
                {s === 'all' ? 'All' : s}{s === 'Needs review' && <span className="mono">{k.needsReview}</span>}
              </button>
            ))}
          </div>
          <select aria-label="Document type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input w-full sm:w-52" placeholder="Search claim, insured, doc…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
        </div>
        <div className="relative overflow-x-auto max-h-[560px] overflow-y-auto border-t" style={{ borderColor: 'var(--line)' }}>
          <table className="data-table min-w-[760px]">
            <thead><tr>{th('receivedAt', 'Received')}{th('docType', 'Document')}{th('claimId', 'Claim')}{th('status', 'Status')}{th('confidence', 'Confidence')}<th /></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((d) => (
                <tr key={d.docId} className={`cursor-pointer ${open?.docId === d.docId ? 'selected' : ''}`} onClick={() => setOpen(d)}>
                  <td className="mono text-[12px] whitespace-nowrap">{d.receivedAt.slice(5).replace('T', ' ')}</td>
                  <td>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLOR[d.docType ?? ''] }} aria-hidden />
                      <span className="font-semibold">{DOC_TYPE_LABEL[d.docType ?? ''] ?? 'Unclassified'}</span></div>
                    <div className="text-[11.5px] muted mono">{d.docId} · {d.source}</div>
                  </td>
                  <td><span className="mono font-semibold">{d.claimId}</span><div className="text-[11.5px] muted">{d.insured} · {d.lossType}</div></td>
                  <td><StatusPill status={d.status} /></td>
                  <td>{d.docType === 'damage_photo' ? <span className="text-[11.5px] muted">Photo · AI description</span>
                    : d.confidence === null ? <span className="text-[11.5px] muted">Table extraction</span> : <Confidence score={d.confidence} />}</td>
                  <td className="text-right"><span className="text-[12px] font-semibold" style={{ color: 'var(--spruce-2)' }}>Preview →</span></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="text-center py-10 muted">No documents match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 flex items-center justify-between gap-2 flex-wrap text-[12px] muted border-t" style={{ borderColor: 'var(--line)' }}>
          <span>Showing {Math.min(limit, rows.length)} of {rows.length} documents. Confidence is the lowest AI_EXTRACT score among identifying fields; estimates use table extraction without scores.</span>
          {rows.length > limit && <button className="btn btn-sm" onClick={() => setLimit((l) => l + 60)}>Show more</button>}
        </div>
      </Panel>
      {open && <Preview doc={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
