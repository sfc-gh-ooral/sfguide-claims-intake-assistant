'use client';

// Staged progress for AI calls. Steps mirror what the live path does and are built from the
// claim's real counts. They advance on a timer; the last one holds until the answer arrives.
import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Reasoning({ steps, expectMs, title = 'Working on it' }: { steps: string[]; expectMs: number; title?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => window.clearInterval(id);
  }, []);
  const per = expectMs / steps.length;
  const step = Math.min(steps.length - 1, Math.floor(elapsed / per));
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface-2)', border: '1px dashed var(--line-strong)' }} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[12.5px] font-bold flex items-center gap-2" style={{ color: 'var(--spruce-2)' }}>
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />{title}
        </span>
        <span className="mono text-[11.5px] muted">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'active' : 'todo';
          return (
            <li key={s} className="flex items-center gap-2.5 text-[13px]" style={{ opacity: state === 'todo' ? 0.45 : 1, transition: 'opacity .2s' }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" aria-hidden
                style={{ background: state === 'done' ? 'var(--spruce-2)' : state === 'active' ? 'var(--marker)' : 'var(--surface-3)', color: state === 'done' ? '#fff' : '#2E2400' }}>
                {state === 'done' ? <Check className="w-3 h-3" /> : state === 'active' ? <span className="w-1.5 h-1.5 rounded-full bg-current" /> : null}
              </span>
              <span className={state === 'active' ? 'font-semibold' : ''}>{s}{state === 'active' ? '…' : ''}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }} aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.min(96, (elapsed / expectMs) * 100)}%`, background: 'linear-gradient(90deg, var(--spruce-2), var(--marker))', transition: 'width .1s linear' }} />
      </div>
    </div>
  );
}
