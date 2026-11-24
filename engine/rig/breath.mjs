import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';

// Ink breath puff in camera space: emitted every 1.8 s at rest when the look is cold ("cold": true), it drifts up and
// fades over 20 frames. Deterministic from the frame index: puff i is born at frame round(1.8 s x fps x i).
export const PUFF = { every: 1.8, life: 20, rise: 0.08, z: -0.4, x: 0.03, y: -0.17 };

export function puffFrames(n, fps = 24) {
  const gap = PUFF.every * fps;
  const out = [];
  for (let i = Math.max(0, Math.floor((n - PUFF.life) / gap)); i <= Math.floor(n / gap); i++) {
    const born = Math.round(i * gap);
    const age = n - born;
    if (age >= 0 && age < PUFF.life) out.push({ i, born, age });
  }
  return out;
}

function puffTexture(ink) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  // A frost-white cloud of three lobes with an ink outline.
  const lobes = [[46, 70, 26], [70, 56, 30], [88, 76, 22]];
  g.fillStyle = '#E9F1F4';
  g.strokeStyle = ink;
  g.lineWidth = 6;
  for (const [x, y, r] of lobes) {
    g.beginPath();
    g.arc(x, y, r, 0, 6.2832);
    g.stroke();
  }
  for (const [x, y, r] of lobes) {
    g.beginPath();
    g.arc(x, y, r - 3, 0, 6.2832);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBreath(camera, palette, tint) {
  const cold = !!palette.json.cold;
  const tex = cold ? puffTexture(palette.json.ink) : null;
  const sprites = [];
  const group = new THREE.Group();
  group.name = 'breath';
  if (cold) {
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, color: tint ?? 0xffffff }));
      m.renderOrder = 20;
      m.visible = false;
      sprites.push(m);
      group.add(m);
    }
    setLayer(group, LAYERS.FX);
    camera.add(group);
  }
  return {
    group,
    // rest: the camera is at rest (no walk, whip or dive); n: absolute frame.
    update(n, rest, fps = 24) {
      if (!cold) return;
      const live = rest ? puffFrames(n, fps) : [];
      sprites.forEach((s, i) => {
        const p = live[i];
        s.visible = !!p;
        if (!p) return;
        const a = p.age / PUFF.life;
        s.position.set(PUFF.x + 0.03 * a, PUFF.y + PUFF.rise * a, PUFF.z);
        s.scale.setScalar(0.7 + 0.8 * a);
        s.material.opacity = 1 - a;
      });
    },
  };
}
