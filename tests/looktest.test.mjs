import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makePalette } from '../engine/look/palette.mjs';
import { addHulls } from '../engine/look/hull.mjs';
import { DEFAULT_RAMP } from '../engine/look/toon.mjs';
import { inkScale } from '../engine/look/hull.mjs';
import { hazeAmount } from '../engine/look/haze.mjs';
import { LAYERS } from '../engine/look/layers.mjs';
import { build, update, ANCHORS, SHIP, LOOKOUT, FLEET } from '../kits/sets/titanic_crowsnest.mjs';
import { CARD_HEIGHT, blinkFrames } from '../engine/rig/card.mjs';
import { BASE_MOTION } from '../engine/rig/camera.mjs';
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

test('look 2.0: ramp, haze, ink hierarchy, light', () => {
  assert.equal(look.ramp.shadow, 0.55);
  assert.equal(look.ramp.litMix, 0.4);
  assert.equal(DEFAULT_RAMP.shadow, 0.55);
  assert.equal(look.light.fill, 'ice');
  assert.equal(look.light.fillIntensity, 0.35);
  assert.equal(look.light.flicker, 0.03);
  assert.deepEqual(look.haze.bands, [0, 0.3, 0.6]);
  assert.equal(hazeAmount(1, look), 0);
  assert.equal(hazeAmount(1e5, look), 0.6);
  assert.equal(inkScale(3), 1);
  assert.ok(Math.abs(inkScale(30) - 0.6) < 1e-9);
  assert.equal(inkScale(500), 0.35);
  assert.equal(look.sky.starMinElevation, 15);
  assert.equal(look.sky.twinkle, 0.05);
});

test('camera base motion and blinks', () => {
  assert.deepEqual(BASE_MOTION, { dolly: 0.25, breathHz: 0.25, breathPitch: 0.15, breathLift: 0.004, push: 1.0, pushMax: 8 });
  const b = [...blinkFrames('looktest:fleet', 288)].sort((x, y) => x - y);
  assert.ok(b.length >= 4);
  const runs = [];
  for (const f of b) (runs.length && runs.at(-1).end === f - 1 ? (runs.at(-1).end = f) : runs.push({ start: f, end: f }));
  for (const r of runs) assert.ok(r.end - r.start + 1 >= 2 && r.end - r.start + 1 <= 3);
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i].start - runs[i - 1].start) / 24;
    assert.ok(gap >= 2 && gap <= 4.1, `blink gap ${gap}`);
  }
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
  assert.deepEqual([aerial.x, aerial.y, aerial.z], [60, 180, 250], 'aerial: line berg->midship +250 m astern, 60 m starboard, 180 m up');
  assert.equal(anchors.aerial.userData.pitch, -27);
  assert.equal(anchors.aerial.userData.fov, 84);
  assert.equal(SHIP.rimH, 1.0);
  const stars = scene.getObjectByName('stars');
  assert.equal(stars.geometry.getAttribute('position').count, 4000);
  const sizes = [...stars.geometry.getAttribute('aSize').array];
  assert.ok(Math.min(...sizes) >= 1 && Math.max(...sizes) <= 3);
  const sp = stars.geometry.getAttribute('position');
  for (let i = 0; i < sp.count; i++) assert.ok(sp.getY(i) / 5800 >= Math.sin((15 * Math.PI) / 180) - 1e-6, 'stars above 15 deg');
  const tw = [...stars.geometry.getAttribute('aTwinkle').array].filter((x) => x > 0).length / sp.count;
  assert.ok(tw > 0.03 && tw < 0.07, `twinkle share ${tw}`);
  assert.ok(!scene.getObjectByName('frost_crust'), 'cake-icing frost removed');
  assert.ok(scene.getObjectByName('cap_rail'));
  assert.equal(scene.getObjectByName('smoke').geometry.getAttribute('position').count, 27, 'smoke from 3 funnels');
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
  const rimTop = new THREE.Vector3(0, SHIP.nestFloorY + SHIP.rimH, bz - (R - 0.06));
  const a = fromTop(rimTop).y;
  const horizon = fromTop(new THREE.Vector3(eye.x, eye.y, eye.z - 1e6)).y;
  // Occlusion against the rim only (wall + frost crust).
  const rim = ['basket_wall', 'cap_rail'].map((n) => scene.getObjectByName(n));
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
  assert.ok(berg.x >= 0 && berg.x <= 1, 'iceberg in frame');
  assert.ok(mid.x >= 0.4 && mid.x <= 0.6, `midship across at ${(mid.x * 100).toFixed(1)}%`);
  assert.ok(berg.y >= 0 && berg.y <= 0.3, `iceberg at ${(berg.y * 100).toFixed(1)}%`);
  assert.ok(mid.y >= 0.3 && mid.y <= 0.7, `midship at ${(mid.y * 100).toFixed(1)}%`);
  assert.ok(mid.x >= 0 && mid.x <= 1, 'midship inside frame');
});

test('framing: Fleet is a foreground edge silhouette in the left 12-20% (brim, shoulder, scarf)', () => {
  const { anchors, cam, fromTop } = frame('cam_lookout');
  const spot = anchors.fleet_spot.getWorldPosition(new THREE.Vector3());
  const C = FLEET.card;
  const w = (CARD_HEIGHT * C.width) / C.height;
  const toCam = new THREE.Vector3(cam.position.x - spot.x, 0, cam.position.z - spot.z).normalize();
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  // Card units (u right, v down from the top) -> frame position.
  const at = (u, v) => fromTop(spot.clone().addScaledVector(right, (u / C.width - 0.5) * w).setY(spot.y + CARD_HEIGHT * (1 - v / C.height)));
  const mid = C.height * 0.3;
  assert.ok(at(0, mid).x < 0, 'card enters from the left edge');
  const cover = at(C.width, mid).x;
  let u0 = C.width;
  for (let u = C.width; u >= 0; u -= 0.5) if (at(u, mid).x >= 0) u0 = u;
  const feats = Object.fromEntries(['brim', 'shoulder', 'scarf'].map((k) => {
    const [x0, x1, y0, y1] = C[k];
    const p = at((x0 + x1) / 2, (y0 + y1) / 2);
    return [k, { visible: u0 <= (x0 + x1) / 2 && p.y >= 0 && p.y <= 1, y: p.y }];
  }));
  console.log(`fleet edge: x ${FLEET.x} m, forward ${FLEET.forward} m, covers ${(cover * 100).toFixed(1)}% of width, strip from card u=${u0} of ${C.width}; ` +
    Object.entries(feats).map(([k, f]) => `${k} ${f.visible ? 'in' : 'OUT'} (${(f.y * 100).toFixed(0)}%)`).join(', '));
  assert.ok(cover >= 0.12 && cover <= 0.2, `Fleet covers ${(cover * 100).toFixed(1)}%`);
  for (const [k, f] of Object.entries(feats)) assert.ok(f.visible, `${k} visible`);
  assert.equal(FLEET.pose, 'edge');
});

test('camera: bounded dolly keeps the eye 0.45 m from the rim; FOV push capped', () => {
  const { anchors } = buildScene();
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  const start = poseCamera(cam, { anchor: 'cam_lookout' }, anchors, 0, 24, 240);
  const z0 = cam.position.z;
  const end = poseCamera(cam, { anchor: 'cam_lookout' }, anchors, 239, 24, 240);
  const moved = z0 - cam.position.z;
  const rimZ = SHIP.basketZ - (SHIP.basketR - 0.04);
  assert.ok(moved <= 0.25 + 1e-9 && moved > 0.1, `dolly ${moved}`);
  assert.ok(cam.position.z - rimZ >= 0.45 - 1e-6, `eye ${(cam.position.z - rimZ).toFixed(3)} m from the rim`);
  assert.ok(Math.abs(72 - end.fov - 8) < 1e-9, 'FOV push capped at 8 deg');
  assert.equal(start.dolly, 0);
});

test('aerial: ship steams at 22 kn, camera tracks, push 3%/s', () => {
  const { scene, anchors } = buildScene();
  const cam = new THREE.PerspectiveCamera(84, 1080 / 1920, 0.05, 9000);
  update(0, {});
  poseCamera(cam, { anchor: 'aerial', pushPct: 3 }, anchors, 0, 24, 48);
  const p0 = cam.position.clone();
  const hull0 = scene.getObjectByName('hull').getWorldPosition(new THREE.Vector3());
  update(47, {});
  scene.updateMatrixWorld(true);
  poseCamera(cam, { anchor: 'aerial', pushPct: 3 }, anchors, 47, 24, 48);
  const hull1 = scene.getObjectByName('hull').getWorldPosition(new THREE.Vector3());
  const t = 47 / 24;
  assert.ok(Math.abs(hull0.z - hull1.z - 11.3 * t) < 1e-6, 'ship moves forward at 11.3 m/s');
  const track = p0.z - cam.position.z;
  assert.ok(track > 11.3 * t, 'camera tracks the ship and pushes in');
  assert.ok(scene.getObjectByName('wake'), 'wake');
  update(0, {});
});

test('set update is deterministic and moves the rigging', () => {
  const { scene } = buildScene();
  const stays = scene.getObjectByName('stays');
  const m = new THREE.Matrix4();
  update(0, {});
  stays.getMatrixAt(0, m);
  const a = m.elements.slice();
  update(37, {});
  stays.getMatrixAt(0, m);
  const b = m.elements.slice();
  update(0, {});
  stays.getMatrixAt(0, m);
  assert.deepEqual(m.elements, a);
  assert.notDeepEqual(a, b);
});

test('measure: stats, stills and target checks', async () => {
  const { frameStats, summarize, check, isStill, percentile } = await import('../tools/measure.mjs');
  const w = 4;
  const h = 2;
  const grey = (v) => new Uint8Array(w * h * 3).fill(v);
  const a = frameStats(grey(80), w, h);
  assert.equal(a.mean, 80);
  assert.equal(a.dark, 0);
  assert.equal(a.sat, 0);
  const b = frameStats(grey(10), w, h, a.luma);
  assert.equal(b.dark, 1);
  assert.equal(b.motion, 1);
  assert.equal(percentile(a.hist, 0.05), 80);
  const p = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  assert.equal(isStill(p, { pos: [0, 0, 0.0005], quat: [0, 0, 0, 1] }), true);
  assert.equal(isStill(p, { pos: [0, 0, 0.0025], quat: [0, 0, 0, 1] }), false);
  const s = summarize([{ ...a, still: true }, { ...b, still: true }]);
  assert.equal(s.stillRun, 2);
  assert.ok(check(s).includes('still'));
  const { TARGETS } = await import('../tools/measure.mjs');
  assert.deepEqual(TARGETS.p5, [0, 25]);
  assert.deepEqual(TARGETS.dark40, [0.06, 0.3]);
});

test('CI: Playwright container matches the installed Playwright', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  const v = lock.packages['node_modules/playwright'].version;
  const wf = readFileSync(new URL('../.github/workflows/render.yml', import.meta.url), 'utf8');
  const images = [...wf.matchAll(/image: (\S+)/g)].map((m) => m[1]);
  assert.ok(images.length >= 2);
  for (const img of images) assert.equal(img, `mcr.microsoft.com/playwright:v${v}-noble`);
  assert.ok(!wf.includes('release create'), 'no releases');
});
