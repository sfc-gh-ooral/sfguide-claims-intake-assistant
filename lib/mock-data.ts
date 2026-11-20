// No-account mode: responses captured from the live app on the same synthetic data
// (scripts/capture-sample.mjs), so Sample and Live show the same numbers and AI text.
// Decisions you make are kept in memory for this session only.
import { applyCorrections, type ClaimsData } from './claims-data';
import boardJson from './mock/board.json';
import inboxJson from './mock/inbox.json';
import { jitter, SAMPLE_DELAY_MS } from './sample-timing';
import type { Answer, Board, ClaimAction, ClaimFile, Inbox } from './types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const actions: ClaimAction[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

async function load<T>(path: string): Promise<T | null> {
  if (typeof window === 'undefined') {
    // Server (local dev in Sample mode): read the same files from public/.
    const { readFile } = await import('node:fs/promises');
    try { return JSON.parse(await readFile(`${process.cwd()}/public/mock/${path}`, 'utf8')) as T; } catch { return null; }
  }
  const res = await fetch(`${BASE}/mock/${path}`);
  return res.ok ? ((await res.json()) as T) : null;
}

let answers: Record<string, Omit<Answer, 'provenance'>> | null = null;

export const mockData: ClaimsData = {
  async inbox() {
    const inbox = clone(inboxJson as unknown as Inbox);
    inbox.provenance = { source: 'mock' };
    return inbox;
  },
  async claim(id) {
    if (!/^CLM-\d+$/.test(id)) return null;
    const file = await load<ClaimFile>(`claims/${id}.json`);
    if (!file) return null;
    file.provenance = { source: 'mock' };
    file.actions = [...file.actions, ...actions.filter((a) => a.claimId === id)];
    const routed = [...file.actions].reverse().find((a) => a.action !== 'correct' && a.adjusterId);
    if (routed) { file.claim.status = 'Routed'; file.claim.assignedAdjuster = routed.adjusterId!; }
    for (const adj of file.adjusters) adj.openClaims += actions.filter((a) => a.action !== 'correct' && a.adjusterId === adj.adjusterId).length;
    return applyCorrections(file);
  },
  async board() {
    const board = clone(boardJson as unknown as Board);
    board.provenance = { source: 'mock' };
    for (const c of board.claims) {
      const r = [...actions].reverse().find((a) => a.claimId === c.claimId && a.action !== 'correct' && a.adjusterId);
      if (r) { c.status = 'Routed'; c.adjuster = r.adjusterId!; if (r.tier) c.tier = r.tier as Board['claims'][number]['tier']; }
    }
    for (const adj of board.adjusters) adj.openClaims += actions.filter((a) => a.action !== 'correct' && a.adjusterId === adj.adjusterId).length;
    return board;
  },
  async summarize(id) {
    const file = await load<ClaimFile>(`claims/${id}.json`);
    await sleep(jitter(SAMPLE_DELAY_MS.summarize));
    if (!file?.triage) throw new Error('No sample summary for this claim');
    return { ...file.triage, provenance: { source: 'mock' } };
  },
  async ask(id, question) {
    answers ??= (await load<Record<string, Omit<Answer, 'provenance'>>>('answers.json')) ?? {};
    await sleep(jitter(SAMPLE_DELAY_MS.ask));
    const hit = answers[`${id}|${question}`];
    if (hit) return { ...hit, provenance: { source: 'mock' } };
    return { answer: 'Sample mode has captured answers only for the suggested questions on this claim. Pick one of them, or run the app in Live mode to ask anything about the claim file.',
      citations: [], provenance: { source: 'mock' } };
  },
  async act(a) {
    actions.push({ ...a, actedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') });
    return { ok: true };
  },
};
