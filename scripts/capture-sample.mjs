// Captures the no-account sample data from the running app in Live mode, so Sample mode shows
// exactly what the live pipeline produced on this synthetic data (fields, scores, AI text).
// Usage: start `npm run dev` with .env.local configured, then `node scripts/capture-sample.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const SUGGESTED = {
  _default: ['What happened, and who is involved?', 'Is anything missing or inconsistent in this file?'],
  'CLM-24003': ['Why might this claim need an SIU referral?', 'When was the police report filed?'],
  'CLM-24004': ['Is this claim covered, and what will the insured pay?'],
  'CLM-24005': ['How have the medical bills changed over time?', 'Who is at fault, and who was injured?'],
  'CLM-24008': ['Does the repair estimate add up?'],
};
const STORY_CLAIMS = Object.keys(SUGGESTED).filter((k) => k !== '_default');

async function call(op, args = []) {
  const res = await fetch(`${APP}/api/data`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${op} ${JSON.stringify(args)}: ${json.error}`);
  if (json.provenance?.source !== 'live') throw new Error(`${op} did not come from Live mode`);
  return json;
}
const strip = (x) => { const { provenance, ...rest } = x; return { provenance: { source: 'mock' }, ...rest, _liveLatencyMs: provenance?.latencyMs }; };

mkdirSync('public/mock/claims', { recursive: true });
const inbox = await call('inbox');
writeFileSync('lib/mock/inbox.json', JSON.stringify(strip(inbox)));
writeFileSync('lib/mock/board.json', JSON.stringify(strip(await call('board'))));
const ids = [...new Set(inbox.docs.map((d) => d.claimId))];
for (const id of ids) {
  const file = strip(await call('claim', [id]));
  for (const d of file.docs) d.url = ''; // presigned URLs expire; the app falls back to the bundled copy
  if (file.triage) file.triage.provenance = undefined;
  writeFileSync(`public/mock/claims/${id}.json`, JSON.stringify(file));
}
console.log(`Captured inbox, board and ${ids.length} claim files`);

// Answers: suggested questions for the story claims and the 12 newest other claims, 4 at a time.
const newest = ids.filter((i) => !STORY_CLAIMS.includes(i)).slice(0, 12);
const jobs = [...STORY_CLAIMS, ...newest].flatMap((id) => [...(SUGGESTED[id] ?? []), ...SUGGESTED._default].map((q) => [id, q]));
const answers = {}, latency = [];
for (let i = 0; i < jobs.length; i += 4) {
  await Promise.all(jobs.slice(i, i + 4).map(async ([id, q]) => {
    const a = await call('ask', [id, q]);
    latency.push(a.provenance.latencyMs);
    answers[`${id}|${q}`] = { answer: a.answer, citations: a.citations };
  }));
}
writeFileSync('public/mock/answers.json', JSON.stringify(answers));
const sum = [];
for (const id of STORY_CLAIMS) sum.push((await call('summarize', [id])).provenance.latencyMs);
latency.sort((a, b) => a - b); sum.sort((a, b) => a - b);
console.log(`Captured ${jobs.length} answers. Ask latency ms min/median/max: ${latency[0]}/${latency[latency.length >> 1]}/${latency.at(-1)}; summarize: ${sum.join(', ')}`);
