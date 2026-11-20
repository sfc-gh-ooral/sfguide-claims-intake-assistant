import { NextResponse } from 'next/server';
import type { ClaimsData } from '@/lib/claims-data';
import { mockData } from '@/lib/mock-data';
import { isSnowflakeConfigured } from '@/lib/snowflake';

// One entry point for every screen. Uses Snowflake when .env.local is configured and the user
// hasn't switched to Sample mode (x-cia-mode: sample); otherwise the bundled synthetic data.
// Live failures are returned as errors, never silently replaced with sample data.
const OPS = new Set<keyof ClaimsData>(['inbox', 'claim', 'board', 'summarize', 'ask', 'act']);
const ID = /^CLM-\d{4,6}$/;

export async function POST(request: Request) {
  const { op, args } = await request.json();
  if (!OPS.has(op) || !Array.isArray(args)) return NextResponse.json({ error: 'Unknown operation' }, { status: 400 });
  if (['claim', 'summarize', 'ask'].includes(op) && !ID.test(String(args[0]))) return NextResponse.json({ error: 'Unknown claim' }, { status: 400 });
  if (op === 'ask' && (typeof args[1] !== 'string' || args[1].length > 500)) return NextResponse.json({ error: 'Question must be under 500 characters' }, { status: 400 });
  if (op === 'act' && (!ID.test(String(args[0]?.claimId)) || !['accept', 'correct', 'route'].includes(args[0]?.action)))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const wantSample = request.headers.get('x-cia-mode') === 'sample';
  const impl: ClaimsData = isSnowflakeConfigured() && !wantSample ? (await import('@/lib/live-data')).liveData : mockData;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (impl[op as keyof ClaimsData] as (...a: any[]) => Promise<unknown>)(...args);
    return NextResponse.json(result ?? { notFound: true });
  } catch (error) {
    console.error(`${op} failed:`, error);
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 502 });
  }
}
