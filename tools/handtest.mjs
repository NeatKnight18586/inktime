// Hands skin/cuff test (STYLE, Hands). Usage: node tools/handtest.mjs [--out out/storyboard/hands.txt]
// Renders every hand pose alone in flat ID colours in headless Chromium (CI stills job only; never in the sandbox) and checks that
// skin is at least 55% of the hand's pixel area and the cuff at most 30%. Writes one line per pose; exit 1 on a FAIL.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

export const LIMITS = { skin: 0.55, cuff: 0.3 };
const argv = process.argv.slice(2);
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'out/storyboard/hands.txt';
const PORT = Number(process.env.INKTIME_PORT ?? 4174);
const server = await startServer(PORT);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/engine/index.html`);
  await page.waitForFunction(() => window.inktime, null, { timeout: 30000 });
  const res = await page.evaluate(() => window.inktime.handTest());
  const lines = Object.entries(res).map(([pose, r]) => {
    const ok = r.pixels > 0 && r.skin >= LIMITS.skin && r.cuff <= LIMITS.cuff;
    if (!ok) code = 1;
    return `${ok ? 'PASS' : 'FAIL'} ${pose}: skin ${(r.skin * 100).toFixed(1)}%, cuff ${(r.cuff * 100).toFixed(1)}% of ${r.pixels} px (skin >= 55%, cuff <= 30%)`;
  });
  const text = `hands skin/cuff test (vFOV 90, flat ID colours, ink hull off)\n${lines.join('\n')}\n${errors.length ? `errors: ${errors[0]}\n` : ''}`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  process.stdout.write(text);
} catch (e) {
  console.error(`handtest: ${e.message.split('\n')[0]}`);
  code = 1;
} finally {
  await browser.close();
  server.close?.();
}
process.exit(code);
