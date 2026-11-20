'use client';

// Ask the claims file: questions over one claim's documents and notes, answered with citations
// that link to the excerpts Cortex Search returned.
import { Camera, FileText, HeartPulse, Mail, MessageSquareText, ScrollText, Send, StickyNote, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Reasoning } from '@/components/Reasoning';
import { ErrorState, Panel, PoweredBy, SampleAiBadge, Skeleton, SourceBadge, StreamText, TierPill } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { suggestedFor } from '@/lib/claims-data';
import { data } from '@/lib/client';
import { SAMPLE_DELAY_MS } from '@/lib/sample-timing';
import { DOC_TYPE_LABEL, type Answer, type Citation } from '@/lib/types';

type Turn = { q: string; a?: Answer; error?: string };
const ICON: Record<string, typeof Mail> = { fnol_email: Mail, claim_form: FileText, repair_estimate: Wrench, police_report: ScrollText, medical_bill: HeartPulse, damage_photo: Camera, claim_note: StickyNote };
const typeLabel = (t: string) => DOC_TYPE_LABEL[t] ?? (t === 'claim_note' ? 'Claim note' : t);

function CitationCard({ c, on, refCb }: { c: Citation; on: boolean; refCb: (el: HTMLLIElement | null) => void }) {
  const Icon = ICON[c.sourceType] ?? FileText;
  return (
    <li ref={refCb} className="rounded-xl border p-3 transition-all" style={{ borderColor: on ? '#E8B800' : 'var(--line)', background: on ? 'color-mix(in srgb, var(--marker) 16%, var(--surface))' : 'var(--surface)' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="cite">{c.id}</span><Icon className="w-3.5 h-3.5 muted" aria-hidden /><span className="font-semibold truncate">{typeLabel(c.sourceType)}</span>
        <span className="ml-auto mono text-[11px] muted shrink-0">{c.date.slice(0, 10)}</span>
      </div>
      <div className="text-[11.5px] muted mono truncate mt-0.5">{c.name}</div>
      <p className="text-[12.5px] mt-1.5 line-clamp-4">{c.snippet}</p>
    </li>
  );
}

function AskView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id') ?? 'CLM-24005';
  const { data: board } = useAsync(() => data.board(), []);
  const { data: file, loading: fileLoading } = useAsync(() => data.claim(id), [id]);
  const claims = useMemo(() => (board?.claims ?? []).map((c) => [c.claimId, `${c.claimId} · ${c.insured} · ${c.lossType}`]).sort(), [board]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [cite, setCite] = useState<{ turn: number; id: string } | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setTurns([]); setCite(null); }, [id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns.length]);

  const notes = file?.notes.length ?? 0, docs = file?.docs.length ?? 0;
  const steps = [
    `Searching ${docs} documents and ${notes} notes in CLAIM_FILE_SEARCH`,
    'Ranking the closest excerpts for this claim',
    'Answering with AI_COMPLETE, citing each excerpt',
  ];
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); setQ('');
    setTurns((t) => [...t, { q: question }]);
    try { const a = await data.ask(id, question); setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x))); }
    catch (e) { setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: String((e as Error).message) } : x))); }
    finally { setBusy(false); }
  };
  const lastWithCites = [...turns].map((t, i) => ({ t, i })).reverse().find((x) => x.t.a?.citations.length);
  const shownTurn = cite?.turn ?? lastWithCites?.i;
  const shownCites = shownTurn !== undefined ? turns[shownTurn]?.a?.citations ?? [] : [];
  const pick = (turn: number, c: string) => { setCite({ turn, id: c }); setTimeout(() => refs.current.get(`${turn}-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 30); };

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-5">
      <div className="space-y-4 min-w-0">
        <Panel eyebrow="Scope" title="Claim file" right={<><PoweredBy>Cortex Search</PoweredBy><PoweredBy>AI_COMPLETE</PoweredBy></>}>
          <div className="flex gap-2 flex-wrap items-center">
            <select className="input mono flex-1 min-w-0" aria-label="Claim" value={id} onChange={(e) => router.push(`/ask?id=${e.target.value}`)}>
              {(claims.length ? claims : [[id, id]]).map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
            {file?.triage && <TierPill tier={file.triage.tier} />}
            <Link href={`/claim?id=${id}`} className="btn btn-sm">Open claim file</Link>
          </div>
          <p className="text-[12.5px] muted mt-3">Answers use only this claim&apos;s parsed documents, photo assessments and notes. The search service filters on <span className="mono">claim_id</span>, so nothing from other claims can be cited.</p>
        </Panel>

        <div className="space-y-4" aria-live="polite">
          {!turns.length && (
            <div className="panel p-6 text-center">
              <span className="w-11 h-11 rounded-xl inline-flex items-center justify-center mb-2" style={{ background: 'var(--marker)', color: '#2E2400' }}><MessageSquareText className="w-5 h-5" /></span>
              <h2 className="font-bold">Ask anything about {id}</h2>
              <p className="text-[13px] muted mt-1">Try one of these questions about this file:</p>
              <div className="flex gap-2 flex-wrap justify-center mt-3">{suggestedFor(id).map((s) => <button key={s} className="btn btn-sm" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2 fade-up">
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[13.5px] font-semibold text-white" style={{ background: 'var(--spruce)' }}>{t.q}</div>
              <div className="panel ai-panel p-4 pl-5 max-w-[95%]">
                {t.error ? <ErrorState title="Live answer failed" detail={t.error} /> : !t.a ? <Reasoning steps={steps} expectMs={SAMPLE_DELAY_MS.ask} title="Reading the claim file" /> : (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                      <span className="eyebrow">Answer · {t.a.citations.length} sources</span>
                      <span className="flex gap-1.5 flex-wrap">{t.a.provenance.source === 'mock' && <SampleAiBadge />}<SourceBadge p={t.a.provenance} /></span>
                    </div>
                    <StreamText text={t.a.answer} onCite={(c) => pick(i, c)} activeCite={cite?.turn === i ? cite.id : null} />
                    <div className="xl:hidden mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                      <ul className="space-y-2">{t.a.citations.map((c) => <CitationCard key={c.id} c={c} on={cite?.turn === i && cite.id === c.id} refCb={() => undefined} />)}</ul>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>

        {turns.length > 0 && (
          <div className="flex gap-2 flex-wrap">{suggestedFor(id).filter((s) => !turns.some((t) => t.q === s)).map((s) => <button key={s} className="btn btn-sm" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
        )}
        <form className="panel p-2 flex gap-2 sticky bottom-3" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input flex-1 min-w-0 !border-0 !shadow-none" placeholder={`Ask about ${id}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" maxLength={500} />
          <button className="btn btn-primary" disabled={busy || !q.trim()} type="submit"><Send className="w-4 h-4" />Ask</button>
        </form>
      </div>

      <aside className="hidden xl:block min-w-0">
        <div className="sticky top-[76px] space-y-4">
          <Panel eyebrow={shownCites.length ? 'Cited excerpts' : 'In this file'} title={shownCites.length ? 'Sources' : 'Documents and notes'}>
            {shownCites.length ? (
              <ul className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
                {shownCites.map((c) => <CitationCard key={c.id} c={c} on={cite?.turn === shownTurn && cite?.id === c.id} refCb={(el) => { if (el) refs.current.set(`${shownTurn}-${c.id}`, el); }} />)}
              </ul>
            ) : fileLoading || !file ? <Skeleton className="h-60" /> : (
              <ul className="space-y-1.5">
                {file.docs.map((d) => { const Icon = ICON[d.docType ?? ''] ?? FileText; return (
                  <li key={d.docId} className="flex items-center gap-2 text-[12.5px]"><Icon className="w-3.5 h-3.5 muted" aria-hidden /><span className="font-semibold">{typeLabel(d.docType ?? '')}</span><span className="ml-auto mono text-[11px] muted">{d.docId}</span></li>); })}
                {file.notes.map((n) => (
                  <li key={n.noteId} className="flex items-center gap-2 text-[12.5px]"><StickyNote className="w-3.5 h-3.5 muted" aria-hidden /><span className="font-semibold">Note</span><span className="muted truncate">{n.author}</span><span className="ml-auto mono text-[11px] muted">{n.createdAt.slice(5, 10)}</span></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </aside>
    </div>
  );
}

export default function AskPage() {
  return <Suspense fallback={<Skeleton className="h-96" />}><AskView /></Suspense>;
}
