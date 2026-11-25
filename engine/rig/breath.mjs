import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';

// Breath (Phase 6b): no grey puffs. A wisp is a few ink-outlined frost curls in camera space, emitted every 1.8 s at rest when
// the look is cold ("cold": true). It is drawn on twos (a new drawing every 2 frames), rises and thins over 20 frames, covers at
// most 3% of the frame area, and is placed (tools/bake.mjs) where it overlaps no subject's bounding box, or not at all.
// Deterministic: wisp i is born at frame phase + round(1.8 s x fps x i).
export const WISP = { every: 1.8, life: 20, area: 0.03, z: 0.4, y: 0.54, xs: [0.5, 0.38, 0.62, 0.26, 0.74], rise: 0.06, drawings: 3 };

export function wispFrames(n, fps = 24, phase = 0) {
  const gap = WISP.every * fps;
  const out = [];
  const m = n - phase;
  for (let i = Math.max(0, Math.floor((m - WISP.life) / gap)); i <= Math.floor(m / gap); i++) {
    const born = phase + Math.round(i * gap);
    const age = n - born;
    if (age >= 0 && age < WISP.life) out.push({ i, born, age });
  }
  return out;
}
// The wisp's square side as a share of the frame height, so its area is WISP.area of the 9:16 frame.
export const wispSide = (aspect = 1080 / 1920) => Math.sqrt(WISP.area * aspect);
// Screen box (x right, y down, 0..1 of width/height) of a wisp centred at sx, at age.
export function wispBox(sx, age, aspect = 1080 / 1920) {
  const hh = wispSide(aspect) / 2;
  const hw = hh / aspect;
  const cy = WISP.y - WISP.rise * (age / WISP.life);
  return { x0: sx - hw, x1: sx + hw, y0: cy - hh, y1: cy + hh };
}
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// The first candidate x whose box (over the wisp's whole life) overlaps no subject box; null when every place is taken.
export function placeWisp(subjects, aspect = 1080 / 1920) {
  for (const x of WISP.xs) {
    const a = wispBox(x, 0, aspect);
    const b = wispBox(x, WISP.life, aspect);
    const life = { x0: a.x0, x1: a.x1, y0: b.y0, y1: a.y1 };
    if (!subjects.some((s) => overlaps(life, s))) return x;
  }
  return null;
}

function wispTexture(ink, frost, k) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  // Three curls rising from the bottom, a little different on each drawing; ink first (wide), then frost (narrow).
  const curls = [0, 1, 2].map((j) => {
    const x0 = 40 + j * 22 + ((k * 7 + j * 5) % 9) - 4;
    return [[x0, 118], [x0 - 12 + j * 4, 88], [x0 + 10, 62], [x0 - 6 + k * 3, 34], [x0 + 4, 14]];
  });
  for (const [w, col] of [[11, ink], [5, frost]]) {
    g.strokeStyle = col;
    g.lineWidth = w;
    for (const p of curls) {
      g.beginPath();
      g.moveTo(...p[0]);
      for (let i = 1; i < p.length - 1; i++) g.quadraticCurveTo(...p[i], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      g.lineTo(...p.at(-1));
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBreath(camera, palette, tint) {
  const cold = !!palette.json.cold;
  const group = new THREE.Group();
  group.name = 'breath';
  let mesh = null;
  let texs = [];
  if (cold) {
    texs = Array.from({ length: WISP.drawings }, (_, k) => wispTexture(palette.json.ink, palette.json.colors.frost ?? palette.json.paper, k));
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texs[0], transparent: true, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false, color: tint ?? 0xffffff }));
    mesh.renderOrder = 20;
    mesh.visible = false;
    group.add(mesh);
    setLayer(group, LAYERS.FX);
    camera.add(group);
  }
  return {
    group,
    // w: the baked wisp { x (screen 0..1), age } or null; n: absolute frame.
    update(n, w) {
      if (!mesh) return;
      mesh.visible = !!w;
      if (!w) return;
      const aspect = camera.aspect;
      const th = Math.tan((camera.fov * Math.PI) / 360);
      const side = wispSide(aspect) * 2 * th * WISP.z; // metres at z
      const b = wispBox(w.x, w.age - (w.age % 2), aspect);
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      mesh.position.set((cx * 2 - 1) * th * aspect * WISP.z, (1 - cy * 2) * th * WISP.z, -WISP.z);
      mesh.scale.set(side, side, 1);
      mesh.material.map = texs[Math.floor(n / 2) % texs.length];
      mesh.material.opacity = 1;
      mesh.material.needsUpdate = true;
    },
  };
}
