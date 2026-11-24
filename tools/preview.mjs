// Cheap preview. Usage: node tools/preview.mjs <episodeDir>   (after tools/check.mjs has baked out/plan.json)
// Renders only the frames at 0%, 12.5% ... 87.5% plus the two frames either side of the loop join, then writes into review/<id>/:
// contact.jpg (5x2: the eight timeline frames, the last frame and frame 1), measure.txt, urls.txt; and <dir>/out/stills/ (stills.json + <n>.measure.txt for the look gate).
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const previewFrames = (N) => {
  const timeline = Array.from({ length: 8 }, (_, i) => Math.floor((N * i) / 8));
  const join_ = [N - 2, N - 1, 0, 1];
  return { timeline, sheet: [...timeline, N - 1, 1], all: [...new Set([...timeline, ...join_])].sort((a, b) => a - b) };
}
const dir = process.argv[2];
if (dir) {
  const plan = JSON.parse(readFileSync(join(dir, 'out', 'plan.json'), 'utf8'));
  const id = plan.id;
  const { sheet, all } = previewFrames(plan.frames);
  const frames = join(dir, 'out', 'preview');
  const stills = join(dir, 'out', 'stills');
  rmSync(frames, { recursive: true, force: true });
  rmSync(stills, { recursive: true, force: true });
  mkdirSync(stills, { recursive: true });
  mkdirSync(`review/${id}`, { recursive: true });
  const r = spawnSync('node', ['tools/render-frames.mjs', '--scene', join(dir, 'out', 'plan.json'), '--frames', all.join(','), '--out', frames, '--cams', join(dir, 'out', 'preview-cams.json')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('preview render failed');
  const png = (n) => join(frames, `${String(n).padStart(5, '0')}.png`);
  const inputs = sheet.flatMap((n) => ['-i', png(n)]);
  const chain = sheet.map((_, i) => `[${i}:v]scale=270:480:flags=area[s${i}]`).join(';');
  const row = (a) => a.map((i) => `[s${i}]`).join('') + `hstack=inputs=${a.length}`;
  const graph = `${chain};${row([0, 1, 2, 3, 4])}[r1];${row([5, 6, 7, 8, 9])}[r2];[r1][r2]vstack=inputs=2`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', graph, '-frames:v', '1', '-q:v', '3', `review/${id}/contact.jpg`]);
  const list = [];
  const text = [];
  for (const n of all) {
    const e = plan.plan[n];
    const m = execFileSync('node', ['tools/measure.mjs', png(n)], { encoding: 'utf8' });
    writeFileSync(join(stills, `${n}.measure.txt`), m);
    list.push({ n, preset: e.preset, light: e.light });
    text.push(`frame ${n} (${e.preset})\n${m}`);
  }
  writeFileSync(join(stills, 'stills.json'), JSON.stringify(list));
  writeFileSync(`review/${id}/measure.txt`, text.join('\n'));
  const repo = process.env.GITHUB_REPOSITORY ?? 'NeatKnight18586/inktime';
  const url = (f) => `https://github.com/${repo}/raw/renders/renders/${id}/${f}`;
  writeFileSync(`review/${id}/urls.txt`, ['contact', 'gates', 'measure'].map((k) => `${k} ${url({ contact: 'contact.jpg', gates: 'gates.txt', measure: 'measure.txt' }[k])}`).join('\n') + '\n');
  console.log(`preview: ${all.length} frames, contact sheet review/${id}/contact.jpg`);
}
