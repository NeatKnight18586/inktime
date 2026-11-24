import * as THREE from 'three';

const DEG = Math.PI / 180;
const easeInOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Shot list: spec.shots [{frames, camera, show}] or a single spec.camera for all frames.
export function shotAt(spec, n) {
  if (!spec.shots) return { camera: spec.camera, start: 0, frames: spec.frames, show: [], index: 0 };
  let start = 0;
  for (const [index, shot] of spec.shots.entries()) {
    if (n < start + shot.frames) return { show: [], ...shot, start, index };
    start += shot.frames;
  }
  const last = spec.shots.at(-1);
  return { show: [], ...last, start: start - last.frames, index: spec.shots.length - 1 };
}

export function totalFrames(spec) {
  return spec.shots ? spec.shots.reduce((s, x) => s + x.frames, 0) : spec.frames;
}

// Base motion on every shot (STYLE). The dolly is 0 unless the shot names a preset that dollies (walk, dive, rise);
// lookout and held shots get FOV push and breathing only. A dollying shot eases in and out and moves at most 0.25 m
// (less if the anchor says so, e.g. so the eye stays 0.45 m from the rim); beyond that only the FOV push
// (1 deg/s, at most 8 deg per shot) plus breathing sway (0.25 Hz, 0.15 deg pitch, 4 mm). No frame is still.
// cam.pushPct adds a push along the view of that percentage of the anchor's aim distance per second (aerial).
export const BASE_MOTION = { dolly: 0, breathHz: 0.25, breathPitch: 0.15, breathLift: 0.004, push: 1.0, pushMax: 8 };

export const DOLLY_PRESETS = { walk: 0.25, dive: 0.25, rise: 0.25 };

// ---------------------------------------------------------------- hook (dive / rise)
// A Catmull-Rom spline through the set's knots (time-parameterised, zero speed at both ends): position, yaw, pitch, roll, FOV.
// The dive lands at frame shotFrames-1-landHold and shakes for the last landHold frames; the rise is the exact reverse
// (the shake comes first, the path then runs backwards and ends on the first knot's pose and FOV).
const hash01 = (k) => {
  const x = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export function hookFrames(hook, shotFrames) {
  const land = Math.max(1, shotFrames - 1 - hook.landHold);
  return { land, seconds: (shotFrames - 1) / 24 };
}

function hermite(ts, vs, t) {
  const n = ts.length;
  let i = 0;
  while (i < n - 2 && t >= ts[i + 1]) i++;
  const dt = ts[i + 1] - ts[i];
  const s = Math.min(1, Math.max(0, (t - ts[i]) / dt));
  // Catmull-Rom tangents, limited per component so a segment never overshoots its knots (no dips at the ends).
  const tan = (j) => {
    if (j <= 0 || j >= n - 1) return vs[j].map(() => 0);
    return vs[j + 1].map((v, c) => {
      const d0 = (vs[j][c] - vs[j - 1][c]) / (ts[j] - ts[j - 1]);
      const d1 = (v - vs[j][c]) / (ts[j + 1] - ts[j]);
      if (d0 * d1 <= 0) return 0;
      const cr = (v - vs[j - 1][c]) / (ts[j + 1] - ts[j - 1]);
      const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
      return Math.sign(cr) * Math.min(Math.abs(cr), lim);
    });
  };
  const m0 = tan(i);
  const m1 = tan(i + 1);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return vs[i].map((v, c) => h00 * v + h10 * dt * m0[c] + h01 * vs[i + 1][c] + h11 * dt * m1[c]);
}

// Knot values in world space for the dive at frame-0 time t0 (s): [x, y, z, yaw, pitch, roll, fov] per knot.
function hookKnots(hook, t0, land, reverse, shipPose, fps) {
  const D = land / fps;
  const head = reverse ? hook.landHold : 0;
  const rows = [];
  let prevYaw = null;
  for (const k of hook.knots) {
    const tk = k.u * D;
    const abs = reverse ? t0 + head / fps + (D - tk) : t0 + tk;
    let [x, y, z] = k.pos;
    let yaw = k.yaw;
    if (k.ref === 'ship') {
      const sp = shipPose(abs);
      const c = Math.cos(sp.yaw);
      const sn = Math.sin(sp.yaw);
      [x, z] = [x * c + z * sn + sp.x, -x * sn + z * c + sp.z];
      yaw += sp.yaw / DEG;
    }
    if (prevYaw !== null) while (yaw - prevYaw > 180) yaw -= 360;
    if (prevYaw !== null) while (yaw - prevYaw < -180) yaw += 360;
    prevYaw = yaw;
    rows.push([x, y, z, yaw, k.pitch, k.roll, k.fov]);
  }
  return { rows, times: hook.knots.map((k) => k.u * D) };
}

// Pose the camera on the hook path. m: frame in the shot; n0: the shot's first frame; shipPose(t) -> {x, z, yaw}.
export function poseHook(camera, hook, m, n0, shotFrames, fps, shipPose, reverse = false) {
  const { land } = hookFrames(hook, shotFrames);
  const D = land / fps;
  const head = reverse ? hook.landHold : 0;
  const { rows, times } = hookKnots(hook, n0 / fps, land, reverse, shipPose, fps);
  const clampT = (f) => Math.min(D, Math.max(0, f / fps));
  const tauAt = (frame) => (reverse ? D - clampT(frame - head) : clampT(frame));
  const at = (frame) => hermite(times, rows, tauAt(frame));
  const v = at(m);
  const shakeFrames = reverse ? m < hook.landHold : m > land;
  if (shakeFrames) {
    const k = reverse ? hook.landHold - m : m - land; // 1 then 2: decaying landing shake
    const a = 1.6 / (k * k);
    v[1] += (hash01(m * 3 + 1) - 0.5) * 0.04 * a;
    v[3] += (hash01(m * 3 + 2) - 0.5) * 1.6 * a;
    v[4] += (hash01(m * 3 + 3) - 0.5) * 2.4 * a;
    v[5] += (hash01(m * 3 + 4) - 0.5) * 1.2 * a;
  }
  camera.position.set(v[0], v[1], v[2]);
  camera.quaternion.setFromEuler(new THREE.Euler(v[4] * DEG, v[3] * DEG, v[5] * DEG, 'YXZ'));
  if (camera.fov !== v[6]) {
    camera.fov = v[6];
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  // Speed streaks (directional misregistration): world speed of the path, in screen space along the lateral motion.
  const a = at(m - 1);
  const b = at(m + 1);
  const vel = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).multiplyScalar(fps / 2);
  const speed = vel.length();
  const vc = vel.clone().applyQuaternion(camera.quaternion.clone().invert());
  const lat = new THREE.Vector2(-vc.x, -vc.y);
  const dir = lat.length() > 0.2 * speed ? lat.normalize() : new THREE.Vector2(Math.cos(0.62), Math.sin(0.62));
  const amount = Math.min(1, Math.max(0, (speed - 40) / 260));
  const px = HOOK_STREAK_PX * amount * amount;
  return { fov: v[6], panini: v[6] >= 80, dolly: 0, streak: [dir.x * px, dir.y * px], speed };
}
export const HOOK_STREAK_PX = 22;

// m is the frame index within the shot, shotFrames its length. Camera anchors carry userData
// {yaw, pitch, fov, panini, maxDolly, aimDist}.
export function poseCamera(camera, cam, anchors, m, fps, shotFrames = m + 1, opts = {}) {
  const anchor = anchors[cam.anchor];
  if (!anchor) throw new Error(`camera anchor "${cam.anchor}" missing`);
  // dive / rise on a set that defines a hook path (opts.hook, opts.shipPose, opts.n0 = the shot's first frame).
  if ((cam.preset === 'dive' || cam.preset === 'rise') && opts.hook) {
    return poseHook(camera, opts.hook, m, opts.n0 ?? 0, shotFrames, fps, opts.shipPose, cam.preset === 'rise');
  }
  const t = m / fps;
  const T = Math.max(1, shotFrames - 1) / fps;
  anchor.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  const base = new THREE.Quaternion();
  anchor.matrixWorld.decompose(pos, base, new THREE.Vector3());
  const M = { ...BASE_MOTION, dolly: DOLLY_PRESETS[cam.preset] ?? BASE_MOTION.dolly, ...(cam.motion ?? {}) };
  const ud = anchor.userData ?? {};
  const drift = (cam.yawDrift ?? 0) * easeInOut(t / (cam.yawDriftSeconds ?? 10));
  const yaw = (drift + (cam.yaw ?? 0)) * DEG;
  const breath = Math.sin(2 * Math.PI * M.breathHz * t);
  const pitch = ((cam.pitch ?? 0) + M.breathPitch * breath) * DEG;
  // The anchor may ride a turning ship: its world yaw beyond the anchor's own yaw is added.
  const extraYaw = ud.pitch !== undefined ? new THREE.Euler().setFromQuaternion(base, 'YXZ').y - (ud.yaw ?? 0) * DEG : 0;
  const baseYaw = (ud.yaw ?? 0) * DEG + yaw + extraYaw;
  const dolly = Math.min(M.dolly, ud.maxDolly ?? Infinity) * easeInOut(t / T);
  pos.x += -Math.sin(baseYaw) * dolly;
  pos.z += -Math.cos(baseYaw) * dolly;
  pos.y += M.breathLift * Math.sin(2 * Math.PI * M.breathHz * t + Math.PI / 2);
  camera.position.copy(pos);
  if (ud.pitch !== undefined) {
    camera.quaternion.setFromEuler(new THREE.Euler((ud.pitch ?? 0) * DEG + pitch, (ud.yaw ?? 0) * DEG + yaw + extraYaw, 0, 'YXZ'));
  } else {
    camera.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  }
  const pushPct = cam.pushPct ?? 0;
  if (pushPct && ud.aimDist) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(fwd, (pushPct / 100) * ud.aimDist * t);
  }
  const held = cam.held ?? true;
  const fov = (cam.fov ?? ud.fov ?? 72) - (held ? Math.min(M.push * t, M.pushMax) : 0);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return { fov, panini: cam.panini ?? ud.panini ?? fov >= 80, dolly, streak: [0, 0] };
}

// Per-frame camera pose for out/cams.json.
export function cameraPose(camera) {
  const p = camera.position;
  const q = camera.quaternion;
  return { pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], fov: camera.fov };
}
