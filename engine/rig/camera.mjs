import * as THREE from 'three';

const DEG = Math.PI / 180;
const easeInOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Shot list: spec.shots [{frames, camera, show}] or a single spec.camera for all frames.
export function shotAt(spec, n) {
  if (!spec.shots) return { camera: spec.camera, start: 0, frames: spec.frames, show: [] };
  let start = 0;
  for (const shot of spec.shots) {
    if (n < start + shot.frames) return { show: [], ...shot, start };
    start += shot.frames;
  }
  const last = spec.shots.at(-1);
  return { show: [], ...last, start: start - last.frames };
}

export function totalFrames(spec) {
  return spec.shots ? spec.shots.reduce((s, x) => s + x.frames, 0) : spec.frames;
}

// POV camera at rest: anchor pose + optional offsets + slow yaw drift + breathing (STYLE: 0.25 Hz, 0.3 cm).
// m is the frame index within the shot. Camera anchors carry userData {yaw, pitch, fov, panini}.
export function poseCamera(camera, cam, anchors, m, fps) {
  const anchor = anchors[cam.anchor];
  if (!anchor) throw new Error(`camera anchor "${cam.anchor}" missing`);
  const t = m / fps;
  anchor.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  const base = new THREE.Quaternion();
  anchor.matrixWorld.decompose(pos, base, new THREE.Vector3());
  if (cam.breathing) pos.y += 0.003 * Math.sin(2 * Math.PI * 0.25 * t);
  const ud = anchor.userData ?? {};
  const drift = (cam.yawDrift ?? 0) * easeInOut(t / (cam.yawDriftSeconds ?? 10));
  const yaw = (drift + (cam.yaw ?? 0)) * DEG;
  const pitch = (cam.pitch ?? 0) * DEG;
  camera.position.copy(pos);
  if (ud.pitch !== undefined) {
    camera.quaternion.setFromEuler(new THREE.Euler((ud.pitch ?? 0) * DEG + pitch, (ud.yaw ?? 0) * DEG + yaw, 0, 'YXZ'));
  } else {
    camera.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  }
  const fov = cam.fov ?? ud.fov ?? 72;
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  return { fov, panini: cam.panini ?? ud.panini ?? fov >= 80 };
}
