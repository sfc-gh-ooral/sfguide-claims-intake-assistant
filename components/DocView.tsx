'use client';

// Source document view: parsed text with every extracted value marked in place, or the damage
// photo with its AI description. Shared by the inbox preview drawer and the claim file.
import { ExternalLink, ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Markdown, PoweredBy } from '@/components/ui';
import type { DocDetail } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const LABEL = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Splits text into plain and marked runs, one mark per extracted value found in it. */
export function highlight(text: string, fields: Record<string, string>, active: string | null, onHover?: (k: string | null) => void): ReactNode[] {
  const marks: { start: number; end: number; key: string }[] = [];
  const lower = text.toLowerCase();
  for (const [key, raw] of Object.entries(fields)) {
    const v = (raw ?? '').trim();
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
    out.push(<mark key={i} className={`hl ${active === m.key ? 'on' : ''}`} style={{ ['--i' as string]: i }} title={LABEL(m.key)} data-field={m.key}
      onMouseEnter={() => onHover?.(m.key)} onMouseLeave={() => onHover?.(null)}>{text.slice(m.start, m.end)}</mark>);
    pos = m.end;
  });
  out.push(text.slice(pos));
  return out;
}

export const docHref = (d: DocDetail) => d.url || `${BASE}/documents/${d.fileName}`;

export function DocView({ doc, active, onHover, maxH }: { doc: DocDetail; active: string | null; onHover?: (k: string | null) => void; maxH?: number }) {
  const href = docHref(doc);
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap text-[12px] muted">
        <span className="mono">{doc.docId} · {doc.receivedAt.replace('T', ' ')} · {doc.source}</span>
        <a className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--spruce-2)' }} href={href} target="_blank" rel="noreferrer">Open original <ExternalLink className="w-3 h-3" /></a>
      </div>
      {doc.docType === 'damage_photo' ? (
        <>
          <div className="rounded-xl overflow-hidden border relative" style={{ borderColor: 'var(--line)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={href} alt={`Damage photo ${doc.docId}: a synthetic drawn illustration of the damaged vehicle`} className="w-full block" />
            <span className="pill absolute top-2 left-2" style={{ background: 'rgba(15,30,27,.75)', color: '#fff' }}><ImageIcon className="w-3 h-3" aria-hidden />Synthetic illustration</span>
          </div>
          {doc.photoDescription && (
            <div className="ai-panel p-4 pl-5 border" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap"><span className="eyebrow">Damage description</span><PoweredBy>AI_COMPLETE (image input)</PoweredBy></div>
              <Markdown text={doc.photoDescription} />
            </div>
          )}
        </>
      ) : (
        <div className="doc-paper" style={maxH ? { maxHeight: maxH } : undefined} aria-label="Parsed document text with extracted values marked">
          {highlight((doc.text ?? '').replace(/\n{2,}/g, '\n').replace(/^#+ /gm, ''), doc.fields, active, onHover)}
        </div>
      )}
    </div>
  );
}
