import * as THREE from 'three';
import { toonMaterial } from './toon.mjs';

export const GUIDE_ACCENT = '#E8336D';

// Build a palette from a look JSON object (engine/looks/<name>.json).
export function makePalette(json, name = 'look') {
  const names = Object.keys(json.colors);
  if (names.length !== 5) throw new Error(`look ${name}: needs 5 colours`);
  for (const hex of Object.values(json.colors)) {
    if (hex.toUpperCase() === GUIDE_ACCENT) throw new Error(`look ${name}: guide accent in palette`);
  }
  const hex = (v) => (json.colors[v] ?? v);
  const color = (v) => new THREE.Color(hex(v));
  const shadowTo = color(json.shadowTo);
  const cache = new Map();
  const palette = {
    name,
    json,
    hex,
    color,
    ink: new THREE.Color(json.ink),
    paper: new THREE.Color(json.paper),
    fog: color(json.fog),
    shadowTo,
    // Mix two palette colours (or hex values) in sRGB; t=0 gives a, t=1 gives b.
    mix(a, b, t) {
      const ca = new THREE.Color(a in json.colors || a === 'ink' || a === 'paper' ? palette.hexOf(a) : a);
      const cb = new THREE.Color(b in json.colors || b === 'ink' || b === 'paper' ? palette.hexOf(b) : b);
      return ca.lerp(cb, t);
    },
    hexOf(v) {
      if (v === 'ink') return json.ink;
      if (v === 'paper') return json.paper;
      return hex(v);
    },
    // Shared toon material per colour key; shadows shift toward shadowTo.
    toon(key, opts) {
      const id = typeof key === 'string' && !opts ? key : null;
      if (id && cache.has(id)) return cache.get(id);
      const c = key instanceof THREE.Color ? key : new THREE.Color(palette.hexOf(key));
      const m = toonMaterial(c, shadowTo, opts);
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
