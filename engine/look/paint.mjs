import * as THREE from 'three';
import { rng, hashSeed } from '../../tools/rng.mjs';

// Painted textures: seeded 512 px canvases, 2-3 flat values with hard edges (never noise) plus 5% paper grain.
// Values are multipliers on the material's palette colour. World-mapped: PAINT_SCALE metres per tile.
export const PAINT_KINDS = ['wood', 'steel', 'canvas', 'rope', 'ice', 'rail'];
export const PAINT_SCALE = { wood: 2, steel: 2, canvas: 1, rope: 0.5, ice: 24, rail: 1 };
const SIZE = 512;
const cache = new Map();

const v = (x) => {
  const c = Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${c},${c},${c})`;
};

function makeCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(SIZE, SIZE);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    return c;
  }
  return null;
}

function grain(ctx, r, amount = 0.05) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y += 2) {
    for (let x = 0; x < SIZE; x += 2) {
      const k = 1 - amount * r();
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y + dy) * SIZE + x + dx) * 4;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function wood(ctx, r) {
  const pw = 64; // 0.25 m planks at 2 m per tile
  ctx.fillStyle = v(0.9);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += pw) {
    // worn patches: lighter, hard-edged
    for (let k = 0; k < 2; k++) {
      if (r() < 0.6) {
        ctx.fillStyle = v(1.0);
        const y = r() * SIZE;
        ctx.beginPath();
        ctx.ellipse(x + pw / 2 + (r() - 0.5) * 16, y, 10 + r() * 14, 30 + r() * 60, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // grain streaks
    ctx.fillStyle = v(0.74);
    for (let k = 0; k < 5; k++) {
      const gx = x + 6 + r() * (pw - 12);
      const y0 = r() * SIZE;
      ctx.fillRect(gx, y0, 1 + (r() < 0.3 ? 1 : 0), 40 + r() * 160);
    }
    // butt joints
    ctx.fillStyle = v(0.25);
    const j = r() * SIZE;
    ctx.fillRect(x, j, pw, 2);
    // ink seam
    ctx.fillStyle = v(0.18);
    ctx.fillRect(x, 0, 2, SIZE);
  }
}

function steel(ctx, r) {
  ctx.fillStyle = v(0.95);
  ctx.fillRect(0, 0, SIZE, SIZE);
  const pw = 256;
  const ph = 128; // 1 m x 0.5 m plates
  for (let y = 0; y < SIZE; y += ph) {
    const off = (y / ph) % 2 ? pw / 2 : 0;
    // darker bottom edge of each plate
    ctx.fillStyle = v(0.8);
    ctx.fillRect(0, y + ph - 10, SIZE, 8);
    for (let x = -pw; x < SIZE + pw; x += pw) {
      const sx = x + off;
      // rivet dots along the seams, with grime streaks running down
      for (let k = 6; k < pw; k += 16) {
        const rx = sx + k;
        ctx.fillStyle = v(0.5);
        ctx.fillRect(rx - 2, y + 5, 4, 4);
        if (r() < 0.22) {
          ctx.fillStyle = v(0.78);
          ctx.fillRect(rx - 1, y + 9, 3, 18 + r() * 60);
        }
      }
      for (let k = 6; k < ph; k += 16) {
        ctx.fillStyle = v(0.5);
        ctx.fillRect(sx + 5, y + k - 2, 4, 4);
      }
      ctx.fillStyle = v(0.42);
      ctx.fillRect(sx, y, 2, ph);
    }
    ctx.fillStyle = v(0.42);
    ctx.fillRect(0, y, SIZE, 2);
  }
}

function hatch(ctx, r, spacing, base, line, angle) {
  ctx.fillStyle = v(base);
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = v(line);
  ctx.lineWidth = 2;
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate(angle);
  for (let x = -SIZE; x < SIZE; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + (r() - 0.5) * 2, -SIZE);
    ctx.lineTo(x + (r() - 0.5) * 2, SIZE);
    ctx.stroke();
  }
  ctx.restore();
}

function ice(ctx, r) {
  // Faceted: flat polygons in three values; frost hatch strokes on the lit (upper-left) side.
  ctx.fillStyle = v(0.86);
  ctx.fillRect(0, 0, SIZE, SIZE);
  const vals = [1.0, 0.86, 0.74];
  for (let k = 0; k < 60; k++) {
    const cx = r() * SIZE;
    const cy = r() * SIZE;
    const rad = 30 + r() * 70;
    const n = 3 + Math.floor(r() * 3);
    ctx.fillStyle = v(vals[Math.floor(r() * 3)]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.8;
      const x = cx + Math.cos(a) * rad * (0.6 + r() * 0.4);
      const y = cy + Math.sin(a) * rad * (0.6 + r() * 0.4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = v(1.0);
  ctx.lineWidth = 2;
  for (let k = 0; k < 140; k++) {
    const x = r() * SIZE * 0.6;
    const y = r() * SIZE * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + r() * 8, y + 10 + r() * 8);
    ctx.stroke();
  }
}

function rail(ctx, r) {
  // Wooden cap rail: wood grain with thin frost hatch strokes.
  wood(ctx, r);
  ctx.strokeStyle = v(1.0);
  ctx.lineWidth = 2;
  for (let k = 0; k < 70; k++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 6 + r() * 6, y - 6 - r() * 6);
    ctx.stroke();
  }
}

const PAINTERS = {
  wood,
  steel,
  ice,
  rail,
  canvas: (ctx, r) => hatch(ctx, r, 10, 0.94, 0.74, Math.PI / 4),
  rope: (ctx, r) => hatch(ctx, r, 8, 0.9, 0.6, -Math.PI / 5),
};

// Returns a cached CanvasTexture, or null where no canvas exists (node tests).
export function paintTexture(kind, seed = 'paint') {
  const key = `${kind}:${seed}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = makeCanvas();
  if (!canvas) {
    cache.set(key, null);
    return null;
  }
  const ctx = canvas.getContext('2d');
  const r = rng(hashSeed(key));
  PAINTERS[kind](ctx, r);
  grain(ctx, r);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

// Corner darkening is computed in the toon shader from each vertex's box: bake aBoxMin/aBoxMax per vertex.
export function bakeCorners(root) {
  const done = new WeakSet();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isHull || !o.material?.isMeshToonMaterial) return;
    const g = o.geometry;
    if (done.has(g) || g.getAttribute('aBoxMin')) return;
    done.add(g);
    g.computeBoundingBox();
    const n = g.getAttribute('position').count;
    const mn = new Float32Array(n * 3);
    const mx = new Float32Array(n * 3);
    const { min, max } = g.boundingBox;
    for (let i = 0; i < n; i++) {
      mn.set([min.x, min.y, min.z], i * 3);
      mx.set([max.x, max.y, max.z], i * 3);
    }
    g.setAttribute('aBoxMin', new THREE.BufferAttribute(mn, 3));
    g.setAttribute('aBoxMax', new THREE.BufferAttribute(mx, 3));
  });
}
