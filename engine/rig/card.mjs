import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

export const CARD_HEIGHT = 1.75;

async function svgTextureFromText(text, scale = 6) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: canvas.width / canvas.height };
}

// Seeded blinks: closed 2-3 frames, every 2-4 s.
export function blinkFrames(seed, frames, fps = 24) {
  const r = rng(hashSeed(`${seed}:blink`));
  const closed = new Set();
  let f = Math.round((1 + r() * 2) * fps);
  while (f < frames) {
    const len = r() < 0.5 ? 2 : 3;
    for (let i = 0; i < len; i++) closed.add(f + i);
    f += Math.round((2 + r() * 2) * fps);
  }
  return closed;
}

// 2D character card in 3D: yaw-only billboard, flat ellipse contact shadow, multiplied by the scene tint.
// The SVG holds <g id="eyes-open"> and <g id="eyes-closed" display="none"> for blinks.
export async function makeCard(scene, spec, anchors, palette, { tint, seed = 'card', frames = 10000 } = {}) {
  const anchor = anchors[spec.anchor];
  if (!anchor) throw new Error(`card anchor "${spec.anchor}" missing`);
  const res = await fetch(`/cast/${spec.cast}/${spec.pose ?? 'idle'}.svg`);
  const text = await res.text();
  const open = await svgTextureFromText(text);
  const closedText = text
    .replace('id="eyes-open"', 'id="eyes-open" display="none"')
    .replace('id="eyes-closed" display="none"', 'id="eyes-closed"');
  const closed = await svgTextureFromText(closedText);
  const h = spec.height ?? CARD_HEIGHT;
  const aspect = open.aspect;
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  geo.translate(0, h / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: open.tex, color: tint ?? 0xffffff, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
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
  const blinks = spec.blink === false ? new Set() : blinkFrames(`${seed}:${spec.cast}`, frames);
  return {
    group,
    blinks,
    // Pose state on twos; blinks by frame; billboard follows the camera on ones (yaw only).
    update(n, camera) {
      const k = Math.floor(n / 2);
      card.scale.y = 1 + 0.006 * Math.sin(k * 0.35);
      const tex = blinks.has(n) ? closed.tex : open.tex;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      group.position.copy(base);
      const dx = camera.position.x - base.x;
      const dz = camera.position.z - base.z;
      card.rotation.y = Math.atan2(dx, dz);
    },
  };
}
