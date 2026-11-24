// POV rig: camera state from (shot, localFrame). Pure functions: no scene access, deterministic.
// The scene supplies world points through ctx (see engine/rig/shotcam.mjs). Eye height 1.62 m (the anchors carry it).
// Layers, in order: preset (engine/rig/presets.mjs) -> base motion (breathing, FOV push, dolly) under every preset.
import { BASE_MOTION, DOLLY_PRESETS } from './camera.mjs';
import { PRESETS, DEG, EYE_HEIGHT, MAX_ROT, dirTo, wrap180, smooth } from './presets.mjs';

export { EYE_HEIGHT, MAX_ROT };
export const NO_CLAMP = new Set(['whip', 'dive', 'rise']);

// Resolve a look spec: an anchor name (+ optional lift in metres), 'base' (the anchor's own look) or {yaw, pitch}.
function look(spec, ctx, pos, base) {
  if (spec === undefined || spec === null || spec === 'base') return base;
  if (typeof spec === 'object' && spec.yaw !== undefined) return { yaw: spec.yaw, pitch: spec.pitch };
  const name = typeof spec === 'string' ? spec : spec.anchor;
  const p = ctx.point(name);
  const lift = typeof spec === 'object' ? spec.lift ?? 0 : 0;
  return dirTo(pos, [p[0], p[1] + lift, p[2]]);
}

// turnToSound(anchorPos, soundFrame, delayFrames = 8): the head turns to an off-frame sound, `delayFrames` after it starts.
// Returns the frame (in the same frame counting as soundFrame) at which the turn begins, and the look to turn to.
export function turnToSound(anchorPos, soundFrame, delayFrames = 8) {
  return { start: soundFrame + delayFrames, point: anchorPos };
}

// ctx: { fps, shotFrames, n0 (shot's first frame), eye:[x,y,z], yaw0, pitch0, fov0, point(name)->[x,y,z], hook(m, reverse) }
export function povState(cam, m, ctx) {
  const preset = cam.preset ?? 'held';
  const fn = PRESETS[preset];
  if (!fn) throw new Error(`pov: unknown preset "${preset}"`);
  const fps = ctx.fps;
  const t = m / fps;
  const T = Math.max(1, ctx.shotFrames - 1) / fps;
  const base = { yaw: ctx.yaw0, pitch: ctx.pitch0 };
  const p = {
    ...cam,
    eye: ctx.eye,
    yaw0: ctx.yaw0,
    pitch0: ctx.pitch0,
    fov0: cam.fov0 ?? ctx.fov0,
    fps,
    T,
    hook: ctx.hook,
  };
  p.fromLook = look(cam.from, ctx, ctx.eye, base);
  p.toLook = look(cam.to, ctx, ctx.eye, base);
  if (cam.object) p.object = ctx.point(cam.object);
  if (cam.target) p.target = ctx.point(cam.target);
  if (cam.pos) p.pos = ctx.point(cam.pos);
  // Sound-led turns: `soundFrame` (absolute) starts the turn `delayFrames` later.
  if (cam.soundFrame !== undefined) {
    const s = turnToSound(null, cam.soundFrame, cam.delayFrames ?? 8);
    p.at = Math.max(0, (s.start - ctx.n0) / fps);
  }
  const r = fn(p, t);
  if (r.hook) {
    const h = r.exact;
    return { pos: r.pos, yaw: h.yaw, pitch: h.pitch, roll: h.roll, fov: h.fov, panini: h.panini ?? h.fov >= 80, streak: h.streak ?? [0, 0], smear: false, rest: false, preset, hook: true };
  }
  const M = { ...BASE_MOTION, dolly: DOLLY_PRESETS[preset] ?? 0, ...(cam.motion ?? {}) };
  const pos = [...r.pos];
  // Base motion layered under every preset: breathing sway, dolly (walk only), FOV push (held shots).
  const breath = Math.sin(2 * Math.PI * M.breathHz * t);
  pos[1] += M.breathLift * Math.sin(2 * Math.PI * M.breathHz * t + Math.PI / 2);
  const d = dirTo(pos, r.target);
  const dolly = Math.min(M.dolly, ctx.maxDolly ?? Infinity) * smooth(t / T);
  const yawR = d.yaw * DEG;
  pos[0] += -Math.sin(yawR) * dolly;
  pos[2] += -Math.cos(yawR) * dolly;
  const pushing = cam.held !== false && preset !== 'snap' && preset !== 'whip' && preset !== 'witness';
  const fov = r.fov - (pushing ? Math.min(M.push * t, M.pushMax) : 0);
  return {
    pos,
    yaw: d.yaw,
    pitch: d.pitch + M.breathPitch * breath,
    roll: r.roll,
    fov,
    panini: cam.panini ?? fov >= 80,
    streak: r.streak ?? [0, 0],
    smear: !!r.smear,
    rest: !!r.rest && preset !== 'walk',
    preset,
  };
}

export { wrap180 };
