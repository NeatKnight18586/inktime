import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makePalette } from '../engine/look/palette.mjs';
import { addHulls } from '../engine/look/hull.mjs';
import { RAMP, gradientMap } from '../engine/look/toon.mjs';
import { LAYERS } from '../engine/look/layers.mjs';
import { build, ANCHORS, SHIP, LOOKOUT } from '../kits/sets/titanic_crowsnest.mjs';
import { poseCamera, shotAt } from '../engine/rig/camera.mjs';
import { paniniNdc } from '../engine/post/panini.mjs';
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
  assert.deepEqual([aerial.x, aerial.y, aerial.z], [150, 180, 200], 'aerial: 150 m starboard, 180 m up, 200 m astern of midship');
  assert.equal(anchors.aerial.userData.pitch, -27);
  assert.equal(anchors.aerial.userData.fov, 84);
  assert.equal(SHIP.rimH, 1.0);
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
  assert.equal(spec.fps, 24);
  assert.equal(spec.shots[0].frames, 48);
  assert.equal(spec.shots[0].camera.anchor, 'aerial');
  assert.equal(spec.shots[1].frames, 240);
  assert.equal(spec.shots[1].camera.anchor, 'cam_lookout');
  assert.equal(spec.shots[1].camera.yawDrift, 3);
  assert.equal(frameCount(spec), 288);
  assert.equal(shotAt(spec, 47).camera.anchor, 'aerial');
  assert.equal(shotAt(spec, 48).camera.anchor, 'cam_lookout');
  assert.equal(resolveTarget('tests/looktest.json').name, 'looktest');
});

test('shard plan covers every frame once', () => {
  const r = shardRanges(240, 8);
  assert.equal(r.length, 8);
  assert.equal(r[0].start, 0);
  assert.equal(r.at(-1).end, 240);
  for (let i = 1; i < r.length; i++) assert.equal(r[i].start, r[i - 1].end);
});

// ---------------------------------------------------------------- framing (pure math, no render)
const PROP_GROUPS = {
  crane: ['crane_post', 'crane_house', 'crane_jib', 'crane_hook'],
  windlass: ['windlass_bed', 'windlass_gear', 'windlass_drum', 'gypsy'],
};
const PROP_NAMES = [
  'tin_mug', 'scarf_hook', 'oilskin', 'bell', 'phone', 'locker', 'capstan', 'hawse', 'bollard_plate',
  'hatch', 'vent', 'lamp_globe', 'jackstaff', 'iceberg_dark', 'bridge', 'funnel1',
];

function frame(anchorName) {
  const { scene, anchors } = buildScene();
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  const view = poseCamera(cam, { anchor: anchorName }, anchors, 0, 24);
  cam.updateMatrixWorld(true);
  const fromTop = (p) => {
    const q = p.clone().project(cam);
    let [x, y] = [q.x, q.y];
    if (view.panini) [x, y] = paniniNdc(x, y, cam.fov, cam.aspect);
    return { x: (x + 1) / 2, y: (1 - y) / 2, z: q.z };
  };
  return { scene, anchors, cam, view, fromTop };
}

function centre(o) {
  return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
}

test('framing: cam_lookout rim, horizon and props', () => {
  const { scene, anchors, cam, fromTop } = frame('cam_lookout');
  const eye = cam.position.clone();
  const R = SHIP.basketR;
  const bz = SHIP.basketZ;
  const rimTop = new THREE.Vector3(0, SHIP.nestFloorY + SHIP.rimH, bz - (R - 0.04));
  const a = fromTop(rimTop).y;
  const horizon = fromTop(new THREE.Vector3(eye.x, eye.y, eye.z - 1e6)).y;
  // Occlusion against the rim only (wall + frost crust).
  const rim = ['basket_wall', 'frost_crust'].map((n) => scene.getObjectByName(n));
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const ray = new THREE.Raycaster();
  const units = [];
  for (const [label, names] of Object.entries(PROP_GROUPS)) units.push({ label, objs: names.flatMap((n) => scene.getObjectsByProperty('name', n)) });
  for (const n of PROP_NAMES) scene.getObjectsByProperty('name', n).forEach((o, i, all) => units.push({ label: all.length > 1 ? `${n}#${i}` : n, objs: [o] }));
  const seen = [];
  for (const u of units) {
    const ok = u.objs.some((o) => {
      const c = centre(o);
      if (!frustum.containsPoint(c)) return false;
      const d = c.clone().sub(eye);
      const dist = d.length();
      ray.set(eye, d.normalize());
      ray.far = dist;
      return ray.intersectObjects(rim, false).length === 0;
    });
    if (ok) seen.push(u.label);
  }
  console.log(`framing lookout: back ${LOOKOUT.back} m, pitch ${LOOKOUT.pitch} deg, rim ${(a * 100).toFixed(1)}%, horizon ${(horizon * 100).toFixed(1)}%, props ${seen.length}: ${seen.join(', ')}`);
  assert.ok(a >= 0.78 && a <= 0.88, `rim top at ${(a * 100).toFixed(1)}%`);
  assert.ok(horizon >= 0.28 && horizon <= 0.38, `horizon at ${(horizon * 100).toFixed(1)}%`);
  assert.ok(seen.length >= 12, `only ${seen.length} props visible`);
});

test('framing: aerial iceberg top band, ship middle band', () => {
  const { anchors, fromTop, view } = frame('aerial');
  assert.equal(view.panini, true);
  const berg = fromTop(anchors.iceberg_dark.getWorldPosition(new THREE.Vector3()));
  const mid = fromTop(new THREE.Vector3(0, 0, 0));
  console.log(`framing aerial: iceberg ${(berg.y * 100).toFixed(1)}% (x ${(berg.x * 100).toFixed(1)}%), midship ${(mid.y * 100).toFixed(1)}% (x ${(mid.x * 100).toFixed(1)}%)`);
  assert.ok(Math.abs(berg.x - 0.5) < 0.01, 'iceberg horizontally centred');
  assert.ok(berg.y >= 0 && berg.y <= 0.3, `iceberg at ${(berg.y * 100).toFixed(1)}%`);
  assert.ok(mid.y >= 0.3 && mid.y <= 0.7, `midship at ${(mid.y * 100).toFixed(1)}%`);
  assert.ok(mid.x >= 0 && mid.x <= 1, 'midship inside frame');
});
