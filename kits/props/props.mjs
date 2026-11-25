// Shared story props, procedural, in the toon look (materials from the set's palette). Hand-lettered in-world text uses
// engine/look/lettering.mjs (letter.mjs), at most 3 words per item, only for things the narration names.
// Each builder returns { group, ready } (ready: a promise that resolves once any lettering has been drawn; Node: no lettering).
import * as THREE from 'three';
import { letterImage } from '../../engine/look/lettering.mjs';
import { LAYERS } from '../../engine/look/layers.mjs';

const browser = typeof document !== 'undefined';
const box = (w, h, d, mat, x = 0, y = 0, z = 0, name = '') => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.name = name;
  return m;
};

// A lettered plane (cutout): `text` brush-lettered in `fill`, fitted into w x h metres; transparent background.
export function letterPlane(text, w, h, { fill = '#141414', seed = 'v1', name = 'lettering' } = {}) {
  const geo = new THREE.PlaneGeometry(w, h);
  if (!browser) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.name = name;
    return { mesh: m, ready: Promise.resolve() };
  }
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.max(64, Math.round((1024 * h) / w));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, fog: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  // Colour only: no ink hull round the plane, not in the line prepass (the lettering carries its own ink).
  mesh.layers.set(LAYERS.FX);
  mesh.userData.noHull = true;
  const ready = letterImage(text, { seed, fill }).then((img) => {
    const g = c.getContext('2d');
    const k = Math.min(c.width / img.width, c.height / img.height) * 0.94;
    g.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
    tex.needsUpdate = true;
  });
  return { mesh, ready };
}

// A real 6 cm brass padlock: body 6 x 5 x 2 cm, steel shackle, keyhole in ink. Origin at the body centre.
export function padlock(pal) {
  const g = new THREE.Group();
  g.name = 'padlock';
  const brass = pal.toon('lamp', { paint: 'steel' });
  const steel = pal.toon(pal.json.colors.steel ? 'steel' : 'ink');
  g.add(box(0.06, 0.05, 0.02, brass, 0, 0, 0, 'padlock_body'));
  const sh = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.004, 6, 16, Math.PI), steel);
  sh.position.y = 0.025;
  sh.name = 'padlock_shackle';
  g.add(sh);
  g.add(box(0.006, 0.014, 0.002, pal.toon('ink'), 0, -0.006, 0.0105, 'keyhole'));
  return { group: g, ready: Promise.resolve() };
}

// A wooden crate stencilled with `text` on its front (+Z face), a hasp and the 6 cm padlock hanging from it.
export function crate(pal, { w = 0.56, h = 0.38, d = 0.36, text = 'BINOCULARS', wood = null } = {}) {
  const g = new THREE.Group();
  g.name = 'crate';
  const woodMat = pal.toon(wood ?? pal.mix('lamp', 'ink', 0.45), { paint: 'wood' });
  const dark = pal.toon(pal.mix('lamp', 'ink', 0.7), { paint: 'wood' });
  g.add(box(w, h, d, woodMat, 0, h / 2, 0, 'crate_body'));
  // Corner battens and the lid edge.
  for (const sx of [-1, 1]) g.add(box(0.04, h, 0.01, dark, sx * (w / 2 - 0.02), h / 2, d / 2 + 0.005, 'batten'));
  g.add(box(w + 0.02, 0.03, d + 0.02, dark, 0, h - 0.015, 0, 'crate_lid'));
  const st = letterPlane(text, w * 0.78, h * 0.32, { fill: pal.hexOf('ink'), name: 'stencil' });
  st.mesh.position.set(0, h * 0.42, d / 2 + 0.012);
  g.add(st.mesh);
  g.add(box(0.03, 0.06, 0.012, pal.toon('steel' in pal.json.colors ? 'steel' : 'ink'), 0, h - 0.06, d / 2 + 0.012, 'hasp'));
  const lock = padlock(pal);
  lock.group.position.set(0, h - 0.115, d / 2 + 0.024);
  g.add(lock.group);
  return { group: g, padlock: lock.group, ready: st.ready };
}

// A brass key (about 9 cm) with a paper tag reading `tag` on a string.
export function brassKey(pal, { tag = 'CROWS NEST TELEPHONE' } = {}) {
  const g = new THREE.Group();
  g.name = 'key';
  const brass = pal.toon('lamp', { paint: 'steel' });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 8, 20), brass);
  bow.position.x = -0.04;
  g.add(bow, box(0.06, 0.006, 0.004, brass, 0.0, 0, 0, 'key_shank'), box(0.006, 0.014, 0.004, brass, 0.027, -0.008, 0, 'key_bit'), box(0.006, 0.01, 0.004, brass, 0.017, -0.006, 0, 'key_bit2'));
  const paper = pal.toon('paper');
  const card = box(0.07, 0.035, 0.001, paper, -0.1, -0.03, 0, 'tag');
  card.rotation.z = 0.2;
  const tl = letterPlane(tag, 0.064, 0.026, { fill: pal.hexOf('ink'), name: 'tag_text' });
  tl.mesh.position.set(0, 0, 0.0012);
  card.add(tl.mesh);
  g.add(card);
  return { group: g, ready: tl.ready };
}

// A gavel: a turned wooden head on a handle, and its sound block.
export function gavel(pal, { wood = null } = {}) {
  const g = new THREE.Group();
  g.name = 'gavel';
  const woodMat = pal.toon(wood ?? pal.mix('lamp', 'ink', 0.5), { paint: 'wood' });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.11, 16), woodMat);
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.2;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.22, 10), woodMat);
  handle.position.y = 0.09;
  g.add(head, handle);
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.025, 20), woodMat);
  block.name = 'sound_block';
  return { group: g, block, ready: Promise.resolve() };
}

// A hand-lettered card on a little easel (the price card).
export function letteredCard(pal, text, { w = 0.42, h = 0.26, fill = null } = {}) {
  const g = new THREE.Group();
  g.name = 'card';
  g.add(box(w, h, 0.006, pal.toon('paper'), 0, h / 2, 0, 'card_board'));
  const tl = letterPlane(text, w * 0.86, h * 0.6, { fill: fill ?? pal.hexOf('ink'), name: 'card_text' });
  tl.mesh.position.set(0, h / 2, 0.0045);
  g.add(tl.mesh);
  return { group: g, ready: tl.ready };
}
