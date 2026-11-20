// Screenshots of the running app in Sample (no-account) mode for the guide and the catalog card.
// Usage: `npm run dev` without .env.local, then `node scripts/capture-screenshots.mjs`.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
mkdirSync('docs/images', { recursive: true });
mkdirSync('docs/catalog', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

async function shot(name, path, prep) {
  await page.goto(`${APP}${path}`);
  await page.waitForTimeout(2500);
  if (prep) await prep();
  await page.screenshot({ path: `docs/images/${name}.png` });
  console.log('captured', name);
}

await shot('01-intake', '/');
await shot('02-claim-siu', '/claim?id=CLM-24003');
await shot('03-estimate', '/claim?id=CLM-24008&doc=DOC-0017', async () => {
  await page.getByText('Estimate total', { exact: true }).first().hover();
  await page.waitForTimeout(400);
});
await shot('04-glass', '/claim?id=CLM-24004&doc=DOC-0006');
await shot('05-triage', '/triage');
await shot('06-ask', '/ask?id=CLM-24005', async () => {
  await page.getByRole('button', { name: 'How have the medical bills changed over time?' }).click();
  await page.waitForSelector('text=Sample AI response', { timeout: 20000 });
  await page.waitForTimeout(500);
});
await browser.close();

// Catalog cards: 960x600 JPEG, dashboard first.
const cards = ['01-intake', '02-claim-siu', '03-estimate', '05-triage', '06-ask', '04-glass'];
cards.forEach((c, i) => {
  const out = `docs/catalog/claims-intake-assistant-${i + 1}.jpg`;
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '48', '-z', '600', '960', `docs/images/${c}.png`, '--out', out], { stdio: 'ignore' });
});
console.log('catalog cards written');
