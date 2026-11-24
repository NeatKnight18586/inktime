// Final mix. Usage: node tools/mix.mjs <episodeDir> [--duration <seconds>]   -> out/mix.wav (48 kHz stereo, -14 LUFS, -1 dBTP)
// Beds loop under the whole episode; voice is one track at the timeline offset; sfx at shots[].sfx cues;
// music.mp3 (optional) hits on the money-shot start, ends on a bar line and ducks 9 dB under the voice.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SR, LOOP_XFADE as X, ffmpeg, episodeOf, loadWords, probeDuration, resolveTime, volume, voiceFile } from './audiolib.mjs';

export const LEVELS = { voice: 0, sfx: -6, bed: -22, music: -14 }; // dB before loudnorm
export const DUCK_DB = 9;

// Where the music sits on the timeline. Bar lines count from the start of music.mp3 (4/4 at bpm); the cut is the last bar line
// at or before the end of the timeline or of the file. hit: seconds into music.mp3 of its big hit, landing on moneyStart.
export function musicTrim({ musicDuration, hit = 0, moneyStart, timelineEnd, bpm }) {
  const bar = (4 * 60) / bpm;
  const delay = Math.max(0, moneyStart - hit); // timeline seconds before the music starts
  const start = Math.max(0, hit - moneyStart); // seconds trimmed off the music head
  const reach = Math.min(musicDuration, hit + (timelineEnd - moneyStart));
  const end = Math.floor((reach + 1e-6) / bar) * bar;
  return { bar, delay, start, end, duration: end - start };
}

// sidechaincompress threshold (linear) that ducks speech by about DUCK_DB: ratio 20 gives (1 - 1/20) of the overshoot,
// and short-term speech peaks sit ~4 dB above the mean level.
export function duckThreshold(voiceMeanDb) {
  const over = DUCK_DB / (1 - 1 / 20);
  return Math.min(1, Math.max(0.00098, 10 ** ((voiceMeanDb + 4 - over) / 20)));
}

export function cues(ep, words) {
  const out = [];
  for (const shot of ep.shots ?? []) {
    for (const [t, name] of shot.sfx ?? []) out.push({ t: Math.max(0, resolveTime(t, words, ep.fps ?? 24)), name });
  }
  return out;
}

const q = (v) => +v.toFixed(4);
const db = (v) => `volume=${v}dB`;

export function buildGraph({ lead, T, beds, sfxCues, music }) {
  const g = [];
  const labels = ['[v]'];
  const stereo = `aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo`;
  // voice: one track; the timeline starts `lead` seconds into the take (a negative lead pads silence)
  const trim = lead > 0 ? `atrim=start=${q(lead)},asetpts=PTS-STARTPTS` : lead < 0 ? `adelay=${Math.round(-lead * SR)}S:all=1` : 'anull';
  g.push(`[0:a]aresample=${SR},${trim},${stereo},${db(LEVELS.voice)},asplit=2[v][vkey]`);
  let idx = 1;
  beds.forEach((b, i) => {
    const P = Math.round((b.duration - X) * SR); // loop period: the last 0.25 s equals the first 0.25 s
    g.push(`[${idx}:a]aresample=${SR},atrim=0:${q(b.duration - X)},asetpts=PTS-STARTPTS,aloop=loop=-1:size=${P},atrim=0:${q(T)},asetpts=PTS-STARTPTS,${stereo},${db(LEVELS.bed)}[bed${i}]`);
    labels.push(`[bed${i}]`);
    idx++;
  });
  sfxCues.forEach((c, i) => {
    g.push(`[${idx}:a]aresample=${SR},${stereo},${db(LEVELS.sfx)},adelay=${Math.round(c.t * SR)}S:all=1[sx${i}]`);
    labels.push(`[sx${i}]`);
    idx++;
  });
  if (music) {
    g.push(`[${idx}:a]aresample=${SR},atrim=${q(music.start)}:${q(music.start + music.duration)},asetpts=PTS-STARTPTS,afade=t=out:st=${q(music.duration - 0.03)}:d=0.03,${stereo},${db(LEVELS.music)},adelay=${Math.round(music.delay * SR)}S:all=1[mus]`);
    g.push(`[mus][vkey]sidechaincompress=threshold=${music.threshold.toExponential(4)}:ratio=20:attack=20:release=400:makeup=1[duck]`);
    labels.push('[duck]');
  } else {
    g.push('[vkey]anullsink');
  }
  g.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0,atrim=0:${q(T)},asetpts=PTS-STARTPTS[pre]`);
  return g;
}

const parseLoudnorm = (log) => JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));

export function mix(dir, { duration } = {}) {
  const ep = episodeOf(dir);
  const { meta, words } = loadWords(dir);
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const voice = voiceFile(dir, ep);
  const voiceEnd = words.length ? words[words.length - 1].end : 0;
  const T = duration ?? voiceEnd + 1.0;
  const inputs = ['-i', voice];

  const sfxFile = (name) => {
    const f = join(out, 'sfx', `${name}.wav`);
    if (!existsSync(f)) throw new Error(`missing out/sfx/${name}.wav (run tools/sfx.mjs first)`);
    return f;
  };
  const beds = (ep.beds ?? []).map((name) => {
    const f = sfxFile(name);
    inputs.push('-i', f);
    return { name, duration: probeDuration(f) };
  });
  const sfxCues = cues(ep, words);
  for (const c of sfxCues) inputs.push('-i', sfxFile(c.name));

  let music = null;
  const musicPath = join(dir, 'audio', 'music.mp3');
  if (existsSync(musicPath)) {
    const shot = (ep.shots ?? []).find((s) => s.id === ep.moneyShot?.shot);
    if (!shot) throw new Error('music.mp3 needs moneyShot.shot in episode.json');
    if (ep.musicHit == null) console.warn('WARN: episode.json has no musicHit (seconds into music.mp3); using 0');
    const moneyStart = resolveTime(shot.start, words, ep.fps ?? 24);
    music = musicTrim({ musicDuration: probeDuration(musicPath), hit: ep.musicHit ?? 0, moneyStart, timelineEnd: T, bpm: ep.musicBpm });
    music.threshold = duckThreshold(volume(voice).mean);
    inputs.push('-i', musicPath);
  } else {
    console.warn('WARN: audio/music.mp3 missing; mixing without music');
  }

  const graph = buildGraph({ lead: meta.lead, T, beds, sfxCues, music });
  // loudnorm runs with headroom (TP -0.1) so it can stay linear; the limiter then holds -1 dBTP (0.85 leaves room for inter-sample peaks).
  const norm = (extra = '') => `[pre]loudnorm=I=-14:TP=-0.1:LRA=50${extra}`;
  const pass1 = ffmpeg([...inputs, '-filter_complex', [...graph, `${norm(':print_format=json')}[n]`].join(';'), '-map', '[n]', '-f', 'null', '-']);
  const m = parseLoudnorm(pass1);
  const extra = `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const file = join(out, 'mix.wav');
  ffmpeg([...inputs, '-filter_complex', [...graph, `${norm(extra)},aresample=${SR},alimiter=limit=0.85:level=0:attack=1:release=50,atrim=0:${q(T)}[n]`].join(';'), '-map', '[n]', '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', file]);
  console.log(`mix: ${file} ${T.toFixed(2)} s${music ? `, music ends on bar at ${music.end.toFixed(2)} s` : ''}`);
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, flag, val] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: mix.mjs <episodeDir> [--duration <seconds>]');
    process.exit(2);
  }
  try {
    mix(dir, { duration: flag === '--duration' ? Number(val) : undefined });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
