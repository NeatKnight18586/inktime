import * as THREE from 'three';

const DEG = Math.PI / 180;
const easeInOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// POV camera at rest: anchor pose + pitch + slow yaw drift + breathing (STYLE: 0.25 Hz, 0.3 cm).
// Moves on ones: everything derives from frame n.
export function poseCamera(camera, cam, anchors, n, fps) {
  const anchor = anchors[cam.anchor];
  if (!anchor) throw new Error(`camera anchor "${cam.anchor}" missing`);
  const t = n / fps;
  anchor.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  const base = new THREE.Quaternion();
  anchor.matrixWorld.decompose(pos, base, new THREE.Vector3());
  if (cam.breathing) pos.y += 0.003 * Math.sin(2 * Math.PI * 0.25 * t);
  const yaw = (cam.yawDrift ?? 0) * easeInOut(t / (cam.yawDriftSeconds ?? 10)) * DEG + (cam.yaw ?? 0) * DEG;
  const pitch = (cam.pitch ?? 0) * DEG;
  const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  camera.position.copy(pos);
  camera.quaternion.copy(base).multiply(local);
  if (camera.fov !== cam.fov) {
    camera.fov = cam.fov ?? 72;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}
