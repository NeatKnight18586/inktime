// Hand-lettering core (browser-safe, no Node APIs): the skeleton stroke alphabet (A-Z, 0-9, - £ · ' , and space) and the
// brush-lettered SVG for a word. tools/letter.mjs is the CLI (sound-word files); engine code draws in-world text
// (props, stamps, screens, cards) with letterImage(). In-world text: at most 3 words per item, only for things the narration names.
import { rng, hashSeed } from '../../tools/rng.mjs';

export const WORDS = ['WHOOOSH', 'CREAK', 'RATTLE', 'SLAP', 'DING-DING-DING', 'SKRRRK', 'RRRING'];
export const INK = '#141414';
export const LAMP = '#E8A64B';
export const LETTER = { px: 200, stroke: 0.17, outline: 0.07, wobble: 0.015, step: 0.02, gap: 0.1, tilt: 5, jitterY: 0.04 };

const DEG = Math.PI / 180;
// Arc points: centre, radii, angles in degrees (counterclockwise, y up).
const arc = (cx, cy, rx, ry, a0, a1, n = 28) => Array.from({ length: n + 1 }, (_, i) => {
  const a = (a0 + ((a1 - a0) * i) / n) * DEG;
  return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
});
// Skeleton alphabet: { width, strokes: [[ [x, y], ... ], ...], closed?: indices of closed strokes }.
export const GLYPHS = {
  W: { w: 1.0, s: [[[0, 1], [0.25, 0], [0.5, 0.62], [0.75, 0], [1, 1]]] },
  H: { w: 0.74, s: [[[0, 1], [0, 0]], [[0.74, 1], [0.74, 0]], [[0, 0.52], [0.74, 0.52]]] },
  O: { w: 0.8, s: [arc(0.4, 0.5, 0.4, 0.5, 90, 450, 40)], closed: [0] },
  S: { w: 0.68, s: [[...arc(0.35, 0.745, 0.31, 0.245, 15, 270, 20), ...arc(0.35, 0.255, 0.33, 0.255, 90, -195, 22).slice(1)]] },
  C: { w: 0.76, s: [arc(0.42, 0.5, 0.42, 0.5, 42, 318, 32)] },
  R: { w: 0.72, s: [[[0, 0], [0, 1], [0.4, 1], ...arc(0.4, 0.74, 0.28, 0.26, 90, -90, 16).slice(1), [0, 0.48]], [[0.3, 0.48], [0.72, 0]]] },
  E: { w: 0.62, s: [[[0.62, 1], [0, 1], [0, 0], [0.62, 0]], [[0, 0.52], [0.5, 0.52]]] },
  A: { w: 0.82, s: [[[0, 0], [0.41, 1], [0.82, 0]], [[0.17, 0.36], [0.65, 0.36]]] },
  K: { w: 0.72, s: [[[0, 1], [0, 0]], [[0.7, 1], [0.04, 0.4]], [[0.24, 0.58], [0.72, 0]]] },
  T: { w: 0.74, s: [[[0, 1], [0.74, 1]], [[0.37, 1], [0.37, 0]]] },
  L: { w: 0.6, s: [[[0, 1], [0, 0], [0.6, 0]]] },
  P: { w: 0.68, s: [[[0, 0], [0, 1], [0.38, 1], ...arc(0.38, 0.74, 0.3, 0.26, 90, -90, 16).slice(1), [0, 0.48]]] },
  D: { w: 0.76, s: [[[0, 0], [0, 1], [0.3, 1], ...arc(0.3, 0.5, 0.46, 0.5, 90, -90, 24).slice(1), [0, 0]]] },
  I: { w: 0.36, s: [[[0, 1], [0.36, 1]], [[0.18, 1], [0.18, 0]], [[0, 0], [0.36, 0]]] },
  N: { w: 0.76, s: [[[0, 0], [0, 1], [0.76, 0], [0.76, 1]]] },
  G: { w: 0.82, s: [arc(0.42, 0.5, 0.42, 0.5, 42, 345, 32), [[0.82, 0.42], [0.47, 0.42]], [[0.82, 0.42], [0.82, 0.06]]] },
  '-': { w: 0.42, s: [[[0.03, 0.5], [0.39, 0.5]]] },
  B: { w: 0.7, s: [[[0, 0], [0, 1], [0.38, 1], ...arc(0.38, 0.76, 0.24, 0.24, 90, -90, 16).slice(1), [0, 0.52], [0.42, 0.52], ...arc(0.42, 0.26, 0.26, 0.26, 90, -90, 16).slice(1), [0, 0]]] },
  F: { w: 0.6, s: [[[0.6, 1], [0, 1], [0, 0]], [[0, 0.52], [0.48, 0.52]]] },
  J: { w: 0.62, s: [[[0.6, 1], [0.6, 0.3], ...arc(0.3, 0.3, 0.3, 0.3, 0, -180, 18).slice(1)]] },
  M: { w: 0.9, s: [[[0, 0], [0, 1], [0.45, 0.35], [0.9, 1], [0.9, 0]]] },
  Q: { w: 0.86, s: [arc(0.4, 0.5, 0.4, 0.5, 90, 450, 40), [[0.5, 0.25], [0.86, -0.04]]], closed: [0] },
  U: { w: 0.72, s: [[[0, 1], ...arc(0.36, 0.36, 0.36, 0.36, 180, 360, 24), [0.72, 1]]] },
  V: { w: 0.78, s: [[[0, 1], [0.39, 0], [0.78, 1]]] },
  X: { w: 0.74, s: [[[0, 1], [0.74, 0]], [[0.74, 1], [0, 0]]] },
  Y: { w: 0.76, s: [[[0, 1], [0.38, 0.5], [0.76, 1]], [[0.38, 0.5], [0.38, 0]]] },
  Z: { w: 0.7, s: [[[0, 1], [0.7, 1], [0, 0], [0.7, 0]]] },
  0: { w: 0.68, s: [arc(0.34, 0.5, 0.34, 0.5, 90, 450, 36)], closed: [0] },
  1: { w: 0.56, s: [[[0.06, 0.78], [0.3, 1], [0.3, 0]], [[0.04, 0], [0.56, 0]]] },
  2: { w: 0.66, s: [[...arc(0.32, 0.7, 0.3, 0.28, 160, -40, 20), [0, 0], [0.66, 0]]] },
  3: { w: 0.66, s: [[...arc(0.32, 0.75, 0.28, 0.25, 150, -90, 18), ...arc(0.32, 0.26, 0.32, 0.26, 90, -150, 20).slice(1)]] },
  4: { w: 0.72, s: [[[0.52, 0], [0.52, 1], [0, 0.3], [0.72, 0.3]]] },
  5: { w: 0.66, s: [[[0.62, 1], [0.1, 1], [0.08, 0.55], ...arc(0.32, 0.32, 0.32, 0.32, 135, -150, 22)]] },
  6: { w: 0.66, s: [[[0.56, 1], [0.2, 0.62], [0.03, 0.3]], arc(0.33, 0.3, 0.3, 0.3, 0, 360, 28)], closed: [1] },
  7: { w: 0.66, s: [[[0, 1], [0.66, 1], [0.24, 0]]] },
  8: { w: 0.66, s: [arc(0.33, 0.76, 0.25, 0.24, 0, 360, 24), arc(0.33, 0.27, 0.31, 0.27, 0, 360, 28)], closed: [0, 1] },
  9: { w: 0.66, s: [arc(0.32, 0.7, 0.3, 0.3, 0, 360, 28), [[0.62, 0.7], [0.5, 0.32], [0.2, 0]]], closed: [0] },
  '£': { w: 0.7, s: [[[0.62, 0.84], ...arc(0.4, 0.74, 0.22, 0.25, 20, 180, 16), [0.18, 0.4], [0.1, 0.1], [0, 0], [0.68, 0]], [[0, 0.45], [0.46, 0.45]]] },
  '·': { w: 0.2, s: [arc(0.1, 0.5, 0.05, 0.05, 0, 360, 10)], closed: [0] },
  "'": { w: 0.16, s: [[[0.09, 1], [0.06, 0.74]]] },
  ',': { w: 0.2, s: [[[0.12, 0.08], [0.04, -0.16]]] },
  ' ': { w: 0.35, s: [] },
};

// Resample a polyline at a fixed step (em).
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

// One brush stroke as a closed outline polygon: wobbled centreline, tapered width, round ends.
export function strokeOutline(pts, { closed = false, r, width = LETTER.stroke, wobble = LETTER.wobble } = {}) {
  const p = resample(pts, LETTER.step);
  const n = p.length;
  const ph = [r() * 6.283, r() * 6.283, r() * 6.283];
  const fr = [3 + r() * 3, 7 + r() * 5];
  const len = [0];
  for (let i = 1; i < n; i++) len.push(len[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const total = len[n - 1] || 1;
  const left = [];
  const right = [];
  const centre = [];
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    const s = len[i];
    // Seeded wobble: two smooth sines along the arc length, amplitude 1.5% of the letter height.
    const wob = wobble * (0.6 * Math.sin(s * fr[0] + ph[0]) + 0.4 * Math.sin(s * fr[1] + ph[1]));
    const c = [p[i][0] + nx * wob, p[i][1] + ny * wob];
    const t = s / total;
    const taper = closed ? 1 : 0.3 + 0.7 * Math.sqrt(Math.max(0, Math.sin(Math.PI * t)));
    const w = (width / 2) * taper * (1 + 0.12 * Math.sin(s * 5.1 + ph[2]));
    centre.push(c);
    left.push([c[0] + nx * w, c[1] + ny * w]);
    right.push([c[0] - nx * w, c[1] - ny * w]);
  }
  if (closed) return { rings: [left, right.reverse()], centre };
  return { rings: [[...left, ...right.reverse()]], centre };
}

// Lay out a word: per-letter seeded tilt, baseline jitter and scale. Returns strokes in em space (y up).
export function layoutWord(word, seed) {
  const r = rng(hashSeed(`letter:${word}:${seed}`));
  let x = 0;
  const strokes = [];
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`letter.mjs: no skeleton for "${ch}" (add it to GLYPHS)`);
    const tilt = (r() * 2 - 1) * LETTER.tilt * DEG;
    const dy = (r() * 2 - 1) * LETTER.jitterY;
    const k = 0.95 + r() * 0.13;
    const cx = g.w / 2;
    g.s.forEach((pts, si) => {
      const t = pts.map(([px, py]) => {
        const ux = (px - cx) * k;
        const uy = (py - 0.5) * k;
        return [x + cx * k + ux * Math.cos(tilt) - uy * Math.sin(tilt), 0.5 + dy + ux * Math.sin(tilt) + uy * Math.cos(tilt)];
      });
      strokes.push({ ch, ...strokeOutline(t, { closed: g.closed?.includes(si), r }) });
    });
    x += g.w * k + LETTER.gap + LETTER.stroke;
  }
  return { strokes, width: x - LETTER.gap - LETTER.stroke + LETTER.stroke };
}

const f2 = (v) => Math.round(v * 100) / 100;
// SVG: every stroke inked (fill + heavy outline) first, then every stroke filled with the palette colour, so the letters
// merge like brush lettering with one heavy outline round the whole word.
export function wordSvg(word, seed, { fill = LAMP } = {}) {
  const { strokes, width } = layoutWord(word, seed);
  const S = LETTER.px;
  const pad = LETTER.outline + LETTER.stroke / 2 + LETTER.wobble + 0.08;
  const W = Math.ceil((width + 2 * pad) * S);
  const H = Math.ceil((1 + 2 * pad + 2 * LETTER.jitterY) * S);
  const top = 1 + pad + LETTER.jitterY;
  const path = (rings) => rings.map((ring) => 'M' + ring.map(([x, y]) => `${f2((x + pad) * S)} ${f2((top - y) * S)}`).join('L') + 'Z').join('');
  const d = strokes.map((s) => path(s.rings)).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<path d="${d}" fill="${INK}" fill-rule="nonzero" stroke="${INK}" stroke-width="${f2(2 * LETTER.outline * S)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<path d="${d}" fill="${fill}" fill-rule="nonzero"/>`,
    '</svg>',
    '',
  ].join('\n');
}


// Browser: the lettered word as an Image (await img.decode()). text is upper-cased; fill is the palette colour.
export async function letterImage(text, { seed = 'v1', fill = LAMP } = {}) {
  const svg = wordSvg(String(text).toUpperCase(), seed, { fill });
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  return img;
}
