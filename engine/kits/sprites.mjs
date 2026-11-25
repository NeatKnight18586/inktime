// Camera-space story sprites: small drawn props held in or near "your" hands (an empty pocket lining, a moth, the dropped phone).
// Drawn once per name with the diorama ink kit (STYLE ink weights, paper grain); placed per frame from the baked plan:
// shot "sprites": [{ name, x, y (screen 0..1), size (share of the frame height), rot (deg) }].
import * as THREE from 'three';
import { buildDiorama } from './diorama.mjs';
import { LAYERS } from '../look/layers.mjs';

export const SPRITE_Z = 0.5;
// Each drawing fills a 1 x 1 m layer (x -0.5..0.5, y 0..1).
export const SPRITES = {
  pocket_lining: (k, c) => {
    // Your coat (the navy sleeve-coat) with its pocket turned out: a dark pocket slit under a flap, and the white cloth lining
    // hanging out of it, with ink fold lines and a loose thread. The lining is the middle 60% of the drawing's width.
    k.shape(k.rect(-0.5, 0.6, 0.5, 1.0), c.coat, { line: k.lw.silhouette });
    k.hatch(k.rect(-0.5, 0.6, 0.5, 1.0), { alpha: 0.25 });
    k.shape([[-0.36, 0.82], [0.36, 0.82], [0.33, 0.74], [-0.33, 0.74]], c.coatDark, { line: k.lw.crease });
    k.shape(k.ellipse(0, 0.74, 0.32, 0.03, 24), c.ink, { outline: false });
    const lining = [[-0.3, 0.75], [-0.33, 0.55], [-0.26, 0.32], [-0.16, 0.14], [0.02, 0.08], [0.18, 0.13], [0.28, 0.3], [0.32, 0.55], [0.3, 0.75]];
    k.shape(lining, c.paper, { line: k.lw.silhouette });
    for (const f of [[[-0.2, 0.7], [-0.14, 0.45], [-0.06, 0.2]], [[0.05, 0.7], [0.1, 0.42], [0.06, 0.16]], [[0.22, 0.68], [0.2, 0.4]], [[-0.26, 0.5], [-0.1, 0.36]]]) k.line(f, k.lw.crease);
    k.hatch([[0.18, 0.13], [0.28, 0.3], [0.32, 0.55], [0.22, 0.55], [0.14, 0.25]], { alpha: 0.35 });
    k.line([[0.02, 0.08], [0.05, -0.0]], k.lw.texture);
  },
  moth: (k, c) => {
    // A small moth rising, wings spread wide, ink-outlined, with three rising dashes below it.
    for (const s of [-1, 1]) {
      k.shape([[0, 0.62], [s * 0.2, 0.95], [s * 0.48, 0.88], [s * 0.4, 0.62], [s * 0.3, 0.45], [s * 0.1, 0.45]], c.moth, { line: k.lw.silhouette });
      k.line([[s * 0.1, 0.7], [s * 0.36, 0.78]], k.lw.texture);
    }
    k.shape(k.ellipse(0, 0.6, 0.05, 0.17, 16), c.ink, { line: k.lw.crease });
    k.line([[0, 0.76], [-0.1, 0.96]], k.lw.texture);
    k.line([[0, 0.76], [0.1, 0.96]], k.lw.texture);
    for (const x of [-0.18, 0, 0.18]) k.line([[x, 0.32], [x, 0.12]], k.lw.crease);
  },
  phone: (k, c) => {
    // The dropped phone, tumbling: a dark slab with a glowing lamp screen and speed dashes above it.
    k.shape([[-0.22, 0.1], [0.22, 0.1], [0.22, 0.9], [-0.22, 0.9]], c.ink, { line: k.lw.silhouette });
    k.shape([[-0.18, 0.15], [0.18, 0.15], [0.18, 0.85], [-0.18, 0.85]], c.glow, { outline: false });
    for (const x of [-0.3, 0, 0.3]) k.line([[x, 0.95], [x * 1.2, 1.0]], k.lw.crease);
  },
};

// names: the sprite names a plan uses. Returns { update(list), ready, prepass }.
export function makeSprites(camera, palette, names, tint) {
  const hex = (k, d) => palette.json.colors[k] ?? d;
  const c = { ink: palette.json.ink, paper: palette.json.paper, coat: '#3A4A66', coatDark: '#2A3650', moth: palette.mixHex('paper', 'ink', 0.4), glow: hex('lamp', palette.json.paper) };
  const items = {};
  const jobs = [];
  const holder = new THREE.Group();
  holder.name = 'sprites';
  camera.add(holder);
  for (const name of names) {
    if (!SPRITES[name]) continue;
    const g = new THREE.Group();
    const d = buildDiorama(g, { seed: `sprite:${name}`, tint, view: { eye: [0, 0.5, 0.6], fov: 52 }, layers: [{ name, z: 0, w: 1, h: 1, y: -0.5, draw: (k) => SPRITES[name](k, c) }] });
    for (const m of d.meshes) {
      m.layers.set(LAYERS.FX);
      m.material.depthTest = false;
      m.renderOrder = 15;
    }
    g.visible = false;
    holder.add(g);
    items[name] = g;
    jobs.push(d.ready);
  }
  return {
    ready: Promise.all(jobs),
    update(list = []) {
      for (const g of Object.values(items)) g.visible = false;
      const th = Math.tan((camera.fov * Math.PI) / 360);
      for (const s of list) {
        const g = items[s.name];
        if (!g) continue;
        g.visible = true;
        g.position.set((s.x * 2 - 1) * th * camera.aspect * SPRITE_Z, (1 - s.y * 2) * th * SPRITE_Z, -SPRITE_Z);
        g.scale.setScalar(s.size * 2 * th * SPRITE_Z);
        g.rotation.set(0, 0, ((s.rot ?? 0) * Math.PI) / 180);
      }
    },
  };
}
