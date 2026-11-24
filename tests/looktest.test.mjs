import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makePalette } from '../engine/look/palette.mjs';
import { addHulls } from '../engine/look/hull.mjs';
import { RAMP, gradientMap } from '../engine/look/toon.mjs';
import { LAYERS } from '../engine/look/layers.mjs';
import { build, ANCHORS } from '../kits/sets/titanic_crowsnest.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';
import { shardRanges, resolveTarget, frameCount } from '../tools/plan.mjs';

const look = JSON.parse(readFileSync(new URL('../engine/looks/titanic_night.json', import.meta.url)));
const spec = JSON.parse(readFileSync(new URL('./looktest.json', import.meta.url)));

function buildScene(seed = 'looktest') {
  const scene = new THREE.Scene();
  scene.userData.palette = makePalette(look, 'titanic_night');
  const out = build(scene, rng(hashSeed(`${seed}:set`)));
  addHulls(scene);
  scene.updateMatrixWorld(true);
  return { scene, ...out };
}

test('look: titanic_night palette', () => {
  assert.deepEqual(Object.keys(look.colors), ['navy', 'steel', 'ice', 'lamp', 'frost']);
  assert.equal(look.ink, '#141414');
  assert.equal(look.paper, '#F4EFE6');
  assert.ok(!Object.values(look.colors).map((c) => c.toUpperCase()).includes('#E8336D'));
  assert.ok(look.shadowTo in look.colors);
});

test('toon ramp is 3 nearest steps', () => {
  assert.deepEqual(RAMP, [0.35, 0.62, 1.0]);
  const g = gradientMap();
  assert.equal(g.magFilter, THREE.NearestFilter);
  assert.equal(g.minFilter, THREE.NearestFilter);
});

test('set exports every anchor', () => {
  const { anchors } = buildScene();
  for (const a of ANCHORS) assert.ok(anchors[a]?.isObject3D, `anchor ${a}`);
  console.log(`anchors: ${Object.keys(anchors).sort().join(', ')}`);
});

test('set is deterministic for a seed', () => {
  const pos = (s) => {
    const { anchors } = buildScene(s);
    return anchors.iceberg_dark.geometry.getAttribute('position').array.slice(0, 30).join(',');
  };
  assert.equal(pos('a'), pos('a'));
  assert.notEqual(pos('a'), pos('b'));
});

test('set geometry: nest, mast, iceberg, ship', () => {
  const { scene, anchors } = buildScene();
  const v = (o) => o.getWorldPosition(new THREE.Vector3());
  const eye = v(anchors.cam_lookout);
  const deck = v(anchors.deck);
  assert.ok(Math.abs(eye.y - deck.y - (15 + 1.62)) < 0.01, 'mast descends 15 m to the deck');
  const berg = v(anchors.iceberg_dark);
  assert.ok(Math.abs(Math.hypot(berg.x - eye.x, berg.z - eye.z) - 1500) < 5, 'iceberg 1.5 km ahead');
  assert.ok(berg.z < eye.z && Math.abs(berg.x) < 1, 'iceberg dead ahead');
  assert.equal(anchors.iceberg_rim.visible, false);
  const hull = scene.getObjectByName('hull');
  hull.geometry.computeBoundingBox();
  const size = hull.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 269) < 0.5, `hull length ${size.z}`);
  const aerial = v(anchors.aerial);
  assert.equal(aerial.y, 400);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(anchors.aerial.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(anchors.aerial.quaternion);
  assert.ok(fwd.y < -0.999, 'aerial looks straight down');
  assert.ok(up.z < -0.999, 'bow to the top of frame');
  const stars = scene.getObjectByName('stars');
  assert.equal(stars.geometry.getAttribute('position').count, 4000);
  const sizes = [...stars.geometry.getAttribute('aSize').array];
  assert.ok(Math.min(...sizes) >= 1 && Math.max(...sizes) <= 3);
});

test('every solid mesh has an inverted hull', () => {
  const { scene } = buildScene();
  let solids = 0;
  let missing = 0;
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.isHull || o.userData.noHull || !o.layers.isEnabled(LAYERS.SOLID)) return;
    solids++;
    if (!o.children.some((c) => c.userData.isHull)) missing++;
  });
  assert.ok(solids > 50);
  assert.equal(missing, 0);
});

test('looktest scene spec', () => {
  assert.equal(spec.frames, 240);
  assert.equal(spec.fps, 24);
  assert.equal(spec.camera.anchor, 'cam_lookout');
  assert.equal(spec.camera.fov, 72);
  assert.equal(spec.camera.pitch, -8);
  assert.equal(spec.camera.yawDrift, 3);
  assert.equal(frameCount(spec), 240);
  assert.equal(resolveTarget('tests/looktest.json').name, 'looktest');
});

test('shard plan covers every frame once', () => {
  const r = shardRanges(240, 8);
  assert.equal(r.length, 8);
  assert.equal(r[0].start, 0);
  assert.equal(r.at(-1).end, 240);
  for (let i = 1; i < r.length; i++) assert.equal(r[i].start, r[i - 1].end);
});
