// POV rig: presets, transitions, breath puffs, and the 480-frame walkthrough (tests/looktest.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { makePalette } from '../engine/look/palette.mjs';
import { build } from '../kits/sets/titanic_crowsnest.mjs';
import { makeShotCam } from '../engine/rig/shotcam.mjs';
import { shotAt, totalFrames } from '../engine/rig/camera.mjs';
import { PRESETS, turn, turnDuration, MAX_ROT, EYE_HEIGHT } from '../engine/rig/presets.mjs';
import { povState, turnToSound, NO_CLAMP } from '../engine/rig/pov.mjs';
import { blinkCover, stingProgress, stingBlobs, irisRadius, transitionAt, BLINK_FRAMES, STING_FRAMES } from '../engine/post/transitions.mjs';
import { puffFrames, PUFF } from '../engine/rig/breath.mjs';
import { isStill, poseDelta } from '../tools/measure.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';

const look = JSON.parse(readFileSync(new URL('../engine/looks/titanic_night.json', import.meta.url)));
const spec = JSON.parse(readFileSync(new URL('./looktest.json', import.meta.url)));
const FPS = 24;

function walk() {
  const scene = new THREE.Scene();
  scene.userData.palette = makePalette(look, 'titanic_night');
  const kit = build(scene, rng(hashSeed('looktest:set')));
  const camera = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  scene.add(camera);
  const sc = makeShotCam({ spec, anchors: kit.anchors, kit, camera, fps: FPS });
  const kitMod = kit;
  const frames = [];
  const { update } = awaitKit();
  for (let n = 0; n < totalFrames(spec); n++) {
    const shot = shotAt(spec, n);
    update(n, { fps: FPS, shot });
    scene.updateMatrixWorld(true);
    const view = sc.pose(n);
    update(n, { camera, fps: FPS, shot });
    const spots = Object.fromEntries(['fleet_spot', 'lee_spot', 'cam_lookout'].map((k) => [k, kit.anchors[k].getWorldPosition(new THREE.Vector3()).toArray()]));
    frames.push({ n, spots, shot: shot.index, preset: view.preset, pos: camera.position.toArray(), quat: camera.quaternion.toArray(), fov: camera.fov, smear: view.smear, panini: view.panini });
  }
  void kitMod;
  return frames;
}
import * as kitModule from '../kits/sets/titanic_crowsnest.mjs';
function awaitKit() {
  return { update: kitModule.update };
}

const frames = walk();

test('walkthrough: 480 frames, shots as authored', () => {
  assert.equal(totalFrames(spec), 480);
  assert.equal(frames.length, 480);
  const at = (s) => shotAt(spec, Math.round(s * FPS)).camera.preset;
  assert.deepEqual([0, 3, 6, 9, 12, 15, 15.4, 16, 19].map(at), ['dive', 'lookdown', 'glance', 'lookup', 'glance', 'whip', 'snap', 'held', 'rise']);
  assert.deepEqual(spec.transitions, [{ type: 'blink', at: 284 }]);
  assert.equal(spec.shots[4].camera.fov, 90);
  assert.equal(spec.shots[2].camera.fov, 52);
  assert.equal(spec.shots[2].hands, 'rail_grip');
  assert.equal(spec.shots[7].hands, 'padlock_hold');
});

test('the rise ends on frame 0 within 0.5 deg and 2 cm', () => {
  const a = frames[0];
  const b = frames.at(-1);
  const { dp, deg } = poseDelta({ pos: a.pos, quat: a.quat }, { pos: b.pos, quat: b.quat });
  assert.ok(dp <= 0.02, `position off by ${(dp * 100).toFixed(2)} cm`);
  assert.ok(deg <= 0.5, `rotation off by ${deg.toFixed(3)} deg`);
  assert.ok(Math.abs(a.fov - b.fov) < 0.05, `fov ${a.fov} vs ${b.fov}`);
});

test('no rotation over 90 deg/s outside whip, dive and rise (within a shot)', () => {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.shot !== b.shot || NO_CLAMP.has(b.preset)) continue;
    const { deg } = poseDelta({ pos: a.pos, quat: a.quat }, { pos: b.pos, quat: b.quat });
    worst = Math.max(worst, deg * FPS);
    assert.ok(deg * FPS <= MAX_ROT, `frame ${i} (${b.preset}): ${(deg * FPS).toFixed(1)} deg/s`);
  }
  console.log(`fastest clamped rotation: ${worst.toFixed(1)} deg/s`);
});

test('no still run over 19 frames', () => {
  let run = 0;
  let longest = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.shot === b.shot && isStill({ pos: a.pos, quat: a.quat }, { pos: b.pos, quat: b.quat })) longest = Math.max(longest, ++run);
    else run = 0;
  }
  assert.ok(longest <= 19, `longest still run ${longest}`);
});

test('identical output for identical input', () => {
  assert.deepEqual(walk(), frames);
});

const BASE = { eye: [0, 34.62, -100.96], yaw0: 0, pitch0: -16, fov0: 72, fps: FPS, T: 3 };
const at = (name, extra, t) => PRESETS[name]({ ...BASE, ...extra }, t);

test('presets are pure (params, t) -> { pos, target, fov, roll }; walk bobs, nothing else does', () => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const k of Object.keys(PRESETS)) {
    if (k === 'dive' || k === 'rise') continue;
    const p = at(k, { fromLook: { yaw: 0, pitch: -16 }, toLook: { yaw: 10, pitch: 0 }, object: [0.4, 33.3, -100.2] }, 0.3);
    assert.ok(p.pos.length === 3 && p.target.length === 3 && Number.isFinite(p.fov) && Number.isFinite(p.roll), k);
  }
  let bob = 0;
  let roll = 0;
  for (let i = 0; i < 48; i++) {
    const w = at('walk', {}, i / FPS);
    bob = Math.max(bob, Math.abs(w.pos[1] - BASE.eye[1]));
    roll = Math.max(roll, Math.abs(w.roll));
  }
  assert.ok(Math.abs(bob - 0.015) < 1e-3 && Math.abs(roll - 0.4) < 0.01, `bob ${bob} roll ${roll}`);
  for (const k of ['glance', 'lookup', 'lookdown', 'kneel', 'held', 'snap', 'witness', 'whip']) assert.equal(at(k, { object: [0.4, 33.3, -100.2], fromLook: { yaw: 0, pitch: -16 }, toLook: { yaw: 5, pitch: -10 } }, 0.2).roll, 0, `${k} has no roll`);
  assert.ok(dist(at('walk', {}, 0).pos, BASE.eye) < 1e-9);
});

test('glance 0.35-0.6 s, clamped to 90 deg/s with a 2-3 frame settle; lookup/lookdown tilt between anchors', () => {
  const a = { yaw: 0, pitch: -38 };
  const b = { yaw: -30, pitch: -29 };
  const k = turn(a, b, 10, { dur: 0.5 });
  assert.ok(k.D >= 0.35 && k.D <= 0.6, `glance lasts ${k.D}`);
  assert.ok(turnDuration(30, 0.5) * MAX_ROT >= 1.65 * 30);
  const settle = [0, 1, 2, 3].map((i) => turn(a, b, k.D + i / FPS, { dur: 0.5 }).yaw);
  assert.ok(settle[1] !== b.yaw && Math.abs(settle[3] - b.yaw) < 1e-9, 'settles within 3 frames');
  const up = at('lookup', { fromLook: a, toLook: { yaw: 0, pitch: 60 } }, 2.9);
  assert.ok(up.target[1] > BASE.eye[1] + 50, 'tilts up');
});

test('kneel 0.9 m, held (object comes to you: eye stays, 12 deg down), snap to vFOV 20 in 3 frames, witness 84, whip 8 frames with one smear frame', () => {
  assert.ok(Math.abs(at('kneel', {}, 2).pos[1] - (BASE.eye[1] - EYE_HEIGHT + 0.9)) < 1e-9);
  const h = at('held', { object: [0, 0, 0] }, 0);
  assert.deepEqual(h.pos, BASE.eye, 'held: the eye stays standing');
  const d = [h.target[0] - h.pos[0], h.target[1] - h.pos[1], h.target[2] - h.pos[2]];
  assert.ok(Math.abs((Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI + 12) < 1e-6, '12 deg down-tilt');
  assert.equal(at('snap', { toLook: { yaw: 0, pitch: 0 } }, 3 / FPS).fov, 20);
  assert.ok(at('snap', { toLook: { yaw: 0, pitch: 0 } }, 1 / FPS).fov > 20);
  assert.equal(at('witness', {}, 0).fov, 84);
  const w = Array.from({ length: 10 }, (_, m) => at('whip', { fromLook: { yaw: 0, pitch: -9 }, toLook: { yaw: -6, pitch: -2 } }, m / FPS));
  assert.equal(w.filter((x) => x.smear).length, 1, 'one smear frame');
  assert.equal(w.findIndex((x) => x.smear), 4);
  assert.ok(Math.hypot(...w[4].streak) > Math.hypot(...w[1].streak), 'streaks peak mid-whip');
  assert.deepEqual(w[8].streak, [0, 0]);
  const last = w[8];
  assert.ok(Math.abs(Math.atan2(-(last.target[0] - last.pos[0]), -(last.target[2] - last.pos[2])) * 180 / Math.PI + 6) < 0.01, 'whip lands on the target in 8 frames');
});

test('turnToSound(anchorPos, soundFrame, delayFrames = 8)', () => {
  assert.equal(turnToSound([0, 0, 0], 144).start, 152);
  assert.equal(turnToSound([0, 0, 0], 144, 6).start, 150);
  const s = frames[152 + 20];
  const before = frames[144 + 4];
  assert.notDeepEqual(s.quat.map((v) => +v.toFixed(3)), before.quat.map((v) => +v.toFixed(3)), 'the head has turned to Lee');
  // no turn before the delay
  const q = (i) => frames[i].quat;
  const move = poseDelta({ pos: [0, 0, 0], quat: q(150) }, { pos: [0, 0, 0], quat: q(151) }).deg;
  assert.ok(move < 0.5, 'still ahead of the sound turn');
});

test('transitions: blink 8 frames close 3 / hold 2 / open 3; sting 12 frames; match iris; whip uses the whip preset', () => {
  assert.deepEqual(Array.from({ length: BLINK_FRAMES }, (_, k) => +blinkCover(k).toFixed(3)), [0.333, 0.667, 1, 1, 1, 0.667, 0.333, 0]);
  assert.equal(blinkCover(8), 0);
  assert.equal(stingProgress(0) > 0 && stingProgress(0) < 0.2, true);
  assert.equal(stingProgress(STING_FRAMES - 1), 1);
  assert.deepEqual(stingBlobs('s'), stingBlobs('s'), 'seeded');
  assert.notDeepEqual(stingBlobs('s'), stingBlobs('t'));
  assert.ok(irisRadius(5) < 0.1 && irisRadius(11) > 1.3 && irisRadius(0) > 1);
  assert.equal(transitionAt(spec.transitions, 283), null);
  assert.deepEqual(transitionAt(spec.transitions, 288), { type: 'blink', at: 284, k: 4 });
  assert.equal(transitionAt(spec.transitions, 292), null);
  const whips = frames.filter((f) => f.preset === 'whip');
  assert.equal(whips.length, 8);
  assert.equal(whips.filter((f) => f.smear).length, 1);
});

test('breath puff: every 1.8 s at rest when the look is cold, drifts up and fades over 20 frames', () => {
  assert.equal(look.cold, true);
  const born = new Set();
  for (let n = 0; n < 24 * 12; n++) for (const p of puffFrames(n)) born.add(p.born);
  const list = [...born].sort((a, b) => a - b);
  assert.deepEqual(list.slice(0, 4), [0, 43, 86, 130]);
  assert.equal(PUFF.life, 20);
  assert.equal(puffFrames(43 + 20).some((p) => p.born === 43), false);
  assert.equal(puffFrames(43 + 19).some((p) => p.born === 43), true);
});

test('povState: unknown presets throw; base motion is layered under presets', () => {
  const ctx = { fps: FPS, shotFrames: 72, n0: 0, eye: BASE.eye, yaw0: 0, pitch0: -16, fov0: 72, point: () => [0, 0, 0], hook: null };
  assert.throws(() => povState({ preset: 'nope' }, 0, ctx));
  const a = povState({ preset: 'glance', to: { yaw: 0, pitch: -16 } }, 0, ctx);
  const b = povState({ preset: 'glance', to: { yaw: 0, pitch: -16 } }, 24, ctx);
  assert.notEqual(a.pitch, b.pitch, 'breathing sway under the preset');
  assert.ok(b.fov < a.fov, 'FOV push');
  assert.equal(povState({ preset: 'glance', to: { yaw: 0, pitch: -16 }, held: false }, 24, ctx).fov, 72);
});

test('measure: dive and rise shots are reported but never judged on luma, dark40, p95 and motion', async () => {
  const { report, HOOK_PRESETS, HOOK_SKIP } = await import('../tools/measure.mjs');
  assert.deepEqual(HOOK_PRESETS, ['dive', 'rise']);
  const s = { frames: 72, lumaMean: 60, p5: 20, p95: 120, dark40: 0.4, sat: 0.4, motion: 0.12, still: 0, stillRun: 0 };
  const r = report('shot 0', s, HOOK_SKIP, 'hook');
  assert.deepEqual(r.misses, []);
  assert.match(r.text, /n\/a \(hook\)/);
  assert.ok(report('shot 1', s).misses.includes('p95'));
});

// ---- Fix 2.1: blocking, lens, framing rule, held object
import { LOOKOUT, FLEET, LEE, BLOCK, SHIP } from '../kits/sets/titanic_crowsnest.mjs';
import { paniniStrength, paniniNdc } from '../engine/post/panini.mjs';
import { HELD, heldObjectCamera } from '../engine/rig/presets.mjs';
import { figure, D_METRES, poseAt, faceTurn } from '../engine/cast/stickmath.mjs';

const DEGR = Math.PI / 180;
const poseSets = { fleet: JSON.parse(readFileSync(new URL('../cast/fleet/poses.json', import.meta.url))), lee: JSON.parse(readFileSync(new URL('../cast/lee/poses.json', import.meta.url))) };

test('lens: POV default vFOV 90 (about 59 deg horizontal in 9:16), Panini ramp 0 at 78, 0.5 at 90, 0.7 at 100', () => {
  assert.equal(LOOKOUT.fov, 90);
  const hfov = (2 * Math.atan(Math.tan(45 * DEGR) * (1080 / 1920))) / DEGR;
  assert.ok(Math.abs(hfov - 58.7) < 0.1, `h fov ${hfov}`);
  assert.equal(paniniStrength(78), 0);
  assert.equal(paniniStrength(52), 0);
  assert.equal(paniniStrength(90), 0.5);
  assert.equal(paniniStrength(100), 0.7);
  assert.equal(paniniStrength(84), 0.25);
  assert.equal(paniniStrength(110), 0.7);
  const [x, y] = paniniNdc(0.8, 0.5, 90, 1080 / 1920);
  assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1);
  assert.deepEqual(paniniNdc(0.3, 0.2, 52, 1080 / 1920), [0.3, 0.2], 'no Panini at inserts');
  assert.equal(frames[72].fov, 90, 'the lookdown starts on the default lens');
  assert.ok(Math.abs(frames[71].fov - 90) < 0.6, `the dive lands at vFOV 90 (${frames[71].fov})`);
  assert.equal(frames[16 * 24 - 1].fov, 20, 'the snap stays at 20');
  assert.equal(frames[8 * 24].fov, 52, 'the Lee glance insert stays at 52');
});

test("crow's nest blocking: eye 0.52 m from the rear wall and 0.2 m clear of the mast; Fleet left and Lee right against the front rim, 1.1 m, 35 deg", () => {
  const scene = new THREE.Scene();
  scene.userData.palette = makePalette(look, 'titanic_night');
  const { anchors } = build(scene, rng(hashSeed('looktest:set')));
  scene.updateMatrixWorld(true);
  const eye = anchors.cam_lookout.position;
  const rearWall = SHIP.basketZ + SHIP.basketR - 0.04;
  assert.ok(Math.abs(rearWall - eye.z - 0.52) < 1e-9, `eye ${(rearWall - eye.z).toFixed(3)} m from the rear inner wall`);
  assert.ok(Math.abs(eye.z - (SHIP.basketZ + 0.34)) < 1e-9);
  const mastR = 0.3 - ((0.3 - 0.17) * (eye.y - SHIP.forecastleY)) / (SHIP.nestFloorY + 8 - SHIP.forecastleY);
  assert.ok(SHIP.mastZ - mastR - eye.z >= 0.2 - 1e-3, 'mast clearance 0.2 m');
  for (const [name, sign] of [['fleet_spot', -1], ['lee_spot', 1]]) {
    const p = anchors[name].position;
    const dx = p.x - eye.x;
    const dz = eye.z - p.z;
    assert.ok(Math.abs(Math.hypot(dx, dz) - 1.1) < 1e-9, `${name} ${Math.hypot(dx, dz)} m`);
    assert.ok(Math.abs(Math.atan2(dx, dz) / DEGR - sign * 35) < 1e-6, `${name} bearing`);
    const r = Math.hypot(p.x, p.z - SHIP.basketZ);
    assert.ok(r > SHIP.basketR - 0.1 && r < SHIP.basketR - 0.04, `${name} against the front rim (radius ${r.toFixed(3)})`);
  }
  assert.equal(FLEET.x, -LEE.x);
  assert.equal(BLOCK.dist, 1.1);
});

// The card figure's screen span (0..1 of the frame width, Panini applied) for a card at frame f; null if it is behind the camera.
function cardSpan(cardSpec, f) {
  const track = cardSpec.track ?? [{ at: 0, pose: cardSpec.pose }];
  const pose = poseAt(poseSets[cardSpec.cast], track, f.n).pose;
  const base = new THREE.Vector3(...f.spots[cardSpec.anchor]);
  const cam = new THREE.PerspectiveCamera(f.fov, 1080 / 1920, 0.05, 9000);
  cam.position.fromArray(f.pos);
  cam.quaternion.fromArray(f.quat);
  cam.updateMatrixWorld(true);
  const t = faceTurn(cardSpec.facing * DEGR, base, cam.position);
  const fig = figure(pose, 0, Math.cos(t.angle));
  const pts = [];
  const add = (p, r) => pts.push([p.x - r, p.y], [p.x + r, p.y], [p.x, p.y - r], [p.x, p.y + r]);
  for (const k of ['armL', 'armR']) for (const j of Object.values(fig[k])) add(j, 0.1);
  for (const k of ['legL', 'legR']) for (const j of Object.values(fig[k])) add(j, 0.17);
  add(fig.headC, cardSpec.cast === 'fleet' ? 0.78 : 0.56); // head, hat (the peaked cap's brim reaches further)
  for (const a of fig.bodyAxis) add(a, 0.44 + 0.02);
  const toCam = new THREE.Vector3(cam.position.x - base.x, 0, cam.position.z - base.z).normalize();
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  let lo = 2;
  let hi = -1;
  let loPt = null;
  for (const [x, y] of pts) {
    const p = base.clone().addScaledVector(right, x * D_METRES);
    p.y += y * D_METRES;
    if (p.clone().applyMatrix4(cam.matrixWorldInverse).z >= -0.05) continue;
    const q = p.clone().project(cam);
    const [nx] = paniniNdc(q.x, q.y, cam.fov, cam.aspect);
    if ((nx + 1) / 2 < lo) loPt = [x, y];
    lo = Math.min(lo, (nx + 1) / 2);
    hi = Math.max(hi, (nx + 1) / 2);
  }
  return { lo, hi, loPt };
}

test('framing rule: in POV shots character cards never cover the centre 40% of the frame width, except in glance shots aimed at that character', () => {
  let checked = 0;
  const worst = { fleet: [9, -9], lee: [9, -9] };
  for (const f of frames) {
    const shot = spec.shots[f.shot];
    // The aerial hook is not a POV shot; a whip (8 frames, smeared) and the snap (vFOV 20, cards out of frame) are exempt.
    if (['dive', 'rise', 'whip', 'snap'].includes(shot.camera.preset)) continue;
    for (const c of spec.cards) {
      // Exempt: shots that glance to (or tilt from) this character.
      if ([shot.camera.to, shot.camera.from].some((a) => (typeof a === 'string' ? a : a?.anchor) === c.anchor)) continue;
      const span = cardSpan(c, f);
      checked++;
      if (span.hi < span.lo) continue;
      worst[c.cast] = [Math.min(worst[c.cast][0], span.lo), Math.max(worst[c.cast][1], span.hi)];
      assert.ok(span.hi <= 0.3 || span.lo >= 0.7, `frame ${f.n}: ${c.cast} spans ${span.lo.toFixed(3)}-${span.hi.toFixed(3)} of the width (limiting point ${span.loPt?.map((v) => v.toFixed(2))} D; spot-eye ${[0, 1, 2].map((i) => (f.spots[c.anchor][i] - f.pos[i]).toFixed(2))}; fov ${f.fov})`);
    }
  }
  console.log(`centre-40% rule: ${checked} card-frames checked; fleet spans ${worst.fleet.map((v) => v.toFixed(2)).join('-')}, lee ${worst.lee.map((v) => v.toFixed(2)).join('-')}`);
  assert.ok(checked > 400);
});

test('held shots: the object comes to you (eye stays at 1.62 m, object 0.45 m in front and 0.25 m below the eye, camera 12 deg down)', () => {
  assert.deepEqual([HELD.forward, HELD.down, HELD.tilt], [0.45, 0.25, 12]);
  const held = frames.filter((f) => spec.shots[f.shot].camera.preset === 'held');
  assert.equal(held.length, 72);
  for (const f of held) {
    assert.ok(Math.abs(f.pos[1] - f.spots.cam_lookout[1]) <= 0.005, 'the eye stays standing at the lookout eye height');
    assert.ok(Math.hypot(f.pos[0] - f.spots.cam_lookout[0], f.pos[2] - f.spots.cam_lookout[2]) < 0.005, 'the camera does not move toward the object');
  }
  const v = new THREE.Vector3(...heldObjectCamera(-12)).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(-12 * DEGR, 0, 0, 'YXZ')));
  assert.ok(Math.abs(v.y + 0.25) < 1e-9 && Math.abs(Math.hypot(v.x, v.z) - 0.45) < 1e-9, `object at ${v.toArray().map((x) => x.toFixed(3))}`);
});

test('solid characters: cutout material, prepass occluder, hands in the same prepass (the pixel test runs on the farm: tools/solidtest.mjs)', async () => {
  const { LAYERS, COLOUR_LAYERS } = await import('../engine/look/layers.mjs');
  const card = readFileSync(new URL('../engine/rig/card.mjs', import.meta.url), 'utf8');
  assert.match(card, /transparent: false, alphaTest: 0\.5, depthWrite: true/);
  assert.match(card, /card\.layers\.set\(LAYERS\.CARD_BODY\)/);
  assert.match(card, /texture2D\(map, vUv\)\.a < 0\.5\) discard/, 'the prepass material is the same cutout');
  assert.ok(COLOUR_LAYERS.includes(LAYERS.CARD_BODY));
  const main = readFileSync(new URL('../engine/main.mjs', import.meta.url), 'utf8');
  const pre = main.indexOf('c.prepass(true)');
  assert.ok(pre > main.indexOf('camera.layers.set(LAYERS.SOLID)') && pre < main.indexOf('camera.layers.set(LAYERS.HULL)'), 'cards render in the depth/normal prepass before the hull ink');
  const hands = readFileSync(new URL('../engine/rig/hands3d.mjs', import.meta.url), 'utf8');
  assert.match(hands, /skinned\.layers\.set\(LAYERS\.SOLID\)/);
  assert.match(hands, /cuff\.layers\.set\(LAYERS\.SOLID\)/);
  assert.match(hands, /hull\.layers\.set\(LAYERS\.HULL\)/);
  const set = JSON.parse(readFileSync(new URL('./solid.json', import.meta.url)));
  assert.equal(set.set, 'solid_test');
  assert.equal(set.cards[0].cast, 'fleet');
});
