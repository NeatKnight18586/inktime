// Titanic crow's nest set kit. Procedural and stylised, not a replica.
// Units: metres. Sea level y=0. Bow points to -Z. Ship centre at the origin.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
  rimH: 1.0,
  eye: 1.62,
};
SHIP.basketZ = SHIP.mastZ - 0.75;
const ICEBERG_DIST = 1500;
export const ICEBERG_Z = SHIP.mastZ - ICEBERG_DIST;
// FIX 1.1 framing. back: eye distance behind the inner face of the front rim (allowed 0.60-0.90 m).
// Masthead lamp: above and behind the nest, a narrow cone aimed forward-down at the forecastle deck. The cone is
// narrower than the angle to the basket (>= 27 deg off axis), so the basket interior never receives it.
export const MASTHEAD = { aft: 0.25, aimZ: -120, aimY: 18, angle: 20 * (Math.PI / 180), penumbra: 0.05, range: 36 };
export const LOOKOUT = { back: 0.65, pitch: -16, fov: 72, minRim: 0.45 };
// The ship steams ahead (-Z) at 22 knots; everything aboard (and the camera anchors) rides ship_root.
export const SHIP_SPEED = 11.3; // spec 0.75 / -14 showed 11 props; adjusted within the allowed range
// Phase 1b aerial: on the line iceberg -> ship midpoint, extended 250 m astern, 60 m to starboard; aimed at midship.
export const AERIAL = { astern: 250, starboard: 60, up: 180, pitch: -27, fov: 84, panini: true };
// Fleet card position relative to the cam_lookout eye (metres): left and forward.
export const FLEET = { x: -0.49, forward: 0.4, pose: 'edge',
  // Edge pose features in card units (viewBox 170 x 350): what the left 12-20% of frame must show.
  card: { width: 170, height: 350, brim: [146, 169, 46, 56], shoulder: [144, 156, 120, 150], scarf: [146, 168, 124, 168] } };

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

// Camera anchor posed by yaw/pitch in degrees (YXZ); userData carries yaw, pitch and fov for the rig.
function cameraAnchor(group, anchors, name, pos, { yaw = 0, pitch = 0, fov = 72, panini = false }) {
  const o = new THREE.Object3D();
  o.name = `anchor:${name}`;
  o.position.copy(pos);
  o.quaternion.setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, 0, 'YXZ'));
  o.userData = { yaw, pitch, fov, panini };
  group.add(o);
  anchors[name] = o;
  return o;
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
// sRGB hex helpers for posterized fills.
function hexScale(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.min(255, Math.round(x * k)));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}
function hexMix(a, b, t) {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t));
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Animated parts registered during build (rigging sway, lamp flicker).
const anim = { stays: null, ropes: [], lamps: [], shipRoot: null };
// Shared per-frame uniforms for the set's animated shaders.
const fxUniforms = {
  uShipZ: { value: 0 },
  uFocal: { value: 1321 },
  uT: { value: 0 },
  uT2: { value: 0 },
  uTwos: { value: 0 },
  uFlicker: { value: 1 },
};

function buildSky(scene, rng, pal) {
  const group = new THREE.Group();
  group.name = 'sky';
  const sky = pal.json.sky;
  const zen = pal.hexOf(sky.zenith);
  const hor = hexScale(pal.hexOf(sky.horizon), 1 + sky.horizonLift);
  const mid = hexMix(zen, hor, 0.5);
  // Posterized 3-band vertical gradient: horizon band (steel lifted 25%), middle, zenith navy.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color(zen) },
        uMid: { value: new THREE.Color(mid) },
        uHorizon: { value: new THREE.Color(hor) },
        uBands: { value: new THREE.Vector2(sky.bands[0], sky.bands[1]) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uZenith, uMid, uHorizon; uniform vec2 uBands; varying vec3 vDir;
        void main(){
          float e = degrees(asin(clamp(normalize(vDir).y, -1.0, 1.0)));
          vec3 c = e < uBands.x ? uHorizon : (e < uBands.y ? uMid : uZenith);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  dome.renderOrder = -10;
  dome.name = 'sky_dome';
  group.add(dome);

  // 4000 stars, 1-3 px, only above 15 deg elevation; 5% twinkle on twos.
  const N = 4000;
  const R = 5800;
  const minY = Math.sin(sky.starMinElevation * DEG);
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const bright = new Float32Array(N);
  const tw = new Float32Array(N);
  const v = new THREE.Vector3();
  let i = 0;
  while (i < N) {
    const y = minY + (1 - minY) * rng();
    const th = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    v.set(r * Math.cos(th), y, r * Math.sin(th));
    pos.set([v.x * R, v.y * R, v.z * R], i * 3);
    const s = rng();
    size[i] = s < 0.7 ? 1 : s < 0.94 ? 2 : 3;
    bright[i] = 0.45 + 0.55 * rng() ** 1.5;
    tw[i] = rng() < sky.twinkle ? 1 + rng() * 50 : 0;
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(tw, 1));
  const stars = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: pal.color('frost') }, uTwos: fxUniforms.uTwos },
      vertexShader: `attribute float aSize; attribute float aBright; attribute float aTwinkle; uniform float uTwos; varying float vB;
        void main(){
          float t = aTwinkle > 0.0 ? 0.3 + 0.7 * fract(sin(aTwinkle * 12.9898 + uTwos * 78.233) * 43758.5453) : 1.0;
          vB = aBright * t; gl_PointSize = aSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vB; void main(){ gl_FragColor = vec4(uColor * vB, 1.0); }`,
    })
  );
  stars.name = 'stars';
  stars.renderOrder = 1;
  stars.frustumCulled = false;
  group.add(stars);
  group.add(buildSea(pal));
  setLayer(group, LAYERS.FX);
  scene.add(group);
  return group;
}

// Banded steel-navy sea, low swell (0.3 m, 8 s period), frost glint dashes drifting with the swell,
// hard-edged lamp pools under the porthole rows.
export const SWELL = { amp: 0.3, period: 8, length: (9.81 * 8 * 8) / (2 * Math.PI), dir: [0.6, -0.8] };
function buildSea(pal) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uT: fxUniforms.uT,
    uFlicker: fxUniforms.uFlicker,
    uNavy: { value: pal.color('navy') },
    uSteel: { value: pal.color('steel') },
    uFrost: { value: pal.color('frost') },
    uLamp: { value: pal.color('lamp') },
    uDir: { value: new THREE.Vector2(...SWELL.dir).normalize() },
    uSwell: { value: new THREE.Vector3(SWELL.amp, (2 * Math.PI) / SWELL.length, (2 * Math.PI) / SWELL.period) },
    uHalfBeam: { value: SHIP.halfBeam },
    uPortZ: { value: new THREE.Vector2(-84, 108) },
    uShipZ: fxUniforms.uShipZ,
  });
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms,
    vertexShader: `
      uniform float uT; uniform vec2 uDir; uniform vec3 uSwell;
      varying vec3 vW; varying float vPhase;
      #include <fog_pars_vertex>
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float ph = dot(w.xz, uDir) * uSwell.y - uT * uSwell.z;
        w.y += uSwell.x * sin(ph);
        vW = w.xyz; vPhase = ph;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uT; uniform float uFlicker; uniform vec2 uDir; uniform vec3 uSwell;
      uniform vec3 uNavy, uSteel, uFrost, uLamp; uniform float uHalfBeam; uniform vec2 uPortZ; uniform float uShipZ;
      varying vec3 vW; varying float vPhase;
      #include <fog_pars_fragment>
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        float s = 0.5 + 0.5 * sin(vPhase);
        float b = floor(s * 2.999);
        vec3 c = b < 0.5 ? uNavy : (b < 1.5 ? mix(uNavy, uSteel, 0.5) : uSteel);
        float dist = length(vW.xz - cameraPosition.xz);
        // Glint dashes along the crests, advected with the swell.
        vec2 q = vec2(dot(vW.xz, uDir), dot(vW.xz, vec2(-uDir.y, uDir.x)));
        q.x -= uT * uSwell.z / uSwell.y;
        vec2 cs = vec2(3.0, 9.0);
        vec2 cell = floor(q / cs);
        vec2 f = fract(q / cs);
        float dash = step(0.8, h2(cell)) * step(abs(f.x - 0.5), 0.07) * step(abs(f.y - 0.5), 0.2) * step(0.55, s) * step(dist, 900.0);
        c = mix(c, uFrost, dash);
        // Porthole pools: 3 hard rings per porthole, just off the hull side.
        float dx = abs(vW.x) - uHalfBeam;
        float zs = vW.z - uShipZ;
        if (dx > 0.0 && dx < 4.0 && zs > uPortZ.x && zs < uPortZ.y) {
          float zc = floor((zs - uPortZ.x) / 2.7 + 0.5) * 2.7 + uPortZ.x;
          float r = length(vec2(dx - 1.3, (zs - zc) * 0.85));
          float pool = r < 0.55 ? 1.0 : (r < 1.1 ? 0.55 : (r < 1.7 ? 0.25 : 0.0));
          c = mix(c, uLamp, pool * 0.8 * uFlicker);
        }
        gl_FragColor = vec4(c, 0.88);
        #include <fog_fragment>
      }`,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 400, 400), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.renderOrder = 0;
  sea.name = 'sea';
  sea.frustumCulled = false;
  return sea;
}

// ---------------------------------------------------------------- lamp sprites
// Lit portholes and windows: lamp squares in 2 px ink frames (screen-facing points, at least minPx wide).
function lampSquares(positions, pal, { world = 0.45, minPx = 5, maxPx = 18, name = 'lamps' } = {}) {
  const geo = new THREE.BufferGeometry().setFromPoints(positions);
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms: { uFocal: fxUniforms.uFocal, uFlicker: fxUniforms.uFlicker, uLamp: { value: pal.color('lamp') }, uInk: { value: pal.color('ink') }, uWorld: { value: world }, uPx: { value: new THREE.Vector2(minPx, maxPx) } },
      vertexShader: `uniform float uFocal; uniform float uWorld; uniform vec2 uPx; varying float vSize;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vSize = clamp(uWorld * uFocal / max(-mv.z, 0.1), uPx.x, uPx.y); gl_PointSize = vSize; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uLamp; uniform vec3 uInk; uniform float uFlicker; varying float vSize;
        void main(){ vec2 q = abs(gl_PointCoord - 0.5) * vSize; float m = max(q.x, q.y);
          gl_FragColor = vec4(m > vSize * 0.5 - 2.0 ? uInk : uLamp * uFlicker, 1.0); }`,
    })
  );
  pts.name = name;
  pts.frustumCulled = false;
  return pts;
}

// 2-step additive halo sprite around every lamp.
function lampHalos(positions, pal, { world = 2.2, minPx = 6, maxPx = 160, name = 'halos', gain = 1 } = {}) {
  const geo = new THREE.BufferGeometry().setFromPoints(positions);
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uFocal: fxUniforms.uFocal, uFlicker: fxUniforms.uFlicker, uLamp: { value: pal.color('lamp') }, uWorld: { value: world }, uPx: { value: new THREE.Vector2(minPx, maxPx) }, uGain: { value: gain } },
      vertexShader: `uniform float uFocal; uniform float uWorld; uniform vec2 uPx;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uWorld * uFocal / max(-mv.z, 0.1), uPx.x, uPx.y); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uLamp; uniform float uFlicker; uniform float uGain;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
          float a = r < 0.45 ? 0.32 : 0.12; gl_FragColor = vec4(uLamp * a * uFlicker * uGain, 1.0); }`,
    })
  );
  pts.name = name;
  pts.renderOrder = 4;
  pts.frustumCulled = false;
  return pts;
}

// Smoke from funnels 1-3 only (4 is a ventilation dummy): ink-outlined puffs, updated on twos, drifting aft.
function smokePuffs(funnelTops, pal, rng) {
  const pos = [];
  const size = [];
  const phase = [];
  for (const top of funnelTops) {
    for (let i = 0; i < 9; i++) {
      pos.push(top.x + (rng() - 0.5) * 2, top.y, top.z);
      size.push(4 + rng() * 3);
      phase.push(i / 9 + rng() * 0.05);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  const pts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uFocal: fxUniforms.uFocal, uT2: fxUniforms.uT2, uFill: { value: pal.mix('steel', 'frost', 0.45) }, uInk: { value: pal.color('ink') } },
      vertexShader: `attribute float aSize; attribute float aPhase; uniform float uFocal; uniform float uT2;
        varying float vSize; varying float vLife; varying float vSeed;
        void main(){
          float life = fract(aPhase + uT2 / 14.0);
          // 14 s of life, drifting aft at ship speed (in the ship's frame) while rising.
          vec3 p = position + vec3(0.0, life * 16.0, life * 14.0 * ${SHIP_SPEED.toFixed(2)});
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vSize = clamp(aSize * (0.6 + life * 1.6) * uFocal / max(-mv.z, 0.1), 3.0, 256.0);
          vLife = life; vSeed = aPhase * 40.0;
          gl_PointSize = vSize; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uFill; uniform vec3 uInk; varying float vSize; varying float vLife; varying float vSeed;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0 * (1.0 + 0.09 * sin(atan(d.y, d.x) * 5.0 + vSeed));
          if (r > 1.0) discard;
          float ring = 1.0 - 2.0 * 2.5 / vSize;
          float a = 0.8 * (1.0 - smoothstep(0.6, 1.0, vLife));
          if (a < 0.02) discard;
          gl_FragColor = vec4(r > ring ? uInk : uFill, a);
        }`,
    })
  );
  pts.name = 'smoke';
  pts.renderOrder = 3;
  pts.frustumCulled = false;
  return pts;
}

// Frost-white foam (V wake from the stern, bow wave): world-anchored churn, so it streams aft as the ship moves;
// posterized blobs with ink rims, ink edges along the ribbon, fading aft.
function foamMaterial(pal) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, { uT: fxUniforms.uT, uFrost: { value: pal.color('frost') }, uInk: { value: pal.color('ink') } });
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms,
    vertexShader: `
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uT; uniform vec3 uFrost; uniform vec3 uInk;
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_fragment>
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float edge = min(vUv.x, 1.0 - vUv.x);
        vec2 p = vW.xz * 0.11 + vec2(uT * 0.21, uT * 0.47);
        float n = vn(p) * 0.6 + vn(p * 2.7 + 3.1) * 0.4;
        float th = 0.32 + 0.42 * vUv.y;
        float foam = step(th, n);
        float rim = step(th - 0.07, n) - foam;
        float border = step(edge, 0.04);
        if (foam + rim + border < 0.5) discard;
        vec3 c = (rim > 0.5 || border > 0.5) ? uInk : uFrost;
        gl_FragColor = vec4(c, 1.0 - smoothstep(0.7, 1.0, vUv.y));
        #include <fog_fragment>
      }`,
  });
}

// Solid ink contact shadow (spot black) under an object, flat on the surface at height y.
function contactShadow(group, pal, x, y, z, rx, rz, name = 'contact_shadow') {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: pal.color('ink'), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  m.rotation.x = -Math.PI / 2;
  m.scale.set(rx, rz, 1);
  m.position.set(x, y + 0.012, z);
  m.name = name;
  m.renderOrder = 1;
  m.layers.set(LAYERS.FX);
  group.add(m);
  return m;
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
  const z = ICEBERG_Z;
  const bergMat = pal.toon(pal.mix('navy', 'ink', 0.42), { paint: 'ice' });
  const berg = mesh(geo, bergMat, 0, 0, z, 'iceberg_dark');
  scene.add(berg);
  anchors.iceberg_dark = berg;
  // Rim light: back-face shell pushed out in screen space, so the frost edge is at most uPx wide at any range.
  const rimMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uColor: { value: pal.color('frost') },
      uBody: { value: pal.mix('navy', 'ink', 0.42) },
      uStrength: { value: bergMat.userData.ink.noRim ? 0 : 1.0 },
      uPx: { value: 2.0 },
      uRes: { value: new THREE.Vector2(1080, 1920) },
    },
    vertexShader: `
      uniform float uPx; uniform vec2 uRes;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 dir = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy;
        float l = length(dir);
        dir = l > 1e-6 ? dir / l : vec2(0.0);
        clip.xy += dir * uPx * 2.0 / uRes * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uBody; uniform float uStrength;
      void main() { gl_FragColor = vec4(mix(uBody, uColor, clamp(uStrength, 0.0, 1.0)), 1.0); }`,
  });
  const rimGeo = geo.clone();
  rimGeo.deleteAttribute('normal');
  rimGeo.deleteAttribute('uv');
  const rimMerged = mergeVertices(rimGeo, 1e-4);
  rimMerged.computeVertexNormals();
  const rim = mesh(rimMerged, rimMat, 0, 0, z, 'iceberg_rim');
  rim.renderOrder = 1;
  rim.visible = false; // shown per shot (scene "show" list); Phase 6 reveals it
  rim.userData.noHull = true;
  rim.layers.set(LAYERS.FX);
  scene.add(rim);
  anchors.iceberg_rim = rim;
}

// ---------------------------------------------------------------- ship exterior
function buildShip(scene, rng, pal) {
  const ship = new THREE.Group();
  ship.name = 'ship';
  const hullMat = pal.toon(pal.mix('ink', 'navy', 0.5), { paint: 'steel' });
  const frost = pal.toon('frost', { paint: 'steel' });
  const steel = pal.toon('steel', { paint: 'steel' });
  const lampMat = pal.toon('lamp', { paint: 'steel' });
  const inkMat = pal.toon('ink');
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

  // Four funnels: lamp body, ink tops, raked aft. Smoke from the first three only.
  const funnelZ = [-42, -6, 30, 66];
  const fBody = new THREE.CylinderGeometry(1, 1, 18, 28);
  const fTop = new THREE.CylinderGeometry(1.02, 1.02, 4, 28);
  const tops = [];
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
    if (k < 3) tops.push(new THREE.Vector3(0, 28 + 22 * Math.cos(4 * DEG), z + 22 * Math.sin(4 * DEG)));
  });
  fx.push(smokePuffs(tops, pal, rng));

  // Masts.
  ship.add(mesh(new THREE.CylinderGeometry(0.18, 0.32, 40, 12), steel, 0, 15 + 20, 104, 'mainmast'));

  // Instanced amber portholes.
  const port = [];
  for (const y of [5.2, 8.2, 11.2, 13.8]) {
    for (let z = -84; z < 108; z += 2.7) {
      for (const side of [1, -1]) {
        if (rng() < 0.22) continue;
        port.push(new THREE.Vector3(side * (halfWidth(z) + 0.12), y, z));
      }
    }
  }
  for (let z = -128; z < -86; z += 2.4) {
    for (const side of [1, -1]) {
      if (rng() < 0.3) continue;
      port.push(new THREE.Vector3(side * (halfWidth(z) + 0.12), 16.4, z));
    }
  }
  fx.push(lampSquares(port, pal, { world: 0.45, minPx: 6, maxPx: 16, name: 'portholes' }));

  // Deck lights and window rows on the superstructure.
  const win = [];
  for (const [y, z0, z1, x] of [[17.2, -70, 96, 12.53], [20.6, -70, 96, 12.53], [26.2, -60, 73, 11.53]]) {
    for (let z = z0; z < z1; z += 2.2) {
      for (const side of [1, -1]) if (rng() > 0.18) win.push(new THREE.Vector3(side * (x + 0.1), y, z));
    }
  }
  // Lit bridge windows.
  const bridgeWin = [];
  for (let x = -6.4; x <= 6.4; x += 1.6) bridgeWin.push(new THREE.Vector3(x, 29.6, -62.15));
  fx.push(lampSquares(win, pal, { world: 0.8, minPx: 6, maxPx: 20, name: 'windows' }));
  fx.push(lampSquares(bridgeWin, pal, { world: 1.0, minPx: 7, maxPx: 24, name: 'bridge_windows' }));
  const dl = [];
  for (let z = -60; z < 74; z += 4.5) for (const side of [1, -1]) dl.push(new THREE.Vector3(side * 11.3, 28.9, z));
  fx.push(lampSquares(dl, pal, { world: 0.35, minPx: 6, maxPx: 12, name: 'deck_lights' }));
  fx.push(lampHalos([...port, ...win, ...bridgeWin, ...dl], pal, { world: 2.0, minPx: 7, maxPx: 60, name: 'ship_halos', gain: 0.8 }));

  // Lifeboats.
  const boats = [];
  for (const z of [-48, -40, -32, -24, 40, 48, 56, 64]) for (const side of [1, -1]) boats.push(at(side * 10.2, 29.0, z));
  ship.add(instanced(new THREE.BoxGeometry(2.0, 1.0, 8.5), frost, boats, 'lifeboats'));

  // Frost-white V wake and bow waves.
  const wakeMat = foamMaterial(pal);
  const kelvin = 19.5 * DEG;
  for (const side of [1, -1]) {
    const pts = [];
    const w = [];
    for (let i = 0; i <= 24; i++) {
      const d = (i / 24) * 700;
      pts.push(new THREE.Vector2(side * (4 + d * Math.tan(kelvin)), SHIP.sternZ - 6 + d));
      w.push(1.5 + d * 0.05);
    }
    fx.push(Object.assign(new THREE.Mesh(ribbon(pts, w, 0.45), wakeMat), { renderOrder: 0.6, name: 'wake' }));
    const bp = [];
    const bw = [];
    for (let i = 0; i <= 16; i++) {
      const z = SHIP.bowZ + 1 + (i / 16) * 70;
      bp.push(new THREE.Vector2(side * (halfWidth(z) + 0.6 + i * 0.5), z));
      bw.push(0.8 + i * 0.25);
    }
    fx.push(Object.assign(new THREE.Mesh(ribbon(bp, bw, 0.46), wakeMat), { renderOrder: 0.6, name: 'bow_wave' }));
  }
  const trail = [];
  const tw = [];
  for (let i = 0; i <= 20; i++) {
    const d = (i / 20) * 500;
    trail.push(new THREE.Vector2(Math.sin(i * 0.7) * 1.5, SHIP.sternZ + d));
    tw.push(14 + d * 0.08);
  }
  fx.push(Object.assign(new THREE.Mesh(ribbon(trail, tw, 0.44), wakeMat), { renderOrder: 0.6, name: 'wake_trail' }));

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
  for (const o of fx) if (['portholes', 'windows', 'bridge_windows', 'ship_halos'].includes(o.name)) mirrorFx.add(o.clone());
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
  const L = pal.json.light;
  const steel = pal.toon('steel', { paint: 'steel' });
  const frost = pal.toon('frost', { paint: 'steel' });
  const navy = pal.toon('navy', { paint: 'steel' });
  const inkMat = pal.toon('ink');
  const plankMat = pal.toon(pal.mix('lamp', 'frost', 0.45), { paint: 'wood' });
  const canvasMat = pal.toon('steel', { paint: 'canvas' });
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
  anim.ropes.push({ obj: fall, a: jibB.clone(), b: new THREE.Vector3(jibB.x, Y + 2.2, jibB.z), phase: 0.7 });
  g.add(mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), inkMat, jibB.x, Y + 2.05, jibB.z, 'crane_hook'));

  // No.1 hatch cover and a ventilator.
  g.add(mesh(new THREE.BoxGeometry(4.2, 0.55, 3.2), navy, 0, Y + 0.28, -109, 'hatch'));
  g.add(mesh(new THREE.BoxGeometry(4.4, 0.08, 3.4), canvasMat, 0, Y + 0.58, -109, 'hatch_tarp'));
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

  // Two amber deck lamps: lamp lights with 3 hard pools, halo sprites, flicker on twos.
  const lampPos = [];
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
    const light = new THREE.PointLight(pal.color('lamp'), L.lamp, L.lampRange, 2);
    light.position.set(lx, Y + 2.38, lz);
    g.add(light);
    anim.lamps.push({ light, base: L.lamp, seed: s + 3 });
    lampPos.push(light.position.clone());
  }
  const halos = lampHalos(lampPos, pal, { world: 1.6, minPx: 8, maxPx: 200, name: 'deck_lamp_halos' });
  halos.layers.set(LAYERS.FX);
  g.add(halos);
  // Contact shadows (solid ink) under the deck props.
  const D = Y + 0.04;
  contactShadow(g, pal, 0, D, wz, 2.1, 0.95);
  for (const s of [1, -1]) {
    contactShadow(g, pal, s * 5.6, D, -120.5, 0.55, 1.1);
    contactShadow(g, pal, s * 2.4, D, wz - 3.2, 0.62, 0.62);
    contactShadow(g, pal, s * 4.4, D, -126.5, 0.22, 0.22);
    contactShadow(g, pal, s * 7.5, D, -106, 0.42, 0.42);
  }
  contactShadow(g, pal, 3.6, D, -114.5, 0.6, 0.6);
  contactShadow(g, pal, 0, D, -109, 2.4, 1.85);
  anchorAt(g, anchors, 'deck', new THREE.Vector3(0, Y, -112));
  scene.add(g);
}

// ---------------------------------------------------------------- foremast, rigging, crow's nest
function buildMastAndNest(scene, rng, pal, anchors) {
  const g = new THREE.Group();
  g.name = 'crowsnest';
  const L = pal.json.light;
  const steel = pal.toon('steel', { paint: 'steel' });
  const frostMat = pal.toon('frost');
  const navy = pal.toon('navy', { paint: 'steel' });
  const inkMat = pal.toon('ink');
  const lampMat = pal.toon('lamp');
  const iceMat = pal.toon('ice', { paint: 'canvas' });
  // Authored nest values (night vision: the basket is kept dark). Interior walls, floor and inner rim face are spot black;
  // the cap rail top catches a thin cool fill line (its thresholds drop so the up-facing fill reaches the lit step).
  const railMat = pal.toon(pal.mix('lamp', 'navy', 0.45), { paint: 'rail', shadowBias: -0.5, lineScale: 1.2 });
  const inkLiner = pal.toon('navy', { spotBlack: true, shadowBias: 0.5, noRim: true, side: THREE.BackSide });
  const floorMat = pal.toon('navy', { spotBlack: true, shadowBias: 0.8, noRim: true });
  const fine = pal.toon('navy', { lineScale: 0.5 });
  const oilMat = pal.toon('lamp', { paint: 'canvas' });
  const F = SHIP.nestFloorY;
  const bz = SHIP.basketZ;
  const R = SHIP.basketR;
  const topY = F + 8;

  // Foremast: 15 m from the forecastle deck to the nest, continuing to the top.
  const mastH = topY - SHIP.forecastleY;
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.3, mastH, 16), steel, 0, SHIP.forecastleY + mastH / 2, SHIP.mastZ, 'foremast'));
  g.add(mesh(new THREE.SphereGeometry(0.24, 10, 6), steel, 0, topY, SHIP.mastZ, 'mast_truck'));
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 16), navy, 0, SHIP.forecastleY + 0.12, SHIP.mastZ, 'mast_collar'));
  const masthead = mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: pal.color('lamp') }), 0, topY - 1.2, SHIP.mastZ + MASTHEAD.aft, 'masthead_light');
  masthead.layers.set(LAYERS.FX);
  g.add(masthead);
  // The masthead lamp lights forward only (3 hard pools inside a hard-edged cone); the basket interior is outside the cone.
  const mastLight = new THREE.SpotLight(pal.color('lamp'), L.masthead, MASTHEAD.range, MASTHEAD.angle, MASTHEAD.penumbra, 2);
  mastLight.position.copy(masthead.position);
  mastLight.target.position.set(0, MASTHEAD.aimY, MASTHEAD.aimZ);
  g.add(mastLight, mastLight.target);
  anim.lamps.push({ light: mastLight, base: L.masthead, seed: 11 });
  const mastHalo = lampHalos([masthead.position.clone()], pal, { world: 1.2, minPx: 8, maxPx: 200, name: 'masthead_halo' });
  mastHalo.layers.set(LAYERS.FX);
  g.add(mastHalo);
  // Mast ladder rungs below the nest.
  const rungs = [];
  for (let y = SHIP.forecastleY + 0.6; y < F - 0.2; y += 0.38) rungs.push(between(new THREE.Vector3(-0.22, y, SHIP.mastZ + 0.32), new THREE.Vector3(0.22, y, SHIP.mastZ + 0.32)));
  g.add(instanced(new THREE.CylinderGeometry(0.015, 0.015, 1, 5), pal.toon('steel', { paint: 'steel', lineScale: 0.6 }), rungs, 'ladder_rungs'));

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
  const stayMesh = instanced(stayGeo, inkMat, stays.map(([a, b]) => between(a, b)), 'stays');
  stayMesh.frustumCulled = false;
  g.add(stayMesh);
  anim.stays = { mesh: stayMesh, list: stays.map(([a, b], i) => ({ a, b, phase: i * 1.7 })) };

  // Basket: open steel ring wall 1.8 m across, 1.0 m rim.
  const nest = new THREE.Group();
  nest.name = 'basket';
  nest.position.set(0, F, bz);
  const capH = 0.05;
  const wallH = SHIP.rimH - capH;
  const wall = new THREE.LatheGeometry(
    [new THREE.Vector2(R - 0.04, 0), new THREE.Vector2(R, 0), new THREE.Vector2(R, wallH), new THREE.Vector2(R - 0.04, wallH), new THREE.Vector2(R - 0.04, 0)],
    56
  );
  nest.add(mesh(wall, steel, 0, 0, 0, 'basket_wall'));
  // Painted wooden cap rail on the rim (top at rimH).
  const cap = new THREE.LatheGeometry(
    [new THREE.Vector2(R - 0.06, wallH), new THREE.Vector2(R + 0.02, wallH), new THREE.Vector2(R + 0.02, SHIP.rimH), new THREE.Vector2(R - 0.06, SHIP.rimH), new THREE.Vector2(R - 0.06, wallH)],
    72
  );
  nest.add(mesh(cap, railMat, 0, 0, 0, 'cap_rail'));
  // Spot-black liners on the interior faces (single-sided, seen from inside, no hull): wall below the cap, and the cap's inner face.
  const liner = (r, h, y, name) => {
    const m = mesh(new THREE.CylinderGeometry(r, r, h, 56, 1, true), inkLiner, 0, y + h / 2, 0, name);
    m.userData.noHull = true;
    return m;
  };
  nest.add(liner(R - 0.045, wallH, 0, 'basket_interior'));
  nest.add(liner(R - 0.062, capH, wallH, 'rim_inner_face'));
  // Frost: small drifts in the corners where the floor meets the wall (hatch strokes live in the rail paint).
  const drift = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rng() * 0.6;
    const d = mesh(drift, frostMat, Math.sin(a) * (R - 0.1), 0, -Math.cos(a) * (R - 0.1), 'frost_drift');
    d.scale.set(0.1 + rng() * 0.08, 0.04 + rng() * 0.03, 0.06 + rng() * 0.04);
    d.rotation.y = -a;
    nest.add(d);
  }
  nest.add(mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.1, 0.12, 40), floorMat, 0, -0.06, 0, 'basket_floor'));
  for (const y of [0.08, wallH - 0.06]) {
    const band = mesh(new THREE.TorusGeometry(R + 0.012, 0.016, 5, 56), navy, 0, y, 0, 'band');
    band.rotation.x = Math.PI / 2;
    nest.add(band);
  }
  // Instanced rivet rows, inside and out.
  const rivets = [];
  for (const y of [0.16, 0.5, wallH - 0.1]) {
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      for (const r of [R + 0.004, R - 0.044]) rivets.push(at(Math.sin(a) * r, y, -Math.cos(a) * r));
    }
  }
  nest.add(instanced(new THREE.SphereGeometry(0.013, 6, 4), fine, rivets, 'rivets'));
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
  contactShadow(nest, pal, -0.48, 0.0, 0.38, 0.26, 0.2);
  contactShadow(nest, pal, 0.42, 0.0, 0.42, 0.3, 0.22);
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
  anim.ropes.push({ obj: null, group: hook, phase: 2.1, swing: true });
  const stripes = mesh(new THREE.BoxGeometry(0.15, 0.025, 0.03), navy, 0.0, -0.2, 0.048, 'scarf_stripe');
  stripes.rotation.z = 0.12;
  hook.add(stripes);
  nest.add(hook);
  const oil = new THREE.Group();
  oil.name = 'oilskin';
  oil.position.set(0.42, 0, 0.42);
  oil.rotation.y = -0.4;
  oil.add(mesh(new THREE.BoxGeometry(0.5, 0.07, 0.36), oilMat, 0, 0.035, 0));
  oil.add(mesh(new THREE.BoxGeometry(0.48, 0.06, 0.3), oilMat, 0.02, 0.1, 0.01));
  oil.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.12), oilMat, -0.12, 0.145, -0.04));
  nest.add(oil);

  g.add(nest);
  scene.add(g);

  // Anchors in world space.
  // Eye 1.62 m, LOOKOUT.back behind the inner face of the front rim, facing the bow.
  const eye = new THREE.Vector3(0, F + SHIP.eye, bz - (R - 0.04) + LOOKOUT.back);
  cameraAnchor(g, anchors, 'cam_lookout', eye, { yaw: 0, pitch: LOOKOUT.pitch, fov: LOOKOUT.fov });
  // The dolly may never bring the eye closer than LOOKOUT.minRim to the rim.
  anchors.cam_lookout.userData.maxDolly = LOOKOUT.back - LOOKOUT.minRim;
  anchorAt(g, anchors, 'mast_top', new THREE.Vector3(0, topY, SHIP.mastZ));
  anchorAt(g, anchors, 'lee_spot', new THREE.Vector3(0.45, F, bz + 0.15));
  // Fleet stands front-left so that from cam_lookout his card fills the left FLEET.cover of frame width.
  anchorAt(g, anchors, 'fleet_spot', new THREE.Vector3(eye.x + FLEET.x, F, eye.z - FLEET.forward));
  anchorAt(g, anchors, 'guide_spot', new THREE.Vector3(-(R - 0.12), F + 1.42, bz - 0.1));
}

// ---------------------------------------------------------------- build
export function build(scene, rng) {
  const pal = scene.userData.palette;
  if (!pal) throw new Error('titanic_crowsnest: scene.userData.palette missing');
  const anchors = {};
  const anchorGroup = new THREE.Group();
  anchorGroup.name = 'anchors';
  const shipRoot = new THREE.Group();
  shipRoot.name = 'ship_root';
  shipRoot.add(anchorGroup);
  anim.shipRoot = shipRoot;

  // The ship is the key light (lamps, portholes). Fill: cool hemisphere, ice at 35%.
  anim.stays = null;
  anim.ropes = [];
  anim.lamps = [];
  const L = pal.json.light;
  scene.add(new THREE.HemisphereLight(pal.color(L.fill), pal.color('navy'), L.fillIntensity));

  buildSky(scene, rng, pal);
  buildIceberg(scene, rng, pal, anchors);
  buildShip(shipRoot, rng, pal);
  buildForecastle(shipRoot, rng, pal, anchors);
  buildMastAndNest(shipRoot, rng, pal, anchors);
  scene.add(shipRoot);

  // Aerial: the iceberg -> midship line (+z) extended 250 m astern, offset 60 m to starboard, 180 m up; aimed at midship.
  const aerialPos = new THREE.Vector3(AERIAL.starboard, AERIAL.up, AERIAL.astern);
  const aerialYaw = Math.atan2(-(0 - aerialPos.x), -(0 - aerialPos.z)) / DEG;
  cameraAnchor(anchorGroup, anchors, 'aerial', aerialPos, { yaw: aerialYaw, pitch: AERIAL.pitch, fov: AERIAL.fov, panini: AERIAL.panini });
  anchors.aerial.userData.aimDist = aerialPos.length();
  anchorAt(anchorGroup, anchors, 'sea', new THREE.Vector3(0, 0, SHIP.mastZ - 220));
  return { anchors, update };
}

const SWAY = { hz: 0.25, deg: 1.5 };
const flick = (seed, k) => {
  const x = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Per-frame state from the frame index only: sea, stars, smoke (on twos), lamp flicker (on twos), rigging sway.
export function update(n, { camera, fps = 24 } = {}) {
  const t = n / fps;
  const k = Math.floor(n / 2);
  fxUniforms.uT.value = t;
  fxUniforms.uShipZ.value = -SHIP_SPEED * t;
  if (anim.shipRoot) {
    anim.shipRoot.position.z = -SHIP_SPEED * t;
    anim.shipRoot.updateMatrixWorld(true);
  }
  fxUniforms.uT2.value = (k * 2) / fps;
  fxUniforms.uTwos.value = k;
  if (camera) fxUniforms.uFocal.value = 1920 / (2 * Math.tan((camera.fov * Math.PI) / 360));
  fxUniforms.uFlicker.value = 1 + 0.03 * (flick(1, k) * 2 - 1);
  for (const l of anim.lamps) l.light.intensity = l.base * (1 + 0.03 * (flick(l.seed, k) * 2 - 1));
  const ang = (ph) => SWAY.deg * DEG * Math.sin(2 * Math.PI * SWAY.hz * t + ph);
  if (anim.stays) {
    const { mesh: m, list } = anim.stays;
    list.forEach(({ a, b, phase }, i) => m.setMatrixAt(i, between(a, swing(a, b, ang(phase)))));
    m.instanceMatrix.needsUpdate = true;
  }
  for (const r of anim.ropes) {
    if (r.obj) {
      between(r.a, swing(r.a, r.b, ang(r.phase))).decompose(r.obj.position, r.obj.quaternion, r.obj.scale);
    } else if (r.group) {
      r.group.rotation.z = ang(r.phase);
    }
  }
}

// Rotate b about a, sideways (horizontal perpendicular to the line).
function swing(a, b, angle) {
  const d = new THREE.Vector3().subVectors(b, a);
  let m = new THREE.Vector3().crossVectors(UP, d);
  if (m.lengthSq() < 1e-8) m.set(1, 0, 0);
  const axis = new THREE.Vector3().crossVectors(d, m).normalize();
  return a.clone().add(d.applyAxisAngle(axis, angle));
}

export const ANCHORS = [
  'aerial', 'cam_lookout', 'mast_top', 'lee_spot', 'fleet_spot', 'guide_spot', 'sea',
  'bell', 'phone', 'locker', 'padlock', 'deck', 'iceberg_dark', 'iceberg_rim',
];
