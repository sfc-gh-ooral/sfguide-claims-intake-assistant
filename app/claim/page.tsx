'use client';

// Claim file: the source document with extracted values marked in place, the fields with their
// confidence (correctable), the coverage check, and the AI summary, tier and routing suggestion.
import { AlertTriangle, Camera, Check, CheckCircle2, ChevronRight, FileText, HeartPulse, Mail, MessageSquareText, Pencil, RefreshCw, Route, ScrollText, ShieldAlert, Wrench, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DocView, LABEL } from '@/components/DocView';
import { Reasoning } from '@/components/Reasoning';
import { axisTick, chartTooltip, Confidence, ErrorState, Flag, PageSkeleton, Panel, PoweredBy, SampleAiBadge, SourceBadge, StreamText, TIER_COLOR, TierPill, usd, useToast } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { HOSTED_EXAMPLE } from '@/lib/hosted';
import { SAMPLE_DELAY_MS } from '@/lib/sample-timing';
import { DOC_TYPE_LABEL, TIERS, type ClaimFile, type DocDetail, type TriageResult } from '@/lib/types';

const DOC_ICON: Record<string, typeof Mail> = { fnol_email: Mail, claim_form: FileText, repair_estimate: Wrench, police_report: ScrollText, medical_bill: HeartPulse, damage_photo: Camera };
const FEATURED = [
  { id: 'CLM-24003', label: 'Theft 2 days after binding' },
  { id: 'CLM-24004', label: 'Windshield, fast track' },
  { id: 'CLM-24005', label: 'Rising medical bills' },
  { id: 'CLM-24008', label: 'Estimate doesn’t add up' },
];

function Fields({ file, doc, active, setActive, onCorrect }: { file: ClaimFile; doc: DocDetail; active: string | null;
  setActive: (k: string | null) => void; onCorrect: (field: string, oldV: string, newV: string) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const corrected = new Set(file.actions.filter((a) => a.action === 'correct' && a.fieldName?.startsWith(`${doc.docId}.`)).map((a) => a.fieldName!.split('.')[1]));
  const entries = Object.entries(doc.fields);
  const lineSum = doc.lineItems.reduce((s, l) => s + (Number(String(l.amount).replace(/[^0-9.]/g, '')) || 0), 0);
  const stated = Number(String(doc.fields.estimate_total ?? '').replace(/[^0-9.]/g, '')) || null;
  if (!entries.length) return <p className="text-[13px] muted">{doc.docType === 'damage_photo' ? 'Photos get an AI damage description instead of fields.' : 'No fields extracted for this document type.'}</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => {
        const score = doc.scores[k];
        return (
          <div key={k} className={`field-row ${active === k ? 'on' : ''}`} onMouseEnter={() => setActive(k)} onMouseLeave={() => setActive(null)}>
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow !text-[10.5px]">{LABEL(k)}</span>
              <span className="flex items-center gap-1.5">
                {corrected.has(k) ? <span className="pill" style={{ background: 'var(--marker)', color: '#2E2400' }}><Check className="w-3 h-3" />Corrected</span> : <Confidence score={score} />}
                <button className="btn btn-ghost btn-sm !px-1.5" aria-label={`Correct ${LABEL(k)}`} onClick={() => { setEditing(k); setValue(v); }} onFocus={() => setActive(k)}><Pencil className="w-3 h-3" /></button>
              </span>
            </div>
            {editing === k ? (
              <form className="flex gap-1.5 mt-1.5" onSubmit={async (e) => { e.preventDefault(); await onCorrect(k, v, value); setEditing(null); }}>
                <input className="input flex-1 min-w-0 mono" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New value for ${LABEL(k)}`} autoFocus />
                <button className="btn btn-primary btn-sm" type="submit">Save</button>
                <button className="btn btn-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : <div className={`text-[13px] break-words mt-0.5 ${/date|number|vin|total|policy/.test(k) ? 'mono' : ''}`}>{v || '—'}</div>}
          </div>
        );
      })}
      {doc.lineItems.length > 0 && (
        <div className="pt-3">
          <div className="flex items-center justify-between mb-1.5 px-1"><span className="eyebrow !text-[10.5px]">Line items · table extraction</span></div>
          <div className="relative overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
            <table className="data-table"><tbody>
              {doc.lineItems.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right mono">{l.amount}</td></tr>)}
              <tr><td className="font-bold">Sum of line items</td><td className="text-right mono font-bold">{usd(lineSum, 2)}</td></tr>
              {stated !== null && <tr style={{ background: Math.abs(stated - lineSum) > 1 ? 'color-mix(in srgb, var(--siu) 9%, transparent)' : undefined }}>
                <td className="font-bold">Stated estimate total</td><td className="text-right mono font-bold" style={{ color: Math.abs(stated - lineSum) > 1 ? 'var(--siu)' : undefined }}>{usd(stated, 2)}</td></tr>}
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  );
}

function CoverageCheck({ file }: { file: ClaimFile }) {
  const c = file.coverage;
  type Row = { label: string; value: ReactNode; state: 'ok' | 'warn' | 'info' };
  const rows: Row[] = [
    { label: 'Policy found', value: <span className="mono">{file.claim.policyNumber}</span>, state: c.policyFound ? 'ok' : 'warn' },
    { label: 'Active on loss date', value: c.policyActive === null ? '—' : c.policyActive ? 'Yes' : 'No', state: c.policyActive === false ? 'warn' : 'ok' },
    { label: 'Days since inception', value: c.daysSinceInception ?? '—', state: (c.daysSinceInception ?? 999) <= 30 ? 'warn' : 'ok' },
    { label: 'Coverage part', value: c.coveragePart, state: 'info' },
    { label: 'Deductible', value: usd(c.deductible), state: 'info' },
  ];
  if (c.estimateTotal !== null) rows.push({ label: 'Estimate total vs line items', value: `${usd(c.estimateTotal)} vs ${usd(c.estimateLineSum)}`, state: c.estimateMismatch ? 'warn' : 'ok' });
  if (c.medicalBills) rows.push({ label: 'Medical bills vs med pay limit', value: `${usd(c.medicalTotal)} / ${usd(c.medPayLimit)}`, state: c.medicalTotal > (c.medPayLimit ?? Infinity) ? 'warn' : 'ok' });
  if (c.policeReportLagDays !== null) rows.push({ label: 'Police report received', value: `${c.policeReportLagDays} days after`, state: c.policeReportLagDays > 2 ? 'warn' : 'ok' });
  rows.push({ label: 'Prior losses (loss history)', value: c.priorLosses ? `${c.priorLosses} · ${usd(c.priorPaid)} paid` : 'None', state: c.priorLosses > 0 ? 'warn' : 'ok' });
  const warns = rows.filter((r) => r.state === 'warn').length;
  return (
    <Panel eyebrow="Rules in SQL over extracted fields" title="Coverage check" right={warns ? <Flag>{warns} to review</Flag> : <span className="pill pill-tint" style={{ ['--c' as string]: 'var(--fast)' }}><CheckCircle2 className="w-3 h-3" />All clear</span>}>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2.5 py-2 text-[13px]" style={{ borderColor: 'var(--line)' }}>
            {r.state === 'warn' ? <XCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--siu)' }} aria-label="Needs review" />
              : r.state === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--fast)' }} aria-label="Passes" />
              : <span className="w-4 h-4 shrink-0 rounded-full border-2" style={{ borderColor: 'var(--line-strong)' }} aria-hidden />}
            <span className="muted">{r.label}</span>
            <span className="ml-auto font-semibold text-right" style={{ color: r.state === 'warn' ? 'var(--siu)' : undefined }}>{r.value}</span>
          </li>
        ))}
      </ul>
      {c.medicalSeries.length > 1 && (
        <div className="mt-4">
          <div className="eyebrow mb-1">Medical bills in date order</div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={c.medicalSeries.map((v, i) => ({ bill: `Bill ${i + 1}`, amount: v }))} margin={{ left: -6, right: 8, top: 6 }}>
                <defs><linearGradient id="med" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#B4235A" stopOpacity={0.3} /><stop offset="100%" stopColor="#B4235A" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 4" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="bill" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} width={44} />
                <Tooltip {...chartTooltip} formatter={(v) => usd(Number(v))} />
                {c.medPayLimit && <ReferenceLine y={c.medPayLimit} stroke="var(--cx)" strokeDasharray="4 3" label={{ value: 'Med pay limit', fontSize: 10.5, fill: 'var(--cx)', position: 'insideTopLeft' }} />}
                <Area dataKey="amount" name="Billed" stroke="#B4235A" strokeWidth={2} fill="url(#med)" dot={{ r: 3, fill: '#B4235A' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}

function AiSuggestion({ file, onRoute }: { file: ClaimFile; onRoute: (action: 'accept' | 'route', tier: string, adjusterId: string) => Promise<void> }) {
  const [triage, setTriage] = useState<TriageResult | null>(file.triage);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [tier, setTier] = useState<string>(file.triage?.tier ?? 'Standard');
  const [adj, setAdj] = useState(file.triage?.suggestedAdjuster ?? file.adjusters[0]?.adjusterId ?? '');
  const routed = [...file.actions].reverse().find((a) => a.action !== 'correct' && a.adjusterId);
  const adjuster = (id: string | null | undefined) => file.adjusters.find((a) => a.adjusterId === id);
  const sample = (triage?.provenance ?? file.provenance).source === 'mock';
  const fieldCount = file.docs.reduce((s, d) => s + Object.keys(d.fields).length, 0);
  const steps = [
    `Reading ${file.docs.length} documents and ${fieldCount} extracted fields`,
    `Checking coverage on policy ${file.claim.policyNumber}`,
    'Choosing a handling tier with AI_CLASSIFY',
    'Drafting the adjuster summary with AI_COMPLETE',
  ];
  const regenerate = async () => {
    setBusy(true); setErr(undefined);
    try { const t = await data.summarize(file.claim.claimId); setTriage(t); setTier(t.tier); if (t.suggestedAdjuster) setAdj(t.suggestedAdjuster); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  };
  const sel = adjuster(adj);
  const loadPct = sel ? Math.min(100, (sel.openClaims / sel.capacity) * 100) : 0;
  return (
    <section className="panel ai-panel p-5 pl-6">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
        <div><div className="eyebrow">AI suggestion · review before acting</div><h2 className="text-[15px] font-bold">Summary, tier and routing</h2></div>
        <div className="flex gap-1.5 flex-wrap">{sample && <SampleAiBadge />}<PoweredBy>AI_COMPLETE + AI_CLASSIFY</PoweredBy></div>
      </div>
      {busy ? <Reasoning steps={steps} expectMs={SAMPLE_DELAY_MS.summarize} title="Re-triaging this claim" /> : triage ? (
        <>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="stamp" style={{ ['--c' as string]: TIER_COLOR[triage.tier] }}>{triage.tier === 'SIU referral' && <ShieldAlert className="w-3.5 h-3.5" />}{triage.tier}</span>
            <span className="text-[12.5px] muted">suggested for <strong style={{ color: 'var(--ink)' }}>{adjuster(triage.suggestedAdjuster)?.name ?? '—'}</strong></span>
          </div>
          <StreamText key={triage.generatedAt + triage.summary.length} text={triage.summary} />
          <p className="text-[11.5px] muted mt-2 flex items-center gap-2 flex-wrap"><span className="mono">{triage.model}</span> · generated {triage.generatedAt} <SourceBadge p={triage.provenance ?? file.provenance} /></p>
        </>
      ) : <p className="text-[13px] muted">The pipeline has not summarized this claim yet.</p>}
      {err && <p className="text-[13px] mt-2" style={{ color: 'var(--siu)' }} role="alert">{err}</p>}

      <div className="border-t mt-4 pt-4 space-y-3" style={{ borderColor: 'var(--line)' }}>
        {(routed || file.claim.assignedAdjuster) && (
          <div className="flex items-center gap-2 flex-wrap text-[13px] rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--fast) 10%, transparent)' }}>
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--fast)' }} aria-hidden />
            {routed ? <>Routed to <strong>{adjuster(routed.adjusterId)?.name}</strong> as <TierPill tier={routed.tier ?? ''} />{routed.actedAt && <span className="mono text-[11.5px] muted">{routed.actedAt}</span>}</>
              : <>Assigned to <strong>{adjuster(file.claim.assignedAdjuster)?.name ?? file.claim.assignedAdjuster}</strong></>}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-primary" disabled={!triage || busy} onClick={() => triage && onRoute('accept', triage.tier, triage.suggestedAdjuster ?? adj)}><Check className="w-4 h-4" />Accept suggestion</button>
          <button className="btn" disabled={busy} onClick={regenerate}><RefreshCw className="w-4 h-4" />Regenerate</button>
        </div>
        <details className="group">
          <summary className="text-[12.5px] font-semibold cursor-pointer select-none flex items-center gap-1" style={{ color: 'var(--spruce-2)' }}>
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />Override tier or adjuster
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
            <label className="text-[11.5px] muted">Tier<select className="input w-full mt-0.5" value={tier} onChange={(e) => setTier(e.target.value)}>{TIERS.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="text-[11.5px] muted">Adjuster<select className="input w-full mt-0.5" value={adj} onChange={(e) => setAdj(e.target.value)}>
              {file.adjusters.map((a) => <option key={a.adjusterId} value={a.adjusterId}>{a.name} ({a.openClaims}/{a.capacity})</option>)}</select></label>
          </div>
          {sel && (
            <div className="mt-2 text-[11.5px] muted">
              <div className="flex justify-between"><span>{sel.skills}</span><span className="mono">{sel.openClaims}/{sel.capacity} open</span></div>
              <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--surface-3)' }}><div className="h-full rounded-full" style={{ width: `${loadPct}%`, background: loadPct > 85 ? 'var(--siu)' : 'var(--spruce-2)' }} /></div>
            </div>
          )}
          <button className="btn mt-3" onClick={() => onRoute('route', tier, adj)}><Route className="w-4 h-4" />Route to {sel?.name.split(' ')[0] ?? 'adjuster'}</button>
        </details>
      </div>
    </section>
  );
}

function ClaimFileView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id') ?? 'CLM-24003';
  const [rev, setRev] = useState(0);
  const { data: file, error, loading } = useAsync(() => data.claim(id), [id, rev], true);
  const [docId, setDocId] = useState<string | null>(params.get('doc'));
  const [active, setActive] = useState<string | null>(null);
  const { toast, node: toastNode } = useToast();
  useEffect(() => { setDocId(params.get('doc')); }, [params]);
  const { data: board } = useAsync(() => data.board(), []);
  const ids = useMemo(() => (board?.claims ?? []).map((c) => c.claimId).sort(), [board]);

  if (loading && !file) return <PageSkeleton label={`Loading ${id}`} />;
  if (error) return <ErrorState title="Could not load the claim" detail={error} />;
  if (!file || 'notFound' in (file as object)) return <ErrorState title="Claim not found" detail={`No claim ${id} in this data set.`} />;
  const doc = file.docs.find((d) => d.docId === docId) ?? file.docs[0];
  const act = async (a: Parameters<typeof data.act>[0], msg: string) => { await data.act(a); setRev((r) => r + 1); toast(msg); };
  const adjName = (x?: string) => file.adjusters.find((a) => a.adjusterId === x)?.name ?? x;
  const flags = [
    (file.coverage.daysSinceInception ?? 999) <= 30 && `Loss ${file.coverage.daysSinceInception} days after inception`,
    file.coverage.priorLosses > 0 && `${file.coverage.priorLosses} prior losses`,
    file.coverage.estimateMismatch && 'Estimate total ≠ line items',
    file.coverage.medicalBills >= 3 && 'Medical bills rising',
  ].filter(Boolean) as string[];
  const tier = [...file.actions].reverse().find((a) => a.tier)?.tier ?? file.triage?.tier;

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap items-center text-[12px]">
        <span className="eyebrow mr-1">Featured files</span>
        {FEATURED.map((f) => (
          <Link key={f.id} href={`/claim?id=${f.id}`} className={`pill ${f.id === id ? '' : 'pill-outline'}`} style={f.id === id ? { background: 'var(--marker)', color: '#2E2400' } : undefined}>
            <span className="mono">{f.id.slice(4)}</span>{f.label}
          </Link>
        ))}
      </div>

      <section className="panel p-5 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: tier ? TIER_COLOR[tier] : 'var(--line)' }} aria-hidden />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap"><h2 className="text-[22px] font-extrabold mono tracking-tight">{file.claim.claimId}</h2>
              {tier && <TierPill tier={tier} />}<span className="pill pill-outline">{file.claim.status}</span></div>
            <p className="text-[15px] font-semibold mt-0.5">{file.claim.insured} · {file.claim.lossType}</p>
            <dl className="flex gap-x-6 gap-y-1 flex-wrap text-[12.5px] mt-2">
              {[['Loss', file.claim.lossDate], ['Reported', file.claim.reportedDate], ['Vehicle', file.claim.vehicle], ['Where', file.claim.lossLocation]].map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="inline muted">{k} </dt><dd className={`inline font-semibold ${k === 'Loss' || k === 'Reported' ? 'mono' : ''}`}>{v}</dd></div>
              ))}
            </dl>
            {flags.length > 0 && <div className="flex gap-1.5 flex-wrap mt-3">{flags.map((f) => <Flag key={f}>{f}</Flag>)}</div>}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <select className="input mono" aria-label="Open claim" value={id} onChange={(e) => router.push(`/claim?id=${e.target.value}`)}>
              {(ids.length ? ids : [id]).map((c) => <option key={c}>{c}</option>)}
            </select>
            <Link className="btn btn-marker" href={`/ask?id=${id}`}><MessageSquareText className="w-4 h-4" />Ask this file</Link>
            <SourceBadge p={file.provenance} />
          </div>
        </div>
      </section>

      <div className="relative">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Documents in this claim">
          {file.docs.map((d) => {
            const Icon = DOC_ICON[d.docType ?? ''] ?? FileText;
            const on = d.docId === doc?.docId;
            const low = Object.values(d.scores).some((s) => s < 0.8);
            return (
              <button key={d.docId} role="tab" aria-selected={on} onClick={() => setDocId(d.docId)}
                className="panel panel-hover !rounded-xl px-3 py-2 text-left shrink-0 flex items-center gap-2.5"
                style={on ? { borderColor: 'var(--spruce-2)', boxShadow: '0 0 0 3px var(--spruce-soft)' } : undefined}>
                <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: on ? 'var(--spruce-2)' : 'var(--surface-3)', color: on ? '#fff' : 'var(--ink-2)' }}><Icon className="w-4 h-4" aria-hidden /></span>
                <span><span className="block text-[12.5px] font-bold whitespace-nowrap">{DOC_TYPE_LABEL[d.docType ?? ''] ?? 'Document'}{low && <AlertTriangle className="inline w-3 h-3 ml-1" style={{ color: 'var(--cx)' }} aria-label="Low confidence field" />}</span>
                  <span className="block text-[11px] muted mono whitespace-nowrap">{d.receivedAt.slice(5).replace('T', ' ')}</span></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,.85fr)_minmax(0,1fr)] lg:grid-cols-2">
        <Panel eyebrow={doc ? DOC_TYPE_LABEL[doc.docType ?? ''] : 'Source'} title="Source document" right={<PoweredBy>{doc?.docType === 'damage_photo' ? 'AI_CLASSIFY (image)' : 'AI_PARSE_DOCUMENT'}</PoweredBy>}>
          {doc ? <DocView key={doc.docId} doc={doc} active={active} onHover={setActive} sample={file?.provenance?.source === 'mock'} /> : <p className="text-[13px] muted">No documents yet.</p>}
        </Panel>
        <Panel eyebrow="Hover to find it in the source" title="Extracted fields" right={<PoweredBy>AI_EXTRACT</PoweredBy>}>
          {doc && <Fields file={file} doc={doc} active={active} setActive={setActive}
            onCorrect={(field, oldV, newV) => act({ claimId: id, action: 'correct', fieldName: `${doc.docId}.${field}`, oldValue: oldV, newValue: newV }, `Correction to ${LABEL(field)} recorded`)} />}
        </Panel>
        <div className="space-y-4 min-w-0 lg:col-span-2 xl:col-span-1">
          <AiSuggestion key={`${id}-${rev}`} file={file} onRoute={(action, t, adjusterId) =>
            act({ claimId: id, action, tier: t, adjusterId }, `${action === 'accept' ? 'Suggestion accepted' : 'Routed'}: ${t} → ${adjName(adjusterId)}`)} />
          <CoverageCheck file={file} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel eyebrow={`${file.notes.length} notes`} title="Claim notes">
          {file.notes.length ? (
            <ol className="relative pl-5">
              <span className="absolute left-[5px] top-1 bottom-1 w-px" style={{ background: 'var(--line)' }} aria-hidden />
              {file.notes.map((n) => (
                <li key={n.noteId} className="relative pb-3 last:pb-0">
                  <span className="absolute -left-5 top-1.5 w-[11px] h-[11px] rounded-full border-2" style={{ borderColor: 'var(--spruce-2)', background: 'var(--surface)' }} aria-hidden />
                  <div className="text-[11.5px] muted"><span className="mono">{n.createdAt}</span> · {n.author}</div>
                  <div className="text-[13px] mt-0.5">{n.text}</div>
                </li>
              ))}
            </ol>
          ) : <p className="text-[13px] muted">No notes yet.</p>}
        </Panel>
        <Panel eyebrow="Audit trail" title="Loss history and decisions" right={file.lossHistory.length ? <Flag>Prior losses on file</Flag> : undefined}>
          {file.lossHistory.length > 0 && (
            <div className="relative overflow-x-auto mb-4 rounded-lg border" style={{ borderColor: 'var(--line)' }}><table className="data-table min-w-[420px]"><thead><tr><th>Prior loss</th><th>Carrier</th><th>Type</th><th className="text-right">Paid</th></tr></thead>
              <tbody>{file.lossHistory.map((h) => <tr key={h.lossDate}><td className="mono">{h.lossDate}</td><td>{h.carrier}</td><td>{h.lossType}</td><td className="text-right mono">{usd(h.paid)}</td></tr>)}</tbody></table></div>
          )}
          {file.actions.length ? <ul className="space-y-2 text-[13px]">{file.actions.map((a, i) => (
            <li key={i} className="flex gap-2"><span className="mono text-[11.5px] muted shrink-0 pt-0.5">{a.actedAt}</span>
              <span>{a.action === 'correct' ? <>Corrected <span className="mono">{a.fieldName}</span>: “{a.oldValue}” → <mark className="hl" style={{ backgroundSize: '100% 100%' }}>{a.newValue}</mark></>
                : <>{a.action === 'accept' ? 'Accepted AI suggestion' : 'Routed'}: <strong>{a.tier}</strong> → {adjName(a.adjusterId)}</>}</span></li>))}</ul>
            : <p className="text-[13px] muted">No decisions recorded yet.{HOSTED_EXAMPLE ? ' In this hosted example, decisions stay in your browser tab.' : ' Decisions are written to APP.CLAIM_ACTIONS.'}</p>}
        </Panel>
      </div>
      {toastNode}
    </div>
  );
}

export default function ClaimPage() {
  return <Suspense fallback={<PageSkeleton label="Loading" />}><ClaimFileView /></Suspense>;
}
