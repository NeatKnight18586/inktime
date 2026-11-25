// Camera slots: camera-relative positions named like anchors, so the guide (Tick) and sound words stay in frame through head
// turns and the dive. A slot is a screen point (x right, y down, 0..1 of the 1080x1920 frame) at a distance in front of the
// camera. Tick's distance grows as the FOV narrows (TICK_K / tan(vFOV / 2)), so it keeps one screen size and its widest pose
// stays clear of the centre 40% of the width. Sound words sit SFX_K / tan(vFOV / 2) in front of the eye, so their size is a
// share of the frame height (size / (2 SFX_K)). Pure: a function of the camera.
import * as THREE from 'three';

export const SLOTS = {
  cam_left: { x: 0.18, y: 0.4 },
  cam_right: { x: 0.82, y: 0.4 },
  cam_hands: { x: 0.68, y: 0.66 },
  cam_centre: { x: 0.5, y: 0.45 }, // the jump: Tick at the centre
  cam_top: { x: 0.5, y: 0.2 }, // sound words over a snap or an insert
};
export const TICK_K = 5.5; // m at vFOV 90 (tan 45 = 1): Tick (idle) spans 12-15% of the frame width
export const TICK_IDLE_WIDTH = 0.134; // Tick's idle width share at a slot (TICK_K)
export const SFX_K = 0.6; // m at vFOV 90
export const isSlot = (name) => Object.hasOwn(SLOTS, name);
// Tick's intro pop (a guide card's "pop" frame): it flies in from off the right edge at POP.width of the frame width over
// POP.fly frames, holds POP.hold frames (0.5 s), then settles to its slot size over POP.settle frames.
export const POP = { fly: 6, hold: 12, settle: 8, width: 0.25, fromX: 1.2 };
// -> { x (screen x of the point, or null for the slot's own), scale (Tick size over its slot size) } for k frames after the pop.
export function popState(k, slotX, idleWidth = 0.134) {
  if (k < 0 || k >= POP.fly + POP.hold + POP.settle) return null;
  const big = POP.width / idleWidth;
  const ease = (u) => u * u * (3 - 2 * u);
  if (k < POP.fly) return { x: POP.fromX + (slotX - POP.fromX) * ease((k + 1) / POP.fly), scale: big };
  if (k < POP.fly + POP.hold) return { x: slotX, scale: big };
  const u = ease((k - POP.fly - POP.hold + 1) / POP.settle);
  return { x: slotX, scale: big + (1 - big) * u };
}
export const tickSlotDistance = (fov) => TICK_K / Math.tan((fov * Math.PI) / 360);
export const sfxSlotDistance = (fov) => SFX_K / Math.tan((fov * Math.PI) / 360);

// World point of slot `name` for a posed camera (position, quaternion, fov, aspect), `dist` metres along the view axis.
export function slotPoint(name, camera, dist, x = null) {
  const s0 = SLOTS[name];
  if (!s0) throw new Error(`slot "${name}" missing`);
  const s = x === null ? s0 : { ...s0, x };
  const ty = Math.tan((camera.fov * Math.PI) / 360);
  const tx = ty * camera.aspect;
  const local = new THREE.Vector3((s.x * 2 - 1) * tx * dist, (1 - s.y * 2) * ty * dist, -dist);
  return local.applyQuaternion(camera.quaternion).add(camera.position);
}
// Camera-right unit vector pointing away from the screen centre on the slot's side (drift poses walk out of frame).
export function slotOutward(name, camera) {
  const side = SLOTS[name].x >= 0.5 ? 1 : -1;
  return new THREE.Vector3(side, 0, 0).applyQuaternion(camera.quaternion);
}
