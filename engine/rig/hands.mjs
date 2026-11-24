import * as THREE from 'three';
import { LAYERS } from '../look/layers.mjs';

// "You" hands, XIII style: SVG drawn on a camera-space quad in the bottom-right of the frame,
// multiplied by the scene tint. Animated on twos. Phase 2 extends this file.
export const HAND_POSES = ['rail_grip', 'padlock_hold'];
export const HAND_FRAME = { width: 0.33, bleedX: 0.03, bleedY: 0.02, z: 0.3 };

async function svgTexture(url, scale = 2) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: canvas.width / canvas.height };
}

export async function makeHands(camera, tint, poses = HAND_POSES) {
  const textures = {};
  for (const p of poses) textures[p] = await svgTexture(`/cast/hands/${p}.svg`);
  const mat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.name = 'hands';
  quad.renderOrder = 1000;
  quad.frustumCulled = false;
  quad.layers.set(LAYERS.CARD);
  quad.visible = false;
  camera.add(quad);
  return {
    quad,
    // pose: name or null. Size follows the current FOV so the hand keeps its place in frame.
    update(n, pose) {
      if (!pose) {
        quad.visible = false;
        return;
      }
      const t = textures[pose];
      if (!t) throw new Error(`hands pose "${pose}" not loaded`);
      quad.visible = true;
      if (mat.map !== t.tex) {
        mat.map = t.tex;
        mat.needsUpdate = true;
      }
      const z = HAND_FRAME.z;
      const fh = 2 * z * Math.tan((camera.fov * Math.PI) / 360);
      const fw = fh * camera.aspect;
      const qw = HAND_FRAME.width * fw;
      const qh = qw / t.aspect;
      const k = Math.floor(n / 2); // on twos
      const bob = 0.004 * fh * Math.sin(k * 0.52) + 0.002 * fh * Math.sin(k * 1.31);
      quad.scale.set(qw, qh, 1);
      quad.position.set(fw / 2 - qw / 2 + HAND_FRAME.bleedX * fw, -fh / 2 + qh / 2 - HAND_FRAME.bleedY * fh + bob, -z);
    },
  };
}
