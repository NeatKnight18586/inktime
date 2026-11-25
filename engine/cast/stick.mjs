// Parametric stick character drawn to a 2D canvas (units: head diameters D). No hand-drawn SVG: every shape is code.
// Tricks drawn here: (b) volume shading with a light that arrives in camera space, rim light, (c) head turn,
// (e) far limbs behind the body and 10% darker. Billboard (a) and the shadow proxy (d) live in engine/rig/card.mjs.
import { D, CARD } from './stickmath.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hexRgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const css = (c) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (a, k) => a.map((v) => v * k);
const INK = '#141414';

// lit / mid / shade for a base colour in the card's own colours. `key` and `shade` are RGB triples.
export function tones(base, { key, shade, strength = 1, dark = null, dim = 1 }) {
  let mid = hexRgb(base);
  if (dark !== null) {
    // Dark nest: the part is on the shadow side; it takes the dark tone only.
    const d = mix(mul(mid, dark), shade, 0.5);
    return { lit: d, mid: d, shade: mul(d, 0.8) };
  }
  mid = mul(mid, dim);
  const lit = mul(mix(mid, key, 0.4), 1.12);
  const sh = mix(mul(mid, 0.55), shade, 0.5);
  return { lit, mid, shade: mix(mid, sh, clamp(0.55 + 0.45 * strength, 0, 1)) };
}

// Brush outline: a polyline stroked in short segments whose width varies +-15% (seeded, stable between redraws).
function brush(ctx, pts, closed, w, seed, colour = INK) {
  const r = rng(hashSeed(seed));
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const v = (Math.sin(i * 0.31 + p1) + Math.sin(i * 0.77 + p2)) / 2;
    ctx.lineWidth = w * (1 + D.outlineVar * v);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
}
const arcPts = (cx, cy, rx, ry, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry]);

export function drawStick(ctx, W, H, params, st) {
  const P = W / CARD.w; // px per D
  const X = (x) => (x + CARD.w / 2) * P;
  const Y = (y) => (CARD.h - CARD.bottom - y) * P;
  const pt = (p) => [X(p.x), Y(p.y)];
  const { fig, pose, turn, light, order, seed, nest } = st;
  const key = hexRgb(light.key);
  const shadeRgb = hexRgb(light.shade);
  const rimCss = light.rim;
  const [lx, ly, lz] = light.cam;
  const l2 = Math.hypot(lx, ly);
  const strength = clamp(l2 / Math.max(1e-6, Math.hypot(lx, ly, lz)) * 1.2, 0, 1);
  const lv = l2 > 1e-6 ? [lx / l2, -ly / l2] : [0, 0]; // 2D light direction on the canvas (y down)
  const litSet = nest ? new Set(nest.lit) : null;
  const T = (name, base, dim = 1) => tones(base, { key, shade: shadeRgb, strength, dim, dark: litSet && !litSet.has(name) ? nest.dark : null });
  const ow = D.outline * P;
  ctx.clearRect(0, 0, W, H);

  // Linear cylinder gradient across a segment: the lit tone sits on the side facing the light.
  const cyl = (c, nx, ny, half, t) => {
    const s = nx * lv[0] + ny * lv[1];
    const sg = s >= 0 ? 1 : -1;
    const g = ctx.createLinearGradient(c[0] + nx * sg * half, c[1] + ny * sg * half, c[0] - nx * sg * half, c[1] - ny * sg * half);
    g.addColorStop(0, css(t.lit));
    g.addColorStop(0.3, css(mix(t.lit, t.mid, 0.6)));
    g.addColorStop(0.55, css(t.mid));
    g.addColorStop(1, css(t.shade));
    return g;
  };
  // Radial sphere gradient: the highlight sits toward the light.
  const sphere = (c, rpx, t, off = 0.3) => {
    const o = off * rpx * strength;
    const hx = c[0] + lv[0] * o;
    const hy = c[1] + lv[1] * o;
    const g = ctx.createRadialGradient(hx, hy, 0, c[0], c[1], rpx + o);
    g.addColorStop(0, css(t.lit));
    g.addColorStop(0.3, css(mix(t.lit, t.mid, 0.7)));
    g.addColorStop(0.6, css(t.mid));
    g.addColorStop(1, css(t.shade));
    return g;
  };

  const limb = (a, b, base, dim, part) => {
    const A = pt(a);
    const B = pt(b);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = T(part, base, dim);
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = (D.limb + 2 * D.outline) * P;
    ctx.beginPath();
    ctx.moveTo(...A);
    ctx.lineTo(...B);
    ctx.stroke();
    ctx.strokeStyle = cyl([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], nx, ny, (D.limb / 2) * P, t);
    ctx.lineWidth = D.limb * P;
    ctx.beginPath();
    ctx.moveTo(...A);
    ctx.lineTo(...B);
    ctx.stroke();
  };
  const hand = (w) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(X(w.x), Y(w.y), (D.hand / 2) * P, 0, 6.2832);
    ctx.fill();
  };
  const dir = Math.sign(st.angle) || 1;
  const shoe = (leg, dim) => {
    const a = leg.ankle;
    ctx.fillStyle = css(mul([30, 30, 36], dim));
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow * 0.8;
    ctx.beginPath();
    ctx.ellipse(X(a.x + 0.07 * dir), Y(a.y - D.shoe / 2), 0.16 * P, (D.shoe / 2) * P, 0, 0, 6.2832);
    ctx.fill();
    ctx.stroke();
  };
  const arm = (side, dim) => {
    const a = fig['arm' + side];
    limb(a.shoulder, a.elbow, st.shirt.color, dim, 'arm');
    limb(a.elbow, a.wrist, st.shirt.color, dim, 'arm');
    hand(a.wrist);
  };
  const leg = (side, dim) => {
    const l = fig['leg' + side];
    limb(l.hip, l.knee, st.trousers, dim, 'leg');
    limb(l.knee, l.ankle, st.trousers, dim, 'leg');
    shoe(l, dim);
  };

  // ---- body (capsule 0.88 x 1.4) with the shirt
  const body = () => {
    const [h, tp] = fig.bodyAxis;
    const A = pt(h);
    const B = pt(tp);
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // The capsule narrows with the body turn (floor 0.8), like the shoulders and hips (figure() turn factor): 0.88 D wide facing the camera.
    const rpx = (D.bodyW / 2) * Math.max(0.8, turn) * P;
    const c0 = [A[0] + ux * rpx, A[1] + uy * rpx];
    const c1 = [B[0] - ux * rpx, B[1] - uy * rpx];
    const ang = Math.atan2(uy, ux);
    const pts = [...arcPts(c1[0], c1[1], rpx, rpx, ang - Math.PI / 2, ang + Math.PI / 2, 28), ...arcPts(c0[0], c0[1], rpx, rpx, ang + Math.PI / 2, ang + (3 * Math.PI) / 2, 28)];
    const nx = -uy;
    const ny = ux;
    const t = T('body', st.shirt.color);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = cyl([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], nx, ny, rpx, t);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Shoulder patch: in the dark nest only this part of the coat catches the key.
    if (litSet?.has('shoulder')) {
      const lt = tones(st.shirt.color, { key, shade: shadeRgb, strength });
      const sg = lv[0] >= 0 ? 1 : -1;
      ctx.fillStyle = css(lt.lit);
      const sy = Y(fig.sk.shoulderY + 0.12);
      ctx.fillRect(sg > 0 ? X(0.22) : X(-D.bodyW), sy, sg > 0 ? X(D.bodyW) - X(0.22) : X(-0.22) - X(-D.bodyW), 0.4 * P);
    }
    // Shirt details ride the body axis.
    const along = (s, off = 0) => [A[0] + ux * s * P + nx * off * P, A[1] + uy * s * P + ny * off * P];
    const so = Math.sin(st.angle) * 0.22; // the front seam slides sideways as the body turns
    const det = st.shirt.details ?? [];
    ctx.fillStyle = css(mul(hexRgb(st.shirt.color), 0.55));
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow * 0.45;
    if (det.includes('pocket')) {
      const p = along(1.0, -0.2 + so * 0.5);
      ctx.beginPath();
      ctx.rect(p[0] - 0.09 * P, p[1] - 0.09 * P, 0.18 * P, 0.17 * P);
      ctx.stroke();
    }
    if (det.includes('buttons')) {
      // buttonColor (char.json shirt): e.g. brass; ink when absent. A coloured button gets a thin ink ring.
      const bc = st.shirt.buttonColor;
      for (let i = 0; i < 3; i++) {
        const p = along(0.65 + i * 0.27, so);
        ctx.beginPath();
        ctx.arc(p[0], p[1], (bc ? 0.04 : 0.032) * P, 0, 6.2832);
        ctx.fillStyle = bc ? css(T('body', bc).lit) : INK;
        ctx.fill();
        if (bc) {
          ctx.lineWidth = ow * 0.35;
          ctx.strokeStyle = INK;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    brush(ctx, pts, true, ow, `${seed}:body`);
    // Rim light 0.03 D in the key colour on the lit straight edge.
    if (l2 > 0.12 * Math.hypot(lx, ly, lz)) {
      const s = nx * lv[0] + ny * lv[1];
      const sg = s >= 0 ? 1 : -1;
      const inset = rpx - ow * 0.5 - D.rim * P * 0.5;
      ctx.strokeStyle = rimCss;
      ctx.lineWidth = D.rim * P;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c0[0] + nx * sg * inset, c0[1] + ny * sg * inset);
      ctx.lineTo(c1[0] + nx * sg * inset, c1[1] + ny * sg * inset);
      ctx.stroke();
    }
    return { A, B, ux, uy, nx, ny, rpx };
  };

  // ---- neck dressing: collar, scarf (drawn before the head, which overlaps it)
  const neckDress = (b) => {
    const det = st.shirt.details ?? [];
    const top = [b.B[0] - b.ux * 0.12 * P, b.B[1] - b.uy * 0.12 * P];
    if (det.includes('collar')) {
      const up = st.shirt.collarUp ? 0.36 : 0.16;
      const t = T('body', st.shirt.collar ?? st.shirt.color);
      for (const sg of [-1, 1]) {
        const base = [top[0] + b.nx * sg * 0.12 * P, top[1] + b.ny * sg * 0.12 * P];
        ctx.beginPath();
        ctx.moveTo(base[0] - b.ux * 0.12 * P, base[1] - b.uy * 0.12 * P);
        ctx.lineTo(base[0] + b.nx * sg * 0.24 * P, base[1] + b.ny * sg * 0.24 * P);
        ctx.lineTo(base[0] + b.nx * sg * 0.08 * P + b.ux * up * P, base[1] + b.ny * sg * 0.08 * P + b.uy * up * P);
        ctx.closePath();
        ctx.fillStyle = css(t.mid);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = ow * 0.7;
        ctx.stroke();
      }
    }
    if (det.includes('scarf')) {
      const t = T('scarf', st.shirt.scarf ?? '#E8A64B');
      const c = [top[0], top[1]];
      const w = 0.62 * P;
      const h = 0.19 * P;
      ctx.save();
      ctx.translate(c[0], c[1]);
      ctx.rotate(Math.atan2(b.uy, b.ux) + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, 6.2832);
      ctx.fillStyle = cyl([0, 0], 1, 0, w / 2, t);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 0.8;
      ctx.stroke();
      // hanging tail on the near front
      const tx = (st.angle >= 0 ? 1 : -1) * 0.3 * P;
      ctx.beginPath();
      ctx.rect(tx - 0.07 * P, 0.02 * P, 0.15 * P, 0.46 * P);
      ctx.fillStyle = cyl([tx, 0.25 * P], 1, 0, 0.075 * P, t);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (acc.includes('bowtie')) {
      // Bow tie: two ink-outlined triangles and a knot at the throat (accessories "bowtie", colour params.bowtie).
      const t = T('bowtie', params.bowtie ?? INK);
      ctx.save();
      ctx.translate(top[0], top[1]);
      ctx.rotate(Math.atan2(b.uy, b.ux) + Math.PI / 2);
      ctx.fillStyle = css(t.mid);
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 0.6;
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(sg * 0.17 * P, -0.08 * P);
        ctx.lineTo(sg * 0.17 * P, 0.08 * P);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 0.04 * P, 0, 6.2832);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };
  const acc = params?.accessories ?? [];

  // ---- head, hat, face (in head-local space: origin at the head centre, x right, y up, in D)
  const head = () => {
    const hc = pt(fig.headC);
    ctx.save();
    ctx.translate(hc[0], hc[1]);
    ctx.rotate(fig.head.tilt);
    const L = (x, y) => [x * P, -y * P];
    const rpx = (D.head / 2) * P;
    const t = T('head', st.skin);
    ctx.beginPath();
    ctx.arc(0, 0, rpx, 0, 6.2832);
    ctx.fillStyle = sphere([0, 0], rpx, t);
    ctx.fill();
    brush(ctx, arcPts(0, 0, rpx, rpx, 0, 6.2832, 64), true, ow, `${seed}:head`);
    // Rim light on the lit edge of the head.
    if (l2 > 0.12 * Math.hypot(lx, ly, lz)) {
      const th = Math.atan2(lv[1], lv[0]) - fig.head.tilt;
      ctx.strokeStyle = rimCss;
      ctx.lineWidth = D.rim * P;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, rpx - ow * 0.5 - D.rim * P * 0.5, th - 1.2, th + 1.2);
      ctx.stroke();
    }
    const sh = st.look.shift;
    const sx = 1 - 0.25 * Math.min(1, Math.abs(st.angle) / (Math.PI / 2));
    if (!st.look.back) face(L, sh, sx);
    hat(L, sh, rpx);
    ctx.restore();
  };

  const face = (L, sh, sx) => {
    const eyeY = 0;
    // pose.gaze (0..1): the eyes (and brows) look along the face shift, sliding up to 0.08 D further than the face.
    const gz = (pose.gaze ?? 0) * 0.08 * (Math.sign(sh) || 1);
    const ex = [sh + gz - (D.eyeGap / 2) * sx, sh + gz + (D.eyeGap / 2) * sx];
    if (st.cheek) {
      for (const x of ex) {
        const c = L(x + Math.sign(x - sh) * 0.1 * sx, -0.13);
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 0.15 * P);
        const cc = hexRgb(st.cheek);
        g.addColorStop(0, `rgba(${cc.join(',')},0.38)`);
        g.addColorStop(1, `rgba(${cc.join(',')},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c[0], c[1], 0.15 * P, 0, 6.2832);
        ctx.fill();
      }
    }
    const eyes = st.blink ? 'closed' : pose.eyes ?? 'half';
    const r = (D.eye / 2) * P;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    for (const x of ex) {
      const c = L(x, eyeY);
      if (eyes === 'closed') {
        ctx.lineWidth = D.outline * 0.8 * P;
        ctx.beginPath();
        ctx.arc(c[0], c[1] - r * 0.4, r * 1.2, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        continue;
      }
      const rr = eyes === 'wide' ? r * 1.3 : r;
      ctx.beginPath();
      if (eyes === 'squint') ctx.ellipse(c[0], c[1], rr * 1.15, rr * 0.45, 0, 0, 6.2832);
      else ctx.arc(c[0], c[1], rr, 0, 6.2832);
      ctx.fill();
      if (eyes !== 'squint') {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(c[0] + rr * 0.32, c[1] - rr * 0.36, rr * 0.2, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = INK;
      }
      if (eyes === 'half') {
        // Smug half-lid: the head tone covers the upper third of the dot, a flat lid line sits on it.
        ctx.fillStyle = css(T('head', st.skin).mid);
        ctx.fillRect(c[0] - rr * 1.3, c[1] - rr * 1.5, rr * 2.6, rr * 1.12);
        ctx.fillStyle = INK;
        ctx.lineWidth = D.outline * 0.85 * P;
        ctx.beginPath();
        ctx.moveTo(c[0] - rr * 1.35, c[1] - rr * 0.36);
        ctx.lineTo(c[0] + rr * 1.35, c[1] - rr * 0.36);
        ctx.stroke();
      }
    }
    // Tapered brows 0.19 wide, 0.17 above the eyes.
    const brows = pose.brows ?? 'neutral';
    ex.forEach((x, i) => {
      const inner = i === 0 ? 1 : -1; // direction toward the face centre
      const lift = brows === 'raised' ? 0.05 : 0;
      const slope = { neutral: 0.0, raised: -0.02, frown: 0.06, worried: -0.06, flat: 0 }[brows] ?? 0;
      const half = D.browW / 2;
      const yc = eyeY + D.browUp + lift;
      const inn = L(x + inner * half, yc - slope);
      const out = L(x - inner * half, yc + slope * 0.4 + (brows === 'raised' ? -0.02 : 0.0));
      const wI = 0.036 * P;
      const wO = 0.008 * P;
      const nx = out[1] - inn[1];
      const ny = inn[0] - out[0];
      const nl = Math.hypot(nx, ny) || 1;
      ctx.beginPath();
      ctx.moveTo(inn[0] + (nx / nl) * wI, inn[1] + (ny / nl) * wI);
      ctx.lineTo(out[0] + (nx / nl) * wO, out[1] + (ny / nl) * wO);
      ctx.lineTo(out[0] - (nx / nl) * wO, out[1] - (ny / nl) * wO);
      ctx.lineTo(inn[0] - (nx / nl) * wI, inn[1] - (ny / nl) * wI);
      ctx.closePath();
      ctx.fillStyle = INK;
      ctx.fill();
    });
    mouth(L, sh * 0.8, sx);
    if (acc.includes('moustache')) {
      // Moustache (an era detail, not identity): two ink tufts above the mouth, curling out.
      ctx.fillStyle = params.moustache ?? INK;
      ctx.strokeStyle = INK;
      ctx.lineWidth = D.outline * 0.5 * P;
      for (const sg of [-1, 1]) {
        const q = (x, y) => L(sh * 0.8 + sg * x * sx, y);
        ctx.beginPath();
        ctx.moveTo(...q(0.01, -0.15));
        ctx.quadraticCurveTo(...q(0.1, -0.12), ...q(0.19, -0.19));
        ctx.quadraticCurveTo(...q(0.12, -0.2), ...q(0.01, -0.19));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  };

  const mouth = (L, mx, sx) => {
    const m = st.mouth;
    const y = -0.24;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = D.outline * 0.85 * P;
    const p = (x, yy) => L(mx + x * sx, y + yy);
    ctx.beginPath();
    if (m === 'line') {
      ctx.moveTo(...p(-0.1, 0));
      ctx.lineTo(...p(0.1, 0));
      ctx.stroke();
    } else if (m === 'smirk') {
      ctx.moveTo(...p(-0.1, -0.005));
      ctx.quadraticCurveTo(...p(0.05, -0.02), ...p(0.14, 0.05));
      ctx.stroke();
    } else if (m === 'o') {
      const c = p(0, 0);
      ctx.ellipse(c[0], c[1], 0.045 * P, 0.058 * P, 0, 0, 6.2832);
      ctx.fill();
    } else if (m === 'grin') {
      ctx.moveTo(...p(-0.15, 0.03));
      ctx.quadraticCurveTo(...p(0, -0.14), ...p(0.15, 0.03));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F4EFE6';
      const g0 = p(-0.09, 0.0);
      ctx.fillRect(g0[0], g0[1], 0.18 * sx * P, 0.022 * P);
    } else if (m === 'gritted') {
      const a = p(-0.12, 0.045);
      ctx.rect(a[0], a[1], 0.24 * sx * P, 0.09 * P);
      ctx.fillStyle = '#F4EFE6';
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = D.outline * 0.4 * P;
      for (const f of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(a[0] + (0.12 + f * 0.12) * sx * P, a[1]);
        ctx.lineTo(a[0] + (0.12 + f * 0.12) * sx * P, a[1] + 0.09 * P);
        ctx.stroke();
      }
    } else if (m === 'frown') {
      ctx.moveTo(...p(-0.1, -0.03));
      ctx.quadraticCurveTo(...p(0, 0.05), ...p(0.1, -0.03));
      ctx.stroke();
    } else if (m === 'shout') {
      const c = p(0, -0.02);
      ctx.ellipse(c[0], c[1], 0.085 * sx * P, 0.1 * P, 0, 0, 6.2832);
      ctx.fill();
    }
  };

  const hat = (L, sh, rpx) => {
    const h = st.hat;
    if (!h) return;
    const side = Math.sign(sh) || 1;
    const cols = h.colours;
    // Crown: a dome sitting on the head above the brows; shifts a third as far as the face.
    const dx = sh * 0.35;
    const crown = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI + (Math.PI * i) / 40;
      crown.push(L(dx + Math.cos(a) * 0.55, 0.3 - Math.sin(a) * 0.3));
    }
    const ct = T('hat', cols.crown);
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      ctx.closePath();
    };
    poly(crown);
    const c0 = L(dx, 0.3);
    ctx.fillStyle = sphere(c0, 0.55 * P, ct, 0.25);
    ctx.fill();
    brush(ctx, crown, true, ow, `${st.seed}:hat`);
    const stripe = T('hat', cols.band ?? cols.crown);
    const bandH = h.type === 'knit' ? 0.16 : 0.06;
    // the band follows the dome: clip to the crown
    ctx.save();
    poly(crown);
    ctx.clip();
    ctx.fillStyle = cyl(c0, 1, 0, 0.55 * P, stripe);
    ctx.fillRect(c0[0] - 0.6 * P, c0[1] - bandH * P, 1.2 * P, bandH * P);
    if (h.type === 'knit') {
      ctx.strokeStyle = INK;
      ctx.lineWidth = D.outline * 0.35 * P;
      for (let i = -5; i <= 5; i++) {
        const x = c0[0] + i * 0.1 * P;
        ctx.beginPath();
        ctx.moveTo(x, c0[1] - bandH * P);
        ctx.lineTo(x, c0[1]);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow * 0.7;
    ctx.beginPath();
    ctx.moveTo(c0[0] - 0.55 * P, c0[1]);
    ctx.lineTo(c0[0] + 0.55 * P, c0[1]);
    ctx.stroke();
    if (h.type === 'peaked') {
      // Brim: a flat dark ellipse that projects toward the look direction and shifts with the face.
      const bt = T('brim', cols.brim ?? '#141414');
      const bc = L(sh * 1.9 + side * 0.0, 0.27);
      const rx = 0.37 * P;
      ctx.beginPath();
      ctx.ellipse(bc[0], bc[1], rx, 0.075 * P, 0, 0, 6.2832);
      ctx.fillStyle = cyl(bc, 1, 0, rx, bt);
      ctx.fill();
      brush(ctx, arcPts(bc[0], bc[1], rx, 0.075 * P, 0, 6.2832, 36), true, ow * 0.8, `${st.seed}:brim`);
      if (st.litBrim) {
        ctx.strokeStyle = rimCss;
        ctx.lineWidth = D.rim * P;
        ctx.beginPath();
        ctx.ellipse(bc[0], bc[1], rx - ow, 0.075 * P - ow, 0, -0.9, 0.2);
        ctx.stroke();
      }
    }
    if (h.type === 'knit') {
      const pr = 0.09 * P;
      const pc = L(dx, 0.3 + 0.3 + 0.07);
      ctx.beginPath();
      ctx.arc(pc[0], pc[1], pr, 0, 6.2832);
      ctx.fillStyle = sphere(pc, pr, stripe);
      ctx.fill();
      brush(ctx, arcPts(pc[0], pc[1], pr, pr, 0, 6.2832, 20), true, ow * 0.7, `${st.seed}:pom`);
    }
  };

  // ---- draw in order: far limbs first (10% darker), then body, near arm, neck dressing, head
  const k = order.darken;
  const run = {
    armL: () => arm('L', order.far === 'L' ? k : 1),
    armR: () => arm('R', order.far === 'R' ? k : 1),
    legL: () => leg('L', order.far === 'L' ? k : 1),
    legR: () => leg('R', order.far === 'R' ? k : 1),
  };
  let bodyInfo = null;
  for (const part of order.order) {
    if (run[part]) run[part]();
    else if (part === 'body') {
      bodyInfo = body();
      neckDress(bodyInfo);
    } else if (part === 'head') head();
  }
}
