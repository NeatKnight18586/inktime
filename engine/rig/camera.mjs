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

// Base motion on every shot (STYLE): dolly forward 0.06 m/s (horizontal, along the view yaw),
// breathing sway 0.25 Hz (0.15 deg pitch, 4 mm vertical); held shots also push FOV in by 1 deg/s. No frame is still.
export const BASE_MOTION = { dolly: 0.06, breathHz: 0.25, breathPitch: 0.15, breathLift: 0.004, push: 1.0 };

// m is the frame index within the shot. Camera anchors carry userData {yaw, pitch, fov, panini}.
export function poseCamera(camera, cam, anchors, m, fps) {
  const anchor = anchors[cam.anchor];
  if (!anchor) throw new Error(`camera anchor "${cam.anchor}" missing`);
  const t = m / fps;
  anchor.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  const base = new THREE.Quaternion();
  anchor.matrixWorld.decompose(pos, base, new THREE.Vector3());
  const M = { ...BASE_MOTION, ...(cam.motion ?? {}) };
  const ud = anchor.userData ?? {};
  const drift = (cam.yawDrift ?? 0) * easeInOut(t / (cam.yawDriftSeconds ?? 10));
  const yaw = (drift + (cam.yaw ?? 0)) * DEG;
  const breath = Math.sin(2 * Math.PI * M.breathHz * t);
  const pitch = ((cam.pitch ?? 0) + M.breathPitch * breath) * DEG;
  const baseYaw = (ud.yaw ?? 0) * DEG + yaw;
  pos.x += -Math.sin(baseYaw) * M.dolly * t;
  pos.z += -Math.cos(baseYaw) * M.dolly * t;
  pos.y += M.breathLift * Math.sin(2 * Math.PI * M.breathHz * t + Math.PI / 2);
  camera.position.copy(pos);
  if (ud.pitch !== undefined) {
    camera.quaternion.setFromEuler(new THREE.Euler((ud.pitch ?? 0) * DEG + pitch, (ud.yaw ?? 0) * DEG + yaw, 0, 'YXZ'));
  } else {
    camera.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  }
  const held = cam.held ?? true;
  const fov = (cam.fov ?? ud.fov ?? 72) - (held ? M.push * t : 0);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return { fov, panini: cam.panini ?? ud.panini ?? fov >= 80 };
}

// Per-frame camera pose for out/cams.json.
export function cameraPose(camera) {
  const p = camera.position;
  const q = camera.quaternion;
  return { pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], fov: camera.fov };
}
