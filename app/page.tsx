'use client';

// Intake inbox: every incoming document with its pipeline status and extraction confidence.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, Confidence, Kpi, PoweredBy, SourceBadge, Thinking } from '@/components/ui';
import { useAsync } from '@/components/useAsync';
import { data } from '@/lib/client';
import { DOC_TYPE_LABEL } from '@/lib/types';

const STATUS_COLOR: Record<string, string> = { Extracted: 'var(--positive)', 'Needs review': 'var(--warning)', Queued: 'var(--muted)' };

export default function InboxPage() {
  const { data: inbox, error, loading } = useAsync(() => data.inbox(), []);
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const rows = useMemo(() => (inbox?.docs ?? []).filter((d) => (type === 'all' || d.docType === type) && (status === 'all' || d.status === status)), [inbox, type, status]);

  if (loading) return <Thinking label="Loading the intake inbox" />;
  if (error || !inbox) return <Card title="Could not load the inbox"><p className="text-sm">{error}</p></Card>;
  const k = inbox.kpis;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Intake inbox</h1>
          <p className="text-sm muted">New documents land on a stage; a stream and task parse, classify and extract each one automatically.</p>
        </div>
        <div className="flex gap-2 flex-wrap"><PoweredBy>stage + stream + task</PoweredBy><SourceBadge p={inbox.provenance} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Documents received" value={k.received.toLocaleString()} sub={k.lastRun ? `Last pipeline run ${k.lastRun}` : undefined} />
        <Kpi label="Extracted" value={k.extracted.toLocaleString()} sub="AI_PARSE_DOCUMENT + AI_EXTRACT" />
        <Kpi label="Need review" value={k.needsReview.toLocaleString()} sub="A field scored under 80% confidence" />
        <Kpi label="New claims to triage" value={k.newClaims.toLocaleString()}
          sub={k.typeAccuracy !== null ? `AI_CLASSIFY matched the generator's label on ${Math.round(k.typeAccuracy * 100)}% of documents` : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Documents by type" right={<PoweredBy>AI_CLASSIFY</PoweredBy>} className="min-w-0">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={inbox.byType.map((b) => ({ ...b, label: DOC_TYPE_LABEL[b.docType] ?? b.docType }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11, fill: 'var(--text-2)' }} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }} />
                <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2 min-w-0" title="Incoming documents"
          right={<>
            <select aria-label="Document type" className="input text-xs" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select aria-label="Status" className="input text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option><option>Extracted</option><option>Needs review</option><option>Queued</option>
            </select>
          </>}>
          <div className="relative overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="data-table min-w-[640px]">
              <thead><tr><th>Received</th><th>Document</th><th>Claim</th><th>Status</th><th>Confidence</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((d) => (
                  <tr key={d.docId} className="click">
                    <td className="tabular whitespace-nowrap text-xs">{d.receivedAt.replace('T', ' ')}</td>
                    <td>
                      <Link href={`/claim?id=${d.claimId}&doc=${d.docId}`} className="font-medium no-underline">{DOC_TYPE_LABEL[d.docType ?? ''] ?? 'Unclassified'}</Link>
                      <div className="text-[11px] muted">{d.docId} · {d.source}</div>
                    </td>
                    <td><Link href={`/claim?id=${d.claimId}`} className="no-underline">{d.claimId}</Link><div className="text-[11px] muted">{d.insured} · {d.lossType}</div></td>
                    <td><span className="text-xs font-semibold" style={{ color: STATUS_COLOR[d.status] }}>{d.status}</span></td>
                    <td>{d.docType === 'damage_photo' ? <span className="text-[11px] muted">Photo</span> : <Confidence score={d.confidence} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] muted mt-2">{rows.length} documents{rows.length > 200 ? ' (showing the newest 200)' : ''}. Confidence is the lowest AI_EXTRACT score among identifying fields.</p>
        </Card>
      </div>
    </div>
  );
}
