// Tick, the guide (cast/guide/README.md): a floating pocket watch drawn parametrically to a canvas, like stick.mjs.
// Pure maths and drawing (no DOM at import); the 3D card lives in makeTick() at the bottom (browser only).
// The six 2.5D tricks: a) billboard, b) light-aware sphere shading of the face, c) face shift, d) a shadow proxy on the
// nearest surface (a silhouette decal, never a lamp shadow on others), e) far arm behind the face and 10% darker,
// f) key, shade, rim and tint from the look file's cast block.
import * as THREE from 'three';
import { D_METRES, billboardAngles, lightInCamera, faceTurn, farSide, blinkFrames } from './stickmath.mjs';
import { tones } from './stick.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';
import { LAYERS } from '../look/layers.mjs';

const DEG = Math.PI / 180;
export const ACCENT = '#E8336D';
const INK = '#141414';
const FACE_WHITE = '#F4EFE6';
// Units: head diameters D (1 D = 0.5 m, the cast's unit), so Tick's ink weight matches Fleet and Lee.
export const TICK = {
  face: 0.34 / D_METRES, // 0.34 m across = 0.68 D
  outline: 0.035,
  outlineVar: 0.15,
  eye: 0.15, // one large dot eye (2x a stick eye)
  eyeUp: 0.06, // just above centre
  hour: 0.19, // clock-hand lengths from the eye centre
  minute: 0.26,
  handW: [0.05, 0.036], // base widths (tapered to a point)
  marks: { r0: 0.255, r1: 0.3, w: 0.035 }, // 4 tick marks at 12, 3, 6, 9; no numerals
  crown: { stemW: 0.07, stemH: 0.05, w: 0.15, h: 0.09 },
  chain: { links: 4, len: 0.065 },
  ring: { gap: 0.03, w: 0.05 }, // countdown arc just outside the rim
  shoulder: { x: 0.33, y: -0.1 },
  arm: 0.62, // two segments of 0.31
  limb: 0.045,
  hand: 0.12,
  rim: 0.03,
  shiftScale: 0.6, // the face shift (0.05-0.18 D) scaled to the smaller face
  bobHz: 0.6,
  bobM: 0.02,
};
TICK.r = TICK.face / 2;
// Card canvas in D, centred on x; the face centre sits CARD.cy above the bottom edge.
export const TICK_CARD = { w: 2.1, h: 1.62, cy: 0.86 };
// Expressions are the clock-hand angles (degrees clockwise from 12): the hands grow from the eye and are its brows.
export function clockAngles(time) {
  const [h, m] = time.split(':').map(Number);
  return { hour: ((h % 12) * 60 + m) / 2, minute: m * 6 };
}
export const EXPRESSIONS = { calm: '10:10', alert: '12:00', sad: '8:20', worried: '9:15' };
export const expressionAngles = (name) => clockAngles(EXPRESSIONS[name] ?? EXPRESSIONS.calm);
export const BLEND = 6;
export const REFILL_FRAMES = 12;
export const FLASH = { count: 3, frames: 12 }; // 3 flashes on twos

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hexRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const css = (c) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- countdown ring
// keys: [{ at, value }] (frames). Linear between keys; full = the first value. A later key with a higher value holds the
// previous value until its frame, then refills over 12 frames. At 0 the ring flashes 3 times on twos. null = no countdown.
export function countdownAt(keys, n) {
  if (!keys?.length) return null;
  const k = [...keys].sort((a, b) => a.at - b.at);
  const full = k[0].value;
  let value;
  if (n <= k[0].at) value = k[0].value;
  else if (n >= k[k.length - 1].at) value = k[k.length - 1].value;
  else {
    let i = 0;
    while (n >= k[i + 1].at) i++;
    const a = k[i];
    const b = k[i + 1];
    value = b.value > a.value ? a.value : lerp(a.value, b.value, (n - a.at) / (b.at - a.at));
  }
  for (let i = 1; i < k.length; i++) {
    if (k[i].value > k[i - 1].value && n >= k[i].at && n < k[i].at + REFILL_FRAMES) value = lerp(k[i - 1].value, k[i].value, (n - k[i].at) / REFILL_FRAMES);
  }
  value = Math.max(0, value);
  // Frames where the value reaches 0 (each falling segment that crosses it).
  let flash = null;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (a.value > 0 && b.value <= 0) {
      const z = Math.ceil(a.at + ((b.at - a.at) * a.value) / (a.value - b.value));
      if (n >= z && n < z + FLASH.frames) flash = Math.floor((n - z) / 2) % 2 === 0;
    }
  }
  return { value, full, frac: full > 0 ? clamp(value / full, 0, 1) : 0, flash };
}

// ---------------------------------------------------------------- poses
// A pose: { armL: [shoulder, elbow], armR, reachL/reachR: [x, y] (D, face centre; 2-bone IK), face, eye, tilt, dx, dy,
// shake, spin }. Multi-drawing poses carry `drawings` (each overrides the pose fields), shown on twos; `loop: false` holds
// the last drawing.
const NUM = ['tilt', 'dx', 'dy', 'lean'];
export function lerpTickPose(a, b, t) {
  const o = { ...(t < 0.5 ? a : b) };
  for (const s of ['L', 'R']) {
    const ja = jointsOf(a, s);
    const jb = jointsOf(b, s);
    o['arm' + s] = [lerp(ja[0], jb[0], t), lerp(ja[1], jb[1], t)];
    delete o['reach' + s];
  }
  for (const k of NUM) o[k] = lerp(a[k] ?? 0, b[k] ?? 0, t);
  const ha = handsOf(a);
  const hb = handsOf(b);
  o.hands = { hour: lerpAngle(ha.hour, hb.hour, t), minute: lerpAngle(ha.minute, hb.minute, t) };
  return o;
}
const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
export function handsOf(p) {
  const base = p.hands ?? expressionAngles(p.face ?? 'calm');
  const spin = p.spin ?? 0;
  return { hour: base.hour + spin, minute: base.minute + spin * 2 };
}
// Shoulder and elbow angles for a side: either authored, or solved from a reach target (D, face-centre space).
export function jointsOf(p, side) {
  const reach = p['reach' + side];
  if (!reach) return p['arm' + side] ?? [10, 10];
  const sg = side === 'L' ? -1 : 1;
  const s = { x: sg * TICK.shoulder.x, y: TICK.shoulder.y };
  const seg = TICK.arm / 2;
  let dx = reach[0] - s.x;
  let dy = reach[1] - s.y;
  let d = Math.hypot(dx, dy);
  const dMax = 2 * seg * 0.999;
  if (d > dMax) {
    dx *= dMax / d;
    dy *= dMax / d;
    d = dMax;
  }
  // Screen angle from straight down, positive toward screen right: a = atan2(dx, -dy).
  const aT = Math.atan2(dx, -dy);
  const bend = Math.acos(clamp(d / (2 * seg), -1, 1));
  // The elbow bows outward (away from the face).
  const out = (b) => sg * (s.x + Math.sin(aT + b) * seg);
  const b = out(bend) >= out(-bend) ? bend : -bend;
  const a1 = aT + b;
  const a2 = aT - b;
  return [(a1 * sg) / DEG, ((a2 - a1) * sg) / DEG];
}

// Pose state at frame n (on twos). track: [{ at, pose }]. Returns the resolved drawing (numbers, hands) and its name.
export function tickPoseAt(poses, track, n) {
  const f = Math.floor(n / 2) * 2;
  let i = 0;
  while (i < track.length - 1 && f >= track[i + 1].at) i++;
  const name = track[i].pose;
  const drawing = (idx) => {
    const p = poses[track[idx].pose];
    if (!p) throw new Error(`guide pose "${track[idx].pose}" missing`);
    if (!p.drawings) return { ...p };
    const k = Math.floor((f - track[idx].at) / 2);
    const j = p.loop === false ? Math.min(p.drawings.length - 1, Math.max(0, k)) : ((k % p.drawings.length) + p.drawings.length) % p.drawings.length;
    const { drawings, loop, ...rest } = p;
    return { ...rest, ...drawings[j], drawing: j };
  };
  let cur = drawing(i);
  if (cur.shake) cur.dx = (cur.dx ?? 0) + cur.shake * (Math.floor(f / 2) % 2 ? 1 : -1);
  const resolve = (p) => ({ ...p, armL: jointsOf(p, 'L'), armR: jointsOf(p, 'R'), hands: handsOf(p) });
  cur = resolve(cur);
  if (i > 0) {
    const t = (f - track[i].at) / BLEND;
    if (t < 1 && !poses[name].drawings) return { pose: lerpTickPose(resolve(drawing(i - 1)), cur, Math.max(0, t)), name, start: track[i].at };
  }
  return { pose: cur, name, start: track[i].at };
}

// Arm chain in D (face-centre space, y up).
export function armChain(p, side) {
  const [sh, el] = p['arm' + side];
  const sg = side === 'L' ? -1 : 1;
  const s = { x: sg * TICK.shoulder.x, y: TICK.shoulder.y };
  const seg = TICK.arm / 2;
  const a1 = sh * sg * DEG;
  const a2 = (sh + el) * sg * DEG;
  const e = { x: s.x + Math.sin(a1) * seg, y: s.y - Math.cos(a1) * seg };
  const w = { x: e.x + Math.sin(a2) * seg, y: e.y - Math.cos(a2) * seg };
  return { shoulder: s, elbow: e, wrist: w };
}

// Bob: 0.6 Hz, 2 cm, from the frame index.
export const bobAt = (n, fps = 24) => TICK.bobM * Math.sin((2 * Math.PI * TICK.bobHz * n) / fps);

// Silhouette points (D, face-centre space) for framing tests: face disc, crown, ring, arms.
export function tickSilhouette(p) {
  const pts = [];
  const R = TICK.r + TICK.ring.gap + TICK.ring.w;
  for (let i = 0; i < 16; i++) pts.push([Math.cos((i / 16) * 6.2832) * R, Math.sin((i / 16) * 6.2832) * R]);
  pts.push([0, TICK.r + TICK.crown.stemH + TICK.crown.h]);
  for (const s of ['L', 'R']) for (const j of Object.values(armChain(p, s))) pts.push([j.x - 0.07, j.y], [j.x + 0.07, j.y], [j.x, j.y - 0.07], [j.x, j.y + 0.07]);
  const t = (p.tilt ?? 0) * DEG;
  return pts.map(([x, y]) => [x * Math.cos(t) + y * Math.sin(t) + (p.dx ?? 0), -x * Math.sin(t) + y * Math.cos(t) + (p.dy ?? 0)]);
}

// ---------------------------------------------------------------- drawing
function brush(ctx, pts, closed, w, seed) {
  const r = rng(hashSeed(seed));
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    ctx.lineWidth = w * (1 + TICK.outlineVar * (Math.sin(i * 0.31 + p1) + Math.sin(i * 0.77 + p2)) / 2);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}
const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * 6.2832) * r, cy + Math.sin((i / n) * 6.2832) * r]);

// st: { pose, angle, look: { shift }, light: { key, shade, rim, cam }, ring: countdownAt(...) | null, blink, seed, n }
export function drawTick(ctx, W, H, st) {
  const P = W / TICK_CARD.w;
  const { pose, light } = st;
  const key = hexRgb(light.key);
  const shade = hexRgb(light.shade);
  const [lx, ly, lz] = light.cam;
  const l2 = Math.hypot(lx, ly);
  const strength = clamp((l2 / Math.max(1e-6, Math.hypot(lx, ly, lz))) * 1.2, 0, 1);
  const lv = l2 > 1e-6 ? [lx / l2, -ly / l2] : [0, 0];
  const T = (base, dim = 1) => tones(base, { key, shade, strength, dim });
  const ow = TICK.outline * P;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  // Face-centre space: x right, y up, in D.
  ctx.translate(W / 2 + (pose.dx ?? 0) * P, H - (TICK_CARD.cy + (pose.dy ?? 0)) * P);
  ctx.rotate((pose.tilt ?? 0) * DEG);
  const L = (x, y) => [x * P, -y * P];
  const far = farSide(st.angle);
  const sphere = (c, rpx, t, off = 0.32) => {
    const o = off * rpx * strength;
    const g = ctx.createRadialGradient(c[0] + lv[0] * o, c[1] + lv[1] * o, 0, c[0], c[1], rpx + o);
    g.addColorStop(0, css(t.lit));
    g.addColorStop(0.3, css(mix(t.lit, t.mid, 0.7)));
    g.addColorStop(0.62, css(t.mid));
    g.addColorStop(1, css(t.shade));
    return g;
  };
  const arm = (side, dim) => {
    const a = armChain(pose, side);
    const t = T('#2A3345', dim);
    for (const [p0, p1] of [[a.shoulder, a.elbow], [a.elbow, a.wrist]]) {
      const A = L(p0.x, p0.y);
      const B = L(p1.x, p1.y);
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = (TICK.limb + 2 * TICK.outline) * P;
      ctx.beginPath();
      ctx.moveTo(...A);
      ctx.lineTo(...B);
      ctx.stroke();
      ctx.strokeStyle = css(t.mid);
      ctx.lineWidth = TICK.limb * P;
      ctx.beginPath();
      ctx.moveTo(...A);
      ctx.lineTo(...B);
      ctx.stroke();
    }
    const w = L(a.wrist.x, a.wrist.y);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(w[0], w[1], (TICK.hand / 2) * P, 0, 6.2832);
    ctx.fill();
  };
  // e) the far arm behind the face, 10% darker.
  arm(far, 0.9);

  // Chain: a short hanging chain from the crown bow, swaying with the bob (ink links, no new colour).
  const crownTop = TICK.r + TICK.crown.stemH;
  const sway = Math.sin((2 * Math.PI * TICK.bobHz * (st.n ?? 0)) / 24 + 1.1) * 0.25;
  let cp = [TICK.crown.w * 0.55, crownTop + TICK.crown.h * 0.4];
  ctx.lineWidth = TICK.outline * 0.6 * P;
  ctx.strokeStyle = INK;
  for (let i = 0; i < TICK.chain.links; i++) {
    const a = -0.35 - i * 0.28 + sway;
    const nxt = [cp[0] + Math.sin(-a) * TICK.chain.len + 0.02, cp[1] - Math.cos(a) * TICK.chain.len];
    const c = L((cp[0] + nxt[0]) / 2, (cp[1] + nxt[1]) / 2);
    ctx.beginPath();
    ctx.ellipse(c[0], c[1], TICK.chain.len * 0.55 * P, (i % 2 ? 0.012 : 0.022) * P, Math.atan2(-(nxt[1] - cp[1]), nxt[0] - cp[0]), 0, 6.2832);
    ctx.stroke();
    cp = nxt;
  }

  // Crown: stem + knurled knob in the accent colour.
  const ct = T(ACCENT);
  const stem = L(-TICK.crown.stemW / 2, TICK.r + TICK.crown.stemH);
  ctx.fillStyle = css(ct.shade);
  ctx.fillRect(stem[0], stem[1], TICK.crown.stemW * P, (TICK.crown.stemH + 0.02) * P);
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 0.7;
  ctx.strokeRect(stem[0], stem[1], TICK.crown.stemW * P, (TICK.crown.stemH + 0.02) * P);
  const kc = L(0, crownTop + TICK.crown.h / 2);
  const kw = TICK.crown.w * P;
  const kh = TICK.crown.h * P;
  ctx.beginPath();
  ctx.ellipse(kc[0], kc[1], kw / 2, kh / 2, 0, 0, 6.2832);
  ctx.fillStyle = sphere(kc, kw / 2, ct, 0.4);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 0.35;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(kc[0] + i * kw * 0.13, kc[1] - kh / 2);
    ctx.lineTo(kc[0] + i * kw * 0.13, kc[1] + kh / 2);
    ctx.stroke();
  }
  ctx.restore();
  brush(ctx, circle(kc[0], kc[1], 1, 28).map(([x, y]) => [kc[0] + (x - kc[0]) * kw / 2, kc[1] + (y - kc[1]) * kh / 2]), true, ow * 0.8, `${st.seed}:crown`);

  // b) Face: a white disc shaded as a sphere toward the key light (camera space), ink outline, rim light.
  const rpx = TICK.r * P;
  const ft = T(FACE_WHITE);
  ctx.beginPath();
  ctx.arc(0, 0, rpx, 0, 6.2832);
  ctx.fillStyle = sphere([0, 0], rpx, ft);
  ctx.fill();
  brush(ctx, circle(0, 0, rpx), true, ow, `${st.seed}:face`);
  if (l2 > 0.12 * Math.hypot(lx, ly, lz)) {
    const th = Math.atan2(lv[1], lv[0]) - (pose.tilt ?? 0) * DEG;
    ctx.strokeStyle = light.rim;
    ctx.lineWidth = TICK.rim * P;
    ctx.beginPath();
    ctx.arc(0, 0, rpx - ow * 0.5 - TICK.rim * P * 0.5, th - 1.1, th + 1.1);
    ctx.stroke();
  }
  // Four tick marks, no numerals.
  ctx.strokeStyle = INK;
  ctx.lineCap = 'butt';
  ctx.lineWidth = TICK.marks.w * P;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(...L(Math.sin(a) * TICK.marks.r0, Math.cos(a) * TICK.marks.r0));
    ctx.lineTo(...L(Math.sin(a) * TICK.marks.r1, Math.cos(a) * TICK.marks.r1));
    ctx.stroke();
  }

  // c) Face shift: the eye and its hands slide toward the look direction and squash with the turn.
  const sh = (st.look?.shift ?? 0) * TICK.shiftScale;
  const sx = 1 - 0.25 * Math.min(1, Math.abs(st.angle) / (Math.PI / 2));
  const ec = L(sh, TICK.eyeUp);
  // Clock hands: tapered, from the eye outward (the brows). Angles clockwise from 12.
  const hand = (deg, len, w0) => {
    const a = deg * DEG;
    const dx = Math.sin(a) * sx;
    const dy = Math.cos(a);
    const nx = -dy;
    const ny = dx;
    const b = L(sh + dx * TICK.eye * 0.35, TICK.eyeUp + dy * TICK.eye * 0.35);
    const tip = L(sh + dx * len, TICK.eyeUp + dy * len);
    const w = (w0 / 2) * P;
    ctx.beginPath();
    ctx.moveTo(b[0] + nx * w, b[1] - ny * w);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(b[0] - nx * w, b[1] + ny * w);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
  };
  hand(pose.hands.hour, TICK.hour, TICK.handW[0]);
  hand(pose.hands.minute, TICK.minute, TICK.handW[1]);
  const er = (TICK.eye / 2) * P * (pose.eye === 'wide' ? 1.2 : 1);
  ctx.fillStyle = INK;
  if (st.blink || pose.eye === 'closed') {
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineWidth = TICK.outline * P;
    ctx.beginPath();
    ctx.arc(ec[0], ec[1] - er * 0.4, er * 1.1, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(ec[0], ec[1], er * sx, er, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ec[0] + er * 0.32, ec[1] - er * 0.36, er * 0.22, 0, 6.2832);
    ctx.fill();
  }

  // Countdown ring: a magenta arc round the rim from 12 o'clock, clockwise; flashing full at 0; hidden with no countdown.
  const ring = st.ring;
  if (ring) {
    const frac = ring.flash === null ? ring.frac : ring.flash ? 1 : 0;
    if (frac > 0) {
      const rr = (TICK.r + TICK.ring.gap + TICK.ring.w / 2) * P;
      const a0 = -Math.PI / 2;
      const a1 = a0 + frac * 2 * Math.PI;
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = (TICK.ring.w + TICK.outline * 1.2) * P;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a1);
      ctx.stroke();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = TICK.ring.w * P;
      ctx.beginPath();
      ctx.arc(0, 0, rr, a0, a1);
      ctx.stroke();
    }
  }
  // Near arm in front of the face.
  arm(far === 'L' ? 'R' : 'L', 1);
  ctx.restore();
}

// ---------------------------------------------------------------- shadow proxy on the nearest surface
// Rays from the face centre along the axes (down, +-x, +-z); the closest solid hit is the surface Tick's shadow lies on.
export const SHADOW_RAYS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
export function nearestSurface(origin, meshes, maxDist = 3) {
  const rc = new THREE.Raycaster();
  rc.far = maxDist;
  let best = null;
  for (const d of SHADOW_RAYS) {
    rc.set(origin, new THREE.Vector3(...d));
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit && (!best || hit.distance < best.distance)) {
      const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(...d).negate();
      if (nrm.dot(new THREE.Vector3(...d)) > 0) nrm.negate();
      best = { distance: hit.distance, point: hit.point.clone(), normal: nrm.normalize(), dir: d };
    }
  }
  return best;
}
// Orientation of the shadow decal: its plane lies on the surface (normal = surface normal); +y of the decal is world up
// projected on the surface, or the key-light direction for a floor.
export function decalBasis(normal, keyDir) {
  const n = normal.clone().normalize();
  let up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (up.lengthSq() < 1e-4) up = new THREE.Vector3(...keyDir).addScaledVector(n, -new THREE.Vector3(...keyDir).dot(n)).negate();
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
  up.normalize();
  const x = new THREE.Vector3().crossVectors(up, n).normalize();
  return new THREE.Matrix4().makeBasis(x, up, n);
}

// ---------------------------------------------------------------- the 3D card (browser)
const PX_PER_D = 300;
export async function makeTick(scene, spec, anchors, palette, { tint, seed = 'tick', frames = 10000, countdown = null } = {}) {
  const anchor = anchors[spec.anchor];
  if (!anchor) throw new Error(`guide anchor "${spec.anchor}" missing`);
  const cast = palette.json.cast;
  const poses = await (await fetch('/cast/guide/poses.json')).json();
  const light = { key: palette.hex(cast.key), shade: palette.hex(cast.shade), rim: palette.hex(cast.rim) };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(TICK_CARD.w * PX_PER_D);
  canvas.height = Math.round(TICK_CARD.h * PX_PER_D);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = TICK_CARD.w * D_METRES;
  const h = TICK_CARD.h * D_METRES;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, (TICK_CARD.h / 2 - TICK_CARD.cy) * D_METRES, 0); // the face centre at the origin
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tint ?? 0xffffff, transparent: false, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide, fog: true });
  const prepassMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } },
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; void main(){ if (texture2D(map, vUv).a < 0.5) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
  });
  const card = new THREE.Mesh(geo, mat);
  card.rotation.order = 'YXZ';
  card.name = 'card:guide';
  card.castShadow = false; // never a lamp shadow on others
  card.receiveShadow = false;
  const group = new THREE.Group();
  group.name = 'card:guide';
  group.add(card);
  scene.add(group);
  group.traverse((o) => o.layers.set(LAYERS.CARD));
  card.layers.set(LAYERS.CARD_BODY);

  // d) Shadow proxy on the nearest surface: Tick's silhouette as an ink decal (40%), placed once on the closest solid.
  anchor.updateWorldMatrix(true, false);
  const home = anchor.getWorldPosition(new THREE.Vector3());
  scene.updateMatrixWorld(true);
  const solids = [];
  scene.traverse((o) => { if (o.isMesh && o.layers.isEnabled(LAYERS.SOLID) && !o.userData.isHull && o.visible) solids.push(o); });
  const surf = nearestSurface(home, solids);
  let decal = null;
  if (surf) {
    const dmat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uInk: { value: new THREE.Color(palette.json.ink) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 uInk; varying vec2 vUv; void main(){ if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(uInk, 0.4); }',
    });
    decal = new THREE.Mesh(geo, dmat);
    decal.name = 'shadow_proxy:guide';
    decal.castShadow = false;
    // The shadow falls along the key light onto that surface's plane (never farther than 0.6 m from the nearest point).
    const k = new THREE.Vector3(...cast.keyDir).normalize().negate();
    const denom = k.dot(surf.normal);
    let p = surf.point.clone();
    if (denom < -0.2) {
      const t = surf.point.clone().sub(home).dot(surf.normal) / denom;
      const q = home.clone().addScaledVector(k, t);
      if (q.distanceTo(surf.point) < 0.6) p = q;
    }
    decal.matrixAutoUpdate = true;
    decal.position.copy(p).addScaledVector(surf.normal, 0.004);
    decal.quaternion.setFromRotationMatrix(decalBasis(surf.normal, cast.keyDir));
    decal.scale.setScalar(0.85);
    decal.layers.set(LAYERS.CARD);
    (anchor.parent ?? scene).attach(decal);
  }
  const facingFor = () => {
    if (spec.facing !== undefined) return spec.facing * DEG;
    const eye = anchors[spec.faceAnchor ?? 'cam_lookout'];
    if (!eye) return 0;
    const e = eye.getWorldPosition(new THREE.Vector3());
    const b = anchor.getWorldPosition(new THREE.Vector3());
    return Math.atan2(e.x - b.x, e.z - b.z);
  };
  const offset = new THREE.Vector3(...(spec.offset ?? [0, 0, 0]));
  const base = new THREE.Vector3();
  const api = {
    group,
    card,
    decal,
    surface: surf,
    mat,
    prepassMat,
    last: null,
    prepass(on) {
      card.material = on ? prepassMat : mat;
    },
    // e = the baked plan entry { anchor, pose, name, start, ring, blink } (tools/bake.mjs).
    update(n, camera, e) {
      const { pose: p0, name, start } = e;
      // A camera slot (engine/rig/slots.mjs) arrives baked as e.pos (drift included) and draws over the set like a viewmodel.
      const slot = !!e.pos;
      if (slot) base.fromArray(e.pos);
      else {
        const at = anchors[e.anchor] ?? anchor;
        at.updateWorldMatrix(true, false);
        at.getWorldPosition(base).add(offset);
        const drift = poses[name]?.drift;
        if (drift) base.addScaledVector(new THREE.Vector3(...drift), Math.max(0, n - start) / 24);
      }
      // Over the set: the depth test always passes (it still writes depth, so the sea and other transparent layers drawn later
      // stay behind Tick); drawn last among the opaques.
      const df = slot ? THREE.AlwaysDepth : THREE.LessEqualDepth;
      if (mat.depthFunc !== df) {
        mat.depthFunc = prepassMat.depthFunc = df;
        mat.needsUpdate = prepassMat.needsUpdate = true;
      }
      card.renderOrder = slot ? 10 : 0;
      if (decal) decal.visible = !slot;
      base.y += bobAt(n);
      group.position.copy(base);
      const bb = billboardAngles(base, camera.position, 0);
      card.rotation.set(bb.pitch, bb.yaw, 0);
      if (n % 2 === 0 || !api.last) {
        const pose = { ...p0, ...(spec.face ? { hands: handsOf({ ...p0, hands: undefined, face: spec.face }) } : {}) };
        const look = faceTurn(facingFor(), base, camera.position, 1);
        const st = { pose, angle: look.angle, look, light: { ...light, cam: lightInCamera(cast.keyDir, camera) }, ring: e.ring, blink: e.blink, seed: `${seed}:guide`, n };
        drawTick(ctx, canvas.width, canvas.height, st);
        tex.needsUpdate = true;
        api.last = { n, ...bb, pose: name, ring: st.ring, shift: look.shift };
      }
    },
  };
  return api;
}
