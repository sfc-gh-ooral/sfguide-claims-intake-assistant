import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { isSnowflakeConfigured, query } from '@/lib/snowflake';

// Live mode only: put a new document on the CLAIM_DOCS stage, add its manifest row, refresh the
// directory table and run the pipeline task now instead of waiting for its schedule.
// GET reports how far the task got for that document.
const CLAIM = /^CLM-\d{4,6}$/;
const DOC = /^DOC-U[0-9A-F]{10}$/;
const MAX_BYTES = 5 * 1024 * 1024;
type Row = Record<string, unknown>;

function kind(buf: Buffer): 'pdf' | 'png' | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

export async function POST(request: Request) {
  if (!isSnowflakeConfigured()) return NextResponse.json({ error: 'Live mode is not configured' }, { status: 400 });
  const form = await request.formData();
  const claimId = String(form.get('claimId') ?? '');
  const file = form.get('file');
  if (!CLAIM.test(claimId)) return NextResponse.json({ error: 'Unknown claim' }, { status: 400 });
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Choose a PDF or PNG under 5 MB' }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = kind(buf);
  if (!ext) return NextResponse.json({ error: 'Only PDF and PNG files are supported' }, { status: 400 });

  // File and document names are generated here, never taken from the upload.
  const docId = `DOC-U${randomBytes(5).toString('hex').toUpperCase()}`;
  const fileName = `${docId}-upload.${ext}`;
  const path = join(tmpdir(), fileName);
  try {
    const [c] = await query<Row>('SELECT COUNT(*) AS n FROM CLAIMS WHERE claim_id = ?', [claimId]);
    if (!Number(c?.N)) return NextResponse.json({ error: 'Unknown claim' }, { status: 400 });
    await writeFile(path, buf);
    await query(`PUT 'file://${path}' @CLAIM_DOCS AUTO_COMPRESS = FALSE OVERWRITE = FALSE`);
    await query(`INSERT INTO DOCUMENTS (doc_id, claim_id, labeled_doc_type, file_name, received_at, source)
                 SELECT ?, ?, NULL, ?, CURRENT_TIMESTAMP(), 'Portal upload'`, [docId, claimId, fileName]);
    await query('ALTER STAGE CLAIM_DOCS REFRESH');
    await query('EXECUTE TASK PROCESS_DOCS_TASK');
    return NextResponse.json({ docId, claimId, fileName });
  } catch (error) {
    console.error('process failed:', error);
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 502 });
  } finally {
    await rm(path, { force: true });
  }
}

export async function GET(request: Request) {
  if (!isSnowflakeConfigured()) return NextResponse.json({ error: 'Live mode is not configured' }, { status: 400 });
  const docId = new URL(request.url).searchParams.get('docId') ?? '';
  if (!DOC.test(docId)) return NextResponse.json({ error: 'Unknown document' }, { status: 400 });
  try {
    const [[r], [t]] = await Promise.all([
      query<Row>(`SELECT d.claim_id, p.doc_type, p.doc_id IS NOT NULL AS parsed, f.doc_id IS NOT NULL AS extracted, f.min_score,
                         a.description AS photo, tr.tier, tr.generated_at >= d.received_at AS triaged
                  FROM DOCUMENTS d LEFT JOIN DOC_PARSED p ON p.doc_id = d.doc_id LEFT JOIN DOC_FIELDS f ON f.doc_id = d.doc_id
                  LEFT JOIN PHOTO_ASSESSMENTS a ON a.doc_id = d.doc_id LEFT JOIN CLAIM_TRIAGE tr ON tr.claim_id = d.claim_id
                  WHERE d.doc_id = ?`, [docId]),
      query<Row>(`SELECT state, error_message FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY(TASK_NAME => 'PROCESS_DOCS_TASK', RESULT_LIMIT => 1))
                  ORDER BY scheduled_time DESC`),
    ]);
    if (!r) return NextResponse.json({ error: 'Unknown document' }, { status: 404 });
    return NextResponse.json({
      claimId: r.CLAIM_ID, docType: r.DOC_TYPE ?? null, parsed: !!r.PARSED, extracted: !!r.EXTRACTED,
      minScore: r.MIN_SCORE === null ? null : Number(r.MIN_SCORE), photo: r.PHOTO ?? null, tier: r.TIER ?? null, triaged: !!r.TRIAGED,
      taskState: t?.STATE ?? null, taskError: t?.ERROR_MESSAGE ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 502 });
  }
}
