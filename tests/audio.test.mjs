// Phase 4 audio tests. Synthetic fixtures only: no model download, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitCards, assFile, W, H, CX, CY, SAFE } from '../tools/captions.mjs';
import { musicTrim, duckThreshold } from '../tools/mix.mjs';
import { synth, RECIPES, recipeFor, entries } from '../tools/sfx.mjs';
import { probeDuration, volume, resolveTime, ffmpeg } from '../tools/audiolib.mjs';
import { voiceEditFilter } from '../tools/align.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'audio-test-'));
const PY = new URL('../tools/align.py', import.meta.url).pathname;

function align(script, rec) {
  const s = join(tmp, 'script.json'), r = join(tmp, 'rec.json'), o = join(tmp, `words-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(s, JSON.stringify(script));
  writeFileSync(r, JSON.stringify(rec));
  const p = spawnSync('python3', ['-I', PY, 'voice.mp3', s, o, '--recognised', r], { encoding: 'utf8' });
  let doc = null;
  try { doc = JSON.parse(readFileSync(o, 'utf8')); } catch { /* exit 1 may still write */ }
  return { status: p.status, out: p.stdout, doc };
}
const rec = (words, t0 = 1, step = 0.4) => words.map((w, i) => ({ word: w, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + 0.3).toFixed(3) }));

test('audio tags are stripped before mapping; compare ignores case and punctuation', () => {
  const script = { lines: [{ id: 'L1', speaker: 'narrator', text: '[whispers] You hold the Key. [pause] Don\'t drop it!' }] };
  const { status, doc } = align(script, rec(['you', 'hold', 'the', 'key', 'dont', 'drop', 'it']));
  assert.equal(status, 0);
  assert.deepEqual(doc.words.map((w) => w.word), ['You', 'hold', 'the', 'Key.', "Don't", 'drop', 'it!']);
  assert.ok(doc.words.every((w) => w.matched));
  assert.equal(doc.meta.matchRate, 1);
});

test('an unmatched script word is interpolated between its matched neighbours', () => {
  const script = { lines: [{ id: 'L1', speaker: 'narrator', text: 'one two three four five six seven eight nine ten' }] };
  const heard = rec(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']);
  heard.splice(4, 1); // "five" was not recognised
  const { status, doc } = align(script, heard);
  assert.equal(status, 0);
  const w = doc.words[4];
  assert.equal(w.word, 'five');
  assert.equal(w.matched, false);
  assert.ok(w.start >= doc.words[3].end - 1e-6 && w.end <= doc.words[5].start + 1e-6, 'inside the gap');
  assert.ok(w.end > w.start);
  assert.equal(doc.meta.matchRate, 0.9);
});

test('matchRate under 90% exits 1 and prints the first unmatched stretch with 5 words of context', () => {
  const text = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
  const heard = rec(text.split(' '));
  heard.splice(5, 3); // foxtrot golf hotel lost -> 75%
  const { status, out } = align({ lines: [{ id: 'L1', speaker: 'narrator', text }] }, heard);
  assert.equal(status, 1);
  assert.match(out, /alpha bravo charlie delta echo \[\[foxtrot golf hotel\]\] india juliet kilo lima/);
});

test('the timeline starts 0.1 s before the first word', () => {
  const { doc } = align({ lines: [{ id: 'L1', speaker: 'narrator', text: 'hello there world' }] }, rec(['hello', 'there', 'world'], 2.5));
  assert.equal(doc.meta.lead, 2.4);
  assert.equal(doc.words[0].start, 0.1);
  assert.equal(doc.words[1].start, 0.5);
});

test('voice edit filter: pause shortening and tempo', () => {
  assert.match(voiceEditFilter({ voicePauseMax: 0.28, voiceTempo: 1.05 }), /silenceremove=.*stop_duration=0\.28.*-40dB.*atempo=1\.05/);
  assert.equal(voiceEditFilter({}), 'anull');
});

test('time strings resolve against words.json', () => {
  const words = [{ line: 'L3', w: 0, start: 4, end: 4.3 }];
  assert.equal(resolveTime('L3:0', words), 4);
  assert.equal(resolveTime('L3:0+12f', words, 24), 4.5);
  assert.equal(resolveTime(7.25, words), 7.25);
});

const W_ = (word, start, end) => ({ word, start, end, matched: true });
test('captions: 1-2 words per card, never across punctuation', () => {
  const words = [W_('You', 0, 0.2), W_('hold', 0.3, 0.5), W_('it,', 0.6, 0.8), W_('then', 0.9, 1.1), W_('drop', 1.2, 1.4), W_('it', 1.5, 1.6), W_('now.', 1.7, 1.9)];
  const cards = splitCards(words);
  assert.deepEqual(cards.map((c) => c.text), ['You hold', 'it,', 'then drop', 'it now.']);
  for (const c of cards) {
    assert.ok(c.words <= 2);
    assert.ok(!/[.,;:!?]\s/.test(c.text), `no punctuation inside "${c.text}"`);
  }
});

test('captions: safe zones (never the bottom 20% or the right 15%) and style', () => {
  const words = ['Extraordinarily', 'unquestionably', 'wonderful', 'I', 'am', 'here', 'Magnificent', 'iceberg'].map((w, i) => W_(w, i, i + 0.5));
  const cards = splitCards(words);
  for (const c of cards) {
    assert.equal(c.x, W / 2);
    assert.equal(c.y, Math.round(H * 0.33));
    assert.ok(c.x + c.width / 2 <= SAFE.right, `right edge of "${c.text}"`);
    assert.ok(c.x - c.width / 2 >= W - SAFE.right, 'symmetric left edge');
    assert.ok(c.y + c.height / 2 <= SAFE.bottom, 'bottom edge');
  }
  const ass = assFile(cards);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Default,Anton,\d+,&H00FFFFFF,.*&H00141414,.*,1,8,0,5,/);
  assert.match(ass, new RegExp(`\\\\pos\\(${CX},${CY}\\)`));
});

test('music trims to end on a bar line (4/4) and lands its hit on the money shot', () => {
  const t = musicTrim({ musicDuration: 61, hit: 10, moneyStart: 20, timelineEnd: 40, bpm: 70 }); // bar = 3.4286 s
  assert.equal(t.delay, 10);
  assert.equal(t.start, 0);
  const bars = t.end / t.bar;
  assert.ok(Math.abs(bars - Math.round(bars)) < 1e-9, 'ends on a bar line');
  assert.ok(t.end <= 10 + 20 && t.end > 30 - t.bar, 'last bar before the timeline ends');
  const early = musicTrim({ musicDuration: 60, hit: 25, moneyStart: 10, timelineEnd: 30, bpm: 120 });
  assert.equal(early.delay, 0);
  assert.equal(early.start, 15);
  assert.equal(early.end % 2, 0);
  assert.ok(duckThreshold(-20) > 0 && duckThreshold(-20) < 1);
});

// Every recipe keyword, as a name that exercises it, with the requested length.
const NAMES = { wind: 'wind_rigging', creak: 'creak', engine: 'engine_room', hum: 'low_hum', sea: 'sea_calm', whoosh: 'rise_whoosh', thump: 'thump', cloth: 'cloth_rustle', slap: 'slap', bell: 'bell', phone: 'phone_crank', crank: 'crank', lock: 'lock_rattle', rattle: 'rattle', ice: 'ice_scrape', scrape: 'scrape' };
test('every sfx recipe keyword is covered and has a recipe', () => {
  assert.deepEqual(RECIPES.map(([k]) => k).sort(), Object.keys(NAMES).sort());
});
for (const [kw, name] of Object.entries(NAMES)) {
  test(`sfx recipe "${kw}" makes a non-silent file of the requested length`, () => {
    assert.ok(recipeFor(name));
    const f = join(tmp, `${name}.wav`);
    synth({ name, seconds: 1.5 }, f, 'test');
    assert.ok(Math.abs(probeDuration(f) - 1.5) < 0.02, `length ${probeDuration(f)}`);
    assert.ok(volume(f).max > -30, `max ${volume(f).max} dB`);
  });
}

test('beds loop: requested length, and the last 0.25 s equals the first 0.25 s', () => {
  const f = join(tmp, 'bed.wav');
  synth({ name: 'wind_rigging', seconds: 4, loop: true }, f, 'test');
  assert.ok(Math.abs(probeDuration(f) - 4) < 0.02);
  const diff = join(tmp, 'bed-diff.wav');
  const ends = join(tmp, 'ends.wav');
  // difference of head and tail should be ~silent compared to the bed itself
  ffmpeg(['-i', f, '-i', f, '-filter_complex', '[0:a]atrim=0:0.25,asetpts=PTS-STARTPTS[a];[1:a]atrim=3.75:4,asetpts=PTS-STARTPTS,volume=-1[b];[a][b]amix=inputs=2:normalize=0', diff]);
  assert.ok(volume(diff).max < volume(f).max - 40, `head/tail differ: ${volume(diff).max} dB`);
  void ends;
});

test('a name with no recipe falls back to a soft thud with a WARN', () => {
  const f = join(tmp, 'mystery.wav');
  const warns = [];
  const w = console.warn;
  console.warn = (m) => warns.push(m);
  try { synth({ name: 'zzz_unknown', seconds: 1 }, f, 'test'); } finally { console.warn = w; }
  assert.match(warns.join(), /WARN: no recipe for "zzz_unknown"/);
  assert.ok(Math.abs(probeDuration(f) - 1) < 0.02);
  assert.ok(volume(f).max > -30);
});

test('sfx entries: beds not in sfxLibrary become loops', () => {
  const e = entries({ sfxLibrary: [{ name: 'thump', seconds: 1 }], beds: ['sea_calm'] });
  assert.deepEqual(e.map((x) => [x.name, !!x.loop]), [['thump', false], ['sea_calm', true]]);
});

test('end to end: mix produces -14 LUFS / -1 dBTP, with music ducked and cut on the bar', async () => {
  const dir = join(tmp, 'ep');
  mkdirSync(join(dir, 'audio'), { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=220:d=9', '-ar', '48000', join(dir, 'audio', 'voice.mp3')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=f=330:d=20', '-ar', '48000', join(dir, 'audio', 'music.mp3')]);
  writeFileSync(join(dir, 'episode.json'), JSON.stringify({
    id: 'fixture', fps: 24, musicBpm: 120, musicHit: 2, beds: ['sea_calm'], sfxLibrary: [{ name: 'thump', seconds: 1 }],
    shots: [{ id: 'S1', start: 'L1:0', sfx: [['L1:1', 'thump']] }, { id: 'S2', start: 'L1:2' }], moneyShot: { shot: 'S2', hold: 0.8 },
  }));
  const words = ['a', 'b', 'c', 'd'].map((w, i) => ({ line: 'L1', w: i, word: w, start: 1 + i, end: 1.8 + i, matched: true }));
  writeFileSync(join(dir, 'audio', 'words.json'), JSON.stringify({ meta: { lead: 0.9, matchRate: 1 }, words }));
  const { sfx } = await import('../tools/sfx.mjs');
  assert.equal(sfx(dir), 0);
  const { mix } = await import('../tools/mix.mjs');
  const file = mix(dir, { duration: 12 });
  assert.ok(Math.abs(probeDuration(file) - 12) < 0.05);
  const log = ffmpeg(['-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const i = parseFloat([...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop()[1]);
  const tp = parseFloat([...log.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].pop()[1]);
  assert.ok(Math.abs(i + 14) <= 0.5, `integrated ${i} LUFS`);
  assert.ok(tp <= -1, `true peak ${tp} dBTP`);
});
