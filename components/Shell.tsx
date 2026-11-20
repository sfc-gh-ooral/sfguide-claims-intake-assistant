'use client';

// App frame. The left "spine" is both navigation and a live view of the document pipeline:
// each destination is a pipeline stage with its current count. Under 1024 px it becomes a sheet.
import { FileText, Inbox, KanbanSquare, Menu, MessageSquareText, Moon, Search, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { LogoMark } from '@/components/Logo';
import { ModeChip } from '@/components/ModeChip';
import { data, onDataChange } from '@/lib/client';
import { HOSTED_EXAMPLE } from '@/lib/hosted';

const REPO = 'https://github.com/sfc-gh-ooral/sfguide-claims-intake-assistant';
type Counts = { review: number; received: number; newClaims: number; lastRun: string | null; claims: string[] };

function useCounts() {
  const [c, setC] = useState<Counts>();
  useEffect(() => {
    const load = () => Promise.all([data.inbox(), data.board()]).then(([i, b]) => setC({
      review: i.kpis.needsReview, received: i.kpis.received, lastRun: i.kpis.lastRun,
      newClaims: b.claims.filter((x) => x.status === 'New').length, claims: b.claims.map((x) => x.claimId).sort(),
    })).catch(() => setC(undefined));
    load();
    return onDataChange(load);
  }, []);
  return c;
}

function Spine({ counts, onClose, closeRef }: { counts?: Counts; onClose?: () => void; closeRef?: React.Ref<HTMLButtonElement> }) {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const params = useSearchParams();
  const claim = params.get('id');
  const nav = [
    { href: '/', label: 'Intake', icon: Inbox, count: counts?.review, attn: true, hint: 'documents need review' },
    { href: `/claim${claim ? `?id=${claim}` : ''}`, path: '/claim', label: 'Claim file', icon: FileText, tag: pathname === '/claim' || pathname === '/ask' ? claim : null },
    { href: '/triage', label: 'Triage board', icon: KanbanSquare, count: counts?.newClaims, hint: 'new claims to route' },
    { href: `/ask${claim ? `?id=${claim}` : ''}`, path: '/ask', label: 'Ask the file', icon: MessageSquareText },
  ];
  const stages = ['Stage', 'Directory table', 'Stream', 'Task'];
  return (
    <div className="spine h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 flex items-center gap-3">
        <LogoMark size={34} />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold leading-tight text-white tracking-tight">Claims Desk</div>
          <div className="text-[11.5px]" style={{ color: 'var(--spine-ink-2)' }}>Veltrona Mutual · Auto</div>
        </div>
        {onClose && <button ref={closeRef} className="ml-auto lg:hidden p-1.5 rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close menu"><X className="w-4 h-4" /></button>}
      </div>
      <div className="px-5 pb-2 text-[10.5px] font-bold tracking-[.12em] uppercase" style={{ color: 'var(--spine-ink-2)' }}>Workflow</div>
      <nav className="px-3 space-y-1" aria-label="Main navigation">
        {nav.map((n, i) => {
          const active = (n.path ?? n.href) === pathname;
          return (
            <Link key={n.label} href={n.href} aria-current={active ? 'page' : undefined} className="spine-link"
              title={n.count !== undefined ? `${n.count} ${n.hint}` : undefined}>
              <span className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold mono" style={{ background: 'rgba(255,255,255,.08)' }} aria-hidden>{i + 1}</span>
              <n.icon className="w-4 h-4" aria-hidden />
              <span className="truncate">{n.label}</span>
              {n.count !== undefined && <span className={`spine-count ${n.attn && n.count > 0 ? 'attn' : ''}`}>{n.count}</span>}
              {n.tag && <span className="spine-count">{n.tag.replace('CLM-', '#')}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="mx-4 mt-6 rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[10.5px] font-bold tracking-[.12em] uppercase" style={{ color: 'var(--spine-ink-2)' }}>Document pipeline</span>
          <span className="w-2 h-2 rounded-full" style={{ background: '#2FBF8F' }} aria-hidden />
        </div>
        <ol className="relative pl-5">
          <span className="absolute left-[4px] top-2 bottom-2 w-px" style={{ background: 'rgba(255,255,255,.22)' }} aria-hidden />
          {stages.map((s, i) => (
            <li key={s} className="relative py-[3px] text-[12.5px] text-white/90">
              <span className="absolute -left-5 top-[8px] w-2.5 h-2.5 rounded-full border-2" aria-hidden
                style={{ borderColor: 'var(--marker)', background: i === stages.length - 1 ? 'var(--marker)' : 'var(--spruce)' }} />
              {s}
            </li>
          ))}
        </ol>
        <p className="text-[11.5px] mt-2.5 leading-snug" style={{ color: 'var(--spine-ink-2)' }}>
          {counts ? <>{counts.received} documents processed{counts.lastRun ? <>, last run <span className="mono">{counts.lastRun.slice(5)}</span></> : ''}</> : 'Loading…'}
        </p>
      </div>
      <div className="mt-auto px-5 py-4 text-[11px] leading-relaxed" style={{ color: 'var(--spine-ink-2)', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        Synthetic data and illustrative logic. Not claims-handling, legal, regulatory or compliance advice. AI tiers and routing are suggestions for adjuster review.
      </div>
    </div>
  );
}

function ClaimSearch({ claims }: { claims: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const n = q.trim().toUpperCase().replace(/^#/, '');
    const id = claims.find((c) => c === n || c === `CLM-${n}` || c.endsWith(n));
    if (id) { router.push(`/claim?id=${id}`); setQ(''); }
  };
  return (
    <form onSubmit={go} className="relative hidden md:block" role="search">
      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 muted" aria-hidden />
      <input className="input !pl-8 w-56" list="claim-ids" placeholder="Go to claim, e.g. 24003" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Go to claim" />
      <datalist id="claim-ids">{claims.map((c) => <option key={c} value={c} />)}</datalist>
    </form>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const flip = () => {
    const t = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    localStorage.setItem('cia-theme', t);
    setDark(!dark);
  };
  return (
    <button className="btn btn-ghost !px-2" onClick={flip} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

const TITLES: Record<string, [string, string]> = {
  '/': ['Intake', 'Documents arriving on the claims stage, parsed and extracted automatically'],
  '/claim': ['Claim file', 'Extracted fields beside the source, coverage check and AI suggestion'],
  '/triage': ['Triage board', 'Lanes by handling tier, adjuster workload and cycle time'],
  '/ask': ['Ask the claims file', 'Answers from one claim’s documents and notes, with citations'],
};

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/\/$/, '') || '/';
  const counts = useCounts();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const t = toggleRef.current;
    return () => { window.removeEventListener('keydown', onKey); t?.focus(); };
  }, [open]);
  const [title, sub] = TITLES[pathname] ?? TITLES['/'];

  return (
    <div className="min-h-screen">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[248px] z-40"><Spine counts={counts} /></aside>
      {open && (
        <>
          <div className="scrim lg:hidden" onClick={() => setOpen(false)} aria-hidden />
          <aside className="fixed inset-y-0 left-0 w-[272px] max-w-[86vw] z-[60] lg:hidden fade-up" role="dialog" aria-modal="true" aria-label="Menu">
            <Spine counts={counts} onClose={() => setOpen(false)} closeRef={closeRef} />
          </aside>
        </>
      )}
      <div className="lg:pl-[248px] min-w-0">
        {HOSTED_EXAMPLE && (
          <div role="note" className="px-4 lg:px-8 py-2 text-[12.5px] border-b" style={{ background: 'color-mix(in srgb, var(--marker) 22%, var(--canvas))', borderColor: 'var(--line)' }}>
            <strong>Hosted example on synthetic data.</strong> Runs in your browser with no Snowflake account. AI answers are samples captured from the live pipeline.{' '}
            <a href={REPO} className="underline underline-offset-2 font-semibold">Run it in your own account</a>
          </div>
        )}
        <header className="topbar sticky top-0 z-30 h-[60px] flex items-center gap-3 px-4 lg:px-8">
          <button ref={toggleRef} className="lg:hidden btn !px-2" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu className="w-4 h-4" /></button>
          <span className="hidden sm:inline lg:hidden"><LogoMark size={28} /></span>
          <div className="min-w-0">
            <h1 className="text-[17px] font-extrabold leading-tight truncate">{title}</h1>
            <p className="text-[12px] muted truncate hidden sm:block">{sub}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ClaimSearch claims={counts?.claims ?? []} />
            <ModeChip />
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-2 pl-2 ml-1 border-l" style={{ borderColor: 'var(--line)' }} title="Fictional user for this example">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ background: 'linear-gradient(135deg,#136B5C,#0E3B34)' }} aria-hidden>AL</span>
              <span className="leading-tight hidden xl:block"><span className="block text-[12.5px] font-semibold">Avery Lindqvist</span><span className="block text-[11px] muted">Intake lead</span></span>
            </div>
          </div>
        </header>
        <main key={pathname} className="fade-up px-4 lg:px-8 py-6 max-w-[1440px]">{children}</main>
        <footer className="px-4 lg:px-8 pb-8 text-[11.5px] muted max-w-[1440px]">
          Veltrona Mutual is fictional. Synthetic data, illustrative logic; not production, regulatory or compliance advice.
          An example built on Snowflake, not an official Snowflake product. <a className="underline" href={REPO}>Source and setup</a>
        </footer>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}><Frame>{children}</Frame></Suspense>;
}
