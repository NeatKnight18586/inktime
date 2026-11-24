// Measure a render against the night look targets.
// Usage: node tools/measure.mjs <mp4> [--cams out/cams.json] [--strict]
// Downscales to 270 px wide, then prints per shot and overall: luma mean, p5, p95, share of pixels < 40,
// saturation mean, in-frame motion (median share of pixels changing > 25 levels frame to frame),
// still frames (pose delta < 0.02 deg and < 1 mm, from cams.json) and the longest still run.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = {
  lumaMean: [70, 95],
  dark40: [0, 0.3],
  p5: [0, 12],
  p95: [170, 255],
  sat: [0.3, 0.5],
  motion: [0.015, 0.06],
  still: [0, 0.1],
  stillRun: [0, 19],
};

export function frameStats(rgb, w, h, prevLuma = null) {
  const n = w * h;
  const luma = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let sum = 0;
  let dark = 0;
  let sat = 0;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    luma[i] = y;
    hist[y]++;
    sum += y;
    if (y < 40) dark++;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    if (prevLuma && Math.abs(y - prevLuma[i]) > 25) changed++;
  }
  return { luma, hist, mean: sum / n, dark: dark / n, sat: sat / n, motion: prevLuma ? changed / n : null };
}

export function percentile(hist, p) {
  let total = 0;
  for (const c of hist) total += c;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= p * total) return i;
  }
  return 255;
}

export function poseDelta(a, b) {
  const dp = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
  const dot = Math.min(1, Math.abs(a.quat[0] * b.quat[0] + a.quat[1] * b.quat[1] + a.quat[2] * b.quat[2] + a.quat[3] * b.quat[3]));
  const deg = (2 * Math.acos(dot) * 180) / Math.PI;
  return { dp, deg };
}

export function isStill(a, b) {
  const { dp, deg } = poseDelta(a, b);
  return deg < 0.02 && dp < 0.001;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

// frames: [{index, shot, mean, dark, sat, motion, hist, still}]
export function summarize(frames) {
  const hist = new Uint32Array(256);
  for (const f of frames) for (let i = 0; i < 256; i++) hist[i] += f.hist[i];
  const k = frames.length || 1;
  let run = 0;
  let longest = 0;
  let stills = 0;
  let known = 0;
  for (const f of frames) {
    if (f.still === null || f.still === undefined) {
      run = 0;
      continue;
    }
    known++;
    if (f.still) {
      stills++;
      run++;
      longest = Math.max(longest, run);
    } else run = 0;
  }
  return {
    frames: frames.length,
    lumaMean: frames.reduce((s, f) => s + f.mean, 0) / k,
    p5: percentile(hist, 0.05),
    p95: percentile(hist, 0.95),
    dark40: frames.reduce((s, f) => s + f.dark, 0) / k,
    sat: frames.reduce((s, f) => s + f.sat, 0) / k,
    motion: median(frames.filter((f) => f.motion !== null).map((f) => f.motion)),
    still: known ? stills / known : null,
    stillRun: known ? longest : null,
  };
}

const FMT = {
  lumaMean: (v) => v.toFixed(1),
  p5: (v) => String(v),
  p95: (v) => String(v),
  dark40: (v) => (v * 100).toFixed(1) + '%',
  sat: (v) => v.toFixed(3),
  motion: (v) => (v * 100).toFixed(2) + '%',
  still: (v) => (v * 100).toFixed(1) + '%',
  stillRun: (v) => String(v),
};
const TFMT = {
  lumaMean: '70-95', p5: '<=12', p95: '>=170', dark40: '<=30%', sat: '0.30-0.50', motion: '1.5-6%', still: '<=10%', stillRun: '<=19',
};

export function check(summary) {
  const misses = [];
  for (const [k, [lo, hi]] of Object.entries(TARGETS)) {
    const v = summary[k];
    if (v === null || v === undefined) continue;
    if (v < lo || v > hi) misses.push(k);
  }
  return misses;
}

export function report(label, s) {
  const misses = check(s);
  const lines = [`${label} (${s.frames} frames)`];
  for (const k of Object.keys(TARGETS)) {
    const v = s[k];
    const val = v === null || v === undefined ? 'n/a' : FMT[k](v);
    lines.push(`  ${k.padEnd(9)} ${val.padStart(8)}   target ${TFMT[k].padEnd(9)} ${v === null || v === undefined ? '' : misses.includes(k) ? 'MISS' : 'ok'}`);
  }
  return { text: lines.join('\n'), misses };
}

async function main() {
  const args = process.argv.slice(2);
  const mp4 = args.find((x) => !x.startsWith('--') && args[args.indexOf(x) - 1] !== '--cams');
  const camsPath = args.includes('--cams') ? args[args.indexOf('--cams') + 1] : null;
  const strict = args.includes('--strict');
  if (!mp4) {
    console.error('usage: measure.mjs <mp4> [--cams out/cams.json] [--strict]');
    process.exit(2);
  }
  const [sw, sh] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4], { encoding: 'utf8' })
    .trim()
    .split(',')
    .map(Number);
  const w = 270;
  const h = Math.round((sh * w) / sw / 2) * 2;
  const cams = camsPath && existsSync(camsPath) ? JSON.parse(readFileSync(camsPath, 'utf8')).frames : null;
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const size = w * h * 3;
  let buf = Buffer.alloc(0);
  let prev = null;
  let prevShot = null;
  let index = 0;
  const frames = [];
  const handle = (rgb) => {
    const pose = cams?.[index];
    const shot = pose?.shot ?? 0;
    const st = frameStats(rgb, w, h, prevShot === shot ? prev : null);
    let still = null;
    const before = cams?.[index - 1];
    if (pose && before && (before.shot ?? 0) === shot) still = isStill(before, pose);
    frames.push({ index, shot, mean: st.mean, dark: st.dark, sat: st.sat, motion: st.motion, hist: st.hist, still });
    prev = st.luma;
    prevShot = shot;
    index++;
  };
  for await (const chunk of ff.stdout) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= size) {
      handle(buf.subarray(0, size));
      buf = buf.subarray(size);
    }
  }
  const shots = [...new Set(frames.map((f) => f.shot))].sort((a, b) => a - b);
  const out = [`measure ${mp4}: ${frames.length} frames at ${w}x${h}${cams ? '' : ' (no cams.json: still frames n/a)'}`];
  let misses = [];
  if (shots.length > 1) {
    for (const s of shots) out.push(report(`shot ${s}`, summarize(frames.filter((f) => f.shot === s))).text);
  }
  const all = report('overall', summarize(frames));
  out.push(all.text);
  misses = all.misses;
  out.push(misses.length ? `MISSES (overall): ${misses.join(', ')}` : 'all overall targets met');
  console.log(out.join('\n'));
  if (strict && misses.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
