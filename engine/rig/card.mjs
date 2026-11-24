import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';

const CARD_HEIGHT = 1.75;

async function svgTexture(url, scale = 2) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

// 2D character card in 3D: yaw-only billboard with a flat ellipse contact shadow.
export async function makeCard(scene, spec, anchors, palette) {
  const anchor = anchors[spec.anchor];
  if (!anchor) throw new Error(`card anchor "${spec.anchor}" missing`);
  const { tex, aspect } = await svgTexture(`/cast/${spec.cast}/${spec.pose ?? 'idle'}.svg`);
  const h = spec.height ?? CARD_HEIGHT;
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  geo.translate(0, h / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  const card = new THREE.Mesh(geo, mat);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 40),
    new THREE.MeshBasicMaterial({ color: palette.shadowTo, transparent: true, opacity: 0.55, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(h * aspect * 0.7, 0.42, 1);
  shadow.position.y = 0.006;
  const group = new THREE.Group();
  group.name = `card:${spec.cast}`;
  group.add(shadow, card);
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(group.position);
  setLayer(group, LAYERS.CARD);
  scene.add(group);
  const base = group.position.clone();
  return {
    group,
    // Pose state on twos; billboard follows the camera on ones (yaw only).
    update(n, camera) {
      const k = Math.floor(n / 2);
      card.scale.y = 1 + 0.006 * Math.sin(k * 0.35);
      group.position.copy(base);
      const dx = camera.position.x - base.x;
      const dz = camera.position.z - base.z;
      card.rotation.y = Math.atan2(dx, dz);
    },
  };
}
