// Storyboard stills. Usage: node tools/storyboard.mjs <episodeDir> [--out out/storyboard] [--only b01,b05]
// episodes/<id>/storyboard.json: one entry per beat { id, at: "L2: binoculars", set, look, camera, subject, verb, captionKey, ... }.
// Each beat renders ONE still at that word's time (words.json), as its own one-shot scene (tools/render-frames.mjs), with the
// caption card of that word burned in (tools/captions.mjs, Anton from assets/fonts). Then contact.jpg: all beats in reading
// order, 7 x 3, each tile with its caption line under it. Plus urls.txt and render.json (published by the CI stills job).
// Optional beat fields: frame (render frame: a number or a time like "L9:7+50f"; default the word's frame), episodeShots (render
// the episode's own shots, e.g. ["S9", "S9b"]), cards [{cast, anchor | slot, pose, facing | facingCam, light, slotScale}],
// hands, show, light, sea, sprites, sfx [{word, at (frames from the still), anchor, size, lift}], jump {at, stamp, dest, back},
// breathPhase (frames from the still).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEpisode, compile, frameOf } from './timeline.mjs';
import { splitCards, assFile } from './captions.mjs';
import { isSlot } from '../engine/rig/slots.mjs';

const bare = (s) => String(s).toLowerCase().replace(/[^a-z0-9£]/g, '');
// "L2: binoculars" -> the first word of line L2 that reads "binoculars" (case and punctuation ignored).
export function findWord(at, words) {
  const m = /^\s*(L\d+)\s*:\s*(.+?)\s*$/.exec(at);
  if (!m) throw new Error(`storyboard: bad at "${at}" (use "L2: word")`);
  const w = words.find((x) => String(x.line) === m[1] && bare(x.word) === bare(m[2]));
  if (!w) throw new Error(`storyboard: "${at}": no such word in words.json`);
  return w;
}

// One beat -> a scene spec (the legacy scene format tools/bake.mjs reads) and its render frame.
export function beatSpec(beat, { ep, words, compiled }) {
  const fps = ep.fps ?? 24;
  const word = findWord(beat.at, words);
  const wordFrame = Math.round(word.start * fps);
  const N = beat.frame === undefined ? wordFrame : typeof beat.frame === 'number' ? beat.frame : frameOf(beat.frame, words, fps);
  const extra = (s) => ({ ...(beat.hands ? { hands: beat.hands } : {}), ...(beat.show ? { show: beat.show } : {}), ...(beat.sprites ? { sprites: beat.sprites } : {}), ...(beat.light ? { light: beat.light } : {}), ...(beat.sea ? { sea: beat.sea } : {}), ...s });
  let shots;
  if (beat.episodeShots) {
    const list = beat.episodeShots.map((id) => {
      const s = compiled.shots.find((x) => x.id === id);
      if (!s) throw new Error(`storyboard ${beat.id}: no shot ${id}`);
      return s;
    });
    const start = list[0].start;
    shots = [];
    if (start > 0) shots.push({ frames: start, camera: { anchor: 'cam_lookout', preset: 'held' } });
    for (const s of list) shots.push(extra({ frames: s.frames, camera: s.camera, show: beat.show ?? s.show, light: beat.light ?? s.light, ...(s.sea ? { sea: s.sea } : {}) }));
    const total = shots.reduce((a, s) => a + s.frames, 0);
    if (N >= total) shots[shots.length - 1].frames += N - total + 1;
  } else {
    // The beat's shot starts LEAD frames before the still (so the FOV push and any head turn are where a real shot has them).
    const LEAD = 24;
    shots = N > LEAD ? [{ frames: N - LEAD, camera: beat.camera }, extra({ frames: LEAD + 1, camera: beat.camera })] : [extra({ frames: N + 1, camera: beat.camera })];
  }
  const cards = (beat.cards ?? []).map((c) => {
    if (c.cast === 'guide') return { cast: 'guide', anchor: 'guide_spot', anchors: [{ at: 0, anchor: c.slot ?? 'cam_right' }], pose: c.pose ?? 'idle', blink: true, ...(c.slotScale ? { slotScale: c.slotScale } : {}), ...(c.pop !== undefined ? { pop: N + c.pop } : {}) };
    return { cast: c.cast, anchor: c.anchor, pose: c.pose ?? 'idle', blink: true, ...(c.light ? { light: c.light } : {}), ...(c.facing !== undefined ? { facing: c.facing } : {}), ...(c.facingCam !== undefined ? { facingCam: c.facingCam } : {}) };
  });
  for (const c of cards) if (c.cast === 'guide' && !isSlot(c.anchors[0].anchor)) throw new Error(`storyboard ${beat.id}: guide slot "${c.anchors[0].anchor}"`);
  // The sea state: the beat's own, else the episode's (only on the episode's own set).
  const sea = beat.sea ?? ((beat.set ?? ep.set) === ep.set ? ep.sea : undefined);
  const spec = {
    name: beat.id,
    fps,
    seed: ep.seed ?? ep.id,
    look: beat.look ?? ep.look,
    set: beat.set ?? ep.set,
    ...(sea ? { sea } : {}),
    shots,
    cards,
    ...(compiled.countdown ? { countdown: compiled.countdown } : {}),
    sfx: (beat.sfx ?? []).map((s) => ({ word: s.word, at: N + (s.at ?? 0), anchor: s.anchor, ...(s.size ? { size: s.size } : {}), ...(s.lift ? { lift: s.lift } : {}) })),
    transitions: beat.jump ? [{ type: beat.jump.back ? 'jump_back' : 'jump', at: N + beat.jump.at, ...(beat.jump.stamp ? { stamp: beat.jump.stamp } : {}), ...(beat.jump.dest ? { dest: beat.jump.dest } : {}) }] : [],
    ...(beat.breathPhase !== undefined ? { breathPhase: N + beat.breathPhase } : {}),
  };
  return { spec, frame: N, word };
}

// The caption card that shows the beat's word (its own card, with the episode's key words).
export function beatCaption(word, words, keys) {
  const cards = splitCards(words, { keys });
  const i = words.indexOf(word);
  let k = 0;
  for (let j = 0, at = 0; j < cards.length; j++) {
    if (i < at + cards[j].words) {
      k = j;
      break;
    }
    at += cards[j].words;
  }
  return cards[k];
}

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ')}`);
  return r.stdout;
};

async function main() {
  const argv = process.argv.slice(2);
  const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const dir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const out = flag('--out', 'out/storyboard');
  const only = flag('--only', null)?.split(',');
  const { ep, words, script } = loadEpisode(dir);
  const compiled = compile(ep, { words, script });
  const board = JSON.parse(readFileSync(join(dir, 'storyboard.json'), 'utf8'));
  const font = 'assets/fonts';
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'spec'), { recursive: true });
  const done = [];
  for (const beat of board.beats) {
    if (only && !only.includes(beat.id)) continue;
    const { spec, frame, word } = beatSpec(beat, { ep, words, compiled });
    const specPath = join(out, 'spec', `${beat.id}.json`);
    writeFileSync(specPath, JSON.stringify(spec, null, 1));
    const raw = join(out, 'raw', beat.id);
    console.log(`${beat.id} (${beat.at}, frame ${frame}): ${beat.subject} ${beat.verb}`);
    console.log(run('node', ['tools/render-frames.mjs', '--scene', specPath, '--frames', String(frame), '--out', raw, '--cams', join(raw, 'cams.json')]).trim().split('\n').pop());
    const png = join(raw, `${String(frame).padStart(5, '0')}.png`);
    if (!existsSync(png)) throw new Error(`${beat.id}: no frame written`);
    // Caption burned in: the beat's word card, popped (rendered 0.3 s into a one-card subtitle file).
    const cap = beatCaption(word, words, ep.captionKeys ?? []);
    const ass = join(out, 'spec', `${beat.id}.ass`);
    writeFileSync(ass, assFile([{ ...cap, start: 0, end: 5 }], ep.fps ?? 24));
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', png, '-vf', `ass=${ass}:fontsdir=${font}`, '-ss', '0.3', '-frames:v', '1', join(out, `${beat.id}.png`)]);
    done.push({ id: beat.id, caption: cap.text, at: beat.at, frame, subject: beat.subject, verb: beat.verb, captionKey: beat.captionKey ?? null });
  }
  rmSync(join(out, 'raw'), { recursive: true, force: true });
  // Contact sheet in reading order: 7 x 3 tiles of 270 x 480, each with its caption line on an ink strip below.
  const TW = 270;
  const TH = 480;
  const BAR = 60;
  const inputs = done.flatMap((d) => ['-i', join(out, `${d.id}.png`)]);
  const chains = done.map((d, i) => {
    const tf = join(out, 'spec', `${d.id}.label.txt`);
    writeFileSync(tf, `${d.id}  ${d.caption}`.slice(0, 30));
    return `[${i}:v]scale=${TW}:${TH}:flags=area,pad=${TW}:${TH + BAR}:0:0:color=0x141414,drawtext=fontfile=${font}/Anton-Regular.ttf:textfile=${tf}:fontsize=22:fontcolor=0xF4EFE6:x=(w-text_w)/2:y=${TH + 16}[t${i}]`;
  });
  const cols = 7;
  const layout = done.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * (TH + BAR)}`).join('|');
  const fill = done.length < cols * 3 ? `:fill=0x141414` : '';
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${chains.join(';')};${done.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${done.length}:layout=${layout}${fill}`, '-frames:v', '1', '-q:v', '3', join(out, 'contact.jpg')]);
  const repo = process.env.GITHUB_REPOSITORY ?? 'NeatKnight18586/inktime';
  const name = `${ep.id}-storyboard`;
  const url = (f) => `https://github.com/${repo}/raw/renders/renders/${name}/${f}`;
  writeFileSync(join(out, 'urls.txt'), [...done.map((d) => `${d.id} ${url(`${d.id}.png`)}`), `contact ${url('contact.jpg')}`].join('\n') + '\n');
  writeFileSync(join(out, 'beats.json'), JSON.stringify(done, null, 1));
  writeFileSync(join(out, 'render.json'), JSON.stringify({ status: 'stills', commit: process.env.GITHUB_SHA ?? 'local', name, beats: done.length, contact_url: url('contact.jpg') }, null, 2) + '\n');
  console.log(`storyboard: ${done.length} stills -> ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (e) {
    console.error(`storyboard: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
}
