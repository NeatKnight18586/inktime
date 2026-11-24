// POV presets: each is (params, t) -> { pos, target, fov, roll, streak?, smear?, rest? }.
// Pure functions of their inputs (no scene access). Angles in degrees, yaw 0 = looking down -Z, positive yaw = to the left
// (the same convention as engine/rig/camera.mjs). t is seconds from the shot's first frame.
// Params (resolved by engine/rig/pov.mjs): eye [x,y,z], yaw0/pitch0/fov0 (the anchor's own look), fps, T (shot seconds),
// plus the shot's own fields (from/to as {yaw,pitch} or points, dur, at, fov, ...).
export const DEG = Math.PI / 180;
export const MAX_ROT = 90; // deg/s outside whip, dive and rise
export const EYE_HEIGHT = 1.62;
export const SETTLE_FRAMES = 3;
const SETTLE_AMP = 0.04;

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smooth = (u) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
export const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
export const aimPoint = (pos, yaw, pitch, R = 100) => [
  pos[0] - Math.sin(yaw * DEG) * Math.cos(pitch * DEG) * R,
  pos[1] + Math.sin(pitch * DEG) * R,
  pos[2] - Math.cos(yaw * DEG) * Math.cos(pitch * DEG) * R,
];
export const dirTo = (from, to) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { yaw: Math.atan2(-dx, -dz) / DEG, pitch: Math.atan2(dy, Math.hypot(dx, dz)) / DEG };
};
const angleOf = (a, b) => Math.hypot(wrap180(b.yaw - a.yaw), b.pitch - a.pitch);

// A head turn between two looks. The duration is lengthened when needed so that the peak speed (smoothstep peak = 1.5 x
// mean, plus the settle overshoot) never passes MAX_ROT: duration >= 1.65 x angle / MAX_ROT. After the turn a 2-3 frame
// damped settle (overshoot 4%) returns to the target.
export function turnDuration(angle, dur) {
  return Math.max(dur, (1.65 * angle) / MAX_ROT);
}
export function turn(a, b, t, { at = 0, dur = 0.5, fps = 24 } = {}) {
  const ang = angleOf(a, b);
  const D = turnDuration(ang, dur);
  const dy = wrap180(b.yaw - a.yaw);
  const dp = b.pitch - a.pitch;
  const u = (t - at) / D;
  let w = smooth(u);
  if (u > 1) w += SETTLE_AMP * Math.sin(Math.PI * clamp01((t - at - D) / (SETTLE_FRAMES / fps)));
  if (u <= 0) w = 0;
  return { yaw: a.yaw + dy * w, pitch: a.pitch + dp * w, ang, D, moving: u > 0 && u < 1 + SETTLE_FRAMES / fps / D };
}

const baseLook = (p) => ({ yaw: p.yaw0, pitch: p.pitch0 });
const fromLook = (p) => p.fromLook ?? baseLook(p);
const toLook = (p) => p.toLook ?? baseLook(p);

function out(p, pos, look, fov, roll = 0, extra = {}) {
  return { pos, target: aimPoint(pos, look.yaw, look.pitch), fov, roll, ...extra };
}

export const PRESETS = {
  // Walk: bob only here. 1.8 Hz, 1.5 cm vertical, 0.4 deg roll (at the half rate, left-right).
  walk(p, t) {
    const pos = [...p.eye];
    pos[1] += 0.015 * Math.sin(2 * Math.PI * 1.8 * t);
    return out(p, pos, baseLook(p), p.fov0, 0.4 * Math.sin(2 * Math.PI * 0.9 * t));
  },
  // Glance: a head turn to an anchor in 0.35-0.6 s (default 0.5), then held. p.fov eases with the turn.
  glance(p, t) {
    const k = turn(fromLook(p), toLook(p), t, { at: p.at ?? 0, dur: p.dur ?? 0.5, fps: p.fps });
    const f = p.fov === undefined ? p.fov0 : p.fov0 + (p.fov - p.fov0) * smooth((t - (p.at ?? 0)) / k.D);
    return out(p, [...p.eye], k, f, 0, { rest: !k.moving });
  },
  // Look-up / look-down: a vertical tilt-reveal between two anchors over the shot (or p.dur).
  lookup(p, t) {
    const k = turn(fromLook(p), toLook(p), t, { at: p.at ?? 0, dur: p.dur ?? p.T, fps: p.fps });
    return out(p, [...p.eye], k, p.fov === undefined ? p.fov0 : p.fov, 0, { rest: !k.moving });
  },
  lookdown(p, t) {
    return PRESETS.lookup(p, t);
  },
  // Kneel: the eye drops to 0.9 m above the floor over 0.6 s.
  kneel(p, t) {
    const pos = [...p.eye];
    const floor = p.eye[1] - EYE_HEIGHT;
    pos[1] = p.eye[1] + (floor + 0.9 - p.eye[1]) * smooth(t / 0.6);
    return out(p, pos, baseLook(p), p.fov0, 0, { rest: t > 0.6 });
  },
  // Held: the camera sits 0.45 m from the object, tilted 12 deg down at it; FOV push 1 deg/s (the base layer adds it).
  held(p, t) {
    if (!p.object) return out(p, [...p.eye], baseLook(p), p.fov0, 0, { rest: true });
    const o = p.object;
    const back = [o[0] - p.eye[0], o[2] - p.eye[2]];
    const hl = Math.hypot(back[0], back[1]) || 1;
    const pos = [o[0] - (back[0] / hl) * 0.45, o[1] + 0.45 * Math.tan(12 * DEG), o[2] - (back[1] / hl) * 0.45];
    const look = dirTo(pos, o);
    return out(p, pos, { yaw: look.yaw, pitch: -12 }, p.fov0, 0, { rest: true });
  },
  // Snap: a reveal zoom to vFOV 20 over 3 frames (hard in, no settle), aimed at the target.
  snap(p, t) {
    const u = clamp01((t - (p.at ?? 0)) / (3 / p.fps));
    const w = 1 - (1 - u) * (1 - u);
    return out(p, [...p.eye], toLook(p), p.fov0 + (20 - p.fov0) * w, 0, { rest: u >= 1 });
  },
  // Witness: third-person wide, vFOV 84, from a camera position looking at the subject.
  witness(p, t) {
    const pos = p.pos ?? p.eye;
    const look = p.target ? dirTo(pos, p.target) : baseLook(p);
    return out(p, [...pos], look, 84, 0, { rest: true });
  },
  // Whip: an 8-frame snap between two looks (cubic ease), a directional misregistration along the motion (never blur) and
  // one smear frame of stretched ink streaks at peak speed (frame 4).
  whip(p, t) {
    const a = fromLook(p);
    const b = toLook(p);
    const T8 = 8 / p.fps;
    const u = clamp01(t / T8);
    const w = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const dw = u < 0.5 ? 12 * u * u : 6 * Math.pow(1 - u, 2); // dw/du
    const dy = wrap180(b.yaw - a.yaw);
    const dpt = b.pitch - a.pitch;
    const speed = (Math.hypot(dy, dpt) * dw) / T8; // deg/s
    const px = Math.min(90, speed * 1.2);
    const len = Math.hypot(dy, dpt) || 1;
    // Screen direction of the motion (yaw to the left moves the picture to the right).
    const streak = [(-dy / len) * -px, (dpt / len) * px * -1].map((v) => (u > 0 && u < 1 ? v : 0));
    const look = { yaw: a.yaw + dy * w, pitch: a.pitch + dpt * w };
    const m = Math.floor(t * p.fps + 1e-6);
    return out(p, [...p.eye], look, p.fov0, 0, { streak, smear: m === 4, rest: u >= 1 });
  },
  // Dive and rise: the existing hook paths, wrapped unchanged (p.hook(m) runs engine/rig/camera.mjs poseHook).
  dive(p, t) {
    return hookPreset(p, t, false);
  },
  rise(p, t) {
    return hookPreset(p, t, true);
  },
};

function hookPreset(p, t, reverse) {
  const h = p.hook(Math.round(t * p.fps), reverse);
  return { pos: h.pos, target: aimPoint(h.pos, h.yaw, h.pitch), fov: h.fov, roll: h.roll, streak: h.streak, panini: h.panini, hook: true, rest: false, exact: h };
}
