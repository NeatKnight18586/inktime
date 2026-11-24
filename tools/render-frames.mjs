// Frame capture. Usage: node tools/render-frames.mjs --scene <path> --start <n> --end <n> --out <dir>
// Renders frames start..end-1 (end exclusive) to <out>/%05d.png, numbered by global frame index.
// Also writes the per-frame camera pose to --cams (default out/cams.json), merged with any existing entries.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}

const a = args(process.argv);
if (!a.scene || !a.out) {
  console.error('usage: render-frames.mjs --scene <path> --start <n> --end <n> --out <dir>');
  process.exit(2);
}
const PORT = Number(process.env.INKTIME_PORT ?? 4173);
const server = await startServer(PORT);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://127.0.0.1:${PORT}/engine/index.html`);
  const gl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  if (!gl2) throw new Error('WebGL2 unavailable in headless chromium');
  await page.waitForFunction(() => window.inktime, null, { timeout: 30000 }).catch(() => {
    throw new Error(`engine did not start: ${errors[0] ?? 'window.inktime missing'}`);
  });
  const scenePath = '/' + a.scene.replace(/^\.?\//, '');
  const info = await page.evaluate((p) => window.inktime.load(p), scenePath);
  const total = await page.evaluate(() => window.inktime.frameCount);
  const start = Number(a.start ?? 0);
  const end = Math.min(Number(a.end ?? total), total);
  mkdirSync(a.out, { recursive: true });
  const camsPath = a.cams ?? 'out/cams.json';
  let cams = { frames: {} };
  if (existsSync(camsPath)) {
    try {
      cams = JSON.parse(readFileSync(camsPath, 'utf8'));
    } catch {
      cams = { frames: {} };
    }
  }
  cams.scene = a.scene;
  cams.fps = 24;
  const t0 = performance.now();
  for (let n = start; n < end; n++) {
    const { url, pose } = await page.evaluate(async (k) => {
      const pose = await window.inktime.renderFrame(k);
      return { url: document.getElementById('view').toDataURL('image/png'), pose };
    }, n);
    cams.frames[n] = pose;
    writeFileSync(join(a.out, `${String(n).padStart(5, '0')}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    if ((n - start) % 100 === 0) console.log(`frame ${n} (${((performance.now() - t0) / 1000 / (n - start + 1)).toFixed(2)} s/frame)`);
  }
  mkdirSync(dirname(camsPath), { recursive: true });
  writeFileSync(camsPath, JSON.stringify(cams));
  const secs = (performance.now() - t0) / 1000;
  console.log(`rendered ${end - start} frames ${start}-${end - 1} of ${info.frames} in ${secs.toFixed(1)} s`);
  if (errors.length) console.log(`page errors: ${errors.length}, first: ${errors[0]}`);
} catch (e) {
  console.error(`render-frames: ${e.message.split('\n')[0]}`);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
