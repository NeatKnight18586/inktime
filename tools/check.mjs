// Gates. Usage: node tools/check.mjs <episodeDir> [--stills <dir>] [--full <measure.txt> [--mix <mix.wav>]] [--index]
// Bakes the episode (tools/bake.mjs), runs every gate (tools/gates.mjs), prints one line per gate and writes review/<id>/gates.txt.
// Exit 1 on any FAIL. --stills: preview stills measured by tools/measure.mjs (<dir>/stills.json + <dir>/<n>.measure.txt).
// --index: on no FAIL, append {id, hookType, presets} to episodes/index.json (never for ids starting with "_").
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bakeEpisode } from './bake.mjs';
import { runGates, formatGates, failed } from './gates.mjs';

export const INDEX = 'episodes/index.json';
export const readIndex = () => (existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : []);

const num = (text, key) => {
  const m = text.match(new RegExp(`^\\s+${key}\\s+(-?[\\d.]+)(%?)`, 'm'));
  return m ? (m[2] ? Number(m[1]) / 100 : Number(m[1])) : null;
};
export function readStills(dir) {
  const list = JSON.parse(readFileSync(join(dir, 'stills.json'), 'utf8'));
  return list.map((s) => {
    const t = readFileSync(join(dir, `${s.n}.measure.txt`), 'utf8');
    const o = t.slice(t.indexOf('overall'));
    return { ...s, lumaMean: num(o, 'lumaMean'), dark40: num(o, 'dark40'), p5: num(o, 'p5'), p95: num(o, 'p95'), sat: num(o, 'sat') };
  });
}
export function readFull(measureFile, mixFile) {
  const t = readFileSync(measureFile, 'utf8');
  const o = t.slice(t.indexOf('overall'));
  const shotsOver = [...t.matchAll(/^shot (\d+).*\n(?:.*\n)*?\s+motion\s+\S+\s+target \S+\s+WARN/gm)].map((m) => m[1]);
  void mixFile;
  return { motion: num(o, 'motion'), shotsOver, lufs: null };
}
function mixLufs(file) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const log = String(e.stderr ?? '');
    const m = [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
    return m ? Number(m[1]) : null;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((x, i) => !x.startsWith('--') && !['--stills', '--full', '--mix'].includes(args[i - 1]));
  const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  if (!dir) {
    console.error('usage: check.mjs <episodeDir> [--stills dir] [--full measure.txt] [--mix mix.wav] [--index]');
    process.exit(2);
  }
  const { doc, words, script, ep } = await bakeEpisode(dir);
  const id = ep.id;
  const index = readIndex();
  const stills = flag('--stills') ? readStills(flag('--stills')) : null;
  let full = null;
  if (flag('--full')) {
    full = readFull(flag('--full'));
    full.lufs = flag('--mix') ? mixLufs(flag('--mix')) : null;
  }
  const gates = runGates({ doc, words, script, index, id, stills, full });
  const text = formatGates(gates);
  mkdirSync(`review/${id}`, { recursive: true });
  writeFileSync(`review/${id}/gates.txt`, text);
  process.stdout.write(text);
  const bad = failed(gates);
  if (!bad && args.includes('--index') && !id.startsWith('_')) {
    const next = [...index.filter((x) => x.id !== id), { id, hookType: doc.hookType, presets: doc.presets }];
    writeFileSync(INDEX, JSON.stringify(next, null, 1) + '\n');
    console.log(`index: ${id} appended`);
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
