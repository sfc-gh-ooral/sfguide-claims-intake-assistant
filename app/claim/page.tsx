'use client';

// Claim file: extracted fields beside the source document, coverage check, and the AI summary,
// tier and routing suggestion, with accept / correct / route actions.
import { Check, ExternalLink, Pencil, RefreshCw, Route } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Reasoning } from '@/components/Reasoning';
import { Card, Confidence, Flag, Markdown, PoweredBy, SampleAiBadge, SourceBadge, Thinking, TierPill, usd } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { HOSTED_EXAMPLE } from '@/lib/hosted';
import { DOC_TYPE_LABEL, TIERS, type ClaimFile, type DocDetail, type TriageResult } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const LABEL = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Splits the document text into plain and highlighted runs for each extracted value found in it. */
function highlight(text: string, fields: Record<string, string>, active: string | null): ReactNode[] {
  const marks: { start: number; end: number; key: string }[] = [];
  const lower = text.toLowerCase();
  for (const [key, raw] of Object.entries(fields)) {
    const v = raw.trim();
    if (v.length < 3 || /^(none|no|yes|n\/a)$/i.test(v)) continue;
    const num = Number(v.replace(/[$,]/g, ''));
    const variants = [v, v.replace(/^\$/, ''), num ? num.toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''].filter((x) => x.length >= 3);
    for (const needle of variants) {
      const at = lower.indexOf(needle.toLowerCase());
      if (at >= 0 && !marks.some((m) => at < m.end && at + needle.length > m.start)) { marks.push({ start: at, end: at + needle.length, key }); break; }
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let pos = 0;
  marks.forEach((m, i) => {
    out.push(text.slice(pos, m.start));
    out.push(<mark key={i} className={`hl ${active === m.key ? 'on' : ''}`} title={LABEL(m.key)}>{text.slice(m.start, m.end)}</mark>);
    pos = m.end;
  });
  out.push(text.slice(pos));
  return out;
}

function DocViewer({ doc, active }: { doc: DocDetail; active: string | null }) {
  const href = doc.url || `${BASE}/documents/${doc.fileName}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs muted">{doc.docId} · received {doc.receivedAt.replace('T', ' ')} · {doc.source}</div>
        <a className="text-xs underline inline-flex items-center gap-1" href={href} target="_blank" rel="noreferrer">Open original <ExternalLink className="w-3 h-3" /></a>
      </div>
      {doc.docType === 'damage_photo' ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={href} alt={`Damage photo ${doc.docId}, a synthetic illustration of a vehicle`} className="w-full rounded-lg border" style={{ borderColor: 'var(--border)' }} />
          {doc.photoDescription && (
            <div className="card p-3">
              <div className="flex items-center gap-2 mb-1 flex-wrap"><PoweredBy>AI_COMPLETE (image)</PoweredBy></div>
              <Markdown text={doc.photoDescription} />
            </div>
          )}
        </>
      ) : (
        <div className="doc-paper tabular" aria-label="Parsed document text with extracted values highlighted">{highlight(doc.text ?? '', doc.fields, active)}</div>
      )}
    </div>
  );
}

function Fields({ file, doc, active, setActive, onCorrect }: { file: ClaimFile; doc: DocDetail; active: string | null;
  setActive: (k: string | null) => void; onCorrect: (field: string, oldV: string, newV: string) => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const corrected = new Set(file.actions.filter((a) => a.action === 'correct' && a.fieldName?.startsWith(`${doc.docId}.`)).map((a) => a.fieldName!.split('.')[1]));
  const entries = Object.entries(doc.fields);
  if (!entries.length) return <p className="text-sm muted">{doc.docType === 'damage_photo' ? 'Photos get an AI damage description instead of fields.' : 'No fields extracted for this document type.'}</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: active === k ? 'var(--accent-soft)' : undefined }}
          onMouseEnter={() => setActive(k)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(k)}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide muted font-semibold">{LABEL(k)}</span>
            <span className="flex items-center gap-1">
              {corrected.has(k) ? <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>Corrected</span> : <Confidence score={doc.scores[k]} />}
              <button className="btn !px-1.5 !py-0.5" aria-label={`Correct ${LABEL(k)}`} onClick={() => { setEditing(k); setValue(v); }}><Pencil className="w-3 h-3" /></button>
            </span>
          </div>
          {editing === k ? (
            <form className="flex gap-1 mt-1" onSubmit={async (e) => { e.preventDefault(); await onCorrect(k, v, value); setEditing(null); }}>
              <input className="input flex-1 min-w-0" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New value for ${LABEL(k)}`} autoFocus />
              <button className="btn btn-primary !px-2" type="submit">Save</button>
              <button className="btn !px-2" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : <div className="text-sm break-words">{v || '—'}</div>}
        </div>
      ))}
      {doc.lineItems.length > 0 && (
        <div className="pt-2">
          <div className="text-[11px] uppercase tracking-wide muted font-semibold px-2 mb-1">Line items (table extraction)</div>
          <table className="data-table"><tbody>
            {doc.lineItems.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right tabular">{l.amount}</td></tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

function CoverageCard({ file }: { file: ClaimFile }) {
  const c = file.coverage;
  const rows: [string, ReactNode, boolean?][] = [
    ['Policy', `${file.claim.policyNumber} · ${c.policyFound ? 'found' : 'not found'}`, !c.policyFound],
    ['Active on loss date', c.policyActive === null ? '—' : c.policyActive ? 'Yes' : 'No', c.policyActive === false],
    ['Inception', c.inceptionDate ? `${c.inceptionDate} (${c.daysSinceInception} days before loss)` : '—', (c.daysSinceInception ?? 999) <= 30],
    ['Coverage part', c.coveragePart],
    ['Deductible', usd(c.deductible)],
  ];
  if (c.estimateTotal !== null) rows.push(['Estimate total vs line items', `${usd(c.estimateTotal)} vs ${usd(c.estimateLineSum)}`, c.estimateMismatch]);
  if (c.medicalBills) rows.push(['Medical bills', `${c.medicalBills} bills, ${usd(c.medicalTotal)} (med pay limit ${usd(c.medPayLimit)})`, c.medicalTotal > (c.medPayLimit ?? Infinity)]);
  if (c.policeReportLagDays !== null) rows.push(['Police report received', `${c.policeReportLagDays} days after the incident`]);
  rows.push(['Prior losses (loss history)', c.priorLosses ? `${c.priorLosses} · ${usd(c.priorPaid)} paid` : 'None', c.priorLosses > 0]);
  return (
    <Card title="Coverage check" right={<PoweredBy>SQL over extracted fields</PoweredBy>}>
      <dl className="text-sm">
        {rows.map(([k, v, warn]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
            <dt className="muted">{k}</dt><dd className="text-right font-medium" style={{ color: warn ? 'var(--negative)' : undefined }}>{v}</dd>
          </div>
        ))}
      </dl>
      {c.medicalSeries.length > 1 && <p className="text-xs muted mt-2">Bills in date order: {c.medicalSeries.map((x) => usd(x)).join(' → ')}</p>}
    </Card>
  );
}

function TriageCard({ file, onRoute }: { file: ClaimFile; onRoute: (action: 'accept' | 'route', tier: string, adjusterId: string) => Promise<void> }) {
  const [triage, setTriage] = useState<TriageResult | null>(file.triage);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [tier, setTier] = useState<string>(file.triage?.tier ?? 'Standard');
  const [adj, setAdj] = useState(file.triage?.suggestedAdjuster ?? file.adjusters[0]?.adjusterId ?? '');
  const routed = [...file.actions].reverse().find((a) => a.action !== 'correct' && a.adjusterId);
  const name = (id: string | null | undefined) => file.adjusters.find((a) => a.adjusterId === id)?.name ?? id ?? '—';
  const sample = (triage?.provenance ?? file.provenance).source === 'mock';
  const regenerate = async () => {
    setBusy(true); setErr(undefined);
    try { const t = await data.summarize(file.claim.claimId); setTriage(t); setTier(t.tier); if (t.suggestedAdjuster) setAdj(t.suggestedAdjuster); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <Card title="AI summary and routing" right={<>{sample && <SampleAiBadge />}<PoweredBy>AI_COMPLETE + AI_CLASSIFY</PoweredBy></>}>
      {busy ? <Reasoning kind="summarize" /> : triage ? (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap text-xs">
            <span className="muted">Suggested tier</span><TierPill tier={triage.tier} />
            <span className="muted">→ {name(triage.suggestedAdjuster)}</span>
            <SourceBadge p={triage.provenance ?? file.provenance} />
          </div>
          <Markdown text={triage.summary} />
          <p className="text-[11px] muted mt-2">AI suggestion from {triage.model}, generated {triage.generatedAt}. Review before acting.</p>
        </>
      ) : <p className="text-sm muted">The pipeline has not summarized this claim yet.</p>}
      {err && <p className="text-sm mt-2" style={{ color: 'var(--negative)' }}>{err}</p>}

      <div className="border-t mt-3 pt-3 space-y-2" style={{ borderColor: 'var(--border)' }}>
        {routed ? (
          <p className="text-sm flex items-center gap-2 flex-wrap"><Check className="w-4 h-4" style={{ color: 'var(--positive)' }} />
            Routed to <strong>{name(routed.adjusterId)}</strong> as <TierPill tier={routed.tier ?? ''} /> {routed.actedAt && <span className="text-xs muted">{routed.actedAt}</span>}</p>
        ) : file.claim.assignedAdjuster ? (
          <p className="text-sm">Already assigned to <strong>{name(file.claim.assignedAdjuster)}</strong>.</p>
        ) : null}
        <div className="flex gap-2 flex-wrap items-center">
          <button className="btn btn-primary" disabled={!triage || busy} onClick={() => triage && onRoute('accept', triage.tier, triage.suggestedAdjuster ?? adj)}>
            <Check className="w-4 h-4" />Accept suggestion</button>
          <button className="btn btn-ai" disabled={busy} onClick={regenerate}><RefreshCw className="w-4 h-4" />Regenerate</button>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select className="input" aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value)}>{TIERS.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="input min-w-0 max-w-full" aria-label="Adjuster" value={adj} onChange={(e) => setAdj(e.target.value)}>
            {file.adjusters.map((a) => <option key={a.adjusterId} value={a.adjusterId}>{a.name} · {a.openClaims}/{a.capacity}</option>)}
          </select>
          <button className="btn" onClick={() => onRoute('route', tier, adj)}><Route className="w-4 h-4" />Route</button>
        </div>
      </div>
    </Card>
  );
}

function ClaimFileView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id') ?? 'CLM-24003';
  const [rev, setRev] = useState(0);
  const { data: file, error, loading } = useAsync(() => data.claim(id), [id, rev]);
  const [docId, setDocId] = useState<string | null>(params.get('doc'));
  const [active, setActive] = useState<string | null>(null);
  const { data: inbox } = useAsync(() => data.inbox(), []);
  const claimIds = useMemo(() => [...new Set((inbox?.docs ?? []).map((d) => d.claimId))].sort(), [inbox]);
  useEffect(() => { setDocId(params.get('doc')); }, [params]);

  if (loading && !file) return <Thinking label={`Loading ${id}`} />;
  if (error) return <Card title="Could not load the claim"><p className="text-sm">{error}</p></Card>;
  if (!file || 'notFound' in (file as object)) return <Card title="Claim not found"><p className="text-sm">No claim {id}.</p></Card>;
  const doc = file.docs.find((d) => d.docId === docId) ?? file.docs[0];
  const act = async (a: Parameters<typeof data.act>[0]) => { await data.act(a); setRev((r) => r + 1); };
  const flags = [
    (file.coverage.daysSinceInception ?? 999) <= 30 && `Loss ${file.coverage.daysSinceInception} days after inception`,
    file.coverage.priorLosses > 0 && `${file.coverage.priorLosses} prior losses`,
    file.coverage.estimateMismatch && 'Estimate total ≠ line items',
    file.coverage.medicalBills >= 3 && 'Medical bills rising',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{file.claim.claimId} · {file.claim.insured}</h1>
          <p className="text-sm muted">{file.claim.lossType} · loss {file.claim.lossDate} · reported {file.claim.reportedDate} · {file.claim.vehicle} · {file.claim.lossLocation}</p>
          <div className="flex gap-1.5 flex-wrap mt-1.5">{flags.map((f) => <Flag key={f}>{f}</Flag>)}</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className="input" aria-label="Open claim" value={id} onChange={(e) => router.push(`/claim?id=${e.target.value}`)}>
            {(claimIds.length ? claimIds : [id]).map((c) => <option key={c}>{c}</option>)}
          </select>
          <Link className="btn" href={`/ask?id=${id}`}>Ask this file</Link>
          <SourceBadge p={file.provenance} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Documents">
        {file.docs.map((d) => (
          <button key={d.docId} role="tab" aria-selected={d.docId === doc?.docId} onClick={() => setDocId(d.docId)}
            className={`btn whitespace-nowrap ${d.docId === doc?.docId ? 'btn-primary' : ''}`}>
            {DOC_TYPE_LABEL[d.docType ?? ''] ?? 'Document'} <span className="text-[10px] opacity-75">{d.docId}</span>
          </button>
        ))}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,1fr)] lg:grid-cols-2 gap-4">
        <Card title="Source document" right={<PoweredBy>AI_PARSE_DOCUMENT</PoweredBy>} className="min-w-0">
          {doc ? <DocViewer doc={doc} active={active} /> : <p className="text-sm muted">No documents yet.</p>}
        </Card>
        <Card title="Extracted fields" right={<PoweredBy>AI_EXTRACT</PoweredBy>} className="min-w-0">
          {doc && <Fields file={file} doc={doc} active={active} setActive={setActive}
            onCorrect={(field, oldV, newV) => act({ claimId: id, action: 'correct', fieldName: `${doc.docId}.${field}`, oldValue: oldV, newValue: newV })} />}
          <p className="text-[11px] muted mt-2">Hover a field to see where it came from in the document. Corrections are recorded in the decision log.</p>
        </Card>
        <div className="space-y-4 min-w-0 lg:col-span-2 xl:col-span-1">
          <TriageCard key={`${id}-${rev}`} file={file} onRoute={(action, tier, adjusterId) => act({ claimId: id, action, tier, adjusterId })} />
          <CoverageCard file={file} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Claim notes">
          {file.notes.length ? <ul className="space-y-2 text-sm">{file.notes.map((n) => <li key={n.noteId}><span className="text-xs muted">{n.createdAt} · {n.author}</span><div>{n.text}</div></li>)}</ul>
            : <p className="text-sm muted">No notes yet.</p>}
        </Card>
        <Card title="Loss history and decision log" right={file.lossHistory.length ? <Flag>Prior losses on file</Flag> : undefined}>
          {file.lossHistory.length > 0 && (
            <div className="relative overflow-x-auto mb-3"><table className="data-table"><thead><tr><th>Prior loss</th><th>Carrier</th><th>Type</th><th className="text-right">Paid</th></tr></thead>
              <tbody>{file.lossHistory.map((h) => <tr key={h.lossDate}><td>{h.lossDate}</td><td>{h.carrier}</td><td>{h.lossType}</td><td className="text-right tabular">{usd(h.paid)}</td></tr>)}</tbody></table></div>
          )}
          {file.actions.length ? <ul className="space-y-1 text-sm">{file.actions.map((a, i) => (
            <li key={i}><span className="text-xs muted">{a.actedAt}</span> · {a.action === 'correct' ? `Corrected ${a.fieldName}: “${a.oldValue}” → “${a.newValue}”`
              : `${a.action === 'accept' ? 'Accepted AI suggestion' : 'Routed'}: ${a.tier} → ${file.adjusters.find((x) => x.adjusterId === a.adjusterId)?.name ?? a.adjusterId}`}</li>))}</ul>
            : <p className="text-sm muted">No decisions recorded yet.{HOSTED_EXAMPLE ? ' In this hosted example, decisions stay in your browser tab.' : ''}</p>}
        </Card>
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return <Suspense fallback={<Thinking label="Loading" />}><ClaimFileView /></Suspense>;
}
