import type { Metadata } from 'next';
import { Figtree, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Shell from '@/components/Shell';

// Self-hosted at build time by next/font (SIL Open Font License); no font CDN at runtime.
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-figtree' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jbmono' });

export const metadata: Metadata = {
  title: 'Veltrona Claims Desk · Claims Intake and Triage Assistant (Snowflake example)',
  description: 'Turn FNOL emails, forms, photos and repair estimates into structured, triaged claims with an AI summary for every adjuster. Synthetic data.',
};

// Applies the saved theme (or the OS setting) before first paint, so there is no flash.
const THEME = `try{var t=localStorage.getItem('cia-theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
