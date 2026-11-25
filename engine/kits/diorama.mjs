// Diorama sets (Disney multiplane style): a set is 4-7 flat layer planes at given depths, each a parametric canvas drawing in
// the Ink Time style (STYLE ink weights, hatching, paper grain). Cast cards stand between the layers; the 3D camera gives real
// parallax. Each set has its own light preset in its look file (engine/looks/<look>.json).
// Layers are cutouts (alphaTest 0.5, depth written) and join the depth/normal prepass like the cards, so the edge pass inks
// their silhouettes and treats them as occluders. Node (the bake): the planes exist without drawings.
import * as THREE from 'three';
import { LAYERS } from '../look/layers.mjs';
import { rng as makeRng, hashSeed } from '../../tools/rng.mjs';

const browser = typeof document !== 'undefined';
const DEG = Math.PI / 180;
export const INK = '#141414';
// Screen ink widths at 1080 wide (STYLE, Ink): silhouettes 7 px, creases 2.5 px, texture lines 1.5 px, scaled by distance.
export const INK_PX = { silhouette: 7, crease: 2.5, texture: 1.5 };
export const MAX_TEX = 4096;
export const inkDistanceScale = (d) => (d <= 5 ? 1 : d <= 30 ? 1 - (0.4 * (d - 5)) / 25 : d <= 200 ? 0.6 - (0.25 * (d - 30)) / 170 : 0.35);

// The drawing kit handed to each layer's draw(): metres in layer space (x right of the centre, y up from the bottom edge).
export function inkKit(ctx, layer, { ppm, lw, seed }) {
  const r = makeRng(hashSeed(`${seed}:${layer.name}`));
  const X = (x) => (x + layer.w / 2) * ppm;
  const Y = (y) => (layer.h - y) * ppm;
  const P = ([x, y]) => [X(x), Y(y)];
  const path = (pts, closed = true) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    if (closed) ctx.closePath();
  };
  // Brush line: short segments, width varying +-20% (seeded), tapered ends on open strokes.
  const brush = (pts, w = lw.silhouette, closed = true, colour = INK) => {
    const ph = r() * 6.28;
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const n = pts.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const t = closed ? 0.5 : i / Math.max(1, last - 1);
      const taper = closed ? 1 : 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
      ctx.lineWidth = w * taper * (1 + 0.2 * Math.sin(i * 0.9 + ph));
      ctx.beginPath();
      ctx.moveTo(...P(pts[i]));
      ctx.lineTo(...P(pts[(i + 1) % n]));
      ctx.stroke();
    }
  };
  const dense = (pts, closed = true, step = 0.08) => {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  };
  // A filled, ink-outlined shape.
  const shape = (pts, fill, { line = lw.silhouette, outline = true } = {}) => {
    path(pts);
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline && line > 0) brush(dense(pts), line);
  };
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const ellipse = (cx, cy, rx, ry, n = 32, a0 = 0, a1 = 360) => Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
  // 45-degree ink hatching inside a shape (spacing and width in screen px, converted).
  const hatch = (pts, { spacing = 3, width = 1.2, angle = 45, colour = INK, alpha = 0.4 } = {}) => {
    ctx.save();
    path(pts);
    ctx.clip();
    ctx.strokeStyle = colour;
    ctx.globalAlpha = alpha;
    const s = spacing * lw.k;
    ctx.lineWidth = width * lw.k;
    const a = angle * DEG;
    const D = Math.hypot(ctx.canvas.width, ctx.canvas.height);
    for (let d = -D; d < D; d += s) {
      ctx.beginPath();
      ctx.moveTo(d * Math.cos(a + Math.PI / 2) - D * Math.cos(a), d * Math.sin(a + Math.PI / 2) - D * Math.sin(a));
      ctx.lineTo(d * Math.cos(a + Math.PI / 2) + D * Math.cos(a), d * Math.sin(a + Math.PI / 2) + D * Math.sin(a));
      ctx.stroke();
    }
    ctx.restore();
  };
  const line = (pts, w = lw.crease, colour = INK) => brush(dense(pts, false), w, false, colour);
  return { ctx, r, X, Y, P, path, brush, dense, shape, rect, ellipse, hatch, line, lw, ppm, layer };
}

// Paper grain: 5% speckle (multiply-like darkening) over the drawn pixels only.
function grain(ctx, W, H, r, amount = 0.05) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = 1 - amount * r();
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
}

const PREPASS_VERT = 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const PREPASS_FRAG = 'uniform sampler2D map; uniform float uHas; varying vec2 vUv; varying vec3 vN; void main(){ if (uHas > 0.5 && texture2D(map, vUv).a < 0.5) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }';

// spec: { seed, view: { eye: [x,y,z], fov } (the set's main camera, for ink widths), tint, layers: [{ name, z, w, h, x = 0,
// y = 0 (bottom edge), floor = false (a horizontal plane at height y), draw(kit) }] }. Returns { group, meshes, prepass(on), ready }.
export function buildDiorama(scene, spec) {
  const group = new THREE.Group();
  group.name = 'diorama';
  const meshes = [];
  const jobs = [];
  const view = spec.view ?? { eye: [0, 1.62, 0], fov: 52 };
  for (const L of spec.layers) {
    const geo = new THREE.PlaneGeometry(L.w, L.h);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }));
    mesh.name = `layer:${L.name}`;
    if (L.floor) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(L.x ?? 0, L.y ?? 0, L.z);
    } else mesh.position.set(L.x ?? 0, (L.y ?? 0) + L.h / 2, L.z);
    mesh.layers.set(LAYERS.CARD_BODY);
    mesh.userData.diorama = true;
    group.add(mesh);
    meshes.push(mesh);
    if (!browser || !L.draw) continue;
    // Texture density: 1.5x the screen density at the main camera, capped at MAX_TEX.
    const dist = Math.max(0.5, Math.abs((L.floor ? L.z : L.z) - view.eye[2]));
    const screenPpm = 1920 / (2 * dist * Math.tan((view.fov * DEG) / 2));
    const ppm = Math.min(screenPpm * 1.5, MAX_TEX / L.w, MAX_TEX / L.h);
    const k = ppm / screenPpm;
    const ds = inkDistanceScale(dist);
    const lw = { silhouette: INK_PX.silhouette * ds * k, crease: INK_PX.crease * ds * k, texture: INK_PX.texture * ds * k, k };
    const c = document.createElement('canvas');
    c.width = Math.max(8, Math.round(L.w * ppm));
    c.height = Math.max(8, Math.round(L.h * ppm));
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mesh.material.map = tex;
    if (spec.tint) mesh.material.color.copy(spec.tint);
    mesh.material.needsUpdate = true;
    const kit = inkKit(ctx, L, { ppm, lw, seed: spec.seed });
    jobs.push(Promise.resolve(L.draw(kit)).then(() => {
      grain(ctx, c.width, c.height, makeRng(hashSeed(`${spec.seed}:${L.name}:grain`)));
      tex.needsUpdate = true;
    }));
  }
  scene.add(group);
  const pre = meshes.map((m) => new THREE.ShaderMaterial({ uniforms: { map: { value: m.material.map }, uHas: { value: m.material.map ? 1 : 0 } }, side: THREE.DoubleSide, vertexShader: PREPASS_VERT, fragmentShader: PREPASS_FRAG }));
  const colour = meshes.map((m) => m.material);
  return {
    group,
    meshes,
    // The depth/normal prepass (engine/main.mjs): cutout normals; the colour pass: the drawings.
    prepass(on) {
      meshes.forEach((m, i) => {
        m.material = on ? pre[i] : colour[i];
      });
    },
    ready: Promise.all(jobs),
  };
}

// Anchors: named Object3Ds; camera anchors carry {yaw, pitch, fov, panini} for the POV rig.
export function anchor(group, anchors, name, pos, cam = null) {
  const o = new THREE.Object3D();
  o.name = `anchor:${name}`;
  o.position.set(...pos);
  if (cam) {
    o.quaternion.setFromEuler(new THREE.Euler((cam.pitch ?? 0) * DEG, (cam.yaw ?? 0) * DEG, 0, 'YXZ'));
    o.userData = { yaw: cam.yaw ?? 0, pitch: cam.pitch ?? 0, fov: cam.fov ?? 52, panini: cam.panini ?? false };
  }
  group.add(o);
  anchors[name] = o;
  return o;
}
