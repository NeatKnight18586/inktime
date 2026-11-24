// Sound effects and beds. Usage: node tools/sfx.mjs <episodeDir>   -> <episodeDir>/out/sfx/<name>.wav
// Uploaded audio/sfx/<name>.mp3|.wav wins; otherwise a synthetic recipe (ffmpeg lavfi only) fills in and prints "synthetic: <name>".
// Loops (beds) are crossfaded so the last 0.25 s equals the first 0.25 s. Deterministic: seeds come from tools/rng.mjs.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, hashSeed } from './rng.mjs';
import { SR, LOOP_XFADE as X, ffmpeg, episodeOf } from './audiolib.mjs';

const n = (v) => +v.toFixed(5);
const aeval = (expr, D) => `aevalsrc='${expr}':s=${SR}:d=${n(D)}`;
const noise = (color, D, seed, amp = 0.8) => `anoisesrc=color=${color}:d=${n(D)}:r=${SR}:a=${amp}:seed=${seed}`;
// A frequency snapped to a whole number of cycles per loop period, so tonal beds join without a seam.
const snap = (f, P) => (P ? Math.max(1, Math.round(f * P)) / P : f);

// Loop join, exact: the last X seconds equal the first X seconds, each an equal-power crossfade of the file's tail into its head.
// Played with period (length - X) the loop is seamless.
export function loopJoin(buf) {
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
  const xn = Math.round(X * SR);
  const L = x.length;
  for (let s = 0; s < xn; s++) {
    const w = Math.sin((Math.PI / 2) * (s / xn));
    const b = x[s] * w + x[L - xn + s] * Math.cos((Math.PI / 2) * (s / xn));
    x[s] = b;
    x[L - xn + s] = b;
  }
  return x;
}

export function writeWav(file, f32) {
  const data = Buffer.alloc(f32.length * 2);
  f32.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

// Noise swept through a bandpass from f0 to f1 over D: N bands with triangular time windows (sample-accurate envelopes).
function sweep(tag, D, f0, f1, seed, amp = 0.8, N = 14) {
  const g = [`${noise('white', D, seed, amp)},asplit=${N}${Array.from({ length: N }, (_, i) => `[${tag}n${i}]`).join('')}`];
  const dt = D / (N - 1);
  for (let i = 0; i < N; i++) {
    const f = f0 * Math.pow(f1 / f0, i / (N - 1));
    g.push(`[${tag}n${i}]bandpass=f=${n(f)}:t=o:w=1.5[${tag}b${i}]`);
    g.push(`${aeval(`max(0,1-abs(t-${n(i * dt)})/${n(dt)})`, D)}[${tag}e${i}]`);
    g.push(`[${tag}b${i}][${tag}e${i}]amultiply[${tag}m${i}]`);
  }
  g.push(`${Array.from({ length: N }, (_, i) => `[${tag}m${i}]`).join('')}amix=inputs=${N}:normalize=0[${tag}]`);
  return g;
}

// noise x sample-accurate envelope
const shaped = (tag, noiseChain, envExpr, D) => [`${noiseChain}[${tag}n]`, `${aeval(envExpr, D)}[${tag}e]`, `[${tag}n][${tag}e]amultiply[${tag}]`];

// Recipes by name keyword. Each returns filter chains ending in [o]. ctx: {D, P (loop period or 0), seed, r (rng), name}
export const RECIPES = [
  ['wind', ({ D, P, seed }) => [
    `${noise('pink', D, seed, 0.9)},bandpass=f=600:t=o:w=2[wn]`,
    `${aeval(`0.65+0.35*sin(2*PI*${snap(0.1, P)}*t)`, D)}[we]`,
    '[wn][we]amultiply,volume=2.2[o]',
  ]],
  ['engine', (c) => hum(c)],
  ['hum', (c) => hum(c)],
  ['sea', ({ D, P, seed }) => [
    `${noise('brown', D, seed, 0.95)},lowpass=f=600[sn]`,
    `${aeval(`0.6+0.4*sin(2*PI*${snap(0.125, P)}*t)`, D)}[se]`,
    '[sn][se]amultiply,volume=2.5[o]',
  ]],
  ['whoosh', ({ D, name, seed }) => {
    const down = /dive|fall|down|drop/.test(name); // rise_whoosh rises 200 -> 3000 Hz; the dive/fall variants are its reverse
    return [...sweep('w', D, down ? 3000 : 200, down ? 200 : 3000, seed), `[w]volume=2.5,afade=t=in:d=${n(D * 0.3)},afade=t=out:st=${n(D * 0.7)}:d=${n(D * 0.3)}[o]`];
  }],
  ['thump', ({ D, seed }) => [
    `${aeval('0.7*sin(2*PI*60*t)*exp(-t*30)', D)}[ta]`,
    `${noise('white', D, seed, 0.9)},highpass=f=800[tn]`,
    `${aeval('0.5*exp(-t*400)', D)}[te]`,
    '[tn][te]amultiply[tb]',
    '[ta][tb]amix=inputs=2:normalize=0[o]',
  ]],
  ['cloth', ({ D, seed, r }) => {
    const bursts = Math.max(2, Math.ceil(D * 4));
    const env = Array.from({ length: bursts }, (_, i) => `${n(0.4 + 0.6 * r())}*exp(-pow(t-${n(((i + 0.2 + 0.6 * r()) * D) / bursts)},2)/0.0032)`).join('+');
    return [...shaped('c', `${noise('white', D, seed, 0.9)},highpass=f=400,lowpass=f=3000`, env, D), '[c]volume=2[o]'];
  }],
  ['slap', ({ D, seed }) => [...shaped('s', `${noise('white', D, seed, 0.95)},highpass=f=1000`, 'if(lt(t,0.03),exp(-t*100),0)', D), '[s]volume=1.5[o]']],
  ['bell', ({ D }) => {
    const parts = [[1, 0.5, 3.07], [2.76, 0.3, 4.9], [5.4, 0.15, 7.4]];
    const strikes = [0, 0.45, 0.9];
    const expr = strikes.flatMap((s) => parts.map(([k, a, d]) => `if(gte(t,${s}),${a}*exp(-(t-${s})*${d})*sin(2*PI*${n(880 * k)}*(t-${s})),0)`)).join('+');
    return [`${aeval(expr, D)},volume=0.6[o]`];
  }],
  ['phone', (c) => crank(c)],
  ['crank', (c) => crank(c)],
  ['lock', (c) => rattle(c)],
  ['rattle', (c) => rattle(c)],
  ['creak', (c) => creak(c)],
  ['ice', (c) => scrape(c)],
  ['scrape', (c) => scrape(c)],
];

// Wood creak: bandpassed friction noise (200-800 Hz) plus a tone with a slow 0.5-1.5 Hz pitch wobble,
// gated into 2-3 stick-slip bursts over 0.8 s (sudden slip, then decay).
function creak({ D, seed, r }) {
  const wob = n(0.5 + r()); // wobble rate, Hz
  const count = r() < 0.5 ? 2 : 3;
  const span = Math.min(0.8, D);
  const burst = Array.from({ length: count }, (_, i) => {
    const t = n((i * span) / count + 0.04 * r());
    return `if(gte(t,${t}),exp(-(t-${t})*${n(7 + 5 * r())})*${n(0.6 + 0.4 * r())},0)`;
  }).join('+');
  return [
    `${noise('white', D, seed, 0.9)},bandpass=f=400:t=o:w=2[kn]`,
    `${aeval(`(${burst})`, D)},asplit=2[ke1][ke2]`,
    '[kn][ke1]amultiply,volume=3[kf]',
    // pitch wobble: instantaneous frequency 320 Hz +/- 60 Hz at the wobble rate
    `${aeval(`0.35*sin(2*PI*320*t+60/${wob}*sin(2*PI*${wob}*t))`, D)}[kt]`,
    '[kt][ke2]amultiply[kg]',
    '[kf][kg]amix=inputs=2:normalize=0[o]',
  ];
}
// Fallback for a name with no recipe: a soft generic thud.
function thud({ D, seed }) {
  return [
    `${aeval('0.5*sin(2*PI*90*t)*exp(-t*18)', D)}[da]`,
    `${noise('brown', D, seed, 0.5)},lowpass=f=300[dn]`,
    `${aeval('0.3*exp(-t*60)', D)}[de]`,
    '[dn][de]amultiply[db]',
    '[da][db]amix=inputs=2:normalize=0[o]',
  ];
}

function hum({ D, P, seed }) {
  const f = snap(50, P);
  return [
    `${aeval(`0.5*sin(2*PI*${f}*t)+0.3*sin(2*PI*${2 * f}*t)`, D)}[ha]`,
    `${noise('brown', D, seed, 0.6)},lowpass=f=200[hb]`,
    '[ha][hb]amix=inputs=2:normalize=0[o]',
  ];
}
function crank({ D }) {
  const ratchet = 'if(lt(t,0.8),0.8*exp(-mod(t,1/18)*500)*sin(2*PI*1800*t),0)';
  const ring = 'if(between(t,0.9,1.05),sin(2*PI*880*t),if(between(t,1.05,1.2),sin(2*PI*660*t),if(between(t,1.2,1.35),sin(2*PI*880*t),if(between(t,1.35,1.5),sin(2*PI*660*t),0))))*0.4*exp(-mod(t-0.9,0.15)*6)';
  return [`${aeval(`${ratchet}+${ring}`, D)}[o]`];
}
function rattle({ D, seed, r }) {
  const ts = [];
  for (let t = 0.02; t < D - 0.02; t += 1 / (8 + 6 * r())) ts.push(n(t)); // random 8-14 Hz
  const env = ts.map((t) => `if(gte(t,${t}),exp(-(t-${t})*500),0)`).join('+');
  return [...shaped('l', `${noise('white', D, seed, 0.9)},bandpass=f=3162:t=o:w=1.3`, env, D), '[l]volume=2[o]'];
}
function scrape({ D, seed }) {
  return [
    `${noise('brown', D, seed, 0.9)},lowpass=f=300[ia]`,
    ...sweep('g', D, 6000, 2000, seed + 1, 0.5),
    '[ia][g]amix=inputs=2:normalize=0,volume=2[o]',
  ];
}

export const recipeFor = (name) => RECIPES.find(([k]) => name.toLowerCase().includes(k))?.[1];

// Synthesize one entry to <outFile>. Returns nothing; throws when the name has no recipe.
export function synth({ name, seconds = 1.5, loop = false }, outFile, epId = 'ep') {
  let make = recipeFor(name);
  if (!make) {
    console.warn(`WARN: no recipe for "${name}" and no audio/sfx/${name}.mp3|wav; using a soft generic thud`);
    make = thud;
  }
  const D = loop ? Math.max(seconds, 2 * X + 0.5) : seconds;
  const seed = hashSeed(`${epId}:${name}`) & 0x7fffffff;
  const g = make({ D, P: loop ? D - X : 0, seed, r: rng(seed), name });
  const fade = loop ? '' : `,afade=t=in:d=0.003,afade=t=out:st=${n(Math.max(0, D - 0.01))}:d=0.01`;
  const graph = [...g.slice(0, -1), g[g.length - 1].replace(/\[o\]$/, '[pre]'), `[pre]alimiter=limit=0.9:level=0,apad=whole_dur=${n(D)},atrim=0:${n(D)}${fade}[final]`].join(';');
  const args = ['-filter_complex', graph, '-map', '[final]', '-ar', String(SR), '-ac', '1'];
  if (!loop) return ffmpeg([...args, '-c:a', 'pcm_s16le', outFile]);
  ffmpeg([...args, '-f', 'f32le', outFile + '.raw']);
  const x = loopJoin(readFileSync(outFile + '.raw'));
  rmSync(outFile + '.raw');
  writeWav(outFile, x);
}

// Convert an uploaded file to out/sfx/<name>.wav, crossfading loops.
function fromUpload(src, outFile, loop) {
  if (!loop) return ffmpeg(['-i', src, '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', outFile]);
  ffmpeg(['-i', src, '-ar', String(SR), '-ac', '1', '-f', 'f32le', outFile + '.raw']);
  const x = loopJoin(readFileSync(outFile + '.raw'));
  rmSync(outFile + '.raw');
  writeWav(outFile, x);
}

export function entries(ep) {
  const lib = [...(ep.sfxLibrary ?? [])];
  for (const b of ep.beds ?? []) if (!lib.some((e) => e.name === b)) lib.push({ name: b, seconds: 16, loop: true });
  return lib.map((e) => (ep.beds ?? []).includes(e.name) ? { ...e, loop: true } : e);
}

export function sfx(dir) {
  if (!existsSync(join(dir, 'episode.json'))) {
    console.log('sfx: no episode.json yet, nothing to make');
    return 0;
  }
  const ep = episodeOf(dir);
  const out = join(dir, 'out', 'sfx');
  mkdirSync(out, { recursive: true });
  let failed = 0;
  for (const e of entries(ep)) {
    const file = join(out, `${e.name}.wav`);
    try {
      const up = ['mp3', 'wav'].map((x) => join(dir, 'audio', 'sfx', `${e.name}.${x}`)).find(existsSync);
      if (up) {
        fromUpload(up, file, !!e.loop);
        console.log(`uploaded: ${e.name}`);
      } else {
        synth(e, file, ep.id);
        console.log(`synthetic: ${e.name}`);
      }
    } catch (err) {
      failed++;
      console.error(`sfx ${e.name}: ${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: sfx.mjs <episodeDir>');
    process.exit(2);
  }
  process.exit(sfx(process.argv[2]));
}

