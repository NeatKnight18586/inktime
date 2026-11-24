// Southampton dock, 9 April 1912, daylight (look dock_day). A diorama set (engine/kits/diorama.mjs): sky with clouds; the ship's
// black hull wall with porthole rows filling the background; a diagonal gangway; crowd silhouette cards; foreground crates and
// a bollard; dock planks. The officer stands at the gangway's foot. Metres; the main camera looks down -Z.
import * as THREE from 'three';
import { buildDiorama, anchor } from '../../engine/kits/diorama.mjs';

export const ANCHORS = ['cam_dock', 'cam_officer_close', 'officer_spot', 'officer_pocket', 'guide_spot', 'gangway', 'hull'];
export const DOCK = { eye: [-0.1, 1.5, -3.5], officer: [-0.6, 0, -9.6], fov: 52 };

export function build(scene, rng) {
  const pal = scene.userData.palette;
  const c = (k) => pal.hexOf(k);
  const mix = (a, b, t) => pal.mixHex(a, b, t);
  const anchors = {};
  const group = new THREE.Group();
  group.name = 'dock_1912';
  scene.add(group);
  const layers = [
    {
      name: 'sky', z: -40, w: 80, h: 46, y: -3,
      draw(k) {
        k.shape(k.rect(-40, 0, 40, 46), c('sky'), { outline: false });
        k.shape(k.rect(-40, 30, 40, 46), mix('sky', 'navy', 0.12), { outline: false });
        // Clouds: flat paper puffs, ink-outlined, three lobes each.
        for (const [x, y, s] of [[-22, 26, 4], [-6, 31, 5], [12, 27, 4.5], [27, 33, 3.5], [-30, 36, 3]]) {
          const lobes = [[x - s * 0.8, y, s * 0.6], [x, y + s * 0.35, s * 0.8], [x + s * 0.85, y, s * 0.55]];
          for (const [cx, cy, r] of lobes) k.shape(k.ellipse(cx, cy, r, r * 0.62), c('paper'), { line: k.lw.crease });
          k.shape(k.rect(x - s * 1.3, y - s * 0.3, x + s * 1.35, y + s * 0.05), c('paper'), { outline: false });
        }
      },
    },
    {
      name: 'hull', z: -20, w: 50, h: 12.5, y: -1.5,
      draw(k) {
        // Black hull wall (ink), red boot-topping at the waterline, plate seams, three porthole rows, the gangway door.
        k.shape(k.rect(-25, 0, 25, 12.5), c('ink'), { outline: false });
        k.shape(k.rect(-25, 0, 25, 1.4), c('hullRed'), { line: k.lw.crease });
        for (let x = -24; x < 25; x += 3.2) k.line([[x, 1.4], [x, 12.5]], k.lw.texture, mix('ink', 'navy', 0.55));
        for (const y of [4.2, 7.2, 10.2]) k.line([[-25, y + 0.9], [25, y + 0.9]], k.lw.texture, mix('ink', 'navy', 0.55));
        for (const [row, y] of [[0, 4.2], [1, 6.9], [2, 9.6]]) {
          for (let x = -23.4 + row * 0.5; x < 24; x += 1.6) {
            if (Math.abs(x - 3.4) < 1.6 && row < 2) continue; // the door
            k.shape(k.ellipse(x, y, 0.26, 0.26, 20), c('paper'), { line: k.lw.crease });
            k.shape(k.ellipse(x, y, 0.15, 0.15, 16), mix('navy', 'sky', 0.35), { outline: false });
          }
        }
        k.shape(k.rect(2.5, 4.6, 4.3, 7.4), mix('brown', 'ink', 0.55), { line: k.lw.silhouette });
        k.hatch(k.rect(2.5, 4.6, 4.3, 7.4), { alpha: 0.4 });
        k.line([[-25, 12.45], [25, 12.45]], k.lw.silhouette);
      },
    },
    {
      name: 'crowd', z: -13, w: 18, h: 2.6, y: 0,
      draw(k) {
        // Crowd silhouettes along the quay: heads, hats and shoulders in navy and brown, a few arms waving.
        const r = k.r;
        for (let x = -8.6; x < 8.6; x += 0.42 + r() * 0.18) {
          if (Math.abs(x + 0.6) < 1.1) continue; // keep the officer clear
          const col = r() < 0.5 ? c('navy') : c('brown');
          const h = 1.5 + r() * 0.3;
          k.shape([[x - 0.24, 0], [x - 0.22, h - 0.35], [x - 0.1, h - 0.22], [x + 0.1, h - 0.22], [x + 0.22, h - 0.35], [x + 0.24, 0]], col, { line: k.lw.crease });
          k.shape(k.ellipse(x, h - 0.08, 0.12, 0.14, 18), mix('paper', 'brown', 0.35), { line: k.lw.crease });
          const hat = r();
          if (hat < 0.45) k.shape([...k.ellipse(x, h + 0.02, 0.13, 0.11, 12, 0, 180), [x - 0.18, h + 0.02], [x + 0.18, h + 0.02]], c('ink'), { line: k.lw.texture });
          else if (hat < 0.75) k.shape(k.rect(x - 0.17, h + 0.01, x + 0.17, h + 0.06), c('ink'), { line: k.lw.texture });
          if (r() < 0.18) k.line([[x + 0.18, h - 0.35], [x + 0.36, h + 0.15], [x + 0.32, h + 0.38]], k.lw.silhouette * 0.8, col);
        }
      },
    },
    {
      name: 'gangway', z: -11, w: 9, h: 6, y: 0,
      draw(k) {
        // A diagonal gangway from the quay (left) up to the hull door (right): planks, side rails, rope handrails.
        const a = [-3.4, 0.1];
        const b = [3.2, 4.9];
        const t = 0.45;
        const deck = [[a[0], a[1]], [b[0], b[1]], [b[0], b[1] - t], [a[0] + 0.3, a[1] - 0.05]];
        k.shape(deck, c('wood'), { line: k.lw.silhouette });
        for (let i = 1; i < 14; i++) {
          const u = i / 14;
          const x = a[0] + (b[0] - a[0]) * u;
          const y = a[1] + (b[1] - a[1]) * u;
          k.line([[x, y], [x + 0.08, y - t]], k.lw.texture, mix('wood', 'ink', 0.5));
          if (i % 2 === 0) k.line([[x, y], [x, y + 0.9]], k.lw.crease);
        }
        k.hatch(deck, { alpha: 0.25 });
        k.line([[a[0], a[1] + 0.9], [b[0], b[1] + 0.9]], k.lw.crease, mix('brown', 'ink', 0.3));
        k.line([[a[0], a[1] + 0.5], [b[0], b[1] + 0.5]], k.lw.texture, mix('brown', 'ink', 0.3));
      },
    },
    {
      name: 'foreground', z: -6, w: 3.2, h: 1.4, y: 0, x: 0.6,
      draw(k) {
        // Crates (bottom-left) and an iron bollard (bottom-right).
        const crate = (x0, x1, y1) => {
          const p = k.rect(x0, 0, x1, y1);
          k.shape(p, c('wood'), { line: k.lw.silhouette });
          k.line([[x0, 0], [x1, y1]], k.lw.crease);
          k.line([[x0, y1], [x1, 0]], k.lw.crease);
          k.hatch(k.rect(x0, 0, x1, y1 * 0.25), { alpha: 0.35 });
        };
        crate(-1.6, -0.95, 0.62);
        crate(-1.15, -0.62, 1.02);
        const bol = [[0.95, 0], [0.97, 0.42], [0.9, 0.5], [0.92, 0.58], [1.38, 0.58], [1.4, 0.5], [1.33, 0.42], [1.35, 0]];
        k.shape(bol, c('ink'), { line: k.lw.silhouette });
        k.line([[1.0, 0.52], [1.3, 0.52]], k.lw.crease, c('navy'));
      },
    },
    {
      name: 'quay', z: -8.5, w: 24, h: 11, y: 0, floor: true,
      draw(k) {
        k.shape(k.rect(-12, 0, 12, 11), c('wood'), { outline: false });
        for (let y = 0.3; y < 11; y += 0.32) k.line([[-12, y], [12, y]], k.lw.texture, mix('wood', 'ink', 0.45));
        for (let i = 0; i < 60; i++) {
          const x = -12 + k.r() * 24;
          const y = k.r() * 11;
          k.line([[x, y], [x + 0.5, y]], k.lw.texture * 0.8, mix('wood', 'ink', 0.3));
        }
      },
    },
  ];
  const d = buildDiorama(group, { seed: 'dock_1912', view: { eye: DOCK.eye, fov: DOCK.fov }, layers });
  // A glint on the officer's coat pocket (the key): a four-point lamp star, ink-outlined.
  const glint = new THREE.Group();
  glint.name = 'key_glint';
  const star = buildDiorama(glint, {
    seed: 'dock_glint', view: { eye: [0, 0, 1.2], fov: 52 },
    layers: [{
      name: 'glint', z: 0, w: 0.12, h: 0.12, y: -0.06,
      draw(k) {
        k.shape([[0, 0.12], [0.014, 0.074], [0.06, 0.06], [0.014, 0.046], [0, 0], [-0.014, 0.046], [-0.06, 0.06], [-0.014, 0.074]], c('paper'), { line: k.lw.crease });
      },
    }],
  });
  glint.position.set(DOCK.officer[0] + 0.14, 1.02, DOCK.officer[2] + 0.12);
  group.add(glint);
  // Light preset (look dock_day): a high soft sun and a sky fill.
  const L = pal.json.light;
  const key = new THREE.DirectionalLight(pal.color(L.key), 2.2);
  key.position.set(...pal.json.cast.keyDir.map((v) => v * 30));
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight(pal.color(L.fill), pal.color('brown'), L.fillIntensity));
  anchor(group, anchors, 'cam_dock', DOCK.eye, { yaw: 3, pitch: 6, fov: DOCK.fov });
  anchor(group, anchors, 'cam_officer_close', [-0.25, 1.15, -8.25], { yaw: 14, pitch: -6, fov: 52 });
  anchor(group, anchors, 'officer_spot', DOCK.officer);
  anchor(group, anchors, 'officer_pocket', [DOCK.officer[0] + 0.14, 1.02, DOCK.officer[2] + 0.12]);
  anchor(group, anchors, 'guide_spot', [1.4, 1.9, -7.5]);
  anchor(group, anchors, 'gangway', [0, 2.5, -11]);
  anchor(group, anchors, 'hull', [0, 6, -20]);
  return {
    anchors,
    keyLight: key,
    update() {},
    prepass(on) {
      d.prepass(on);
      star.prepass(on);
    },
    ready: Promise.all([d.ready, star.ready]),
  };
}
