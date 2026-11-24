// Shot camera: poses a three.js camera for frame n of a scene spec. Shared by the renderer (engine/main.mjs) and the tests.
// New POV presets run through engine/rig/pov.mjs; the legacy anchor presets (lookout, none) keep engine/rig/camera.mjs.
import * as THREE from 'three';
import { poseCamera, shotAt, cameraPose } from './camera.mjs';
import { povState } from './pov.mjs';
import { PRESETS, DEG } from './presets.mjs';

export function makeShotCam({ spec, anchors, kit, camera, fps = 24 }) {
  const scratch = new THREE.PerspectiveCamera(72, 1080 / 1920, 0.05, 9000);
  const tmp = new THREE.Vector3();
  const point = (name) => {
    const a = anchors[name];
    if (!a) throw new Error(`pov: anchor "${name}" missing`);
    a.updateWorldMatrix(true, false);
    return a.getWorldPosition(tmp.clone()).toArray();
  };
  return {
    // Returns the view info (fov, panini, streak, smear, rest, preset) and poses `camera`.
    pose(n) {
      const shot = shotAt(spec, n);
      const cam = shot.camera;
      const m = n - shot.start;
      if (!PRESETS[cam.preset]) return { ...poseCamera(camera, cam, anchors, m, fps, shot.frames, { hook: kit.hook, shipPose: kit.shipPose, n0: shot.start }), preset: cam.preset ?? 'held', shot: shot.index, smear: false };
      const anchor = anchors[cam.anchor];
      if (!anchor) throw new Error(`camera anchor "${cam.anchor}" missing`);
      anchor.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      anchor.matrixWorld.decompose(pos, q, new THREE.Vector3());
      const ud = anchor.userData ?? {};
      const eul = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const hasAim = ud.pitch !== undefined;
      const ctx = {
        fps,
        shotFrames: shot.frames,
        n0: shot.start,
        eye: pos.toArray(),
        yaw0: hasAim ? (ud.yaw ?? 0) + (eul.y / DEG - (ud.yaw ?? 0)) : eul.y / DEG,
        pitch0: hasAim ? ud.pitch ?? 0 : eul.x / DEG,
        fov0: cam.fov ?? ud.fov ?? 72,
        maxDolly: ud.maxDolly,
        rimDist: ud.rimDist,
        point,
        hook: (mm, reverse) => {
          const v = poseCamera(scratch, { anchor: cam.anchor, preset: reverse ? 'rise' : 'dive' }, anchors, mm, fps, shot.frames, { hook: kit.hook, shipPose: kit.shipPose, n0: shot.start });
          const e = new THREE.Euler().setFromQuaternion(scratch.quaternion, 'YXZ');
          return { pos: scratch.position.toArray(), yaw: e.y / DEG, pitch: e.x / DEG, roll: e.z / DEG, fov: v.fov, panini: v.panini, streak: v.streak };
        },
      };
      const s = povState(cam, m, ctx);
      camera.position.set(...s.pos);
      camera.quaternion.setFromEuler(new THREE.Euler(s.pitch * DEG, s.yaw * DEG, s.roll * DEG, 'YXZ'));
      if (camera.fov !== s.fov) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
      return { ...s, shot: shot.index };
    },
    cameraPose,
  };
}
