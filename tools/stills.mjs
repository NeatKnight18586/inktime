// Style frames: render only the frames listed in tests/styleframes.json, at full quality (1080x1920).
// Usage: node tools/stills.mjs [--frames tests/styleframes.json] [--out out/styleframes]
// Per frame <id>: <id>.png, <id>.measure.txt, <id>.notan.png (3 values, 18x32 grid, 10x nearest-neighbour).
// Plus contact.jpg (frames) and notan.png (all notan thumbnails side by side) and render.json.
// Each frame is its own one-shot scene whose shot starts at frame 0, so the camera, ship and lamps at frame `at`
// are exactly what the full render shows at that frame.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const framesPath = flag('--frames', 'tests/styleframes.json');
const out = flag('--out', 'out/styleframes');
const cfg = JSON.parse(readFileSync(framesPath, 'utf8'));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return r.stdout;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'spec'), { recursive: true });
const ids = [];
for (const f of cfg.frames) {
  const spec = {
    name: f.id,
    fps: cfg.fps,
    seed: cfg.seed,
    look: cfg.look,
    set: cfg.set,
    shots: [{ frames: f.at + 1, camera: f.camera, ...(f.hands ? { hands: f.hands } : {}), ...(f.show ? { show: f.show } : {}) }],
    cards: f.cards ?? [],
  };
  const specPath = join(out, 'spec', `${f.id}.json`);
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const dir = join(out, 'raw', f.id);
  console.log(`${f.id}: frame ${f.at}`);
  console.log(run('node', ['tools/render-frames.mjs', '--scene', specPath, '--start', String(f.at), '--end', String(f.at + 1), '--out', dir, '--cams', join(dir, 'cams.json')]).trim());
  const raw = join(dir, `${String(f.at).padStart(5, '0')}.png`);
  if (!existsSync(raw)) throw new Error(`${f.id}: no frame written`);
  copyFileSync(raw, join(out, `${f.id}.png`));
  const focus = (f.focus ?? []).map((p) => p.join(',')).join(';');
  const text = run('node', ['tools/measure.mjs', join(out, `${f.id}.png`), '--focus', focus, '--notan-out', join(out, `${f.id}.notan.png`), ...(f.skip?.length ? ['--skip', f.skip.join(',')] : [])]);
  writeFileSync(join(out, `${f.id}.measure.txt`), `${f.id}: ${f.title}\n${text}`);
  console.log(text.trim());
  ids.push(f.id);
}
rmSync(join(out, 'raw'), { recursive: true, force: true });
// Contact sheet (frames) and notan sheet, each 270x480 tiles in a row.
const sheet = (suffix, dest, extra = []) => {
  const inputs = ids.flatMap((id) => ['-i', join(out, `${id}${suffix}`)]);
  const chain = ids.map((_, i) => `[${i}:v]scale=270:480:flags=${suffix === '.png' ? 'area' : 'neighbor'}[s${i}]`).join(';');
  const stack = ids.map((_, i) => `[s${i}]`).join('') + `hstack=inputs=${ids.length}`;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${chain};${stack}`, '-frames:v', '1', ...extra, dest]);
};
sheet('.png', join(out, 'contact.jpg'), ['-q:v', '3']);
sheet('.notan.png', join(out, 'notan.png'));
writeFileSync(join(out, 'render.json'), JSON.stringify({ status: 'stills', commit: process.env.GITHUB_SHA ?? null, frames: ids }, null, 2) + '\n');
console.log(`stills done: ${ids.join(', ')}`);
