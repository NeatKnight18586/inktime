import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VERT, srgbVec } from './common.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';
import { letterImage } from '../look/lettering.mjs';

// Transitions: blink, sting, whip, match. The maths is pure (testable); one full-screen pass draws them in ink #141414.
//  blink  8 frames: two slightly curved ink eyelids, close 3 / hold 2 / open 3.
//  sting  12 frames: seeded ink blobs splash outward from the centre, revealing the scene.
//  whip   the whip preset (engine/rig/presets.mjs) across the cut; the pass only draws its smear frame (stretched ink streaks).
//  match  a circular iris through the screen position of a round anchor: closes onto it, opens on the next scene.
//  jump   20 frames, the time jump: Tick flies to the centre and grows to 40% of the width in 6 frames (there by frame 8) while
//         its hands spin (frames 0-11), an ink splash grows from Tick from frame 12 and covers the frame, the cut lands at frame 14 and the splash wipes open on the
//         destination (14-19). A hand-lettered date stamp card then pops in for 1.2 s. "back": the same 20 frames reversed
//         (the cut at frame 6, Tick shrinks back to its slot), no stamp. Rule: at most 2 jumps per episode, each to a new place.
export const BLINK_FRAMES = 8;
export const STING_FRAMES = 12;
export const MATCH_FRAMES = 12;
export const JUMP = { frames: 20, cut: 14, fly: 12, flyIn: 6, coverFrom: 12, stampSeconds: 1.2, tickWidth: 0.4, max: 2 };
export const TRANSITION_FRAMES = { blink: BLINK_FRAMES, sting: STING_FRAMES, match: MATCH_FRAMES, whip: 8, jump: JUMP.frames };

// Jump state for local frame k (0..19): fly 0..1 (Tick from its slot to the centre), cover 0..1 (ink grows from Tick) and
// reveal 0..1 (the splash wiping open on the destination). back: the timeline reversed.
export function jumpState(k, back = false) {
  const j = back ? JUMP.frames - 1 - k : k;
  const fly = Math.min(1, (j + 1) / JUMP.flyIn);
  const cover = j < JUMP.coverFrom ? 0 : j < JUMP.cut ? (j - JUMP.coverFrom + 1) / (JUMP.cut - JUMP.coverFrom) : 1;
  const reveal = j < JUMP.cut ? 0 : (j - JUMP.cut + 1) / (JUMP.frames - JUMP.cut);
  return { j, fly, cover, reveal, spin: j < JUMP.fly, cut: back ? JUMP.frames - JUMP.cut : JUMP.cut };
}
// The stamp card after an outbound jump: frames from the cut, pop scale 0.6 -> 1.15 -> 1.0, then held; null when gone.
export function stampState(t, n, fps = 24) {
  if (t?.type !== 'jump' || t.back || !t.stamp) return null;
  const k = n - (t.at + JUMP.cut);
  if (k < 0 || k >= Math.round(JUMP.stampSeconds * fps)) return null;
  return { text: t.stamp, k, scale: [0.6, 1.15, 1.0][k] ?? 1 };
}

// Eyelid cover 0..1 for local frame k (0..7): close 3 (1/3, 2/3, 1), hold 2, open 3 (2/3, 1/3, 0).
export function blinkCover(k) {
  if (k < 0 || k >= BLINK_FRAMES) return 0;
  if (k < 3) return (k + 1) / 3;
  if (k < 5) return 1;
  return 1 - (k - 4) / 3;
}
// Sting reveal progress 0..1 for local frame k (0..11); ink-covered at the start, fully revealed at k = 11.
export const stingProgress = (k) => (k < 0 ? 0 : k >= STING_FRAMES - 1 ? 1 : (k + 1) / STING_FRAMES);
// Seeded splash blobs: [angle, reach (x edge radius), size].
export function stingBlobs(seed, n = 10) {
  const r = rng(hashSeed(`${seed}:sting`));
  return Array.from({ length: n }, () => [r() * Math.PI * 2, 0.95 + r() * 0.6, 0.025 + r() * 0.05]);
}
export function stingPhases(seed) {
  const r = rng(hashSeed(`${seed}:stingw`));
  return [r() * 6.28, r() * 6.28, r() * 6.28];
}
// Iris radius (in screen heights) for local frame k (0..11): closes to a point over 6 frames, opens over 6.
export function irisRadius(k) {
  if (k < 0 || k >= MATCH_FRAMES) return 1.4;
  return k < 6 ? 1.4 * (1 - (k + 1) / 6) + 0.02 : 1.4 * ((k - 5) / 6) + 0.02;
}

// The transition active at absolute frame n: spec.transitions = [{ type, at, anchor? }], at = first frame.
export function transitionAt(transitions, n) {
  for (const t of transitions ?? []) {
    if (t.type === 'jump_back') {
      if (n >= t.at && n < t.at + JUMP.frames) return { ...t, type: 'jump', back: true, k: n - t.at };
      continue;
    }
    const len = TRANSITION_FRAMES[t.type];
    if (n >= t.at && n < t.at + len) return { ...t, k: n - t.at };
  }
  return null;
}

export function transitionPass({ res, ink, seed = 'transition' }) {
  const blobs = stingBlobs(seed).map((b) => new THREE.Vector3(...b));
  const ph = stingPhases(seed);
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uRes: { value: res.clone() },
      uInk: { value: new THREE.Vector3(...srgbVec(ink)) },
      uMode: { value: 0 },
      uP: { value: 0 },
      uCentre: { value: new THREE.Vector2(0.5, 0.5) },
      uStreak: { value: new THREE.Vector2(0, 0) },
      uBlobs: { value: blobs },
      uPhase: { value: new THREE.Vector3(...ph) },
      uP2: { value: 0 },
      uStamp: { value: null },
      uStampRect: { value: new THREE.Vector4(0.5, 0.82, 0.78, 0.11) },
      uStampScale: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uRes;
      uniform vec3 uInk;
      uniform int uMode;
      uniform float uP;
      uniform vec2 uCentre;
      uniform vec2 uStreak;
      uniform vec3 uBlobs[10];
      uniform vec3 uPhase;
      uniform float uP2;
      uniform sampler2D uStamp;
      uniform vec4 uStampRect;
      uniform float uStampScale;
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        float asp = uRes.x / uRes.y;
        if (uMode == 1) {
          // Blink: two slightly curved eyelids from the top and bottom edges. uP = cover 0..1.
          float x = (vUv.x - 0.5) * 2.0;
          float curve = 0.07 * (1.0 - x * x);
          float edgeTop = 1.0 - uP * 0.5 - curve * uP;       // the top lid's lower edge bows down in the middle
          float edgeBot = uP * 0.5 + curve * uP;              // the bottom lid's upper edge bows up in the middle
          if (uP > 0.0 && (vUv.y > edgeTop || vUv.y < edgeBot)) col = uInk;
        } else if (uMode == 2) {
          // Sting: ink everywhere except a seeded, wobbling splash growing from the centre (plus flying droplets).
          if (uP < 1.0) {
            vec2 p = (vUv - 0.5) * vec2(asp, 1.0);
            float d = length(p);
            float th = atan(p.y, p.x);
            float wob = 1.0 + 0.22 * sin(3.0 * th + uPhase.x) + 0.14 * sin(5.0 * th + uPhase.y) + 0.08 * sin(9.0 * th + uPhase.z);
            float R = uP * 1.9 * 0.67;
            bool shown = d < R * wob;
            for (int i = 0; i < 10; i++) {
              vec2 c = vec2(cos(uBlobs[i].x), sin(uBlobs[i].x)) * R * uBlobs[i].y;
              if (length(p - c) < uBlobs[i].z * (1.0 - 0.5 * uP)) shown = true;
            }
            if (!shown) col = uInk;
          }
        } else if (uMode == 5) {
          // Jump: ink grows from Tick's screen point (uCentre) to cover the frame (uP = cover), then the sting-like splash
          // wipes open on the destination (uP2 = reveal).
          vec2 p = (vUv - uCentre) * vec2(asp, 1.0);
          float d = length(p);
          float th = atan(p.y, p.x);
          float wob = 1.0 + 0.22 * sin(3.0 * th + uPhase.x) + 0.14 * sin(5.0 * th + uPhase.y) + 0.08 * sin(9.0 * th + uPhase.z);
          if (uP2 > 0.0) {
            if (d >= uP2 * 1.9 * 0.67 * wob) col = uInk;
          } else if (uP > 0.0) {
            bool ink = d < uP * 1.4 * wob;
            for (int i = 0; i < 10; i++) {
              vec2 c = vec2(cos(uBlobs[i].x), sin(uBlobs[i].x)) * uP * 1.2 * uBlobs[i].y;
              if (length(p - c) < uBlobs[i].z * 1.5) ink = true;
            }
            if (ink) col = uInk;
          }
        } else if (uMode == 3) {
          // Match: a circular iris around the round anchor; uP = radius in screen heights.
          vec2 p = (vUv - uCentre) * vec2(asp, 1.0);
          if (length(p) > uP) col = uInk;
        } else if (uMode == 4) {
          // Whip smear frame: stretched ink streaks (the darkest sample along the motion wins; never a blur).
          vec3 best = col;
          for (int i = 1; i <= 12; i++) {
            vec3 s = texture2D(tDiffuse, clamp(vUv - uStreak * (float(i) / 12.0) / uRes, vec2(0.0), vec2(1.0))).rgb;
            if (dot(s, vec3(0.2126, 0.7152, 0.0722)) < dot(best, vec3(0.2126, 0.7152, 0.0722))) best = s;
          }
          col = best;
        }
        // The date stamp card (after an outbound jump): a paper card with hand-lettered ink text, popped in at uStampScale.
        if (uStampScale > 0.0) {
          vec2 q = (vUv - uStampRect.xy) / (uStampRect.zw * uStampScale) + 0.5;
          if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
            vec4 s = texture2D(uStamp, q);
            if (s.a > 0.5) col = s.rgb;
          }
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // Set the pass state for a frame. t: the active transition ({type, k, centre?}) or null; smear: {streak:[x,y]} or null.
  pass.setState = (t, smear = null) => {
    const u = pass.uniforms;
    u.uMode.value = 0;
    u.uP2.value = 0;
    if (t?.type === 'blink') {
      u.uMode.value = 1;
      u.uP.value = blinkCover(t.k);
    } else if (t?.type === 'sting') {
      u.uMode.value = 2;
      u.uP.value = stingProgress(t.k);
    } else if (t?.type === 'match') {
      u.uMode.value = 3;
      u.uP.value = irisRadius(t.k);
      u.uCentre.value.set(...(t.centre ?? [0.5, 0.5]));
    } else if (t?.type === 'jump') {
      const js = jumpState(t.k, !!t.back);
      u.uMode.value = 5;
      u.uP.value = js.cover;
      u.uP2.value = js.reveal >= 1 ? 0 : js.reveal;
      if (js.reveal >= 1) u.uMode.value = 0;
      u.uCentre.value.set(...(t.centre ?? [0.5, 0.55]));
    } else if (smear) {
      u.uMode.value = 4;
      u.uStreak.value.set(smear.streak[0] * 3, smear.streak[1] * 3);
    }
  };
  // The stamp: tex (a canvas texture of the card, made by stampTexture) and its state from stampState, or null.
  pass.setStamp = (tex, st) => {
    const u = pass.uniforms;
    u.uStamp.value = tex;
    u.uStampScale.value = tex && st ? st.scale : 0;
    if (tex && st) u.uStampRect.value.w = u.uStampRect.value.z * (tex.image.height / tex.image.width) * (pass.uniforms.uRes.value.x / pass.uniforms.uRes.value.y);
  };
  return pass;
}

// Browser: the stamp as a texture: one paper card per line ("|" separates stacked cards, each within the 3-word rule), each with
// a double ink border and its text hand-lettered in ink (engine/look/lettering.mjs), stacked and a little askew.
export async function stampTexture(text, { ink = '#141414', paper = '#F4EFE6', seed = 'stamp' } = {}) {
  const lines = String(text).split('|').map((l) => l.trim()).filter(Boolean);
  const CH = 200;
  const GAP = 36;
  const c = document.createElement('canvas');
  c.width = 1400;
  c.height = lines.length * CH + (lines.length - 1) * GAP + 40;
  const g = c.getContext('2d');
  const r = rng(hashSeed(`${seed}:${text}`));
  for (const [i, line] of lines.entries()) {
    const img = await letterImage(line, { fill: ink, seed: 'v1' });
    const k = Math.min(1180 / img.width, 116 / img.height);
    const w = Math.min(1360, img.width * k + 150);
    g.save();
    g.translate(c.width / 2 + (i % 2 ? 40 : -20), 20 + CH / 2 + i * (CH + GAP));
    g.rotate((r() * 2 - 1) * 0.035);
    g.fillStyle = paper;
    g.fillRect(-w / 2, -CH / 2, w, CH);
    g.strokeStyle = ink;
    g.lineWidth = 10;
    g.strokeRect(-w / 2 + 8, -CH / 2 + 8, w - 16, CH - 16);
    g.lineWidth = 4;
    g.strokeRect(-w / 2 + 24, -CH / 2 + 24, w - 48, CH - 48);
    g.drawImage(img, (-img.width * k) / 2, (-img.height * k) / 2, img.width * k, img.height * k);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
