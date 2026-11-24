// Stick cast: proportions, poses, and one snapshot per 2.5D trick (billboard, light flip, face shift, far limbs, shadow proxy).
// Snapshots live in tests/cast.snapshot.json; regenerate with UPDATE_SNAPSHOT=1 node --test tests/cast.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { D, CARD, skeleton, figure, billboardAngles, lightInCamera, faceTurn, drawOrder, farSide, proxyYaw, poseAt, lerpPose, breathAt, mouthAt, blinkFrames } from '../engine/cast/stickmath.mjs';
import { drawStick } from '../engine/cast/stick.mjs';

const DEG = Math.PI / 180;
const url = (p) => new URL(p, import.meta.url);
const look = JSON.parse(readFileSync(url('../engine/looks/titanic_night.json')));
const day = JSON.parse(readFileSync(url('../engine/looks/day.json')));
const snapPath = url('./cast.snapshot.json');
const snap = {};
const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
function check(name, value) {
  snap[name] = round(value);
}
test.after(() => {
  if (process.env.UPDATE_SNAPSHOT || !existsSync(snapPath)) {
    writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n');
    return;
  }
  const stored = JSON.parse(readFileSync(snapPath));
  assert.deepEqual(snap, stored, 'cast snapshot changed (UPDATE_SNAPSHOT=1 to accept)');
});

const poses = { fleet: JSON.parse(readFileSync(url('../cast/fleet/poses.json'))), lee: JSON.parse(readFileSync(url('../cast/lee/poses.json'))) };
const chars = { fleet: JSON.parse(readFileSync(url('../cast/fleet/char.json'))), lee: JSON.parse(readFileSync(url('../cast/lee/char.json'))) };

test('proportions in head diameters: 3.5 D tall, body 0.88 x 1.4, legs 1.0, arms 1.3, head overlaps 0.08', () => {
  const sk = skeleton(0);
  assert.ok(Math.abs(sk.crown - 3.5) < 1e-9, `crown ${sk.crown}`);
  assert.equal(D.bodyW, 0.88);
  assert.equal(D.bodyL, 1.4);
  assert.equal(D.leg, 1.0);
  assert.equal(D.arm, 1.3);
  assert.equal(D.limb, 0.045);
  assert.equal(D.hand, 0.12);
  assert.equal(D.shoe, 0.18);
  assert.equal(D.outline, 0.035);
  assert.equal(D.eye, 0.075);
  assert.equal(D.eyeGap, 0.27);
  assert.equal(D.browW, 0.19);
  assert.equal(D.browUp, 0.17);
  assert.equal(D.rim, 0.03);
  assert.ok(Math.abs(sk.bodyTop - sk.neck - D.headOverlap) < 1e-9);
  const f = figure({ armL: [0, 0], armR: [90, 0], legL: [0, 0], legR: [0, 0] });
  const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.abs(len(f.armR.shoulder, f.armR.wrist) - 1.3) < 1e-9, 'arm 1.3 D');
  assert.ok(Math.abs(len(f.legL.hip, f.legL.ankle) - 1.0) < 1e-9, 'leg 1.0 D');
  assert.ok(sk.crown + 0.4 <= CARD.h - CARD.bottom + 1e-9, 'card has room for the hat');
});

test('characters are JSON params; every pose exists with joint angles, eyes, brows, mouth', () => {
  const need = ['idle', 'lean_forward', 'squint', 'point', 'alarm', 'shiver'];
  for (const c of ['fleet', 'lee']) {
    for (const n of need) assert.ok(poses[c][n], `${c}.${n}`);
    assert.ok(chars[c].hat.type && chars[c].hat.colours && chars[c].shirt.color && chars[c].trousers);
    for (const [n, p] of Object.entries(poses[c])) {
      for (const k of ['armL', 'armR', 'legL', 'legR']) assert.equal(p[k].length, 2, `${c}.${n}.${k}`);
      assert.ok(p.eyes && p.brows && p.mouth, `${c}.${n} face`);
    }
  }
  for (const n of ['edge', 'phone_shout']) assert.ok(poses.fleet[n], `fleet.${n}`);
  for (const n of ['talk', 'scoff']) assert.ok(poses.lee[n], `lee.${n}`);
  assert.equal(chars.fleet.hat.type, 'peaked');
  assert.equal(chars.fleet.shirt.scarf, '#E8A64B');
  assert.equal(chars.lee.hat.type, 'knit');
  assert.equal(chars.lee.shirt.collarUp, true);
  assert.ok(!existsSync(url('../cast/fleet/idle.svg')) && !existsSync(url('../cast/fleet/edge.svg')), 'old SVG cards are gone');
});

test('trick a) billboard: yaw faces the camera every frame, pitch limited to 15 deg', () => {
  const base = new THREE.Vector3(1, 0, -2);
  const a = billboardAngles(base, new THREE.Vector3(4, 1.0, 1), 2.05);
  assert.ok(Math.abs(a.yaw - Math.atan2(3, 3)) < 1e-9);
  const b = billboardAngles(base, new THREE.Vector3(1.2, 40, -1.8), 2.05); // camera far above: clamped
  assert.ok(Math.abs(b.pitch + 15 * DEG) < 1e-9, `pitch ${b.pitch / DEG}`);
  const c = billboardAngles(base, new THREE.Vector3(4, 1.4, 1), 2.05);
  assert.ok(Math.abs(c.pitch) < 15 * DEG);
  check('billboard', { yawDeg: a.yaw / DEG, clampedPitchDeg: b.pitch / DEG, lowPitchDeg: c.pitch / DEG });
});

function camAt(yawDeg) {
  const cam = new THREE.PerspectiveCamera(72, 9 / 16, 0.05, 100);
  cam.quaternion.setFromEuler(new THREE.Euler(0, yawDeg * DEG, 0, 'YXZ'));
  return cam;
}
test('trick b) light: the key light in camera space flips side when the camera orbits 180 deg', () => {
  const k = look.cast.keyDir;
  const l0 = lightInCamera(k, camAt(0));
  const l180 = lightInCamera(k, camAt(180));
  assert.ok(Math.sign(l0[0]) === -Math.sign(l180[0]) && Math.abs(l0[0]) > 0.3, 'lit side flips');
  assert.ok(Math.abs(l0[1] - l180[1]) < 1e-9, 'elevation unchanged');
  assert.ok(Math.abs(Math.hypot(...l0) - 1) < 1e-9);
  const d0 = lightInCamera(day.cast.keyDir, camAt(0));
  check('light', { night0: l0, night180: l180, day0: d0 });
});

test('trick c) face turn: features shift 0.05-0.18 D toward the look direction; the back is shown past 100 deg', () => {
  const base = new THREE.Vector3(0, 0, 0);
  const cam = new THREE.Vector3(0, 1.6, 5); // bearing 0
  const rows = {};
  for (const deg of [0, 20, 45, 90, 130, -45]) {
    const t = faceTurn(deg * DEG, base, cam);
    assert.ok(Math.abs(t.shift) >= 0.05 - 1e-9 && Math.abs(t.shift) <= 0.18 + 1e-9, `shift ${t.shift}`);
    assert.equal(Math.sign(t.shift), deg < 0 ? -1 : 1);
    rows[deg] = { shift: t.shift, back: t.back };
  }
  assert.ok(Math.abs(rows[90].shift) > Math.abs(rows[20].shift));
  assert.equal(rows[130].back, true);
  assert.equal(rows[45].back, false);
  check('faceShift', rows);
});

test('trick e) depth order: far limbs behind the body and 10% darker', () => {
  const r = drawOrder(50 * DEG);
  assert.equal(r.far, 'R');
  assert.deepEqual(r.order.slice(0, 5), ['armR', 'legR', 'legL', 'body', 'armL']);
  assert.equal(drawOrder(-50 * DEG).far, 'L');
  assert.equal(farSide(0.1), 'R');
  assert.equal(r.darken, 0.9);
  // Recorded drawing: 6 limb segments (far arm, far leg, near leg) are inked before the body clips, 2 (near arm) after.
  const ev = [];
  const grads = [];
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => { const g = { stops: [] }; grads.push(g); return { addColorStop: (o, c) => g.stops.push(c) }; };
      return (...a) => ev.push(k);
    },
    set: (_, k, v) => { if (k === 'lineWidth') ev.push(`w${Math.round(v * 100) / 100}`); return true; },
  });
  const P = 960 / CARD.w;
  const ink = `w${Math.round((D.limb + 2 * D.outline) * P * 100) / 100}`;
  const light = { key: '#FFE8B0', shade: '#4B6584', rim: '#FFE8B0', cam: lightInCamera(day.cast.keyDir, camAt(0)) };
  const angle = 50 * DEG;
  const st = { fig: figure(poses.fleet.point, 0, Math.cos(angle)), pose: poses.fleet.point, turn: Math.cos(angle), angle, look: { shift: 0.1, back: false }, light, order: r, seed: 't', nest: null, blink: false, mouth: 'o', skin: chars.fleet.skin, shirt: chars.fleet.shirt, trousers: chars.fleet.trousers, hat: chars.fleet.hat, cheek: null };
  drawStick(ctx, 960, 1230, chars.fleet, st);
  const clip = ev.indexOf('clip');
  const before = ev.slice(0, clip).filter((e) => e === ink).length;
  const after = ev.slice(clip).filter((e) => e === ink).length;
  assert.equal(before, 6);
  assert.equal(after, 2);
  // first limb gradient (far arm) is 10% darker than the near arm of the same colour
  const lum = (c) => c.match(/\d+/g).map(Number).reduce((s, v) => s + v, 0);
  const farLit = lum(grads[0].stops[2]);
  const nearArmIdx = grads.findIndex((g, i) => i > 8 && g.stops.length === 4 && grads[i].stops[2] !== grads[0].stops[2]);
  assert.ok(nearArmIdx > 0 && farLit < lum(grads[nearArmIdx].stops[2]) * 1.0001, 'far limb is darker');
  check('depthOrder', { far: r.far, order: r.order, inkedBefore: before, inkedAfter: after });
});

test('trick d) shadow proxy faces the key light (its normal points at the light azimuth)', () => {
  for (const L of [look.cast, day.cast]) {
    const y = proxyYaw(L.keyDir);
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), y);
    const h = new THREE.Vector3(L.keyDir[0], 0, L.keyDir[2]).normalize();
    assert.ok(Math.abs(n.dot(h) - 1) < 1e-9, 'plane normal toward the light');
  }
  check('proxy', { nightYawDeg: proxyYaw(look.cast.keyDir) / DEG, dayYawDeg: proxyYaw(day.cast.keyDir) / DEG });
});

test('trick f) lighting per scene: key, shade, rim and tint come from the look file', () => {
  for (const l of [look, day]) {
    assert.ok(l.cast.keyDir.length === 3 && l.cast.key in l.colors && l.cast.shade in l.colors && (l.cast.rim in l.colors));
    assert.ok(l.tint);
  }
  assert.notDeepEqual(look.cast.keyDir, day.cast.keyDir);
});

test('animation: poses blend, on twos; breathing +1.5% at 0.3 Hz; seeded blinks; talk alternates o/line on twos', () => {
  const track = [{ at: 0, pose: 'idle' }, { at: 48, pose: 'point' }];
  const a = poseAt(poses.fleet, track, 47).pose;
  const b = poseAt(poses.fleet, track, 48).pose;
  assert.deepEqual(poseAt(poses.fleet, track, 49).pose, b, 'twos: odd frame equals the even frame before it');
  assert.deepEqual(a, poses.fleet.idle);
  const mid = poseAt(poses.fleet, track, 51).pose; // 3 frames into a 6-frame blend (frame 50 state)
  assert.ok(mid.armR[0] > poses.fleet.idle.armR[0] && mid.armR[0] < poses.fleet.point.armR[0], 'interpolated');
  let max = 0;
  for (let n = 0; n < 24 * 10; n++) max = Math.max(max, breathAt(n));
  assert.ok(Math.abs(max - 0.015) < 1e-3, `breath max ${max}`);
  assert.ok(Math.abs(breathAt(0)) < 1e-12);
  const t = 1 / 0.3 / 2; // half period: the maximum
  assert.ok(Math.abs(breathAt(Math.round(t * 24 / 2) * 2) - 0.015) < 2e-3);
  const bl = [...blinkFrames('x:fleet', 24 * 30)];
  assert.deepEqual(bl, [...blinkFrames('x:fleet', 24 * 30)], 'seeded');
  const spk = [[10, 40]];
  const seq = [10, 11, 12, 13, 14, 15].map((n) => mouthAt(n, { mouth: 'smirk' }, spk));
  assert.deepEqual(seq, ['line', 'line', 'o', 'o', 'line', 'line']);
  assert.equal(mouthAt(50, { mouth: 'smirk' }, spk), 'smirk');
  check('animation', { mid: lerpPose(poses.fleet.idle, poses.fleet.point, 0.5).armR, breathMax: max });
});
