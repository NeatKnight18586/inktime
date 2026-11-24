// Sound words (docs/STYLE.md, Sound words): hand-lettered SVGs from tools/letter.mjs placed in 3D at the sound source as
// camera-facing quads. Solid cutout like the cards (alphaTest 0.5 equivalent, not transparent, depth written, in the
// depth/normal prepass). Pop in over 3 frames (scale 0.6 -> 1.15 -> 1.0), hold, fade over 6 frames (an dithered dissolve,
// so every pixel stays fully opaque or absent); the variant is picked by seed.
// Episode spec: "sfx": [{ "word": "CREAK", "at": frame, "anchor": "forestay_top", "size": m (letter-box height),
// "lift": m, "hold": frames }]. An anchor that the current shot holds (camera.object) resolves to the held object.
import * as THREE from 'three';
import { LAYERS } from './look/layers.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';

export const POP = [0.6, 1.15, 1.0];
export const FADE_FRAMES = 6;
export const HOLD_FRAMES = 24;
export const SIZE = 0.3;

// Scale and fade (1..0) at frame n, or null when the word is not on screen.
export function sfxState(ev, n) {
  const k = n - ev.at;
  const hold = ev.hold ?? HOLD_FRAMES;
  if (k < 0) return null;
  if (k < POP.length) return { scale: POP[k], fade: 1, phase: 'pop' };
  if (k < POP.length + hold) return { scale: 1, fade: 1, phase: 'hold' };
  const f = k - POP.length - hold;
  if (f < FADE_FRAMES) return { scale: 1, fade: 1 - (f + 1) / (FADE_FRAMES + 1), phase: 'fade' };
  return null;
}
export const sfxEnd = (ev) => ev.at + POP.length + (ev.hold ?? HOLD_FRAMES) + FADE_FRAMES;
export const pickVariant = (seed, ev) => 1 + Math.floor(rng(hashSeed(`${seed}:sfx:${ev.word}:${ev.at}`))() * 3);
export const sfxTilt = (seed, ev) => (rng(hashSeed(`${seed}:sfx-tilt:${ev.word}:${ev.at}`))() * 2 - 1) * 6 * (Math.PI / 180);

// World-space corners of the quad (for framing tests): centre, camera quaternion, height and aspect (w / h).
export function sfxCorners(centre, quat, height, aspect, scale = 1, tilt = 0) {
  const h = (height * scale) / 2;
  const w = h * aspect;
  const q = quat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyQuaternion(q).add(centre));
}

// Screen-space dissolve threshold (interleaved gradient noise, fixed per pixel): a pixel is kept while its threshold is below the fade.
const FRAG = /* glsl */ `
uniform sampler2D map; uniform float uFade; uniform float uPrepass; varying vec2 vUv; varying vec3 vN;
float dither(vec2 p) { return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715)))); }
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) discard;
  if (dither(gl_FragCoord.xy) >= uFade) discard;
  if (uPrepass > 0.5) { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); return; }
  gl_FragColor = vec4(c.rgb, 1.0);
}`;
const VERT = 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

export function sfxMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uFade: { value: 1 }, uPrepass: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

async function loadSvg(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sound word ${url}: ${res.status}`);
  const blob = new Blob([await res.text()], { type: 'image/svg+xml' });
  const src = URL.createObjectURL(blob);
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  URL.revokeObjectURL(src);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height };
}

export async function makeSfx(scene, events, anchors, { seed = 'sfx', held = {} } = {}) {
  const items = [];
  for (const ev of events ?? []) {
    const v = ev.variant ?? pickVariant(seed, ev);
    const { tex, aspect } = await loadSvg(`/sfx-words/${ev.word}/v${v}.svg`);
    const mat = sfxMaterial(tex);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.name = `sfx:${ev.word}`;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.layers.set(LAYERS.CARD_BODY);
    scene.add(mesh);
    items.push({ ev, mesh, mat, aspect, variant: v });
  }
  const p = new THREE.Vector3();
  return {
    items,
    prepass(on) {
      for (const it of items) it.mat.uniforms.uPrepass.value = on ? 1 : 0;
    },
    // active: the baked plan entry's sound words [{ i, pos | held, lift, tilt, size, scale, opacity }] (tools/bake.mjs).
    // A word whose source is the held object sits on it (its anchor name is the key in `held`).
    update(n, camera, active = []) {
      const on = new Set(active.map((a) => a.i));
      items.forEach((it, i) => {
        it.mesh.visible = on.has(i);
      });
      for (const a of active) {
        const it = items[a.i];
        if (a.held) {
          const src = held[it.ev.anchor];
          src.updateWorldMatrix(true, false);
          src.getWorldPosition(p);
          p.y += a.lift ?? 0;
        } else p.set(...a.pos);
        it.mesh.position.copy(p);
        it.mesh.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a.tilt));
        const h = a.size * a.scale;
        it.mesh.scale.set(h * it.aspect, h, 1);
        it.mat.uniforms.uFade.value = a.opacity;
      }
    },
  };
}
