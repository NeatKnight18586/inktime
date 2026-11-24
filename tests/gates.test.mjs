// Phase 5 gates: synthetic baked plans (tools/gates.mjs). One plan passes everything; each broken copy fails exactly its gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGates, editRatio } from '../tools/gates.mjs';

const N = 960;
const FPS = 24;
const SHOTS = Array.from({ length: 20 }, (_, i) => ({ id: `S${i + 1}`, frames: 48, preset: i === 0 ? 'dive' : i === 19 ? 'rise' : i === 15 ? 'snap' : i % 2 ? 'held' : 'glance' }));
const lastWordEnd = N / FPS - 0.4;
const words = [{ line: 'L1', w: 0, word: 'Go', start: 0, end: 0.3 }, { line: 'L1', w: 1, word: 'now', start: lastWordEnd - 0.3, end: lastWordEnd }];
const script = { lines: [{ id: 'L1', speaker: 'narrator', text: 'You have eight words to hear this now.' }] };
const stillOk = { preset: 'glance', light: 'night', lumaMean: 80, dark40: 0.2, p5: 10, p95: 200, sat: 0.3 };

function makeDoc() {
  const plan = [];
  for (let n = 0; n < N; n++) {
    const shot = Math.floor(n / 48);
    const a = 0.2 * Math.sin((2 * Math.PI * n) / (N - 1));
    plan.push({
      n,
      shot,
      preset: SHOTS[shot].preset,
      m: n % 48,
      light: 'night',
      cam: { pos: [Math.sin((2 * Math.PI * n) / (N - 1)), 1.6, Math.cos((2 * Math.PI * 3 * n) / (N - 1))], quat: [0, Math.sin(a / 2), 0, Math.cos(a / 2)] },
      hands: { name: 'grip', cur: 'grip' },
      cards: [],
      sfx: n === 0 ? [{ i: 0 }] : [],
      caption: n === 0 ? { text: 'Go', x: 540, y: 634, width: 300, height: 125 } : null,
      g: { pov: shot !== 0 && shot !== 19, spans: [], exempt: [], faces: [], sfx: n === 0 ? [{ word: 'X', start: true, box: null }] : [], tick: { visible: true }, ...(n <= 10 ? { plant: true } : {}) },
    });
  }
  return { id: 'ep-test', fps: FPS, frames: N, hookType: 'instruction', presets: SHOTS.map((s) => s.preset), shots: SHOTS, cards: [], sfx: [{ word: 'X', at: 0 }, { word: 'Y', at: 200 }], moneyShot: { shot: 'S16', hold: 0.8 }, plant: { anchor: 'p', frames: [0, 10] }, plan };
}
const run = (doc, extra = {}) => runGates({ doc, words, script, index: [], id: doc.id, stills: Array(8).fill(stillOk), ...extra });
const status = (gates, name) => gates.find((x) => x.name === name).status;

test('a clean plan passes every gate', () => {
  const gates = run(makeDoc());
  const bad = gates.filter((x) => x.status !== 'PASS');
  assert.deepEqual(bad, [], bad.map((x) => `${x.status} ${x.name}: ${x.msg}`).join('\n'));
});

test('stillness: a still run over 19 frames fails', () => {
  const d = makeDoc();
  for (let n = 100; n < 130; n++) d.plan[n].cam = d.plan[99].cam;
  assert.equal(status(run(d), 'stillness'), 'FAIL');
});

test('money shot outside 65-85% fails', () => {
  const d = makeDoc();
  d.moneyShot = { shot: 'S5', hold: 0.8 };
  assert.equal(status(run(d), 'money'), 'FAIL');
});

test('loop: a last frame off frame 0 fails', () => {
  const d = makeDoc();
  d.plan[N - 1].cam = { ...d.plan[N - 1].cam, pos: [d.plan[0].cam.pos[0] + 0.1, 1.6, 0] };
  assert.equal(status(run(d), 'loop'), 'FAIL');
});

test('banned phrases fail', () => {
  const s = { lines: [{ id: 'L1', speaker: 'narrator', text: "Let us Delve into it, because it's important to note this." }] };
  assert.equal(status(run(makeDoc(), { script: s }), 'script'), 'FAIL');
});

test('night luma out of range fails; dive, rise and snap stills are not judged', () => {
  const dark = Array(8).fill({ ...stillOk, lumaMean: 40 });
  assert.equal(status(run(makeDoc(), { stills: dark }), 'look'), 'FAIL');
  const exempt = Array(8).fill({ ...dark[0], preset: 'dive' });
  assert.equal(status(run(makeDoc(), { stills: exempt }), 'look'), 'WARN');
});

test('centre-40% rule: a card over the middle fails unless exempt', () => {
  const d = makeDoc();
  d.cards = [{ cast: 'fleet' }];
  for (const e of d.plan) {
    e.cards = [{}];
    e.g.spans = [[0.4, 0.6]];
    e.g.exempt = [false];
  }
  assert.equal(status(run(d), 'centre40'), 'FAIL');
  for (const e of d.plan) e.g.exempt = [true];
  assert.equal(status(run(d), 'centre40'), 'PASS');
});

test('sound words closer than 48 frames fail', () => {
  const d = makeDoc();
  d.sfx = [{ word: 'X', at: 0 }, { word: 'Y', at: 30 }];
  assert.equal(status(run(d), 'soundwords'), 'FAIL');
});

test('variety: same hook type twice running, or a near-identical preset sequence, fails', () => {
  const d = makeDoc();
  const prev = [{ id: 'a', hookType: 'instruction', presets: d.presets }, { id: 'b', hookType: 'instruction', presets: ['x'] }];
  assert.equal(status(run(d, { index: prev }), 'variety'), 'FAIL');
  assert.ok(editRatio(['a', 'b', 'c'], ['a', 'b', 'c']) === 0 && editRatio(['a'], ['b']) === 1);
});

test('plant: the gate checks the frames episode.json names', () => {
  const d = makeDoc();
  d.plan[8].g.plant = false;
  assert.equal(status(run(d), 'plant'), 'FAIL');
  d.plant = { anchor: 'p', frames: [0, 5] };
  assert.equal(status(run(d), 'plant'), 'PASS');
});

test('jumps: at most 2 per episode, each to a different place; returns do not count', () => {
  const d = makeDoc();
  d.transitions = [{ type: 'jump', at: 100, dest: 'dock' }, { type: 'jump_back', at: 200 }, { type: 'jump', at: 300, dest: 'auction' }];
  assert.equal(status(run(d), 'jumps'), 'PASS');
  d.transitions.push({ type: 'jump', at: 600, dest: 'moon' });
  assert.equal(status(run(d), 'jumps'), 'FAIL');
  d.transitions = [{ type: 'jump', at: 100, dest: 'dock' }, { type: 'jump', at: 300, dest: 'dock' }];
  assert.equal(status(run(d), 'jumps'), 'FAIL');
});
