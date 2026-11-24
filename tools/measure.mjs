// Measure a render against the night look targets.
// Usage: node tools/measure.mjs <mp4|png> [--cams out/cams.json] [--strict] [--focus "x,y;x,y"] [--notan-out file.png] [--skip p5,dark40]
// Downscales to 270 px wide, then prints per shot and overall: luma mean, p5, p95, share of pixels < 40,
// saturation mean, in-frame motion (median share of pixels changing > 25 levels frame to frame),
// still frames (pose delta < 0.02 deg and < 1 mm, from cams.json) and the longest still run.
// Stills (png) also get the notan check: --focus "x,y;x,y" (normalised frame coords) --notan-out <png>.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = {
  lumaMean: [70, 95],
  dark40: [0.06, 0.3],
  p5: [0, 25],
  p95: [170, 255],
  sat: [0.3, 0.5],
  motion: [0.015, 0.06],
  still: [0, 0.1],
  stillRun: [0, 19],
};

// Notan: the frame as 3 values on an 18x32 grid (cell = mean luma). Cuts: dark < 60, light >= 140 (authored, docs/STYLE.md).
// WARN only, never a miss: the dark-mass share (target 20-55%) and whether the brightest cell cluster lies within
// 1 cell of a focus anchor. The brightest cluster = the connected cells (8-neighbour) within 15% of the brightest cell.
export const NOTAN = { cols: 18, rows: 32, cuts: [60, 140], values: [20, 128, 235], dark: [0.2, 0.55], scale: 10 };

export function notanGrid(luma, w, h) {
  const { cols, rows, cuts } = NOTAN;
  const cw = w / cols;
  const ch = h / rows;
  const cells = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++) for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++, n++) sum += luma[y * w + x];
      cells[r * cols + c] = n ? sum / n : 0;
    }
  }
  const cls = Uint8Array.from(cells, (v) => (v < cuts[0] ? 0 : v < cuts[1] ? 1 : 2));
  return { cells, cls };
}

export function notanReport({ cells, cls }, focus = []) {
  const { cols, rows, dark } = NOTAN;
  const n = cells.length;
  const share = [0, 1, 2].map((k) => cls.reduce((a, c) => a + (c === k ? 1 : 0), 0) / n);
  let peak = 0;
  for (let i = 1; i < n; i++) if (cells[i] > cells[peak]) peak = i;
  const floor = cells[peak] * 0.85;
  const seen = new Set([peak]);
  const stack = [peak];
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / cols);
    const c = i % cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        const j = rr * cols + cc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || seen.has(j) || cells[j] < floor) continue;
        seen.add(j);
        stack.push(j);
      }
    }
  }
  const cluster = [...seen].map((i) => [i % cols, Math.floor(i / cols)]);
  const anchors = focus.map(([x, y]) => [Math.min(cols - 1, Math.floor(x * cols)), Math.min(rows - 1, Math.floor(y * rows))]);
  const dist = anchors.length ? Math.min(...anchors.flatMap(([ax, ay]) => cluster.map(([cx, cy]) => Math.max(Math.abs(cx - ax), Math.abs(cy - ay))))) : null;
  const darkOk = share[0] >= dark[0] && share[0] <= dark[1];
  const focusOk = dist === null ? null : dist <= 1;
  const [cx, cy] = cluster.reduce((a, c) => [a[0] + c[0] / cluster.length, a[1] + c[1] / cluster.length], [0, 0]);
  const lines = [
    `notan 18x32 (cuts ${NOTAN.cuts.join('/')}): dark ${(share[0] * 100).toFixed(1)}%  mid ${(share[1] * 100).toFixed(1)}%  light ${(share[2] * 100).toFixed(1)}%   dark-mass target 20-55% ${darkOk ? 'ok' : 'WARN'}`,
    `notan brightest cluster: ${cluster.length} cells, centre cell (${cx.toFixed(1)}, ${cy.toFixed(1)}), peak luma ${cells[peak].toFixed(0)}${focusOk === null ? '' : `; nearest focus anchor ${dist} cells away, target <= 1 ${focusOk ? 'ok' : 'WARN'}`}`,
  ];
  return { share, cluster, dist, darkOk, focusOk, lines };
}

export function notanPixels({ cls }) {
  const { cols, rows, values, scale } = NOTAN;
  const W = cols * scale;
  const out = Buffer.alloc(W * rows * scale);
  for (let y = 0; y < rows * scale; y++) for (let x = 0; x < W; x++) out[y * W + x] = values[cls[Math.floor(y / scale) * cols + Math.floor(x / scale)]];
  return { gray: out, width: W, height: rows * scale };
}

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
    motion: frames.some((f) => f.motion !== null) ? median(frames.filter((f) => f.motion !== null).map((f) => f.motion)) : null,
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
  lumaMean: '70-95', p5: '<=25', p95: '>=170', dark40: '6-30%', sat: '0.30-0.50', motion: '1.5-6%', still: '<=10%', stillRun: '<=19',
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

// skip: targets that do not apply (an insert frame: p5, dark40) are listed as n/a and never missed.
// Shots whose preset is dive or rise are reported but never judged on luma, dark40, p95 and motion.
export const HOOK_PRESETS = ['dive', 'rise'];
export const HOOK_SKIP = ['lumaMean', 'dark40', 'p95', 'motion'];
export function report(label, s, skip = [], note = 'insert') {
  const misses = check(s).filter((k) => !skip.includes(k));
  const lines = [`${label} (${s.frames} frames)`];
  for (const k of Object.keys(TARGETS)) {
    const v = s[k];
    const val = v === null || v === undefined ? 'n/a' : FMT[k](v);
    lines.push(`  ${k.padEnd(9)} ${val.padStart(8)}   target ${TFMT[k].padEnd(9)} ${skip.includes(k) ? `n/a (${note})` : v === null || v === undefined ? '' : misses.includes(k) ? 'MISS' : 'ok'}`);
  }
  return { text: lines.join('\n'), misses };
}

async function main() {
  const args = process.argv.slice(2);
  const valueFlags = ['--cams', '--focus', '--notan-out', '--skip'];
  const mp4 = args.find((x, i) => !x.startsWith('--') && !valueFlags.includes(args[i - 1]));
  const flag = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const camsPath = flag('--cams');
  const focus = (flag('--focus') ?? '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
  const notanOut = flag('--notan-out');
  const skip = (flag('--skip') ?? '').split(',').filter(Boolean);
  const isStillImage = /\.(png|jpe?g)$/i.test(mp4 ?? '');
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
  let lastLuma = null;
  const frames = [];
  const handle = (rgb) => {
    const pose = cams?.[index];
    const shot = pose?.shot ?? 0;
    const st = frameStats(rgb, w, h, prevShot === shot ? prev : null);
    let still = null;
    const before = cams?.[index - 1];
    if (pose && before && (before.shot ?? 0) === shot) still = isStill(before, pose);
    frames.push({ index, shot, hook: HOOK_PRESETS.includes(pose?.preset), mean: st.mean, dark: st.dark, sat: st.sat, motion: st.motion, hist: st.hist, still });
    prev = st.luma;
    lastLuma = st.luma;
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
  // Every shot is checked against the same targets (the aerial hook included), then the whole film.
  const misses = [];
  if (shots.length > 1) {
    for (const s of shots) {
      const sf = frames.filter((f) => f.shot === s);
      const hook = sf.every((f) => f.hook);
      const r = report(`shot ${s}${hook ? ' (dive/rise: reported, not judged)' : ''}`, summarize(sf), hook ? [...skip, ...HOOK_SKIP] : skip, hook ? 'hook' : 'insert');
      out.push(r.text);
      misses.push(...r.misses.map((m) => `shot ${s} ${m}`));
    }
  }
  // The whole film is judged without its dive and rise shots on the four exempt targets.
  const judged = frames.filter((f) => !f.hook);
  const hooks = frames.length - judged.length;
  const all = report(hooks ? 'overall (dive/rise shots excluded from luma, dark40, p95, motion)' : 'overall', summarize(hooks ? judged : frames), skip);
  out.push(all.text);
  misses.push(...all.misses.map((m) => `overall ${m}`));
  if (hooks) out.push(report('overall incl. dive/rise (reported, not judged)', summarize(frames), [...skip, ...HOOK_SKIP], 'hook').text);
  out.push(misses.length ? `MISSES: ${misses.join(', ')}` : 'all targets met');
  if (isStillImage && lastLuma) {
    const grid = notanGrid(lastLuma, w, h);
    out.push(...notanReport(grid, focus).lines);
    if (notanOut) {
      const { gray, width, height } = notanPixels(grid);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-i', '-', '-frames:v', '1', notanOut], { input: gray });
    }
  }
  console.log(out.join('\n'));
  if (strict && misses.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
