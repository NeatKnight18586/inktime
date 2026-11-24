// See-through test: a character card in front of a striped wall must be solid. Renders the card in front of the stripes (A), in
// front of a plain wall (B) and the plain wall alone (C) on the farm, then checks that every sampled pixel inside the card body
// (mask from B vs C, eroded 10 px) is identical in A and B: card colour only, no stripes and no ink lines from behind.
// Usage: node tools/solidtest.mjs [--out out/solid] [--result out/solid.txt]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const out = flag('--out', 'out/solid');
const resultPath = flag('--result', join(out, '..', 'solid.txt'));
const W = 1080;
const H = 1920;
const base = JSON.parse(readFileSync('tests/solid.json', 'utf8'));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: opts.buffer ? null : 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return r.stdout;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const variants = {
  A: { ...base, name: 'solidA' },
  B: { ...base, name: 'solidB', set: 'solid_test_plain' },
  C: { ...base, name: 'solidC', set: 'solid_test_plain', cards: [] },
};
const rgb = {};
for (const [k, spec] of Object.entries(variants)) {
  const specPath = join(out, `${k}.json`);
  writeFileSync(specPath, JSON.stringify(spec));
  const dir = join(out, `raw${k}`);
  run('node', ['tools/render-frames.mjs', '--scene', specPath, '--start', '0', '--end', '1', '--out', dir, '--cams', join(dir, 'cams.json')]);
  rgb[k] = run('ffmpeg', ['-v', 'error', '-i', join(dir, '00000.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { buffer: true });
  run('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, '00000.png'), '-vf', 'scale=270:480', join(out, `${k}.jpg`)]);
}
const px = (b, i) => [b[i * 3], b[i * 3 + 1], b[i * 3 + 2]];
const diff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
// Card body mask: where the card (B) differs from the bare wall (C); eroded by 10 px so edges, misregistration and grain borders stay out.
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = diff(px(rgb.B, i), px(rgb.C, i)) > 24 ? 1 : 0;
const R = 10;
let sampled = 0;
let bad = 0;
let worst = 0;
for (let y = R; y < H - R; y += 3) {
  for (let x = R; x < W - R; x += 3) {
    let inside = true;
    for (let d = -R; d <= R && inside; d += 5) if (!mask[y * W + x + d] || !mask[(y + d) * W + x] || !mask[(y + d) * W + x + d] || !mask[(y + d) * W + x - d]) inside = false;
    if (!inside) continue;
    sampled++;
    const d = diff(px(rgb.A, y * W + x), px(rgb.B, y * W + x));
    worst = Math.max(worst, d);
    if (d > 8) bad++;
  }
}
const pass = sampled >= 500 && bad === 0;
const text = `see-through test: ${pass ? 'PASS' : 'FAIL'}\nsampled ${sampled} pixels inside the card body (mask eroded ${R} px); ${bad} differ between striped and plain wall (max channel diff ${worst}, tolerance 8)\n`;
writeFileSync(resultPath, text);
console.log(text.trim());
process.exit(pass ? 0 : 1);
