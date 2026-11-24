// Screen-space framing maths shared by the bake and the tests: where a character card, Tick, a face and a sound word land on
// the 1080x1920 frame (Panini applied). Pure functions of a camera pose; no DOM.
import * as THREE from 'three';
import { paniniNdc } from '../engine/post/panini.mjs';
import { figure, D_METRES, faceTurn } from '../engine/cast/stickmath.mjs';
import { tickSilhouette } from '../engine/cast/tick.mjs';
import { sfxCorners } from '../engine/sfxwords.mjs';

export const W = 1080;
export const H = 1920;
const DEGR = Math.PI / 180;

export function makeCam(pos, quat, fov) {
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.05, 9000);
  cam.position.fromArray(pos);
  cam.quaternion.fromArray(quat);
  cam.updateMatrixWorld(true);
  return cam;
}
// Normalised screen point (x right, y down, 0..1) after Panini; null when behind the camera.
export const toScreen = (p, cam) => {
  if (p.clone().applyMatrix4(cam.matrixWorldInverse).z >= -0.05) return null;
  const q = p.clone().project(cam);
  const [nx, ny] = paniniNdc(q.x, q.y, cam.fov, cam.aspect);
  return [(nx + 1) / 2, (1 - ny) / 2];
};

// The card figure's span across the frame width (0..1) for a stick-character card; { lo: 2, hi: -1 } when nothing is in front of the camera.
export function cardSpan(card, pose, spot, cam) {
  const base = new THREE.Vector3(...spot);
  const t = faceTurn((card.facing ?? 0) * DEGR, base, cam.position);
  const fig = figure(pose, 0, Math.cos(t.angle));
  const pts = [];
  const add = (p, r) => pts.push([p.x - r, p.y], [p.x + r, p.y], [p.x, p.y - r], [p.x, p.y + r]);
  for (const k of ['armL', 'armR']) for (const j of Object.values(fig[k])) add(j, 0.1);
  for (const k of ['legL', 'legR']) {
    add(fig[k].hip, 0.07);
    add(fig[k].knee, 0.07);
    add(fig[k].ankle, 0.23);
  }
  add(fig.headC, card.cast === 'fleet' ? 0.78 : 0.56);
  {
    const rho = 0.44 * Math.max(0.8, Math.cos(t.angle));
    const [h, tp] = fig.bodyAxis;
    const len = Math.hypot(tp.x - h.x, tp.y - h.y);
    const ux = (tp.x - h.x) / len;
    const uy = (tp.y - h.y) / len;
    add({ x: h.x + ux * rho, y: h.y + uy * rho }, rho + 0.02);
    add({ x: tp.x - ux * rho, y: tp.y - uy * rho }, rho + 0.02);
  }
  const toCam = new THREE.Vector3(cam.position.x - base.x, 0, cam.position.z - base.z).normalize();
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  let lo = 2;
  let hi = -1;
  for (const [x, y] of pts) {
    const p = base.clone().addScaledVector(right, x * D_METRES);
    p.y += y * D_METRES;
    if (p.clone().applyMatrix4(cam.matrixWorldInverse).z >= -0.05) continue;
    const q = p.clone().project(cam);
    const [nx] = paniniNdc(q.x, q.y, cam.fov, cam.aspect);
    lo = Math.min(lo, (nx + 1) / 2);
    hi = Math.max(hi, (nx + 1) / 2);
  }
  return { lo, hi };
}

// Tick's silhouette on its camera-facing card at `base` (already including the bob): screen span and whether any of it is in frame.
export function tickView(pose, base, cam) {
  const toCam = new THREE.Vector3(cam.position.x - base.x, 0, cam.position.z - base.z).normalize();
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  let lo = 2;
  let hi = -1;
  let visible = false;
  for (const [x, y] of tickSilhouette(pose)) {
    const p = base.clone().addScaledVector(right, x * D_METRES).add(new THREE.Vector3(0, y * D_METRES, 0));
    const s = toScreen(p, cam);
    if (!s) continue;
    if (s[0] * W > 0 && s[0] * W < W && s[1] * H > 0 && s[1] * H < H) visible = true;
    if (s[1] < -0.05 || s[1] > 1.05) continue;
    lo = Math.min(lo, s[0]);
    hi = Math.max(hi, s[0]);
  }
  return { lo, hi, visible };
}

// A character's face disc in pixels (head centre, 0.4 D radius); null for the back of the head or off-screen.
export function faceDisc(card, pose, spot, cam) {
  const base = new THREE.Vector3(...spot);
  if (faceTurn((card.facing ?? 0) * DEGR, base, cam.position).back) return null;
  const fig = figure(pose, 0, 1);
  const centre = base.clone().add(new THREE.Vector3(0, fig.headC.y * D_METRES, 0));
  const s = toScreen(centre, cam);
  const up = s && toScreen(centre.clone().add(new THREE.Vector3(0, 0.4 * D_METRES, 0)), cam);
  if (!s || !up) return null;
  const d = { cast: card.cast, x: s[0] * W, y: s[1] * H, r: Math.hypot((up[0] - s[0]) * W, (up[1] - s[1]) * H) };
  return d.x + d.r > 0 && d.x - d.r < W && d.y + d.r > 0 && d.y - d.r < H ? d : null;
}

// A sound word's screen box in pixels, or null when any corner is behind the camera.
export function sfxBox(centre, cam, size, aspect, scale, tilt) {
  const q = sfxCorners(new THREE.Vector3(...centre), cam.quaternion, size, aspect, scale, tilt).map((p) => toScreen(p, cam));
  if (q.some((p) => !p)) return null;
  const xs = q.map((p) => p[0] * W);
  const ys = q.map((p) => p[1] * H);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
