// Browser-side access to ClaimsData. The hosted /try/ build has no server, so it calls the
// sample implementation directly; otherwise every call goes to /api/data, which picks sample or live.
// Inbox and board are cached per page load (the shell and the page both read them) and
// refreshed after a decision is recorded.
import type { ClaimsData } from './claims-data';
import { HOSTED_EXAMPLE } from './hosted';
import { mockData } from './mock-data';
import { preferSample } from './mode';

type Op = keyof ClaimsData;

async function call<T>(op: Op, args: unknown[]): Promise<T> {
  const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(preferSample() ? { 'x-cia-mode': 'sample' } : {}) }, body: JSON.stringify({ op, args }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

const source: ClaimsData = HOSTED_EXAMPLE ? mockData : new Proxy({} as ClaimsData, {
  get: (_t, op: Op) => (...args: unknown[]) => call(op, args),
});

const cache = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
export function onDataChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

function cached<K extends 'inbox' | 'board'>(op: K): ClaimsData[K] {
  return (() => {
    if (!cache.has(op)) { const p = source[op](); cache.set(op, p); p.catch(() => cache.delete(op)); }
    return cache.get(op);
  }) as ClaimsData[K];
}

// Drop cached inbox and board after new documents are processed.
export function refreshData() { cache.clear(); listeners.forEach((fn) => fn()); }

export const data: ClaimsData = {
  inbox: cached('inbox'),
  board: cached('board'),
  claim: (id) => source.claim(id),
  summarize: (id) => source.summarize(id),
  ask: (id, q) => source.ask(id, q),
  act: async (a) => {
    const r = await source.act(a);
    cache.clear();
    listeners.forEach((fn) => fn());
    return r;
  },
};
