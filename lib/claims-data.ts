// One interface, two implementations: lib/mock-data.ts (bundled synthetic captures) and
// lib/live-data.ts (Snowflake). Every screen goes through it.
import type { Answer, Board, ClaimAction, ClaimFile, Inbox, TriageResult } from './types';

export interface ClaimsData {
  inbox(): Promise<Inbox>;
  claim(claimId: string): Promise<ClaimFile | null>;
  board(): Promise<Board>;
  /** Re-run the AI summary and tier for one claim. */
  summarize(claimId: string): Promise<TriageResult>;
  /** Ask a question over one claim's documents and notes. */
  ask(claimId: string, question: string): Promise<Answer>;
  /** Record an adjuster decision: accept, correct a field, or route. */
  act(action: ClaimAction): Promise<{ ok: true }>;
}

export const MODEL = process.env.SNOWFLAKE_COMPLETE_MODEL ?? 'claude-sonnet-4-5';

/** Questions offered on "Ask the claims file". Sample mode has captured live answers for these. */
export const SUGGESTED: Record<string, string[]> = {
  _default: ['What happened, and who is involved?', 'Is anything missing or inconsistent in this file?'],
  'CLM-24003': ['Why might this claim need an SIU referral?', 'When was the police report filed?'],
  'CLM-24004': ['Is this claim covered, and what will the insured pay?'],
  'CLM-24005': ['How have the medical bills changed over time?', 'Who is at fault, and who was injured?'],
  'CLM-24008': ['Does the repair estimate add up?'],
};
export const suggestedFor = (id: string) => [...(SUGGESTED[id] ?? []), ...SUGGESTED._default];

/** Applies the latest field correction for each document field. */
export function applyCorrections(file: ClaimFile): ClaimFile {
  const docs = file.docs.map((d) => {
    const fields = { ...d.fields };
    for (const a of file.actions) {
      if (a.action === 'correct' && a.fieldName?.startsWith(`${d.docId}.`)) fields[a.fieldName.slice(d.docId.length + 1)] = a.newValue ?? '';
    }
    return { ...d, fields };
  });
  return { ...file, docs };
}
