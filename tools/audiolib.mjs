// Shared helpers for the audio tools (Phase 4). No state, no randomness except named seeds from tools/rng.mjs.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SR = 48000;
export const LOOP_XFADE = 0.25;

export const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
export const episodeOf = (dir) => readJson(join(dir, 'episode.json'));

// Run ffmpeg; returns its stderr log (filters such as loudnorm and volumedetect print there). Throws with the last lines on failure.
export function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).trim().split('\n').filter((l) => !/^(\s*$|size=|video:|\[out#)/.test(l)).slice(-3).join(' | ')}`);
  return String(r.stderr);
}

export function probeDuration(file) {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
}

// {max, mean} dB via volumedetect.
export function volume(file) {
  const log = ffmpeg(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const g = (k) => parseFloat(new RegExp(`${k}_volume: (-?[\\d.]+|-inf) dB`).exec(log)?.[1] ?? '-91');
  return { max: g('max'), mean: g('mean') };
}

// The voice file the pipeline uses: audio/voice_edit.wav when the episode asks for an edit, else the untouched take.
export function wantsVoiceEdit(ep) {
  return ep.voicePauseMax != null || ep.voiceTempo != null;
}
export function voiceFile(dir, ep = episodeOf(dir)) {
  return wantsVoiceEdit(ep) ? join(dir, 'audio', 'voice_edit.wav') : join(dir, 'audio', 'voice.mp3');
}

// "L3:0+8f" | "L3:0" | 12.5 -> seconds on the timeline. words: the words.json array.
export function resolveTime(t, words, fps = 24) {
  if (typeof t === 'number') return t;
  const m = /^L(\d+):(\d+)(?:([+-]\d+)f)?$/.exec(String(t));
  if (!m) throw new Error(`bad time "${t}"`);
  const w = words.find((x) => x.line === `L${m[1]}` && x.w === Number(m[2]));
  if (!w) throw new Error(`time "${t}": no such word in words.json`);
  return w.start + (m[3] ? Number(m[3]) / fps : 0);
}

export const loadWords = (dir) => readJson(join(dir, 'audio', 'words.json'));
