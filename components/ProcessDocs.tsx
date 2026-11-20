'use client';

// Live mode: upload a document for a claim and run the pipeline task now. The file goes onto the
// CLAIM_DOCS stage, the stream picks it up and PROCESS_DOCS_TASK parses, classifies and extracts it.
// In Sample mode (and the hosted example) the pipeline only ran ahead of time, so this explains that.
import { Loader2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Panel, PoweredBy } from '@/components/ui';
import { refreshData } from '@/lib/client';
import { HOSTED_EXAMPLE } from '@/lib/hosted';
import { preferSample } from '@/lib/mode';
import { DOC_TYPE_LABEL } from '@/lib/types';

type Status = { claimId: string; docType: string | null; parsed: boolean; extracted: boolean; minScore: number | null; photo: string | null;
  tier: string | null; triaged: boolean; taskState: string | null; taskError: string | null };

export function ProcessDocs({ claims }: { claims: string[] }) {
  const [live, setLive] = useState(false);
  const [claimId, setClaimId] = useState(claims[0] ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(Status & { docId: string; seconds: number }) | null>(null);

  useEffect(() => {
    if (HOSTED_EXAMPLE || preferSample()) return;
    fetch('/api/mode').then((r) => r.json()).then((j) => setLive(j.mode === 'live')).catch(() => setLive(false));
  }, []);

  if (!live) return (
    <p className="text-[12.5px] muted">Parsing, classification, extraction and photo descriptions run in a scheduled Snowflake task (<span className="mono">PROCESS_DOCS_TASK</span>) when new files land on the stage. In Sample mode you see its stored output; in Live mode you can upload a document here and run the task.</p>
  );

  async function run() {
    if (!file || !claimId) return;
    setBusy(true); setError(null); setDone(null);
    const t0 = Date.now();
    try {
      setStep('Uploading to the CLAIM_DOCS stage and starting PROCESS_DOCS_TASK');
      const body = new FormData(); body.set('claimId', claimId); body.set('file', file);
      const res = await fetch('/api/process', { method: 'POST', body });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const s = await fetch(`/api/process?docId=${j.docId}`).then(async (r) => { const x = await r.json(); if (!r.ok) throw new Error(x.error); return x as Status; });
        if (s.taskState === 'FAILED') throw new Error(`Task failed: ${s.taskError ?? 'see TASK_HISTORY'}`);
        setStep(!s.parsed ? 'AI_PARSE_DOCUMENT and AI_CLASSIFY running in the task' : !s.triaged ? 'AI_EXTRACT and re-triage (AI_COMPLETE, AI_CLASSIFY) running' : 'Done');
        if (s.parsed && s.triaged) { setDone({ ...s, docId: j.docId, seconds: Math.round((Date.now() - t0) / 1000) }); refreshData(); return; }
      }
      throw new Error('The task did not finish within 6 minutes. Check TASK_HISTORY for PROCESS_DOCS_TASK.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <Panel eyebrow="Live pipeline" title="Process new documents" right={<PoweredBy>stage + stream + task</PoweredBy>}>
      <p className="text-[12.5px] muted mb-3">Upload a PDF or PNG for a claim. The app puts it on the stage, refreshes the directory table and runs the task now instead of waiting for its 5-minute schedule. Ask the claims file sees it after the Cortex Search refresh (up to 1 hour).</p>
      <div className="flex gap-2 flex-wrap items-center">
        <select aria-label="Claim for the new document" className="input" value={claimId} onChange={(e) => setClaimId(e.target.value)} disabled={busy}>
          {claims.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input aria-label="Document file" type="file" accept="application/pdf,image/png" className="text-[12.5px]" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn btn-primary" onClick={run} disabled={busy || !file}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Process</button>
      </div>
      {busy && <p className="text-[12.5px] mt-3" role="status">{step}…</p>}
      {error && <p className="text-[12.5px] mt-3" role="alert" style={{ color: 'var(--siu)' }}>{error}</p>}
      {done && (
        <p className="text-[12.5px] mt-3" role="status">
          <span className="mono">{done.docId}</span> classified as <b>{DOC_TYPE_LABEL[done.docType ?? ''] ?? done.docType ?? 'unclassified'}</b>
          {done.minScore !== null && <> · lowest field confidence {Math.round(done.minScore * 100)}%</>}
          {done.tier && <> · claim tier {done.tier}</>} · {done.seconds} s. <Link href={`/claim?id=${done.claimId}&doc=${done.docId}`} className="font-semibold" style={{ color: 'var(--spruce-2)' }}>Open claim file →</Link>
        </p>
      )}
    </Panel>
  );
}
