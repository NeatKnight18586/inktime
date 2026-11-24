// Stick cast maths (pure, no DOM): proportions in head diameters (D), pose blending, the 2.5D tricks as numbers.
// Everything derives from the frame index and the camera; randomness only from tools/rng.mjs with a named seed.
import * as THREE from 'three';
import { rng, hashSeed } from '../../tools/rng.mjs';

const DEG = Math.PI / 180;
export const D = {
  height: 3.5, // total, feet to crown
  head: 1.0,
  headOverlap: 0.08, // the head overlaps the body
  bodyW: 0.88,
  bodyL: 1.4,
  leg: 1.0,
  arm: 1.3,
  limb: 0.045,
  hand: 0.12,
  shoe: 0.18, // dark oval, height; width 0.32
  outline: 0.035,
  outlineVar: 0.15, // brush feel: +-15%
  eye: 0.075,
  eyeGap: 0.27,
  browW: 0.19,
  browUp: 0.17,
  rim: 0.03,
  faceShift: [0.05, 0.18],
  pitchMax: 15 * DEG,
  breathHz: 0.3,
  breathAmp: 0.015,
};
// Card canvas in D: margins around the 3.5 D figure; plane width 3.2 D, height 4.1 D, feet 0.2 D above the bottom.
export const CARD = { w: 3.2, h: 4.1, bottom: 0.2 };
export const D_METRES = 0.5; // 1 D in the world: 3.5 D = 1.75 m

// Skeleton in D, origin at the ground between the feet, y up, x right. `breath` scales the body (and what rides on it) in y.
export function skeleton(breath = 0) {
  const s = 1 + breath;
  const hipY = D.shoe + D.leg; // 1.18
  const bodyTop = hipY + D.bodyL * s;
  const headC = bodyTop - D.headOverlap + D.head / 2;
  return {
    hipY,
    bodyTop,
    headC,
    shoulderY: bodyTop - 0.3 * s,
    shoulderX: 0.4,
    hipX: 0.2,
    neck: bodyTop - D.headOverlap,
    crown: headC + D.head / 2,
  };
}

// Joint chain for a pose. Angles are degrees from straight down, positive = swing outward (away from the body centre);
// the elbow adds to the shoulder angle (the forearm swings further out and up); the knee swings the shin back inward.
// `lean` rotates the torso about the hip (+ = toward screen right). `turn` (cos of the body yaw) narrows shoulders and hips.
export function figure(pose, breath = 0, turn = 1) {
  const sk = skeleton(breath);
  const lean = (pose.lean ?? 0) * DEG;
  const hip = { x: 0, y: sk.hipY };
  // Rotate about the hip: (dx, dy) -> (dx cos - dy sin, dx sin + dy cos) with angle -lean (lean right = clockwise on screen).
  const turnBody = (p) => {
    const a = -lean;
    const dx = p.x - hip.x;
    const dy = p.y - hip.y;
    return { x: hip.x + dx * Math.cos(a) - dy * Math.sin(a), y: hip.y + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  const k = Math.max(0.55, turn);
  const out = { sk, lean, bodyAxis: [turnBody({ x: 0, y: sk.hipY }), turnBody({ x: 0, y: sk.bodyTop })] };
  const arm = (side) => {
    const [sh, el] = pose[side === 'L' ? 'armL' : 'armR'] ?? [0, 0];
    const sgn = side === 'L' ? -1 : 1;
    const s0 = turnBody({ x: sgn * sk.shoulderX * k, y: sk.shoulderY });
    const a1 = (sh * sgn + 0) * DEG; // screen angle from down, positive = toward screen right
    const a2 = ((sh + el) * sgn) * DEG;
    const seg = D.arm / 2;
    const e = { x: s0.x + Math.sin(a1) * seg, y: s0.y - Math.cos(a1) * seg };
    const w = { x: e.x + Math.sin(a2) * seg, y: e.y - Math.cos(a2) * seg };
    return { shoulder: s0, elbow: e, wrist: w };
  };
  const leg = (side) => {
    const [hp, kn] = pose[side === 'L' ? 'legL' : 'legR'] ?? [0, 0];
    const sgn = side === 'L' ? -1 : 1;
    const h0 = turnBody({ x: sgn * sk.hipX * k, y: sk.hipY });
    const a1 = hp * sgn * DEG;
    const a2 = (hp - kn) * sgn * DEG;
    const seg = D.leg / 2;
    const kneeP = { x: h0.x + Math.sin(a1) * seg, y: h0.y - Math.cos(a1) * seg };
    const ankle = { x: kneeP.x + Math.sin(a2) * seg, y: kneeP.y - Math.cos(a2) * seg };
    return { hip: h0, knee: kneeP, ankle };
  };
  out.armL = arm('L');
  out.armR = arm('R');
  out.legL = leg('L');
  out.legR = leg('R');
  out.head = { x: turnBody({ x: 0, y: sk.neck }).x, neck: turnBody({ x: 0, y: sk.neck }), tilt: (pose.tilt ?? 0) * DEG };
  out.headC = { x: out.head.neck.x + Math.sin(out.head.tilt) * (sk.headC - sk.neck), y: out.head.neck.y + Math.cos(out.head.tilt) * (sk.headC - sk.neck) };
  return out;
}

// ---------------------------------------------------------------- trick (a): billboard
// Yaw faces the camera every frame; pitch follows the camera elevation but is limited to 15 degrees.
export function billboardAngles(base, camPos, heightM) {
  const dx = camPos.x - base.x;
  const dz = camPos.z - base.z;
  const yaw = Math.atan2(dx, dz);
  const elev = Math.atan2(camPos.y - (base.y + heightM / 2), Math.hypot(dx, dz));
  // Rotation about local x by -elev tilts the plane normal up toward a camera above it.
  const pitch = -Math.max(-D.pitchMax, Math.min(D.pitchMax, elev));
  return { yaw, pitch };
}

// ---------------------------------------------------------------- trick (b): light direction in camera space
// `keyDir` is the world direction from the character toward the key light (the look file's cast.keyDir).
export function lightInCamera(keyDir, camera) {
  const v = new THREE.Vector3(...keyDir).normalize();
  const q = camera.quaternion.clone().invert();
  v.applyQuaternion(q);
  return [v.x, v.y, v.z];
}

// ---------------------------------------------------------------- trick (c): fake head turn
// The angle between the character's facing (world yaw, facing vector (sin, cos)) and the direction to the camera.
// a > 0: the character is turned toward screen right. Returns the angle a (radians, -PI..PI), the feature shift in D
// (0.05..0.18, signed toward the turn) and whether we see the back of the head.
export function faceTurn(facingYaw, base, camPos, lookBias = 0) {
  const bearing = Math.atan2(camPos.x - base.x, camPos.z - base.z);
  let a = facingYaw - bearing;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  const mag = D.faceShift[0] + (D.faceShift[1] - D.faceShift[0]) * Math.min(1, Math.abs(a) / (90 * DEG));
  const side = a !== 0 ? Math.sign(a) : Math.sign(lookBias) || 1;
  return { angle: a, shift: side * mag, back: Math.abs(a) > 100 * DEG };
}

// Trick (e): the limbs on the far side (turned away from the camera) are drawn behind the body, 10% darker.
// Screen-right limbs are far when the character is turned toward screen right.
export function farSide(angle) {
  return angle >= 0 ? 'R' : 'L';
}
export function drawOrder(angle) {
  const far = farSide(angle);
  const near = far === 'R' ? 'L' : 'R';
  return {
    far,
    darken: 0.9,
    order: [`arm${far}`, `leg${far}`, `leg${near}`, 'body', `arm${near}`, 'head', 'face', 'hat'],
  };
}

// ---------------------------------------------------------------- trick (d): shadow proxy faces the key light
// The proxy plane's normal is horizontal and points at the light's azimuth, so the light sees its full silhouette.
export function proxyYaw(keyDir) {
  return Math.atan2(keyDir[0], keyDir[2]);
}

// ---------------------------------------------------------------- poses
const POSE_NUM = ['tilt', 'lean'];
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
// Blend two poses; discrete fields (eyes, brows, mouth, view) switch at the midpoint.
export function lerpPose(a, b, t) {
  const o = { ...(t < 0.5 ? a : b) };
  for (const k of ['armL', 'armR', 'legL', 'legR']) {
    const pa = a[k] ?? [0, 0];
    const pb = b[k] ?? [0, 0];
    o[k] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t)];
  }
  for (const k of POSE_NUM) o[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
  return o;
}
export const BLEND_FRAMES = 6;

// Pose at frame n (on twos: the pose state is that of frame 2*floor(n/2)). A track is [{ at, pose }], sorted by `at`.
export function poseAt(poses, track, n, blend = BLEND_FRAMES) {
  const f = Math.floor(n / 2) * 2;
  let i = 0;
  while (i < track.length - 1 && f >= track[i + 1].at) i++;
  const cur = poses[track[i].pose];
  if (!cur) throw new Error(`pose "${track[i].pose}" missing`);
  if (i === 0) return { pose: cur, name: track[0].pose };
  const t = (f - track[i].at) / blend;
  const prev = poses[track[i - 1].pose];
  if (t >= 1 || !prev) return { pose: cur, name: track[i].pose };
  return { pose: lerpPose(prev, cur, Math.max(0, t)), name: track[i].pose };
}

// Blinks: closed 2-3 frames, every 2-4 s, seeded.
export function blinkFrames(seed, frames, fps = 24) {
  const r = rng(hashSeed(`${seed}:blink`));
  const closed = new Set();
  let f = Math.round((1 + r() * 2) * fps);
  while (f < frames) {
    const len = r() < 0.5 ? 2 : 3;
    for (let i = 0; i < len; i++) closed.add(f + i);
    f += Math.round((2 + r() * 2) * fps);
  }
  return closed;
}

// Idle breathing: body scale y + 1.5% at 0.3 Hz (eased 0..1 so the body only ever grows).
export function breathAt(n, fps = 24) {
  const t = (Math.floor(n / 2) * 2) / fps;
  return D.breathAmp * 0.5 * (1 - Math.cos(2 * Math.PI * D.breathHz * t));
}

// Talk: the mouth alternates o / line on twos while the character speaks. `speak` is [[from, to], ...] in frames.
export function mouthAt(n, pose, speak = []) {
  const talking = speak.some(([a, b]) => n >= a && n < b);
  if (!talking) return pose.mouth ?? 'line';
  return Math.floor(n / 2) % 2 === 0 ? 'o' : 'line';
}
