// Live mode: every screen reads the objects sql/setup.sql created. Server only.
// All user input reaches Snowflake as bind variables.
import { applyCorrections, MODEL, type ClaimsData } from './claims-data';
import { query } from './snowflake';
import type { Adjuster, Board, BoardClaim, ClaimAction, ClaimFile, Coverage, DocDetail, Inbox, Tier, TriageResult } from './types';

type Row = Record<string, unknown>;
const S = (v: unknown) => (v === null || v === undefined ? null : String(v));
const N = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const J = <T,>(v: unknown, d: T): T => {
  if (v === null || v === undefined) return d;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return d; } }
  return v as T;
};
const flat = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)]));

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const r = await fn();
  return [r, Date.now() - t0];
}

async function adjusters(): Promise<Adjuster[]> {
  const rows = await query<Row>('SELECT adjuster_id, name, skills, capacity, open_claims FROM ADJUSTER_LOAD ORDER BY adjuster_id');
  return rows.map((r) => ({ adjusterId: S(r.ADJUSTER_ID)!, name: S(r.NAME)!, skills: S(r.SKILLS)!, capacity: N(r.CAPACITY)!, openClaims: N(r.OPEN_CLAIMS)! }));
}

function flags(f: Row): string[] {
  const out: string[] = [];
  const days = N(f.DAYS_SINCE_INCEPTION);
  if (days !== null && days <= 30) out.push(`Loss ${days} days after inception`);
  if (N(f.PRIOR_LOSSES)) out.push(`${N(f.PRIOR_LOSSES)} prior losses`);
  if (f.ESTIMATE_MISMATCH === true) out.push('Estimate total ≠ line items');
  if ((N(f.MEDICAL_BILLS) ?? 0) >= 3) out.push('Medical bills rising');
  if (f.POLICY_ACTIVE === false) out.push('Policy not active');
  return out;
}

export const liveData: ClaimsData = {
  async inbox() {
    const [[rows, meta], ms] = await timed(() => Promise.all([
      query<Row>(`SELECT d.doc_id, d.claim_id, d.file_name, TO_CHAR(d.received_at, 'YYYY-MM-DD"T"HH24:MI') AS received_at, d.source,
                          p.doc_type, f.min_score, p.doc_id IS NOT NULL AS parsed, c.insured_name, c.loss_type
                   FROM DOCUMENTS d JOIN CLAIMS c ON c.claim_id = d.claim_id
                   LEFT JOIN DOC_PARSED p ON p.doc_id = d.doc_id LEFT JOIN DOC_FIELDS f ON f.doc_id = d.doc_id
                   ORDER BY d.received_at DESC, d.doc_id DESC`),
      query<Row>(`SELECT (SELECT COUNT_IF(p.doc_type = d.labeled_doc_type) / NULLIF(COUNT(*), 0) FROM DOC_PARSED p JOIN DOCUMENTS d ON d.doc_id = p.doc_id) AS acc,
                         (SELECT TO_CHAR(MAX(processed_at), 'YYYY-MM-DD HH24:MI') FROM DOC_PARSED) AS last_run,
                         (SELECT COUNT(*) FROM CLAIMS WHERE status = 'New') AS new_claims`),
    ]));
    const docs = rows.map((r) => {
      const conf = N(r.MIN_SCORE);
      return {
        docId: S(r.DOC_ID)!, claimId: S(r.CLAIM_ID)!, fileName: S(r.FILE_NAME)!, receivedAt: S(r.RECEIVED_AT)!, source: S(r.SOURCE)!,
        docType: S(r.DOC_TYPE), confidence: conf, insured: S(r.INSURED_NAME)!, lossType: S(r.LOSS_TYPE)!,
        status: !r.PARSED ? 'Queued' : conf !== null && conf < 0.8 ? 'Needs review' : 'Extracted',
      } as Inbox['docs'][number];
    });
    const byType = Object.entries(docs.reduce<Record<string, number>>((a, d) => ({ ...a, [d.docType ?? 'queued']: (a[d.docType ?? 'queued'] ?? 0) + 1 }), {}))
      .map(([docType, count]) => ({ docType, count })).sort((a, b) => b.count - a.count);
    return {
      provenance: { source: 'live', latencyMs: ms }, docs, byType,
      kpis: { received: docs.length, extracted: docs.filter((d) => d.status !== 'Queued').length,
        needsReview: docs.filter((d) => d.status === 'Needs review').length, newClaims: N(meta[0].NEW_CLAIMS)!,
        typeAccuracy: N(meta[0].ACC), lastRun: S(meta[0].LAST_RUN) },
    };
  },

  async claim(claimId) {
    const t0 = Date.now();
    const [c, docs, facts, tri, notes, hist, acts, adj] = await Promise.all([
      query<Row>(`SELECT c.*, TO_CHAR(c.loss_date) AS ld, TO_CHAR(c.reported_date) AS rd, OBJECT_CONSTRUCT(p.*) AS policy
                  FROM CLAIMS c LEFT JOIN POLICIES p ON p.policy_number = c.policy_number WHERE c.claim_id = ?`, [claimId]),
      query<Row>(`SELECT d.doc_id, d.file_name, p.doc_type, TO_CHAR(d.received_at, 'YYYY-MM-DD"T"HH24:MI') AS received_at, d.source,
                         p.parsed_text, f.fields, f.scores, f.line_items, a.description AS photo,
                         GET_PRESIGNED_URL(@CLAIM_DOCS, d.file_name, 3600) AS url
                  FROM DOCUMENTS d LEFT JOIN DOC_PARSED p ON p.doc_id = d.doc_id LEFT JOIN DOC_FIELDS f ON f.doc_id = d.doc_id
                  LEFT JOIN PHOTO_ASSESSMENTS a ON a.doc_id = d.doc_id
                  WHERE d.claim_id = ? ORDER BY d.received_at, d.doc_id`, [claimId]),
      query<Row>('SELECT f.*, TO_CHAR(f.inception_date) AS inc FROM CLAIM_FACTS f WHERE claim_id = ?', [claimId]),
      query<Row>(`SELECT ai_summary, tier, suggested_adjuster, model, TO_CHAR(generated_at, 'YYYY-MM-DD HH24:MI') AS g, facts
                  FROM CLAIM_TRIAGE WHERE claim_id = ?`, [claimId]),
      query<Row>(`SELECT note_id, author, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') AS at, note_text FROM CLAIM_NOTES WHERE claim_id = ? ORDER BY created_at`, [claimId]),
      query<Row>(`SELECT TO_CHAR(h.loss_date) AS ld, prior_carrier, h.loss_type, paid_amount FROM LOSS_HISTORY h JOIN CLAIMS c ON c.policy_number = h.policy_number
                  WHERE c.claim_id = ? ORDER BY h.loss_date`, [claimId]),
      query<Row>(`SELECT action, field_name, old_value, new_value, tier, adjuster_id, comment, TO_CHAR(acted_at, 'YYYY-MM-DD HH24:MI') AS at
                  FROM APP.CLAIM_ACTIONS WHERE claim_id = ? ORDER BY acted_at`, [claimId]),
      adjusters(),
    ]);
    if (!c.length) return null;
    const r = c[0], f = facts[0] ?? {};
    const docList: DocDetail[] = docs.map((d) => ({
      docId: S(d.DOC_ID)!, fileName: S(d.FILE_NAME)!, docType: S(d.DOC_TYPE), receivedAt: S(d.RECEIVED_AT)!, source: S(d.SOURCE)!,
      text: S(d.PARSED_TEXT), fields: flat(J(d.FIELDS, {})),
      scores: Object.fromEntries(Object.entries(J<Record<string, { score: number }>>(d.SCORES, {})).map(([k, v]) => [k, v.score])),
      lineItems: (() => { const li = J<{ description?: string[]; amount?: string[] }>(d.LINE_ITEMS, {});
        return (li.description ?? []).map((desc, i) => ({ description: desc, amount: li.amount?.[i] ?? '' })); })(),
      photoDescription: S(d.PHOTO), url: S(d.URL) ?? '',
    }));
    const coverage: Coverage = {
      policyFound: !!f.POLICY_FOUND, policyActive: (f.POLICY_ACTIVE as boolean) ?? null, inceptionDate: S(f.INC), daysSinceInception: N(f.DAYS_SINCE_INCEPTION),
      coveragePart: S(f.COVERAGE_PART) ?? '', deductible: N(f.DEDUCTIBLE), biLimitPerPerson: N(f.BI_LIMIT_PER_PERSON), medPayLimit: N(f.MED_PAY_LIMIT),
      estimateTotal: N(f.ESTIMATE_TOTAL), estimateLineSum: N(f.ESTIMATE_LINE_SUM), estimateMismatch: f.ESTIMATE_MISMATCH === true,
      medicalTotal: N(f.MEDICAL_TOTAL) ?? 0, medicalBills: N(f.MEDICAL_BILLS) ?? 0, medicalSeries: J<number[]>(f.MEDICAL_SERIES, []).map(Number),
      policeReportLagDays: N(f.POLICE_REPORT_LAG_DAYS), priorLosses: N(f.PRIOR_LOSSES) ?? 0, priorPaid: N(f.PRIOR_PAID) ?? 0,
    };
    const t = tri[0];
    const file: ClaimFile = {
      provenance: { source: 'live', latencyMs: Date.now() - t0 },
      claim: { claimId, insured: S(r.INSURED_NAME)!, lossType: S(r.LOSS_TYPE)!, lossDate: S(r.LD)!, reportedDate: S(r.RD)!, lossLocation: S(r.LOSS_LOCATION)!,
        vehicle: S(r.VEHICLE)!, status: S(r.STATUS)!, assignedAdjuster: S(r.ASSIGNED_ADJUSTER) || null, policyNumber: S(r.POLICY_NUMBER)! },
      policy: Object.fromEntries(Object.entries(J<Record<string, unknown>>(r.POLICY, {})).map(([k, v]) => [k.toLowerCase(), v as string])),
      docs: docList, coverage,
      triage: t ? { summary: S(t.AI_SUMMARY)!, tier: S(t.TIER) as Tier, suggestedAdjuster: S(t.SUGGESTED_ADJUSTER), model: S(t.MODEL)!, generatedAt: S(t.G)!, facts: S(t.FACTS)! } : null,
      notes: notes.map((n) => ({ noteId: S(n.NOTE_ID)!, author: S(n.AUTHOR)!, createdAt: S(n.AT)!, text: S(n.NOTE_TEXT)! })),
      lossHistory: hist.map((h) => ({ lossDate: S(h.LD)!, carrier: S(h.PRIOR_CARRIER)!, lossType: S(h.LOSS_TYPE)!, paid: N(h.PAID_AMOUNT)! })),
      actions: acts.map((a) => ({ claimId, action: S(a.ACTION) as ClaimAction['action'], fieldName: S(a.FIELD_NAME) ?? undefined, oldValue: S(a.OLD_VALUE) ?? undefined,
        newValue: S(a.NEW_VALUE) ?? undefined, tier: S(a.TIER) ?? undefined, adjusterId: S(a.ADJUSTER_ID) ?? undefined, comment: S(a.COMMENT) ?? undefined, actedAt: S(a.AT) ?? undefined })),
      adjusters: adj,
    };
    return applyCorrections(file);
  },

  async board() {
    const [[rows, adj, cyc], ms] = await timed(() => Promise.all([
      query<Row>(`WITH last_route AS (
                    SELECT claim_id, tier, adjuster_id FROM APP.CLAIM_ACTIONS WHERE action IN ('route', 'accept')
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY claim_id ORDER BY acted_at DESC) = 1)
                  SELECT c.claim_id, c.insured_name, c.loss_type, TO_CHAR(c.reported_date) AS rd, c.status,
                         COALESCE(r.tier, t.tier) AS tier, COALESCE(r.adjuster_id, NULLIF(c.assigned_adjuster, '')) AS adjuster,
                         t.suggested_adjuster, f.*
                  FROM CLAIMS c LEFT JOIN CLAIM_TRIAGE t ON t.claim_id = c.claim_id LEFT JOIN last_route r ON r.claim_id = c.claim_id
                  LEFT JOIN CLAIM_FACTS f ON f.claim_id = c.claim_id ORDER BY c.reported_date DESC, c.claim_id DESC`),
      adjusters(),
      query<Row>(`SELECT TO_CHAR(DATE_TRUNC('month', closed_date), 'YYYY-MM') AS m, tier, ROUND(AVG(DATEDIFF('day', reported_date, closed_date)), 1) AS d, COUNT(*) AS n
                  FROM CLOSED_CLAIMS WHERE closed_date >= DATEADD('month', -12, DATE_TRUNC('month', '2026-11-18'::DATE)) GROUP BY 1, 2 ORDER BY 1`),
    ]));
    const claims: BoardClaim[] = rows.map((r) => ({
      claimId: S(r.CLAIM_ID)!, insured: S(r.INSURED_NAME)!, lossType: S(r.LOSS_TYPE)!, reportedDate: S(r.RD)!, status: S(r.STATUS)!,
      tier: (S(r.TIER) ?? 'Standard') as Tier, adjuster: S(r.ADJUSTER), suggestedAdjuster: S(r.SUGGESTED_ADJUSTER), flags: flags(r),
    }));
    return { provenance: { source: 'live', latencyMs: ms }, claims, adjusters: adj,
      cycle: cyc.map((c) => ({ month: S(c.M)!, tier: S(c.TIER) as Tier, avgDays: N(c.D)!, closed: N(c.N)! })) } satisfies Board;
  },

  async summarize(claimId) {
    const [rows, ms] = await timed(() => query<Row>(`
      WITH s AS (SELECT claim_id, facts FROM CLAIM_FACT_SHEET WHERE claim_id = ?),
      t AS (SELECT claim_id, facts, AI_CLASSIFY(facts,
             [{'label': 'Fast track', 'description': 'glass-only damage, or minor comprehensive damage with a repair estimate under $1,500; clear coverage, no injuries, no red flags'},
              {'label': 'Standard', 'description': 'collision, theft, hail or animal damage with a larger estimate that needs an adjuster review; no injuries and no fraud indicators'},
              {'label': 'Complex', 'description': 'bodily injury, rising medical bills, high severity, or document discrepancies needing senior review'},
              {'label': 'SIU referral', 'description': 'fraud indicators such as a loss soon after policy inception combined with a pattern of prior losses or late reporting'}],
             {'task_description': 'Choose the claim handling tier for an auto insurance claim'}):labels[0]::STRING AS tier FROM s)
      SELECT tier, facts, AI_COMPLETE(?, 'You are a claims intake assistant. Using only these facts, write a summary for the assigned adjuster: '
           || 'first a 2-sentence overview, then up to 3 short bullet points starting with "- " covering coverage, '
           || 'any red flags or discrepancies, and the suggested next step. The suggested handling tier is ' || tier
           || '. Do not invent facts or amounts. Facts: ' || facts) AS summary,
           TO_CHAR(CURRENT_TIMESTAMP(), 'YYYY-MM-DD HH24:MI') AS g
      FROM t`, [claimId, MODEL]));
    if (!rows.length) throw new Error(`No facts for ${claimId}`);
    const r = rows[0];
    const prior = await query<Row>('SELECT suggested_adjuster FROM CLAIM_TRIAGE WHERE claim_id = ? AND tier = ?', [claimId, S(r.TIER)]);
    return { summary: J<string>(r.SUMMARY, S(r.SUMMARY)!), tier: S(r.TIER) as Tier, suggestedAdjuster: S(prior[0]?.SUGGESTED_ADJUSTER) ?? null,
      model: MODEL, generatedAt: S(r.G)!, facts: S(r.FACTS)!, provenance: { source: 'live', latencyMs: ms } } satisfies TriageResult;
  },

  async ask(claimId, question) {
    const t0 = Date.now();
    const req = JSON.stringify({ query: question, columns: ['source_id', 'source_type', 'source_name', 'source_date', 'chunk'],
      filter: { '@eq': { claim_id: claimId } }, limit: 6 });
    const hits = await query<Row>(`SELECT PARSE_JSON(SNOWFLAKE.CORTEX.SEARCH_PREVIEW('CLAIMS_INTAKE_DEMO.CLAIMS.CLAIM_FILE_SEARCH', ?)):results AS r`, [req]);
    const results = J<Row[]>(hits[0]?.R, []);
    const context = results.map((h, i) => `[${i + 1}] (${h.source_type}, ${h.source_name}, ${h.source_date})\n${h.chunk}`).join('\n\n');
    const prompt = `You answer questions for a claims adjuster using only the claim file excerpts below. Cite sources inline as [1], [2]. ` +
      `If the excerpts do not contain the answer, say so. Keep it under 150 words.\n\nQuestion: ${question}\n\nExcerpts:\n${context}`;
    const out = await query<Row>('SELECT AI_COMPLETE(?, ?) AS a', [MODEL, prompt]);
    return {
      answer: J<string>(out[0].A, S(out[0].A)!),
      citations: results.map((h, i) => ({ id: String(i + 1), sourceType: S(h.source_type)!, name: S(h.source_name)!, date: S(h.source_date)!,
        snippet: (S(h.chunk) ?? '').slice(0, 280) })),
      provenance: { source: 'live', latencyMs: Date.now() - t0 },
    };
  },

  async act(a) {
    await query(`INSERT INTO APP.CLAIM_ACTIONS (claim_id, action, field_name, old_value, new_value, tier, adjuster_id, comment)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.claimId, a.action, a.fieldName ?? null, a.oldValue ?? null, a.newValue ?? null, a.tier ?? null, a.adjusterId ?? null, a.comment ?? null]);
    if (a.action !== 'correct' && a.adjusterId) {
      await query(`UPDATE CLAIMS SET status = 'Routed', assigned_adjuster = ? WHERE claim_id = ?`, [a.adjusterId, a.claimId]);
    }
    return { ok: true };
  },
};
