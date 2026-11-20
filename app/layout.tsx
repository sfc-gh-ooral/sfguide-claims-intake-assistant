import type { Metadata } from 'next';
import './globals.css';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: 'Claims Intake and Triage Assistant: Snowflake example',
  description: 'Turn FNOL emails, forms, photos and repair estimates into structured, triaged claims with an AI summary for every adjuster. Synthetic data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
