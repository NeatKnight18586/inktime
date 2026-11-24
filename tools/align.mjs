// Align the hand-made voice take to the script. Usage: node tools/align.mjs <episodeDir>
// Local and free: faster-whisper (tools/align.py). Optional voice edit first (voicePauseMax / voiceTempo in episode.json).
// Reruns only when audio/words.json is missing or older than the voice file or script.json.
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { episodeOf, ffmpeg, voiceFile, wantsVoiceEdit, wantsVoiceCut, voiceCutFilter, probeDuration } from './audiolib.mjs';

const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

// ffmpeg filter chain for the optional edit: shorten pauses longer than voicePauseMax (-40 dB), then atempo.
export function voiceEditFilter(ep) {
  const f = [];
  if (ep.voicePauseMax != null) {
    const m = ep.voicePauseMax;
    f.push(`silenceremove=stop_periods=-1:stop_duration=${m}:stop_threshold=-40dB:stop_silence=${m}`);
  }
  if (ep.voiceTempo != null && ep.voiceTempo !== 1) f.push(`atempo=${ep.voiceTempo}`);
  return f.length ? f.join(',') : 'anull';
}

export function align(dir) {
  const ep = existsSync(join(dir, 'episode.json')) ? episodeOf(dir) : {}; // the smoke run has no episode.json yet
  const audio = join(dir, 'audio');
  const mp3 = join(audio, 'voice.mp3');
  if (!existsSync(mp3)) throw new Error('upload audio/voice.mp3');
  const voice = voiceFile(dir, ep);
  // voiceCuts first: remove each span from the take (10 ms crossfades) -> audio/voice_cut.wav; the edit (if any) works on that.
  let src = mp3;
  if (wantsVoiceCut(ep)) {
    src = join(audio, 'voice_cut.wav');
    if (mtime(src) < Math.max(mtime(mp3), mtime(join(dir, 'episode.json')))) {
      ffmpeg(['-i', mp3, '-filter_complex', voiceCutFilter(ep.voiceCuts, probeDuration(mp3)), '-map', '[out]', '-ar', '48000', '-ac', '1', src]);
      console.log(`voice cut: ${src} (${ep.voiceCuts.length} span${ep.voiceCuts.length > 1 ? 's' : ''} removed)`);
    }
  }
  if (wantsVoiceEdit(ep) && mtime(voice) < mtime(src)) {
    ffmpeg(['-i', src, '-af', voiceEditFilter(ep), '-ar', '48000', voice]);
    console.log(`voice edit: ${voice}`);
  }
  const script = join(dir, 'script.json');
  const out = join(audio, 'words.json');
  const hasScript = existsSync(script);
  const target = hasScript ? out : join(audio, 'words.raw.json');
  if (mtime(target) > Math.max(mtime(voice), mtime(script))) {
    console.log(`align: ${target} is up to date`);
    return 0;
  }
  const py = join(dirname(fileURLToPath(import.meta.url)), 'align.py');
  const r = spawnSync('python3', ['-I', py, voice, hasScript ? script : '-', target], { stdio: 'inherit' });
  return r.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: align.mjs <episodeDir>');
    process.exit(2);
  }
  try {
    process.exit(align(dir));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
