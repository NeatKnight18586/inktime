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
import { build, update, ANCHORS, SHIP, LOOKOUT, FLEET, PATH, PSI0, AERIAL, BERG_H, RANGE, SHIP_SPEED, shipPose, MONEY_FRAME } from '../kits/sets/titanic_crowsnest.mjs';
import { CARD_HEIGHT, blinkFrames } from '../engine/rig/card.mjs';
import { BASE_MOTION } from '../engine/rig/camera.mjs';
import { poseCamera, shotAt, hookFrames } from '../engine/rig/camera.mjs';
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
  assert.deepEqual(BASE_MOTION, { dolly: 0, breathHz: 0.25, breathPitch: 0.15, breathLift: 0.004, push: 1.0, pushMax: 8 });
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
  const crest = v(anchors.berg_crest);
  assert.ok(Math.abs(crest.y - BERG_H) < 1e-6, 'iceberg stands 18 m tall');
  const bow = (t) => { const p = shipPose(t); return [p.x - SHIP.length / 2 * Math.sin(p.yaw), p.z - SHIP.length / 2 * Math.cos(p.yaw)]; };
  const berg = v(anchors.iceberg_dark);
  const range = (t) => { const b = bow(t); return Math.hypot(berg.x - b[0], berg.z - b[1]); };
  assert.ok(Math.abs(range(0) - RANGE.start) < 0.5, `bow 850 m from the iceberg at frame 0 (${range(0)})`);
  assert.ok(Math.abs(range(PATH.T) - RANGE.money) < 0.5, 'bow 457 m from the iceberg at the money shot');
  assert.ok(Math.abs(shipPose(PATH.T).x - berg.x) < 1e-6 && shipPose(PATH.T).yaw === 0, 'dead ahead of the iceberg at the money shot');
  assert.equal(anchors.iceberg_rim.visible, false);
  const hull = scene.getObjectByName('hull');
  hull.geometry.computeBoundingBox();
  const size = hull.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 269) < 0.5, `hull length ${size.z}`);
  const aerial = v(anchors.aerial);
  assert.ok(Math.abs(Math.hypot(aerial.x - crest.x, aerial.z - crest.z) - AERIAL.back) < 1e-6, 'aerial: 55 m behind the crest');
  assert.ok(Math.abs(aerial.y - crest.y - AERIAL.up) < 1e-6, 'aerial: 6 m above the crest');
  assert.equal(anchors.aerial.userData.fov, 30);
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
  assert.equal(spec.shots[0].frames, 72);
  assert.equal(spec.shots[0].camera.preset, 'dive');
  assert.equal(spec.shots[0].camera.anchor, 'aerial');
  assert.equal(spec.shots[1].frames, 240);
  assert.equal(spec.shots[1].camera.anchor, 'cam_lookout');
  assert.equal(spec.shots[1].camera.yawDrift, 3);
  assert.equal(frameCount(spec), 312);
  assert.equal(shotAt(spec, 71).camera.anchor, 'aerial');
  assert.equal(shotAt(spec, 72).camera.anchor, 'cam_lookout');
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

test('framing: aerial frame 0 is a telephoto: ship three-quarter in the middle band, iceberg bottom-left', () => {
  const { scene, anchors, hook } = buildScene();
  update(0, {});
  scene.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  const view = poseCamera(cam, { anchor: 'aerial', preset: 'dive' }, anchors, 0, 24, 1, { hook, shipPose, n0: 0 });
  assert.equal(cam.fov, 30);
  assert.equal(view.panini, false);
  const P = (p) => {
    const q = p.clone().project(cam);
    return { x: (q.x + 1) / 2, y: (1 - q.y) / 2 };
  };
  const ship = scene.getObjectByName('ship_root');
  let x0 = 9;
  let x1 = -9;
  for (const z of [-134.5, 134.5]) for (const x of [-14, 14]) for (const y of [0, 20]) {
    const q = P(new THREE.Vector3(x, y, z).applyMatrix4(ship.matrixWorld));
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
  }
  const mid = P(new THREE.Vector3(0, 20, 0).applyMatrix4(ship.matrixWorld));
  const berg = anchors.iceberg_dark;
  const g = berg.geometry.getAttribute('position');
  let bx1 = -9;
  let by0 = 9;
  const a = new THREE.Vector3();
  for (let i = 0; i < g.count; i++) {
    const q = P(a.fromBufferAttribute(g, i).applyMatrix4(berg.matrixWorld));
    if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue;
    bx1 = Math.max(bx1, q.x);
    by0 = Math.min(by0, q.y);
  }
  console.log(`framing aerial: ship ${((x1 - x0) * 100).toFixed(0)}% wide (${x0.toFixed(2)}-${x1.toFixed(2)}), midship y ${mid.y.toFixed(2)}; berg top y ${by0.toFixed(2)}, right edge x ${bx1.toFixed(2)}`);
  assert.ok(x1 - x0 >= 0.5 && x1 - x0 <= 0.7, `ship spans ${((x1 - x0) * 100).toFixed(0)}% of the width`);
  assert.ok(mid.y >= 0.3 && mid.y <= 0.7, 'ship in the middle band');
  assert.ok(by0 >= 0.6 && by0 <= 0.8, `iceberg top at ${by0.toFixed(2)}: the bottom 30-40%`);
  assert.ok(bx1 <= 0.7, 'iceberg in the left part of the frame');
  assert.ok(PSI0 > 0 && PATH.T > 25 && PATH.T < 40, 'the ship turns dead ahead of the iceberg over ~34 s');
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

test('camera: lookout dolly is 0; a walk preset dollies at most 0.25 m and keeps the eye 0.45 m from the rim; FOV push capped', () => {
  const { anchors } = buildScene();
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  poseCamera(cam, { anchor: 'cam_lookout' }, anchors, 0, 24, 240);
  const zl = cam.position.z;
  poseCamera(cam, { anchor: 'cam_lookout', preset: 'lookout' }, anchors, 239, 24, 240);
  assert.ok(Math.abs(cam.position.z - zl) < 0.01, 'lookout does not dolly (breathing lift only)');
  const start = poseCamera(cam, { anchor: 'cam_lookout', preset: 'walk' }, anchors, 0, 24, 240);
  const z0 = cam.position.z;
  const end = poseCamera(cam, { anchor: 'cam_lookout', preset: 'walk' }, anchors, 239, 24, 240);
  const moved = z0 - cam.position.z;
  const rimZ = SHIP.basketZ - (SHIP.basketR - 0.04);
  assert.ok(moved <= 0.25 + 1e-9 && moved > 0.1, `dolly ${moved}`);
  assert.ok(cam.position.z - rimZ >= 0.45 - 1e-6, `eye ${(cam.position.z - rimZ).toFixed(3)} m from the rim`);
  assert.ok(Math.abs(72 - end.fov - 8) < 1e-9, 'FOV push capped at 8 deg');
  assert.equal(start.dolly, 0);
});

test('ship steams at 22 kn along the turning path; the money shot is frame MONEY_FRAME', () => {
  const { scene } = buildScene();
  update(0, {});
  scene.updateMatrixWorld(true);
  const ship = scene.getObjectByName('ship_root');
  const p0 = ship.position.clone();
  for (const t of [0, 5, 20, PATH.T - 1]) {
    const a = shipPose(t);
    const b = shipPose(t + 0.01);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) / 0.01 - SHIP_SPEED) < 0.05, `speed at ${t}`);
  }
  update(48, {});
  assert.ok(ship.rotation.y < PSI0 && ship.rotation.y > 0, 'heading turns toward dead ahead');
  assert.ok(Math.abs(ship.position.distanceTo(p0) - 11.3 * 2) < 0.2, 'ship covers 11.3 m/s');
  assert.equal(MONEY_FRAME(24), Math.round(PATH.T * 24));
  assert.ok(scene.getObjectByName('wake'), 'wake');
  update(0, {});
});

test('hook: dive in at most 3 s, lands on the lookout pose; the rise is the exact reverse and ends on frame 0', () => {
  const { scene, anchors, hook } = buildScene();
  const cam = new THREE.PerspectiveCamera(30, 1080 / 1920, 0.05, 9000);
  const opts = (n0) => ({ hook, shipPose, n0 });
  const dive = { anchor: 'aerial', preset: 'dive' };
  const frames = 72;
  assert.ok(frames / 24 <= hook.maxSeconds, 'at most 3 s');
  const fovs = [];
  const streaks = [];
  for (let m = 0; m < frames; m++) {
    update(m, {});
    scene.updateMatrixWorld(true);
    const v = poseCamera(cam, dive, anchors, m, 24, frames, opts(0));
    fovs.push(cam.fov);
    streaks.push(Math.hypot(...v.streak));
    if (m === 0) {
      const aerial = anchors.aerial.getWorldPosition(new THREE.Vector3());
      assert.ok(cam.position.distanceTo(aerial) < 1e-9 && cam.fov === 30, 'frame 0 is the aerial pose');
    }
  }
  assert.ok(Math.max(...fovs) >= 83.5 && Math.max(...fovs) <= 84.0001, 'dolly zoom 30 to 84');
  assert.ok(Math.abs(fovs[69] - 72) < 1e-6 && Math.abs(fovs[71] - 72) < 1e-6, 'settles to 72');
  assert.ok(fovs.slice(0, 20).every((f, i, a) => i === 0 || f >= a[i - 1] - 1e-4), `FOV widens during the rush: ${fovs.slice(0, 20).map((x) => x.toFixed(2))}`);
  assert.ok(Math.max(...streaks) > 15 && streaks[0] < 1 && streaks[69] < 1, 'speed streaks only in the rush');
  // Landing (frame 69) equals the lookout pose at that moment; the last 2 frames shake.
  update(69, {});
  scene.updateMatrixWorld(true);
  poseCamera(cam, dive, anchors, 69, 24, frames, opts(0));
  const lk = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  poseCamera(lk, { anchor: 'cam_lookout', preset: 'lookout' }, anchors, 0, 24, 240);
  assert.ok(cam.position.distanceTo(lk.position) < 0.02, 'lands in the nest');
  assert.ok(cam.quaternion.angleTo(lk.quaternion) < 0.001, 'facing forward');
  assert.equal(hookFrames(hook, frames).land, 69);
  update(70, {});
  poseCamera(cam, dive, anchors, 70, 24, frames, opts(0));
  assert.ok(cam.quaternion.angleTo(lk.quaternion) > 0.0005 || cam.position.distanceTo(lk.position) > 0.0005, '2-frame landing shake');
  // Rise: ends on frame 0's exact pose and FOV.
  const rise = { anchor: 'aerial', preset: 'rise' };
  update(1000, {});
  scene.updateMatrixWorld(true);
  poseCamera(cam, rise, anchors, 71, 24, frames, opts(1000));
  const ap = anchors.aerial.getWorldPosition(new THREE.Vector3());
  assert.ok(cam.position.distanceTo(ap) < 1e-6 && cam.fov === 30, 'rise ends on frame 0 pose and FOV');
  assert.ok(cam.quaternion.angleTo(anchors.aerial.getWorldQuaternion(new THREE.Quaternion())) < 1e-6);
  poseCamera(cam, rise, anchors, 0, 24, frames, opts(1000));
  assert.ok(Math.abs(cam.fov - 72) < 0.5, 'rise starts in the nest');
});

test('F3 money shot: iceberg 457 m away, snap zoom to vFOV 20, centred at 40% height, bow out of frame', () => {
  const sf = JSON.parse(readFileSync(new URL('./styleframes.json', import.meta.url)));
  const f3 = sf.frames[2];
  assert.equal(f3.at, MONEY_FRAME(24));
  const { scene, anchors } = buildScene();
  update(f3.at, {});
  scene.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  poseCamera(cam, f3.camera, anchors, f3.at, 24, f3.at + 1);
  assert.equal(cam.fov, 20);
  const berg = anchors.iceberg_dark;
  const g = berg.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let y0 = 9;
  let y1 = -9;
  for (let i = 0; i < g.count; i++) {
    v.fromBufferAttribute(g, i).applyMatrix4(berg.matrixWorld);
    if (v.y < 0) continue;
    const q = v.project(cam);
    y0 = Math.min(y0, (1 - q.y) / 2);
    y1 = Math.max(y1, (1 - q.y) / 2);
  }
  const bow = new THREE.Vector3(0, 19, -134.5).applyMatrix4(scene.getObjectByName('ship_root').matrixWorld).project(cam);
  console.log(`F3: iceberg ${((y1 - y0) * 1920).toFixed(0)} px tall, centre y ${((y0 + y1) / 2).toFixed(3)}`);
  assert.ok((y1 - y0) * 1920 >= 90, 'iceberg at least 90 px tall');
  assert.ok(Math.abs((y0 + y1) / 2 - 0.4) < 0.03, 'centred at 40% height');
  assert.ok(Math.abs(bow.y) > 1 || bow.z > 1, 'the bow is out of frame');
  assert.deepEqual(f3.skip, ['p5', 'dark40']);
  assert.equal(f3.camera.held, false);
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

// ---- Fix 1b.2: authored material controls, nest lighting, style frames, notan
import { toonMaterial, controlsOf, lightsPars, RAMP } from '../engine/look/toon.mjs';
import { notanGrid, notanReport, NOTAN } from '../tools/measure.mjs';

test('material controls: defaults, ranges, cache key, hull lineScale', () => {
  assert.deepEqual(controlsOf({}), { shadowBias: 0, spotBlack: 'unlit', lineScale: 1, noRim: false });
  assert.throws(() => controlsOf({ shadowBias: 1.5 }));
  assert.throws(() => controlsOf({ spotBlack: 'maybe' }));
  assert.equal(look.ramp.t1, 0.1);
  const pal = makePalette(look, 'titanic_night');
  const a = pal.toon('navy');
  const b = pal.toon('navy', { spotBlack: true, shadowBias: 0.5 });
  assert.notEqual(a, b);
  assert.equal(pal.toon('navy', { spotBlack: true, shadowBias: 0.5 }), b);
  assert.ok(Math.abs(b.userData.inkUniforms.uThresh.value.x - (0.1 + 0.15)) < 1e-9);
  assert.equal(b.userData.inkUniforms.uSpot.value, 1);
  assert.equal(a.userData.inkUniforms.uSpot.value, 2);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const scene = new THREE.Scene();
  const thin = new THREE.Mesh(geo, pal.toon('steel', { lineScale: 0.5 }));
  scene.add(thin);
  addHulls(scene);
  assert.equal(thin.children[0].material.uniforms.uLine.value, 0.5);
});

test('toon pools apply to point and spot lights', () => {
  assert.ok((lightsPars.match(/inkPool\(/g) ?? []).length >= 2);
  assert.ok(!/getDistanceAttenuation\( lightDistance, (point|spot)Light\.distance/.test(lightsPars));
});

test('masthead: a forward cone that never reaches the basket interior; basket values authored per object', () => {
  const { scene } = buildScene();
  const spot = scene.getObjectByProperty('isSpotLight', true);
  assert.ok(spot, 'masthead spot');
  const dir = new THREE.Vector3().subVectors(spot.target.position, spot.position).normalize();
  const basket = scene.getObjectByName('basket');
  const bp = basket.position;
  for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [0.9, 0, 0], [-0.9, 0, 0], [0, 0, -0.9], [0, 0, 0.9], [0, 1, -0.9]]) {
    const to = new THREE.Vector3(bp.x + dx, bp.y + dy, bp.z + dz).sub(spot.position).normalize();
    assert.ok(Math.acos(to.dot(dir)) > spot.angle + 0.05, `basket point ${dx},${dy},${dz} outside the cone`);
  }
  assert.ok(spot.target.position.z < spot.position.z && spot.position.z > bp.z - 1.5, 'above and behind (aft of) the nest front, aimed forward');
  const ctl = (n) => scene.getObjectByName(n).material.userData.ink;
  for (const n of ['basket_interior', 'rim_inner_face', 'basket_floor']) assert.equal(ctl(n).spotBlack, true, n);
  assert.ok(ctl('cap_rail').shadowBias < 0, 'cap rail top reaches the lit (cool fill) step');
});

test('camera: dolly only in walk, dive and rise', () => {
  const { anchors } = buildScene();
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  for (const preset of ['lookout', 'held', undefined]) {
    poseCamera(cam, { anchor: 'cam_lookout', preset }, anchors, 0, 24, 240);
    const z0 = cam.position.z;
    const v = poseCamera(cam, { anchor: 'cam_lookout', preset }, anchors, 239, 24, 240);
    assert.equal(v.dolly, 0, `${preset}`);
    assert.ok(Math.abs(cam.position.z - z0) < 0.01);
  }
  for (const preset of ['walk', 'dive', 'rise']) assert.ok(poseCamera(cam, { anchor: 'cam_lookout', preset }, anchors, 239, 24, 240).dolly > 0, preset);
});

test('notan: 3 values on an 18x32 grid, dark share and focus warning', () => {
  const w = 270;
  const h = 480;
  const luma = new Uint8Array(w * h).fill(100);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (y >= 240) luma[y * w + x] = 20; // bottom half dark
    if (x >= 135 && x < 165 && y >= 120 && y < 150) luma[y * w + x] = 230; // bright block at cells (9..10, 8..9)
  }
  const g = notanGrid(luma, w, h);
  assert.equal(g.cells.length, NOTAN.cols * NOTAN.rows);
  const near = notanReport(g, [[0.5, 0.27]]);
  assert.ok(Math.abs(near.share[0] - 0.5) < 1e-9 && near.darkOk === true || near.share[0] === 0.5);
  assert.equal(near.focusOk, true);
  const far = notanReport(g, [[0.1, 0.9]]);
  assert.equal(far.focusOk, false);
  assert.ok(far.lines.some((l) => l.includes('WARN')));
});

test('styleframes.json: F1 aerial, F2 lookout, F3 money shot', () => {
  const sf = JSON.parse(readFileSync(new URL('./styleframes.json', import.meta.url)));
  const [f1, f2, f3] = sf.frames;
  assert.deepEqual(sf.frames.map((f) => f.id), ['F1_aerial', 'F2_lookout', 'F3_money']);
  assert.equal(f1.at, 0);
  assert.equal(f1.camera.anchor, 'aerial');
  assert.equal(f2.at, 48);
  assert.equal(f2.camera.anchor, 'cam_lookout');
  assert.equal(f2.hands, 'rail_grip');
  assert.equal(f2.cards[0].pose, 'edge');
  assert.equal(f2.cards[0].light, 'nest');
  assert.deepEqual(f3.show, ['iceberg_rim']);
  for (const f of sf.frames) assert.ok(f.focus.length && f.id && f.camera.preset);
});

// ---- Fix 1b.3: hands viewmodel, cap rail, glows, Fleet in the nest
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { existsSync } from 'node:fs';
import { buildHand, curlAngles, blendPose, poseAtFrame, placeHand, HAND_FRAME, BLEND_FRAMES, breathLag } from '../engine/rig/hands3d.mjs';

const poses = JSON.parse(readFileSync(new URL('../cast/hands/poses.json', import.meta.url)));
async function loadGlb(hand) {
  const b = readFileSync(new URL(`../assets/hands/${hand}.glb`, import.meta.url));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise((ok, no) => new GLTFLoader().parse(ab, '', ok, no));
}
const handColors = () => ({ lit: new THREE.Color('#EFCEA0'), shadow: new THREE.Color('#8B7C67'), key: new THREE.Color('#E8A64B'), rim: new THREE.Color('#9FD3E0'), tint: new THREE.Color(1, 1, 1), navy: new THREE.Color('#1B2A41') });

test('hands: SVG hands and the quad are gone; poses are tiny JSON; assets are credited', () => {
  assert.ok(!existsSync(new URL('../engine/rig/hands.mjs', import.meta.url)));
  assert.ok(!existsSync(new URL('../cast/hands/rail_grip.svg', import.meta.url)));
  assert.deepEqual(Object.keys(poses), ['rail_grip', 'padlock_hold']);
  for (const p of Object.values(poses)) {
    assert.deepEqual(Object.keys(p.curl).sort(), ['index', 'middle', 'pinky', 'ring', 'thumb']);
    assert.ok(p.spread >= 0 && p.spread <= 1 && p.thumbOppose >= 0 && p.thumbOppose <= 1 && p.wrist.length === 3);
    for (const c of Object.values(p.curl)) assert.ok(c >= 0 && c <= 1);
  }
  const grip = Object.entries(poses.rail_grip.curl).filter(([k]) => k !== 'thumb').map(([, c]) => c);
  assert.ok(Math.min(...grip) >= 0.75 && Math.max(...grip) <= 0.9, 'rail grip curls 0.75-0.9');
  assert.equal(poses.rail_grip.thumbOppose, 0.7);
  assert.ok(existsSync(new URL('../assets/hands/left.glb', import.meta.url)) && existsSync(new URL('../assets/hands/right.glb', import.meta.url)));
  assert.match(readFileSync(new URL('../assets/hands/LICENSE.md', import.meta.url), 'utf8'), /MIT License/);
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /webxr-input-profiles/);
});

test('hands: curl maps to proximal 70c, intermediate 95c, distal 65c; poses blend over 3 frames on twos', () => {
  assert.deepEqual(curlAngles(1), { proximal: 70, intermediate: 95, distal: 65 });
  assert.deepEqual(curlAngles(0.5), { proximal: 35, intermediate: 47.5, distal: 32.5 });
  const mid = blendPose(poses.rail_grip, poses.padlock_hold, 0.5);
  assert.ok(Math.abs(mid.curl.index - (poses.rail_grip.curl.index + poses.padlock_hold.curl.index) / 2) < 1e-12);
  assert.equal(BLEND_FRAMES, 3);
  // The pose changes at frame 10: the 3-frame blend shows 1/3 on the first even frame, then the new pose.
  const at = (f) => (f < 10 ? 'rail_grip' : 'padlock_hold');
  const w = (n) => poseAtFrame(n, at, poses).curl.index;
  const a = poses.rail_grip.curl.index;
  const b = poses.padlock_hold.curl.index;
  assert.equal(w(9), a);
  assert.ok(Math.abs(w(10) - (a + (b - a) / 3)) < 1e-12 && w(11) === w(10), 'frame 10 and 11 share a pose state (twos)');
  assert.equal(w(12), b, 'the 3-frame window is over by the next even frame');
  assert.equal(w(14), b);
  assert.equal(poseAtFrame(0, () => null, poses), null);
});

test('hands: rigged hand curls round a rail, sits bottom-right (25-35% of width) and keeps its place when the FOV zooms', async () => {
  const rig = buildHand(await loadGlb('right'), handColors(), {});
  const cam = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 100);
  const scene = new THREE.Scene();
  scene.add(cam);
  cam.add(rig.group);
  const wp = (n) => rig.bones[n].getWorldPosition(new THREE.Vector3());
  const open = { curl: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }, spread: 0.35, thumbOppose: 0, wrist: [0, 0, 0] };
  rig.setPose(open);
  scene.updateMatrixWorld(true);
  const openLen = wp('index-finger-tip').distanceTo(wp('index-finger-phalanx-proximal'));
  rig.setPose(poses.rail_grip);
  placeHand(rig.group, rig.baseQuat, poses.rail_grip.wrist, 72);
  scene.updateMatrixWorld(true);
  const gripLen = wp('index-finger-tip').distanceTo(wp('index-finger-phalanx-proximal'));
  assert.ok(gripLen < openLen * 0.75, 'fingers curl');
  const camY = (n) => wp(n).applyMatrix4(cam.matrixWorldInverse).y;
  assert.ok(camY('index-finger-tip') < camY('index-finger-phalanx-proximal'), 'fingers curl down, round the rail');
  const extents = (fov) => {
    cam.fov = fov;
    cam.updateProjectionMatrix();
    placeHand(rig.group, rig.baseQuat, poses.rail_grip.wrist, fov);
    scene.updateMatrixWorld(true);
    let x0 = 9;
    let x1 = -9;
    let y0 = 9;
    const p = new THREE.Vector3();
    const pos = rig.skinned.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      rig.skinned.getVertexPosition(i, p).applyMatrix4(rig.skinned.matrixWorld).project(cam);
      x0 = Math.min(x0, (p.x + 1) / 2);
      x1 = Math.max(x1, (p.x + 1) / 2);
      y0 = Math.min(y0, (1 - p.y) / 2);
    }
    return { x0, x1, y0, width: x1 - x0 };
  };
  const e72 = extents(72);
  const e84 = extents(84);
  const e20 = extents(20);
  console.log(`hands: x ${e72.x0.toFixed(2)}-${e72.x1.toFixed(2)}, top y ${e72.y0.toFixed(2)}, width ${(e72.width * 100).toFixed(0)}%`);
  assert.ok(e72.width >= 0.25 && e72.width <= 0.35, `hand width ${(e72.width * 100).toFixed(0)}%`);
  assert.ok(e72.x0 >= 0.55 && e72.y0 >= 0.65, 'bottom-right');
  for (const e of [e84, e20]) assert.ok(Math.abs(e.x0 - e72.x0) < 0.05 && Math.abs(e.width - e72.width) < 0.05, 'same place at any FOV');
  assert.ok(Math.abs(breathLag(10, 24).pitchDeg) < 0.05, 'lags the breathing by 2 frames (tiny)');
  assert.equal(HAND_FRAME.refFov, 72);
  // Material, ink hull sharing the skeleton, cuff on the wrist bone.
  assert.ok(rig.hull.isSkinnedMesh && rig.hull.skeleton === rig.skinned.skeleton);
  assert.equal(rig.hull.material.side, THREE.BackSide);
  assert.equal(rig.hull.material.uniforms.uLine.value, 1.3);
  assert.equal(rig.cuff.parent, rig.bones.wrist);
  assert.ok(rig.skinned.material.uniforms.uLit.value.equals(new THREE.Color('#EFCEA0')));
});

test('hands: the left hand loads and rigs the same way', async () => {
  const rig = buildHand(await loadGlb('left'), handColors(), {});
  rig.setPose(poses.rail_grip);
  assert.ok(rig.axes.f.y < -0.9, 'fingers run along -Y at rest');
});

test('cap rail is 3 cm high; lamp halos are real glows (additive, no fog, no tone mapping, 60% and 25% lamp)', () => {
  const { scene } = buildScene();
  const cap = scene.getObjectByName('cap_rail');
  cap.geometry.computeBoundingBox();
  const h = cap.geometry.boundingBox.max.y - cap.geometry.boundingBox.min.y;
  assert.ok(Math.abs(h - 0.03) < 1e-6, `cap height ${h}`);
  const halos = scene.getObjectByName('ship_halos');
  assert.equal(halos.material.blending, THREE.AdditiveBlending);
  assert.equal(halos.material.fog, false);
  assert.equal(halos.material.toneMapped, false);
  assert.match(halos.material.fragmentShader, /r < 0\.45 \? 0\.6 : 0\.25/);
  assert.match(halos.material.fragmentShader, /vec4\(uLamp, a/);
});

test('Fleet in the dark nest: sidecar lists cap brim, shoulder and scarf; shadowBias -0.4 leaves only them lit', () => {
  const nest = JSON.parse(readFileSync(new URL('../cast/fleet/edge.nest.json', import.meta.url)));
  assert.equal(nest.shadowBias, -0.4);
  assert.deepEqual(nest.lit, [FLEET.card.brim, FLEET.card.shoulder, FLEET.card.scarf]);
  assert.ok(nest.dark.every((c) => c < 0.5), 'dark nest tint');
  assert.ok(nest.litGain < 0.9, 'lit features stay below the lamps and hands');
  const term = nest.terminator + 0.3 * (nest.shadowBias + 0.4);
  assert.ok(term * nest.size[0] > 140, 'only the right edge catches light');
});
