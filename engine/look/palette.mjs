import * as THREE from 'three';
import { toonMaterial, DEFAULT_RAMP, controlsKey } from './toon.mjs';

export const GUIDE_ACCENT = '#E8336D';

// Build a palette from a look JSON object (engine/looks/<name>.json).
export function makePalette(json, name = 'look') {
  const names = Object.keys(json.colors);
  if (names.length !== 5) throw new Error(`look ${name}: needs 5 colours`);
  for (const hex of Object.values(json.colors)) {
    if (hex.toUpperCase() === GUIDE_ACCENT) throw new Error(`look ${name}: guide accent in palette`);
  }
  const hexOf = (v) => (v === 'ink' ? json.ink : v === 'paper' ? json.paper : json.colors[v] ?? v);
  const color = (v) => new THREE.Color(hexOf(v));
  const shadowTo = color(json.shadowTo);
  const ramp = { ...DEFAULT_RAMP, ...(json.ramp ?? {}), ink: json.ink };
  const cache = new Map();
  const palette = {
    name,
    json,
    ramp,
    hex: hexOf,
    hexOf,
    color,
    ink: new THREE.Color(json.ink),
    paper: new THREE.Color(json.paper),
    fog: color(json.fog),
    shadowTo,
    // Mix two palette colours (names or hex); t=0 gives a, t=1 gives b (linear working space).
    mix(a, b, t) {
      return color(a).lerp(color(b), t);
    },
    // sRGB-space mix, returned as hex (for SVG/canvas work).
    mixHex(a, b, t) {
      const ca = new THREE.Color().setStyle(hexOf(a), THREE.NoColorSpace);
      const cb = new THREE.Color().setStyle(hexOf(b), THREE.NoColorSpace);
      return '#' + ca.lerp(cb, t).getHexString(THREE.NoColorSpace);
    },
    // Shared toon material per colour key (+ paint); shadows shift toward shadowTo.
    toon(key, opts = {}) {
      const id = typeof key === 'string' ? `${key}|${opts.paint ?? ''}|${opts.fog ?? ''}|${controlsKey(opts)}` : null;
      if (id && cache.has(id)) return cache.get(id);
      const c = key instanceof THREE.Color ? key : color(key);
      const m = toonMaterial(c, shadowTo, { ramp, ...opts });
      if (id) cache.set(id, m);
      return m;
    },
  };
  return palette;
}

export async function loadLook(name, base = '/engine/looks/') {
  const res = await fetch(`${base}${name}.json`);
  if (!res.ok) throw new Error(`look ${name}: ${res.status}`);
  return makePalette(await res.json(), name);
}
