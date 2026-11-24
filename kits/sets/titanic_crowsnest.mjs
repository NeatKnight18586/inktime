// Titanic crow's nest set kit. Procedural and stylised, not a replica.
// Units: metres. Sea level y=0. Bow points to -Z. Ship centre at the origin.
import * as THREE from 'three';
import { LAYERS, setLayer } from '../../engine/look/layers.mjs';

const DEG = Math.PI / 180;
export const SHIP = {
  length: 269,
  bowZ: -134.5,
  sternZ: 134.5,
  halfBeam: 14,
  hullTop: 15,
  forecastleY: 18,
  forecastleEndZ: -85,
  mastZ: -100,
  nestFloorY: 33, // forecastle deck + 15 m
  basketR: 0.9,
  rimH: 1.1,
  eye: 1.62,
};
SHIP.basketZ = SHIP.mastZ - 0.75;
const ICEBERG_DIST = 1500;

// Hull half-width at z: pointed bow, parallel middle body, rounded stern.
export function halfWidth(z) {
  const { bowZ, sternZ, halfBeam } = SHIP;
  if (z <= bowZ || z >= sternZ) return 0;
  if (z < -90) {
    const t = (z - bowZ) / (-90 - bowZ);
    return halfBeam * (1 - (1 - t) * (1 - t) * (1 - 0.15 * t));
  }
  if (z > 112) {
    const t = (sternZ - z) / (sternZ - 112);
    return halfBeam * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
  }
  return halfBeam;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

// Matrix placing a unit Y cylinder (height 1, centred) between a and b.
function between(a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  tmpQ.setFromUnitVectors(UP, d.normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), tmpQ.clone(), new THREE.Vector3(1, len, 1));
}

function instanced(geo, mat, matrices, name) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.name = name ?? '';
  return m;
}

function at(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  tmpQ.setFromEuler(new THREE.Euler(rx, ry, rz));
  tmpS.set(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ.clone(), tmpS.clone());
}

function mesh(geo, mat, x = 0, y = 0, z = 0, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.name = name;
  return m;
}

function hullShape(z0, z1, inset = 0, steps = 80) {
  const shape = new THREE.Shape();
  const zs = [];
  for (let i = 0; i <= steps; i++) zs.push(z0 + ((z1 - z0) * i) / steps);
  const hw = (z) => Math.max(0, halfWidth(z) - inset);
  shape.moveTo(hw(zs[0]), -zs[0]);
  for (const z of zs) shape.lineTo(hw(z), -z);
  for (const z of [...zs].reverse()) shape.lineTo(-hw(z), -z);
  shape.closePath();
  return shape;
}

// Shape (x, -z) extruded upward from y0 to y1.
function extrudeHull(shape, y0, y1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  g.computeVertexNormals();
  return g;
}

// Ribbon on the sea with uv.y running along its length.
function ribbon(points, widths, y = 0.05) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const o = points[Math.max(i - 1, 0)];
    const dir = new THREE.Vector2(q.x - o.x, q.y - o.y).normalize();
    const nx = -dir.y;
    const nz = dir.x;
    const w = widths[i] / 2;
    pos.push(p.x + nx * w, y, p.y + nz * w, p.x - nx * w, y, p.y - nz * w);
    const v = i / (points.length - 1);
    uv.push(0, v, 1, v);
    if (i < points.length - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fadeTexture(from = 1, to = 0) {
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(255 * (from + (to - from) * (i / (n - 1)) ** 0.8));
    data.set([v, v, v, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function anchorAt(group, anchors, name, pos, look, up) {
  const o = new THREE.Object3D();
  o.name = `anchor:${name}`;
  o.position.copy(pos);
  if (look) {
    const m = new THREE.Matrix4().lookAt(pos, look, up ?? UP);
    o.quaternion.setFromRotationMatrix(m);
  }
  group.add(o);
  anchors[name] = o;
  return o;
}

// ---------------------------------------------------------------- sky + sea
function buildSky(scene, rng, pal) {
  const group = new THREE.Group();
  group.name = 'sky';
  const zenith = pal.mix('navy', 'ink', 0.45);
  const horizon = pal.color('navy');
  const band = pal.color('frost');
  const bandN = new THREE.Vector3(0.32, 0.62, 0.72).normalize();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uZenith: { value: zenith }, uHorizon: { value: horizon }, uBand: { value: band }, uBandN: { value: bandN } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon, uBand, uBandN; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          vec3 d = normalize(vDir);
          float e = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(uHorizon, uZenith, pow(e, 0.6));
          float b = dot(d, uBandN);
          float mw = exp(-b*b/0.012) * (0.45 + 0.55 * n3(d*9.0)) * (0.7 + 0.3 * n3(d*23.0));
          c = mix(c, uBand, mw * 0.07 * smoothstep(-0.02, 0.15, d.y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  group.add(dome);

  // 4000 stars, 1-3 px; a third crowd the Milky Way band.
  const N = 4000;
  const R = 5800;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const bright = new Float32Array(N);
  const a1 = new THREE.Vector3(1, 0, 0).cross(bandN).normalize();
  const a2 = new THREE.Vector3().crossVectors(bandN, a1).normalize();
  const v = new THREE.Vector3();
  let i = 0;
  while (i < N) {
    if (rng() < 0.34) {
      const th = rng() * Math.PI * 2;
      const off = (rng() + rng() + rng() - 1.5) * 0.12;
      v.copy(a1).multiplyScalar(Math.cos(th)).addScaledVector(a2, Math.sin(th)).addScaledVector(bandN, off).normalize();
    } else {
      const y = rng();
      const th = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      v.set(r * Math.cos(th), y, r * Math.sin(th));
    }
    if (v.y < 0.004) continue;
    pos.set([v.x * R, v.y * R, v.z * R], i * 3);
    const s = rng();
    size[i] = s < 0.7 ? 1 : s < 0.94 ? 2 : 3;
    bright[i] = 0.35 + 0.65 * rng() ** 1.5;
    i++;
  }
  const starMat = (mirror) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: pal.color('frost') }, uGain: { value: mirror ? 0.55 : 1.0 } },
      vertexShader: `attribute float aSize; attribute float aBright; varying float vB;
        void main(){ vB = aBright; gl_PointSize = aSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uGain; varying float vB; void main(){ gl_FragColor = vec4(uColor * vB * uGain, 1.0); }`,
    });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  const stars = new THREE.Points(geo, starMat(false));
  stars.name = 'stars';
  stars.renderOrder = 1;
  stars.frustumCulled = false;
  // Faint star reflections: the same field mirrored under the translucent sea.
  const reflected = new THREE.Points(geo, starMat(true));
  reflected.scale.y = -1;
  reflected.renderOrder = -1;
  reflected.frustumCulled = false;
  reflected.name = 'star_reflections';
  group.add(stars, reflected);

  // Thin haze band at the horizon.
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(5200, 5200, 160, 96, 1, true),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { uColor: { value: pal.color('frost') } },
      vertexShader: `varying float vH; void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vH; void main(){ float a = 0.11 * pow(1.0 - vH, 2.2); gl_FragColor = vec4(uColor, a); }`,
    })
  );
  haze.position.y = 80 - 20;
  haze.renderOrder = 2;
  haze.name = 'haze';
  group.add(haze);

  // Flat calm sea, translucent so reflections show faintly.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshBasicMaterial({ color: pal.mix('navy', 'ink', 0.22), transparent: true, opacity: 0.8, depthWrite: true })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.renderOrder = 0;
  sea.name = 'sea';
  group.add(sea);
  setLayer(group, LAYERS.FX);
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- iceberg
function buildIceberg(scene, rng, pal, anchors) {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const lobes = Array.from({ length: 14 }, () => ({
    d: new THREE.Vector3(rng() * 2 - 1, rng() * 1.4 - 0.2, rng() * 2 - 1).normalize(),
    a: 0.12 + rng() * 0.3,
    w: 0.15 + rng() * 0.35,
  }));
  const p = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r = 0.78;
    for (const l of lobes) r += l.a * Math.exp(-(1 - v.dot(l.d)) / l.w);
    const peak = Math.exp(-((v.x - 0.25) ** 2 + (v.z * 0.6) ** 2) / 0.18) * Math.max(v.y, 0) * 0.55;
    r += peak;
    v.multiplyScalar(r);
    p.setXYZ(i, v.x * 46, Math.max(v.y * 34, -4), v.z * 36);
  }
  geo.computeVertexNormals();
  const z = SHIP.mastZ - ICEBERG_DIST;
  const berg = mesh(geo, pal.toon(pal.mix('navy', 'ink', 0.42), { fog: false }), 0, 0, z, 'iceberg_dark');
  scene.add(berg);
  anchors.iceberg_dark = berg;
  const rim = mesh(geo, new THREE.MeshBasicMaterial({ color: pal.color('ice'), side: THREE.BackSide, fog: false }), 0, 0, z, 'iceberg_rim');
  rim.scale.setScalar(1.025);
  rim.visible = false;
  rim.userData.noHull = true;
  rim.layers.set(LAYERS.FX);
  scene.add(rim);
  anchors.iceberg_rim = rim;
}

// ---------------------------------------------------------------- ship exterior
function buildShip(scene, rng, pal) {
  const ship = new THREE.Group();
  ship.name = 'ship';
  const hullMat = pal.toon(pal.mix('ink', 'navy', 0.5));
  const frost = pal.toon('frost');
  const steel = pal.toon('steel');
  const lampMat = pal.toon('lamp');
  const inkMat = pal.toon('ink');
  const glow = new THREE.MeshBasicMaterial({ color: pal.color('lamp') });
  const fx = [];

  ship.add(mesh(extrudeHull(hullShape(SHIP.bowZ, SHIP.sternZ), -8, SHIP.hullTop), hullMat, 0, 0, 0, 'hull'));
  // Raised forecastle and poop.
  ship.add(mesh(extrudeHull(hullShape(SHIP.bowZ, SHIP.forecastleEndZ, 0, 40), SHIP.hullTop, SHIP.forecastleY), hullMat, 0, 0, 0, 'forecastle'));
  ship.add(mesh(extrudeHull(hullShape(104, SHIP.sternZ, 0, 24), SHIP.hullTop, SHIP.forecastleY), hullMat, 0, 0, 0, 'poop'));
  // Boot-top line.
  ship.add(mesh(extrudeHull(hullShape(SHIP.bowZ + 0.4, SHIP.sternZ - 0.4, -0.06, 80), 0.0, 0.6), pal.toon(pal.mix('lamp', 'ink', 0.55)), 0, 0, 0, 'boot'));

  // White superstructure.
  const box = (w, h, d, x, y, z, mat = frost, name = '') => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, name);
  ship.add(box(25, 9.5, 170, 0, SHIP.hullTop, 13, frost, 'superstructure'));
  ship.add(box(23, 3.5, 137, 0, 24.5, 6.5, frost, 'a_deck'));
  ship.add(box(16, 3, 12, 0, 28, -56, frost, 'bridge'));
  ship.add(box(26, 0.6, 3, 0, 30.4, -60, frost, 'bridge_wings'));
  for (const z of [-30, 12, 48, 84]) ship.add(box(8, 2.6, 14, 0, 28, z, frost, 'deckhouse'));

  // Four funnels: lamp body, ink tops, raked aft, with faint smoke.
  const funnelZ = [-42, -6, 30, 66];
  const fBody = new THREE.CylinderGeometry(1, 1, 18, 28);
  const fTop = new THREE.CylinderGeometry(1.02, 1.02, 4, 28);
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  funnelZ.forEach((z, k) => {
    const f = new THREE.Group();
    f.name = `funnel${k + 1}`;
    const body = mesh(fBody, lampMat, 0, 9, 0);
    const top = mesh(fTop, inkMat, 0, 20, 0);
    f.add(body, top);
    f.scale.set(3.2, 1, 4.6);
    f.position.set(0, 28, z);
    f.rotation.x = 4 * DEG;
    ship.add(f);
    if (k < 3) {
      for (let i = 0; i < 7; i++) {
        const puff = new THREE.Mesh(
          puffGeo,
          new THREE.MeshBasicMaterial({ color: pal.color('frost'), transparent: true, opacity: 0.075 * (1 - i / 8), depthWrite: false })
        );
        const s = 3 + i * 1.6 + rng() * 1.5;
        puff.scale.set(s, s * 0.7, s * 1.2);
        puff.position.set((rng() - 0.5) * 3, 50 + i * 2.2, z + 3 + i * 6.5);
        puff.renderOrder = 3;
        fx.push(puff);
      }
    }
  });

  // Masts.
  ship.add(mesh(new THREE.CylinderGeometry(0.18, 0.32, 40, 12), steel, 0, 15 + 20, 104, 'mainmast'));

  // Instanced amber portholes.
  const port = [];
  for (const y of [5.2, 8.2, 11.2, 13.8]) {
    for (let z = -84; z < 108; z += 2.7) {
      for (const side of [1, -1]) {
        if (rng() < 0.22) continue;
        port.push(at(side * (halfWidth(z) + 0.03), y + (rng() - 0.5) * 0.05, z, 0, side * Math.PI / 2, 0));
      }
    }
  }
  for (let z = -128; z < -86; z += 2.4) {
    for (const side of [1, -1]) {
      if (rng() < 0.3) continue;
      const hw = halfWidth(z);
      const slope = Math.atan2(halfWidth(z + 0.5) - halfWidth(z - 0.5), 1);
      port.push(at(side * (hw + 0.04), 16.4, z, 0, side * (Math.PI / 2 - slope), 0));
    }
  }
  fx.push(instanced(new THREE.CircleGeometry(0.22, 10), glow, port, 'portholes'));

  // Deck lights and window rows on the superstructure.
  const win = [];
  for (const [y, z0, z1, x] of [[17.2, -70, 96, 12.53], [20.6, -70, 96, 12.53], [26.2, -60, 73, 11.53]]) {
    for (let z = z0; z < z1; z += 2.2) {
      for (const side of [1, -1]) if (rng() > 0.18) win.push(at(side * x, y, z, 0, side * Math.PI / 2, 0));
    }
  }
  for (let x = -6; x <= 6; x += 1.6) win.push(at(x, 29.6, -62.03, 0, Math.PI, 0));
  fx.push(instanced(new THREE.PlaneGeometry(0.9, 0.7), glow, win, 'windows'));
  const dl = [];
  for (let z = -60; z < 74; z += 4.5) for (const side of [1, -1]) dl.push(at(side * 11.3, 28.9, z));
  fx.push(instanced(new THREE.SphereGeometry(0.16, 6, 4), glow, dl, 'deck_lights'));

  // Lifeboats.
  const boats = [];
  for (const z of [-48, -40, -32, -24, 40, 48, 56, 64]) for (const side of [1, -1]) boats.push(at(side * 10.2, 29.0, z));
  ship.add(instanced(new THREE.BoxGeometry(2.0, 1.0, 8.5), frost, boats, 'lifeboats'));

  // Frost-white V wake and bow waves.
  const wakeMat = new THREE.MeshBasicMaterial({ color: pal.color('frost'), transparent: true, opacity: 0.55, alphaMap: fadeTexture(1, 0), depthWrite: false });
  const kelvin = 19.5 * DEG;
  for (const side of [1, -1]) {
    const pts = [];
    const w = [];
    for (let i = 0; i <= 24; i++) {
      const d = (i / 24) * 700;
      pts.push(new THREE.Vector2(side * (4 + d * Math.tan(kelvin)), SHIP.sternZ - 6 + d));
      w.push(1.5 + d * 0.05);
    }
    fx.push(Object.assign(new THREE.Mesh(ribbon(pts, w), wakeMat), { renderOrder: 0.6, name: 'wake' }));
    const bp = [];
    const bw = [];
    for (let i = 0; i <= 16; i++) {
      const z = SHIP.bowZ + 1 + (i / 16) * 70;
      bp.push(new THREE.Vector2(side * (halfWidth(z) + 0.6 + i * 0.5), z));
      bw.push(0.8 + i * 0.25);
    }
    fx.push(Object.assign(new THREE.Mesh(ribbon(bp, bw, 0.06), wakeMat), { renderOrder: 0.6, name: 'bow_wave' }));
  }
  const trail = [];
  const tw = [];
  for (let i = 0; i <= 20; i++) {
    const d = (i / 20) * 500;
    trail.push(new THREE.Vector2(Math.sin(i * 0.7) * 1.5, SHIP.sternZ + d));
    tw.push(14 + d * 0.08);
  }
  fx.push(Object.assign(new THREE.Mesh(ribbon(trail, tw, 0.04), wakeMat), { renderOrder: 0.6, name: 'wake_trail' }));

  // Faint reflection of the ship under the translucent sea.
  const mirror = ship.clone(true);
  mirror.scale.y = -1;
  mirror.name = 'ship_reflection';
  setLayer(mirror, LAYERS.MIRROR);
  const fxGroup = new THREE.Group();
  fxGroup.name = 'ship_fx';
  fxGroup.add(...fx);
  setLayer(fxGroup, LAYERS.FX);
  const mirrorFx = new THREE.Group();
  for (const o of fx) if (o.name === 'portholes' || o.name === 'windows' || o.name === 'deck_lights') mirrorFx.add(o.clone());
  mirrorFx.scale.y = -1;
  setLayer(mirrorFx, LAYERS.MIRROR);
  scene.add(ship, fxGroup, mirror, mirrorFx);
  return ship;
}

// ---------------------------------------------------------------- forecastle deck
function buildForecastle(scene, rng, pal, anchors) {
  const g = new THREE.Group();
  g.name = 'forecastle_kit';
  const Y = SHIP.forecastleY;
  const steel = pal.toon('steel');
  const frost = pal.toon('frost');
  const navy = pal.toon('navy');
  const inkMat = pal.toon('ink');
  const plankMat = pal.toon(pal.mix('steel', 'frost', 0.18));
  const glow = new THREE.MeshBasicMaterial({ color: pal.color('lamp') });

  // Planking: instanced fore-aft planks with dark seams between.
  const planks = [];
  const pw = 0.24;
  for (let x = -13.4; x <= 13.4; x += pw + 0.035) {
    let z0 = SHIP.bowZ;
    while (halfWidth(z0) - 0.35 < Math.abs(x) && z0 < SHIP.forecastleEndZ) z0 += 0.25;
    const z1 = SHIP.forecastleEndZ - 0.2;
    if (z1 - z0 < 0.5) continue;
    planks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, Y + 0.02, (z0 + z1) / 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, z1 - z0)));
  }
  g.add(instanced(new THREE.BoxGeometry(pw, 0.04, 1), plankMat, planks, 'planks'));

  // Anchor windlass: bed, two drums with gypsies, capstan heads, chain to the hawse pipes.
  const wz = -123;
  g.add(mesh(new THREE.BoxGeometry(3.6, 0.5, 1.4), steel, 0, Y + 0.25, wz, 'windlass_bed'));
  for (const s of [1, -1]) {
    const drum = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 20), navy, s * 1.1, Y + 0.95, wz, 'windlass_drum');
    drum.rotation.z = Math.PI / 2;
    g.add(drum);
    const gyp = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.14, 12), steel, s * 1.55, Y + 0.95, wz, 'gypsy');
    gyp.rotation.z = Math.PI / 2;
    g.add(gyp);
    g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 16), steel, s * 2.4, Y + 0.35, wz - 3.2, 'capstan'));
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), navy, s * 2.4, Y + 0.76, wz - 3.2, 'capstan_head'));
    const links = [];
    const a = new THREE.Vector3(s * 1.55, Y + 0.5, wz - 0.5);
    const b = new THREE.Vector3(s * 3.2, Y + 0.05, -131.5);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const p = a.clone().lerp(b, i / n);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      links.push(at(p.x, p.y + 0.06, p.z, i % 2 ? Math.PI / 2 : 0, yaw, Math.PI / 2, 1));
    }
    g.add(instanced(new THREE.TorusGeometry(0.09, 0.03, 4, 8), inkMat, links, 'chain'));
    g.add(mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.18, 14), inkMat, s * 3.2, Y + 0.09, -131.6, 'hawse'));
  }
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.9, 1.0), steel, 0, Y + 0.95, wz, 'windlass_gear'));

  // Two bollards.
  for (const s of [1, -1]) {
    const bx = s * 5.6;
    const bz = -120.5;
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.12, 1.7), steel, bx, Y + 0.06, bz, 'bollard_plate'));
    for (const dz of [-0.45, 0.45]) {
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.65, 14), navy, bx, Y + 0.44, bz + dz, 'bollard'));
      g.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 14), navy, bx, Y + 0.8, bz + dz, 'bollard_cap'));
    }
  }

  // Cargo crane: post, slewing house, jib reaching forward.
  const cx = 3.6;
  const cz = -114.5;
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.4, 14), steel, cx, Y + 1.7, cz, 'crane_post'));
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.1, 1.6), navy, cx, Y + 3.9, cz, 'crane_house'));
  const jibA = new THREE.Vector3(cx, Y + 3.8, cz - 0.6);
  const jibB = new THREE.Vector3(cx - 1.2, Y + 7.6, cz - 6.5);
  const jib = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1, 8), steel);
  jib.applyMatrix4(between(jibA, jibB));
  jib.name = 'crane_jib';
  g.add(jib);
  const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 5), inkMat);
  fall.applyMatrix4(between(jibB, new THREE.Vector3(jibB.x, Y + 2.2, jibB.z)));
  g.add(fall);
  g.add(mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), inkMat, jibB.x, Y + 2.05, jibB.z, 'crane_hook'));

  // No.1 hatch cover and a ventilator.
  g.add(mesh(new THREE.BoxGeometry(4.2, 0.55, 3.2), navy, 0, Y + 0.28, -109, 'hatch'));
  g.add(mesh(new THREE.BoxGeometry(4.4, 0.08, 3.4), steel, 0, Y + 0.58, -109, 'hatch_tarp'));
  for (const s of [1, -1]) {
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.6, 12), frost, s * 7.5, Y + 0.8, -106, 'vent'));
    const cowl = mesh(new THREE.TorusGeometry(0.34, 0.18, 8, 14, Math.PI), frost, s * 7.5, Y + 1.6, -106.1, 'vent_cowl');
    cowl.rotation.y = Math.PI / 2;
    g.add(cowl);
  }

  // Bow rail: posts and two rails following the forecastle edge.
  const posts = [];
  const rails = [];
  const edge = [];
  for (let z = SHIP.forecastleEndZ - 0.3; z > SHIP.bowZ + 0.6; z -= 1.6) edge.push(z);
  for (const s of [1, -1]) {
    const pts = edge.map((z) => new THREE.Vector3(s * (halfWidth(z) - 0.15), Y, z));
    pts.push(new THREE.Vector3(0, Y, SHIP.bowZ + 0.4));
    pts.forEach((p) => posts.push(between(p, p.clone().setY(Y + 1.1))));
    for (const h of [0.55, 1.1]) {
      for (let i = 0; i < pts.length - 1; i++) rails.push(between(pts[i].clone().setY(Y + h), pts[i + 1].clone().setY(Y + h)));
    }
  }
  g.add(instanced(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), steel, posts, 'rail_posts'));
  g.add(instanced(new THREE.CylinderGeometry(0.028, 0.028, 1, 6), frost, rails, 'rails'));
  const jack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 6), steel);
  jack.applyMatrix4(between(new THREE.Vector3(0, Y, SHIP.bowZ + 0.6), new THREE.Vector3(0, Y + 3.6, SHIP.bowZ + 0.2)));
  jack.name = 'jackstaff';
  g.add(jack);

  // Two amber deck lamps.
  for (const s of [1, -1]) {
    const lx = s * 4.4;
    const lz = -126.5;
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.2, 8), steel, lx, Y + 1.1, lz, 'lamp_post'));
    g.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.12, 10), inkMat, lx, Y + 2.62, lz, 'lamp_hood'));
    const globe = mesh(new THREE.SphereGeometry(0.17, 12, 8), glow, lx, Y + 2.38, lz, 'lamp_globe');
    globe.layers.set(LAYERS.FX);
    g.add(globe);
    const cage = mesh(new THREE.TorusGeometry(0.19, 0.02, 4, 12), inkMat, lx, Y + 2.38, lz, 'lamp_cage');
    cage.rotation.x = Math.PI / 2;
    g.add(cage);
    const light = new THREE.PointLight(pal.color('lamp'), 55, 32, 2);
    light.position.set(lx, Y + 2.38, lz);
    g.add(light);
  }
  anchorAt(g, anchors, 'deck', new THREE.Vector3(0, Y, -112));
  scene.add(g);
}

// ---------------------------------------------------------------- foremast, rigging, crow's nest
function buildMastAndNest(scene, rng, pal, anchors) {
  const g = new THREE.Group();
  g.name = 'crowsnest';
  const steel = pal.toon('steel');
  const frostMat = pal.toon('frost');
  const navy = pal.toon('navy');
  const inkMat = pal.toon('ink');
  const lampMat = pal.toon('lamp');
  const iceMat = pal.toon('ice');
  const F = SHIP.nestFloorY;
  const bz = SHIP.basketZ;
  const R = SHIP.basketR;
  const topY = F + 8;

  // Foremast: 15 m from the forecastle deck to the nest, continuing to the top.
  const mastH = topY - SHIP.forecastleY;
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.3, mastH, 16), steel, 0, SHIP.forecastleY + mastH / 2, SHIP.mastZ, 'foremast'));
  g.add(mesh(new THREE.SphereGeometry(0.24, 10, 6), steel, 0, topY, SHIP.mastZ, 'mast_truck'));
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16), navy, 0, SHIP.forecastleY + 0.12, SHIP.mastZ, 'mast_collar'));
  const masthead = mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: pal.color('frost') }), 0, topY - 1.2, SHIP.mastZ - 0.25, 'masthead_light');
  masthead.layers.set(LAYERS.FX);
  g.add(masthead);
  // Mast ladder rungs below the nest.
  const rungs = [];
  for (let y = SHIP.forecastleY + 0.6; y < F - 0.2; y += 0.38) rungs.push(between(new THREE.Vector3(-0.22, y, SHIP.mastZ + 0.32), new THREE.Vector3(0.22, y, SHIP.mastZ + 0.32)));
  g.add(instanced(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), steel, rungs, 'ladder_rungs'));

  // Rigging stays: forestay, shrouds.
  const stays = [
    [new THREE.Vector3(0, topY - 0.6, SHIP.mastZ), new THREE.Vector3(0, SHIP.forecastleY + 0.6, SHIP.bowZ + 0.8)],
    [new THREE.Vector3(0, F - 0.8, SHIP.mastZ), new THREE.Vector3(0, SHIP.forecastleY + 0.3, -118)],
  ];
  for (const s of [1, -1]) {
    for (const z of [-97.5, -95, -92.5]) stays.push([new THREE.Vector3(s * 0.18, F - 0.6, SHIP.mastZ + 0.1), new THREE.Vector3(s * 13.3, SHIP.forecastleY + 0.4, z)]);
    stays.push([new THREE.Vector3(s * 0.15, topY - 0.8, SHIP.mastZ), new THREE.Vector3(s * 12.8, SHIP.forecastleY + 0.4, -104)]);
  }
  const stayGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 5);
  g.add(instanced(stayGeo, inkMat, stays.map(([a, b]) => between(a, b)), 'stays'));

  // Basket: open steel ring wall 1.8 m across, 1.1 m rim.
  const nest = new THREE.Group();
  nest.name = 'basket';
  nest.position.set(0, F, bz);
  const wall = new THREE.LatheGeometry(
    [new THREE.Vector2(R - 0.04, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, SHIP.rimH), new THREE.Vector2(R - 0.04, SHIP.rimH), new THREE.Vector2(R - 0.04, 0)],
    56
  );
  nest.add(mesh(wall, steel, 0, 0, 0, 'basket_wall'));
  nest.add(mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.1, 0.12, 40), navy, 0, -0.06, 0, 'basket_floor'));
  for (const y of [0.08, SHIP.rimH - 0.08]) {
    const band = mesh(new THREE.TorusGeometry(R + 0.012, 0.016, 5, 56), navy, 0, y, 0, 'band');
    band.rotation.x = Math.PI / 2;
    nest.add(band);
  }
  // Frost crust on the rim top (lumpy, seeded).
  const crust = new THREE.TorusGeometry(R - 0.02, 0.034, 6, 96);
  const cp = crust.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const y = cp.getY(i);
    const a = Math.atan2(y, x);
    const k = 1 + 0.35 * Math.sin(a * 23 + 1.3) * Math.sin(a * 7) + (rng() - 0.5) * 0.25;
    cp.setZ(i, cp.getZ(i) * k);
  }
  crust.computeVertexNormals();
  const crustM = mesh(crust, frostMat, 0, SHIP.rimH + 0.01, 0, 'frost_crust');
  crustM.rotation.x = Math.PI / 2;
  nest.add(crustM);
  // Instanced rivet rows, inside and out.
  const rivets = [];
  for (const y of [0.16, 0.55, 0.94]) {
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      for (const r of [R + 0.004, R - 0.044]) rivets.push(at(Math.sin(a) * r, y, -Math.cos(a) * r));
    }
  }
  nest.add(instanced(new THREE.SphereGeometry(0.013, 6, 4), navy, rivets, 'rivets'));
  // Support brackets under the basket.
  const struts = [];
  for (const a of [-50, 0, 50, 180]) {
    const ar = a * DEG;
    struts.push(between(new THREE.Vector3(Math.sin(ar) * (R - 0.1), -0.1, -Math.cos(ar) * (R - 0.1)), new THREE.Vector3(0, -1.6, 0.75)));
  }
  nest.add(instanced(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), steel, struts, 'struts'));
  // Floor hatch.
  nest.add(mesh(new THREE.BoxGeometry(0.62, 0.03, 0.55), steel, 0.25, 0.015, 0.1, 'floor_hatch'));
  const hinge = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), inkMat, 0.25 + 0.31, 0.03, 0.1, 'hatch_hinge');
  hinge.rotation.x = Math.PI / 2;
  nest.add(hinge);
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 12), inkMat, 0.0, 0.034, 0.1, 'hatch_ring');
  ring.rotation.x = Math.PI / 2;
  nest.add(ring);

  // Bell on an outboard bracket, front-right.
  const ba = 24 * DEG;
  const bracket = new THREE.Group();
  bracket.position.set(Math.sin(ba) * R, 0, -Math.cos(ba) * R);
  bracket.rotation.y = -ba;
  bracket.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), steel, 0, 1.0, -0.2, 'bell_arm'));
  bracket.add(mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), steel, 0, 0.88, -0.02, 'bell_brace'));
  bracket.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5), inkMat, 0, 0.94, -0.36, 'bell_hanger'));
  const bellGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.0, 0.02), new THREE.Vector2(0.1, 0.0), new THREE.Vector2(0.115, 0.0), new THREE.Vector2(0.085, 0.06), new THREE.Vector2(0.075, 0.15), new THREE.Vector2(0.05, 0.2), new THREE.Vector2(0.0, 0.2)],
    20
  );
  const bell = mesh(bellGeo, lampMat, 0, 0.7, -0.36, 'bell');
  bracket.add(bell);
  bracket.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), inkMat, 0, 0.69, -0.36, 'bell_clapper'));
  bracket.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4), frostMat, 0.0, 0.46, -0.36, 'bell_lanyard'));
  nest.add(bracket);
  anchors.bell = bell;

  // Telephone box on the mast (aft side of the basket, facing forward).
  const mastLocalZ = SHIP.mastZ - bz;
  const phone = mesh(new THREE.BoxGeometry(0.26, 0.36, 0.14), navy, 0, 1.3, mastLocalZ - 0.3, 'phone');
  nest.add(phone);
  nest.add(mesh(new THREE.BoxGeometry(0.06, 0.18, 0.05), inkMat, 0.16, 1.34, mastLocalZ - 0.35, 'phone_handset'));
  nest.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), lampMat, -0.06, 1.38, mastLocalZ - 0.375, 'phone_bell'));
  anchors.phone = phone;

  // Small steel locker with a brass padlock, aft-left on the floor.
  const locker = mesh(new THREE.BoxGeometry(0.42, 0.46, 0.3), steel, -0.48, 0.23, 0.38, 'locker');
  locker.rotation.y = 0.5;
  nest.add(locker);
  const lockGroup = new THREE.Group();
  lockGroup.position.copy(locker.position);
  lockGroup.rotation.y = 0.5;
  const padlock = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.025), lampMat, 0.0, 0.08, -0.165, 'padlock');
  lockGroup.add(padlock);
  const shackle = mesh(new THREE.TorusGeometry(0.02, 0.006, 4, 10, Math.PI), steel, 0, 0.11, -0.165, 'shackle');
  lockGroup.add(shackle);
  lockGroup.add(mesh(new THREE.BoxGeometry(0.02, 0.4, 0.01), inkMat, 0.1, 0.0, -0.152, 'locker_seam'));
  nest.add(lockGroup);
  anchors.locker = locker;
  anchors.padlock = padlock;

  // Story props: tin mug on the rim, scarf on a hook, folded oilskin on the floor.
  const ma = -14 * DEG;
  const mug = new THREE.Group();
  mug.name = 'tin_mug';
  mug.position.set(Math.sin(ma) * (R - 0.02), SHIP.rimH + 0.03, -Math.cos(ma) * (R - 0.02));
  mug.add(mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.095, 16), steel, 0, 0.048, 0));
  const handle = mesh(new THREE.TorusGeometry(0.026, 0.007, 5, 10, Math.PI), steel, 0.045, 0.05, 0);
  handle.rotation.z = -Math.PI / 2;
  mug.add(handle);
  mug.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 14), inkMat, 0, 0.088, 0));
  nest.add(mug);
  const ha = 40 * DEG;
  const hook = new THREE.Group();
  hook.name = 'scarf_hook';
  hook.position.set(Math.sin(ha) * (R - 0.06), 0.98, -Math.cos(ha) * (R - 0.06));
  hook.rotation.y = -ha;
  hook.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 5), inkMat, 0, 0, 0.02));
  const scarfShape = new THREE.Shape();
  scarfShape.moveTo(-0.07, 0);
  scarfShape.quadraticCurveTo(0, 0.04, 0.07, 0);
  scarfShape.lineTo(0.09, -0.42);
  scarfShape.lineTo(0.03, -0.44);
  scarfShape.lineTo(0.0, -0.1);
  scarfShape.lineTo(-0.03, -0.36);
  scarfShape.lineTo(-0.09, -0.34);
  scarfShape.closePath();
  const scarfGeo = new THREE.ExtrudeGeometry(scarfShape, { depth: 0.025, bevelEnabled: false });
  hook.add(mesh(scarfGeo, iceMat, 0, 0.0, 0.035, 'scarf'));
  const stripes = mesh(new THREE.BoxGeometry(0.15, 0.025, 0.03), navy, 0.0, -0.2, 0.048, 'scarf_stripe');
  stripes.rotation.z = 0.12;
  hook.add(stripes);
  nest.add(hook);
  const oil = new THREE.Group();
  oil.name = 'oilskin';
  oil.position.set(0.42, 0, 0.42);
  oil.rotation.y = -0.4;
  oil.add(mesh(new THREE.BoxGeometry(0.5, 0.07, 0.36), lampMat, 0, 0.035, 0));
  oil.add(mesh(new THREE.BoxGeometry(0.48, 0.06, 0.3), lampMat, 0.02, 0.1, 0.01));
  oil.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.12), lampMat, -0.12, 0.145, -0.04));
  nest.add(oil);

  g.add(nest);
  scene.add(g);

  // Anchors in world space.
  const eye = new THREE.Vector3(0, F + SHIP.eye, bz + 0.25);
  anchorAt(g, anchors, 'cam_lookout', eye, eye.clone().add(new THREE.Vector3(0, 0, -10)));
  anchorAt(g, anchors, 'mast_top', new THREE.Vector3(0, topY, SHIP.mastZ));
  anchorAt(g, anchors, 'lee_spot', new THREE.Vector3(0.45, F, bz + 0.15));
  anchorAt(g, anchors, 'fleet_spot', new THREE.Vector3(-0.3, F, bz - 0.55));
  anchorAt(g, anchors, 'guide_spot', new THREE.Vector3(-(R - 0.12), F + 1.42, bz - 0.1));
}

// ---------------------------------------------------------------- build
export function build(scene, rng) {
  const pal = scene.userData.palette;
  if (!pal) throw new Error('titanic_crowsnest: scene.userData.palette missing');
  const anchors = {};
  const anchorGroup = new THREE.Group();
  anchorGroup.name = 'anchors';
  scene.add(anchorGroup);

  // Lights: cold key from above-forward, no ambient (keeps the 3-step ramp honest).
  const key = new THREE.DirectionalLight(pal.color('frost'), Math.PI * 0.9);
  key.position.set(-0.45, 1, -0.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(pal.color('ice'), Math.PI * 0.12);
  fill.position.set(0.6, 0.3, 0.8);
  scene.add(fill);

  buildSky(scene, rng, pal);
  buildIceberg(scene, rng, pal, anchors);
  buildShip(scene, rng, pal);
  buildForecastle(scene, rng, pal, anchors);
  buildMastAndNest(scene, rng, pal, anchors);

  // Aerial: 400 m above, straight down, bow to the top of frame.
  const aerialPos = new THREE.Vector3(0, 400, -10);
  anchorAt(anchorGroup, anchors, 'aerial', aerialPos, new THREE.Vector3(0, 0, -10), new THREE.Vector3(0, 0, -1));
  anchorAt(anchorGroup, anchors, 'sea', new THREE.Vector3(0, 0, SHIP.mastZ - 220));
  return { anchors };
}

export const ANCHORS = [
  'aerial', 'cam_lookout', 'mast_top', 'lee_spot', 'fleet_spot', 'guide_spot', 'sea',
  'bell', 'phone', 'locker', 'padlock', 'deck', 'iceberg_dark', 'iceberg_rim',
];
