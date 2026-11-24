import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VERT, srgbVec } from './common.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

// Transitions: blink, sting, whip, match. The maths is pure (testable); one full-screen pass draws them in ink #141414.
//  blink  8 frames: two slightly curved ink eyelids, close 3 / hold 2 / open 3.
//  sting  12 frames: seeded ink blobs splash outward from the centre, revealing the scene.
//  whip   the whip preset (engine/rig/presets.mjs) across the cut; the pass only draws its smear frame (stretched ink streaks).
//  match  a circular iris through the screen position of a round anchor: closes onto it, opens on the next scene.
export const BLINK_FRAMES = 8;
export const STING_FRAMES = 12;
export const MATCH_FRAMES = 12;
export const TRANSITION_FRAMES = { blink: BLINK_FRAMES, sting: STING_FRAMES, match: MATCH_FRAMES, whip: 8 };

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
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // Set the pass state for a frame. t: the active transition ({type, k, centre?}) or null; smear: {streak:[x,y]} or null.
  pass.setState = (t, smear = null) => {
    const u = pass.uniforms;
    u.uMode.value = 0;
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
    } else if (smear) {
      u.uMode.value = 4;
      u.uStreak.value.set(smear.streak[0] * 3, smear.streak[1] * 3);
    }
  };
  return pass;
}
