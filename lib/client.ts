// Browser-side access to ClaimsData. The hosted /try/ build has no server, so it calls the
// sample implementation directly; otherwise every call goes to /api/data, which picks sample or live.
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

const remote = new Proxy({} as ClaimsData, {
  get: (_t, op: Op) => (...args: unknown[]) => call(op, args),
});

export const data: ClaimsData = HOSTED_EXAMPLE ? mockData : remote;
