// Phase 6b: the ep001 storyboard resolves (21 beats at their words), in-world text rules, the money-shot berg stays in frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { loadEpisode, compile } from '../tools/timeline.mjs';
import { beatSpec, findWord, beatCaption } from '../tools/storyboard.mjs';
import { bakeSpec } from '../tools/bake.mjs';

const dir = 'episodes/ep001-titanic-key';
const { ep, words, script } = loadEpisode(dir);
const compiled = compile(ep, { words, script });
const board = JSON.parse(readFileSync(`${dir}/storyboard.json`, 'utf8'));

test('storyboard: 21 beats, each at a word of its line, with subject, verb, set and look', () => {
  assert.equal(board.beats.length, 21);
  assert.deepEqual(board.beats.map((b) => b.id), Array.from({ length: 21 }, (_, i) => `b${String(i + 1).padStart(2, '0')}`));
  for (const b of board.beats) {
    assert.ok(findWord(b.at, words), b.id);
    assert.ok(b.subject && b.verb && b.set && b.look, b.id);
    const { spec, frame } = beatSpec(b, { ep, words, compiled });
    assert.ok(spec.shots.reduce((a, s) => a + s.frames, 0) > frame, `${b.id}: the still is inside its scene`);
  }
  assert.equal(beatCaption(findWord('L2: binoculars', words), words, ep.captionKeys).keys.filter(Boolean).length, 1, 'binoculars is a key word');
});

test('storyboard: at most 2 jumps, to different places; in-world text at most 3 words', () => {
  const jumps = board.beats.filter((b) => b.jump && !b.jump.back);
  assert.ok(new Set(jumps.map((b) => b.jump.dest)).size <= 2);
  for (const t of [...jumps.map((b) => b.jump.stamp), 'BINOCULARS', 'CROWS NEST TELEPHONE', '£90,000', 'NO SERVICE']) assert.ok(t.split(/\s+/).filter((w) => /[A-Z0-9£]/.test(w)).length <= 3, t);
});

test('money shot: the berg spans at least 40% of the width and stays fully in frame during the hold', async () => {
  const b18 = board.beats.find((b) => b.id === 'b18');
  const { spec, frame } = beatSpec(b18, { ep, words, compiled });
  const doc = await bakeSpec(spec, { range: [frame, frame + 1] });
  const e = doc.plan[frame];
  assert.equal(e.preset, 'snap');
  const { makePalette } = await import('../engine/look/palette.mjs');
  const kitMod = await import('../kits/sets/titanic_crowsnest.mjs');
  const { rng, hashSeed } = await import('../tools/rng.mjs');
  const scene = new THREE.Scene();
  scene.userData.palette = makePalette(JSON.parse(readFileSync('engine/looks/titanic_night.json', 'utf8')), 'titanic_night');
  const kit = kitMod.build(scene, rng(hashSeed('t:set')));
  kit.update(frame, { fps: 24 });
  const berg = kit.anchors.iceberg_dark;
  berg.scale.setScalar(e.fx.bergScale);
  scene.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(e.cam.fov, 1080 / 1920, 0.05, 9000);
  cam.position.fromArray(e.cam.pos);
  cam.quaternion.fromArray(e.cam.quat);
  cam.updateMatrixWorld(true);
  const p = berg.geometry.getAttribute('position');
  let x0 = 9;
  let x1 = -9;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (v.y < 0) continue;
    v.applyMatrix4(berg.matrixWorld).project(cam);
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
  }
  assert.ok((x1 - x0) / 2 >= 0.4, `width ${(((x1 - x0) / 2) * 100).toFixed(0)}%`);
  assert.ok(x0 >= -1 && x1 <= 1, `fully in frame (${x0.toFixed(2)}..${x1.toFixed(2)})`);
});
