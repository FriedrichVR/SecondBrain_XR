import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/FSASTR~1/AppData/Local/Temp/opencode/shots2';
mkdirSync(OUT, { recursive: true });

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const b = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 940 } });
p.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('canvas');
await p.waitForTimeout(6000);

const open = async () => {
  if (await p.locator('[data-preset-menu]').count()) return;
  await p.locator('button', { hasText: /^presets ·/i }).first().click();
  await p.waitForTimeout(400);
};
const pick = async (name: string) => {
  await open();
  await p.getByRole('button', { name: new RegExp(`^${escapeRe(name)}\\s`) }).first().click();
  await p.waitForTimeout(2400);
};

// dropdown abierto, agrupado
await open();
await p.locator('[data-preset-menu]').scrollIntoViewIfNeeded();
await p.screenshot({ path: `${OUT}/00-dropdown.png`, fullPage: false });
await p.keyboard.press('Escape');
await p.waitForTimeout(300);

for (const [name, file] of [
  ['org chart', '01-org-chart'],
  ['time series', '02-time-series'],
  ['deep × 40', '03-deep-40'],
  ['1k siblings', '04-1k-siblings'],
  ['unicode torture', '05-unicode'],
  ['pathological keys', '06-pathological'],
] as const) {
  await pick(name);
  await p.screenshot({ path: `${OUT}/${file}.png` });
}

// 1k siblings con expand all: el peor caso de perf
await pick('1k siblings');
await p.locator('[title="Expand all"]').click();
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/07-1k-expand-all.png` });

await b.close();
console.log('done ->', OUT);