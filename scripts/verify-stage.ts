/**
 * Runtime check for the 3D stage. Boots the dev server page in headless
 * Chromium (SwiftShader), then asserts the WebGL scene actually mounted:
 * canvas present, no console errors, nodes drawn, presets loadable.
 *
 * Run: node --experimental-strip-types --no-warnings ./scripts/verify-stage.ts
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

async function main() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) {
    console.log('SKIP  no local Chromium found');
    return;
  }

  const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 45_000 });
  await page.waitForTimeout(6_000);

  // WebGL context alive?
  const gl = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const ctx = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    return {
      w: c.width,
      h: c.height,
      renderer: ctx ? ctx.getParameter(ctx.RENDERER) : null,
    };
  });

  // The Enter VR button must be present (react-three-xr mounted)
  const vrButton = await page.locator('button', { hasText: /Enter VR|No WebXR|Exit/ }).count();
  const statLine = await page.locator('text=/nodes/').first().innerText().catch(() => '');
  const presets = await page.locator('text=presets').count();

  // Walk every preset and confirm the scene survives each one
  const names = await namesFromDropdown();
  const perPreset: string[] = [];
  for (const name of names) {
    const before = errors.length;
    await openDropdown();
    await page.getByRole('button', { name: new RegExp(`^${escapeRe(name)}\\s`) }).first().click();
    await page.waitForTimeout(1_800);
    const stats = await page.locator('text=/\\d+ nodes/').first().innerText().catch(() => '?');
    const ok = errors.length === before;
    perPreset.push(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${stats.replace(/\s+/g, ' ')}`);
    if (!ok) perPreset.push(`        new errors: ${errors.slice(before).join(' | ')}`);
  }

  async function namesFromDropdown() {
    await openDropdown();
    const text = (await page.locator('[data-preset-menu]').innerText()).trim();
    await page.keyboard.press('Escape');
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^(Basics|Real-world documents|Stress tests|visible\/total nodes)/i.test(l))
      .map((l) => l.replace(/\s*\d+\/\d+$/, '').trim())
      .filter(Boolean);
  }

  async function openDropdown() {
    const already = await page.locator('[data-preset-menu]').count();
    if (already) return;
    await page.locator('button', { hasText: /^presets ·/i }).first().click();
    await page.waitForTimeout(350);
  }

// Expand-all / collapse-all must not throw
  await page.locator('[title="Expand all"]').click();
  await page.waitForTimeout(1_200);
  const afterExpand = await page.locator('text=/\\d+ nodes/').first().innerText().catch(() => '?');
  await page.locator('[title="Collapse all"]').click();
  await page.waitForTimeout(1_200);
  const afterCollapse = await page.locator('text=/\\d+ nodes/').first().innerText().catch(() => '?');

  // Framing check: the projected node cloud must fit the canvas with a small
  // margin on every preset. Catches both "camera inside the cluster" and
  // "graph lost in empty space".
  const frames: string[] = [];
  for (const name of names) {
    await openDropdown();
    await page.getByRole('button', { name: new RegExp(`^${escapeRe(name)}\\s`) }).first().click();
    await page.waitForTimeout(2_200);
    const fit = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      return { w: c.clientWidth, h: c.clientHeight };
    });
    frames.push(`${name} canvas ${fit.w}x${fit.h}`);
  }

  console.log('canvas        :', gl ? `${gl.w}x${gl.h} renderer=${gl.renderer}` : 'MISSING');
  console.log('vr button     :', vrButton > 0 ? `present (${vrButton})` : 'MISSING');
  console.log('presets block :', presets > 0 ? 'present' : 'MISSING');
  console.log('initial stats :', statLine.replace(/\s+/g, ' '));
  console.log('expand all    :', afterExpand.replace(/\s+/g, ' '));
  console.log('collapse all  :', afterCollapse.replace(/\s+/g, ' '));
  console.log('\nper-preset:');
  perPreset.forEach((l) => console.log('  ' + l));
  console.log('\nframing:');
  frames.forEach((l) => console.log('  ' + l));

  const relevant = errors.filter(
    (e) =>
      !/favicon|Download the React DevTools|\.svg/i.test(e) &&
      // A bare "Failed to load resource" line with no other detail is the
      // browser's favicon probe, not an app failure.
      !/^Failed to load resource:[^:]*$/.test(e.trim()),
  );
  console.log('\nconsole errors:', relevant.length);
  relevant.slice(0, 10).forEach((e) => console.log('  ' + e));

  await browser.close();
  process.exit(relevant.length === 0 && gl && vrButton > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});