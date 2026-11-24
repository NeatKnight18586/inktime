// Render plan. Usage: node tools/plan.mjs <scene.json | episodes/<id>[/episode.json]> [shards]
// Prints name, frames and a matrix of {index,start,end} (end exclusive) as GitHub outputs.
import { readFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec } from './timeline.mjs';
import { resolve } from 'node:path';

export function resolveTarget(target) {
  let file = target;
  if (existsSync(target) && statSync(target).isDirectory()) file = join(target, 'episode.json');
  const isEpisode = basename(file) === 'episode.json';
  const name = isEpisode ? basename(dirname(file)) : basename(file).replace(/\.json$/, '');
  return { file, name };
}

export function frameCount(spec) {
  if (Array.isArray(spec.shots)) return spec.shots.reduce((n, s) => n + s.frames, 0);
  if (Number.isInteger(spec.frames)) return spec.frames;
  if (spec.duration) return Math.round(spec.duration * (spec.fps ?? 24));
  throw new Error('no frame count');
}

export function shardRanges(frames, shards) {
  const n = Math.max(1, Math.min(shards, frames));
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor((frames * i) / n);
    const end = Math.floor((frames * (i + 1)) / n);
    out.push({ index: i, start, end });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target = 'episodes/_looktest', shards = '8'] = process.argv.slice(2);
  let { file, name } = resolveTarget(target);
  let frames;
  if (basename(file) === 'episode.json') {
    // Episode targets render the baked plan (tools/bake.mjs writes it to <dir>/out/plan.json).
    frames = frameCount(loadSpec(dirname(file)));
    file = join(dirname(file), 'out', 'plan.json');
  } else frames = frameCount(JSON.parse(readFileSync(file, 'utf8')));
  const matrix = shardRanges(frames, Number(shards));
  const lines = [`name=${name}`, `scene=${file}`, `frames=${frames}`, `matrix=${JSON.stringify(matrix)}`];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
