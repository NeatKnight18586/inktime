import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LAYERS } from '../look/layers.mjs';
import { hullUniforms, INK_SCALE_GLSL, SILHOUETTE_PX } from '../look/hull.mjs';
import { BASE_MOTION } from './camera.mjs';

// "You" hands as a 3D viewmodel (STYLE, Hands). An existing rigged hand (@webxr-input-profiles generic-hand, MIT) is
// skinned, shaded with a two-tone toon ramp, outlined with a skinned inverted hull, and drawn in camera space.
// Poses are tiny JSON (cast/hands/poses.json): curl 0..1 per finger, spread, thumbOppose, wrist [pitch, yaw, roll] deg.
const DEG = Math.PI / 180;
export const HAND_MODEL = { right: '/assets/hands/right.glb', left: '/assets/hands/left.glb' };
// Curl c -> joint angles (deg): proximal 70c, intermediate 95c, distal 65c.
export const CURL_DEG = { proximal: 70, intermediate: 95, distal: 65 };
// Finger fan (deg at spread 1, positive toward the thumb) and thumb opposition (deg at oppose 1).
export const FAN_DEG = { 'index-finger': 10, 'middle-finger': 3, 'ring-finger': -4, 'pinky-finger': -12 };
export const SPREAD_REST = 0.35;
export const OPPOSE_DEG = { toPalm: 50, toFingers: 22 };
export const BLEND_FRAMES = 3;
// Camera-space placement (metres, right/up/forward from the eye) at the reference FOV; bottom-right of the frame.
export const HAND_FRAME = { x: 0.12, y: -0.2, z: 0.42, scale: 1, refFov: 72 };
// Lighting (kept from 1b.2): warm amber key from below, ice rim on the upper edges. keyDir is view space (towards the light).
export const HAND_LOOK = { lineScale: 1.3, shadowBias: 0, t2: 0.3, keyDir: [0.2, -0.62, 0.76], warm: 0.3, rimFrom: 0.62, rimUp: 0.1, rimMix: 0.9, ink: 0.022 };

export const curlAngles = (c) => ({ proximal: CURL_DEG.proximal * c, intermediate: CURL_DEG.intermediate * c, distal: CURL_DEG.distal * c });

// Linear blend of two poses (numbers only; the wrist is an array).
export function blendPose(a, b, w) {
  const l = (x, y) => x + (y - x) * w;
  const curl = {};
  for (const k of Object.keys(b.curl)) curl[k] = l(a.curl[k], b.curl[k]);
  return { hand: b.hand ?? 'right', curl, spread: l(a.spread, b.spread), thumbOppose: l(a.thumbOppose, b.thumbOppose), wrist: b.wrist.map((v, i) => l(a.wrist[i], v)) };
}

// Pose weights at frame n for a stateless render: pose changes blend over BLEND_FRAMES, on twos.
export function poseAtFrame(n, poseAt, poses) {
  const ne = n - (n % 2);
  const cur = poseAt(ne);
  if (!cur) return null;
  for (let d = 0; d < BLEND_FRAMES; d++) {
    const here = poseAt(Math.max(0, ne - d));
    const before = poseAt(Math.max(0, ne - d - 1));
    if (ne - d - 1 >= 0 && before !== here) {
      if (!before) return poses[cur];
      return blendPose(poses[before], poses[cur], (d + 1) / BLEND_FRAMES);
    }
  }
  return poses[cur];
}

const SKIN_VERT = /* glsl */ `
varying vec3 vN;
varying vec2 vUv;
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vN = normalize( normalMatrix * objectNormal );
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );
}`;

const SKIN_FRAG = /* glsl */ `
uniform vec3 uLit; uniform vec3 uShadow; uniform vec3 uKey; uniform vec3 uRim; uniform vec3 uTint;
uniform vec3 uKeyDir; uniform vec4 uP; // t2, warm, rimFrom, rimUp
uniform float uRimMix; uniform sampler2D uMap; uniform float uUseMap;
varying vec3 vN; varying vec2 vUv;
void main() {
  vec3 n = normalize( vN );
  float e = max( dot( n, normalize( uKeyDir ) ), 0.0 );
  vec3 base = uLit;
  vec3 shadow = uShadow;
  if ( uUseMap > 0.5 ) { base = texture2D( uMap, vUv ).rgb; shadow = base * 0.6; }
  vec3 c = e < uP.x ? shadow : mix( base, base * uKey * 1.5, uP.y );
  float edge = 1.0 - max( n.z, 0.0 );
  if ( edge > uP.z && n.y > uP.w ) c = mix( c, uRim, uRimMix );
  gl_FragColor = vec4( c * uTint, 1.0 );
}`;

const HULL_VERT = /* glsl */ `
uniform vec2 uRes; uniform float uFocal; uniform float uWorld; uniform float uLine; uniform float uBoil;
${INK_SCALE_GLSL}
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vec3 vn = normalize( mat3( viewMatrix ) * ( mat3( modelMatrix ) * objectNormal ) );
  vec4 vp = viewMatrix * wp;
  float d = max( -vp.z, 0.01 );
  float vary = 1.0 + 0.2 * ( fract( sin( dot( wp.xyz + uBoil, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) * 2.0 - 1.0 );
  float maxPx = 0.5 * ${SILHOUETTE_PX.toFixed(1)} * inkScale( d ) * vary * uLine;
  float px = clamp( uWorld * uLine * uFocal / d, 0.0, maxPx );
  vec4 clip = projectionMatrix * vp;
  vec2 dir = ( projectionMatrix * vec4( vn, 0.0 ) ).xy;
  float len = length( dir );
  dir = len > 1e-6 ? dir / len : vec2( 0.0 );
  clip.xy += dir * px * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;

export function skinMaterial(colors, { map = null } = {}) {
  const K = HAND_LOOK;
  return new THREE.ShaderMaterial({
    vertexShader: SKIN_VERT,
    fragmentShader: SKIN_FRAG,
    uniforms: {
      uLit: { value: colors.lit },
      uShadow: { value: colors.shadow },
      uKey: { value: colors.key },
      uRim: { value: colors.rim },
      uTint: { value: colors.tint },
      uKeyDir: { value: new THREE.Vector3(...K.keyDir) },
      uP: { value: new THREE.Vector4(K.t2 + 0.3 * K.shadowBias, K.warm, K.rimFrom, K.rimUp) },
      uRimMix: { value: K.rimMix },
      uMap: { value: map },
      uUseMap: { value: map ? 1 : 0 },
    },
  });
}

// Ink outline: a back-face shell pushed out along the (skinned) normal in screen space; the line pass reads alpha < 0.5.
export function inkHullMaterial(worldThickness, lineScale = HAND_LOOK.lineScale) {
  return new THREE.ShaderMaterial({
    vertexShader: HULL_VERT,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.5, 0.5, 1.0, 0.0); }',
    side: THREE.BackSide,
    uniforms: { ...hullUniforms, uWorld: { value: worldThickness }, uLine: { value: lineScale } },
  });
}

// Navy wool cuff with knit hatching (canvas texture; none in Node).
function knitTexture(navy, ink) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = navy;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = ink;
  g.lineWidth = 2;
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      g.beginPath();
      g.moveTo(x + 1, y + 7);
      g.lineTo(x + 4, y + 1);
      g.lineTo(x + 7, y + 7);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  return t;
}

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const FINGER_KEY = { 'index-finger': 'index', 'middle-finger': 'middle', 'ring-finger': 'ring', 'pinky-finger': 'pinky' };
const chainOf = (f) => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`];
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];

function rotAbout(p, pivot, axis, ang) {
  return p.clone().sub(pivot).applyAxisAngle(axis, ang).add(pivot);
}

// Rig a parsed generic-hand glTF: the joints come flat, so rebuild the finger chains as a hierarchy (rest pose kept).
// palette: { lit, shadow, key, rim, tint, navy, ink } THREE.Colors.
export function buildHand(gltf, colors, hex = {}) {
  const root = gltf.scene;
  const skinned = root.getObjectByProperty('isSkinnedMesh', true);
  if (!skinned) throw new Error('hand glb has no skinned mesh');
  const bones = Object.fromEntries(skinned.skeleton.bones.map((b) => [b.name, b]));
  root.updateMatrixWorld(true);
  const rest = {};
  for (const [name, b] of Object.entries(bones)) {
    rest[name] = { pos: b.getWorldPosition(new THREE.Vector3()), quat: b.getWorldQuaternion(new THREE.Quaternion()) };
  }
  // Hierarchy: wrist -> metacarpal -> proximal -> intermediate -> distal -> tip.
  const parentOf = {};
  const chains = [...FINGERS.map(chainOf), THUMB];
  for (const ch of chains) {
    ch.forEach((name, i) => {
      const parent = i === 0 ? 'wrist' : ch[i - 1];
      bones[parent].attach(bones[name]);
      parentOf[name] = parent;
    });
  }
  root.updateMatrixWorld(true);
  const local0 = {};
  for (const [name, b] of Object.entries(bones)) local0[name] = b.quaternion.clone();

  // Rest axes: f = finger direction, n = palm normal (the side the thumb leans to), across = index -> pinky.
  const P = (n) => rest[n].pos;
  const f = new THREE.Vector3();
  for (const fg of FINGERS) f.add(P(`${fg}-tip`).clone().sub(P(`${fg}-phalanx-proximal`)));
  f.normalize();
  const across = P('pinky-finger-phalanx-proximal').clone().sub(P('index-finger-phalanx-proximal')).normalize();
  let n = new THREE.Vector3().crossVectors(across, f).normalize();
  if (P('thumb-tip').clone().sub(P('index-finger-phalanx-proximal')).dot(n) < 0) n.negate();
  const axisFor = (dir) => {
    const nn = n.clone().addScaledVector(dir, -n.dot(dir)).normalize();
    return new THREE.Vector3().crossVectors(dir, nn).normalize(); // + angle bends toward the palm
  };
  const dirOf = (a, b) => P(b).clone().sub(P(a)).normalize();
  const flexAxis = {};
  for (const fg of FINGERS) flexAxis[fg] = axisFor(dirOf(`${fg}-phalanx-proximal`, `${fg}-tip`));
  const thumbAxis = axisFor(dirOf('thumb-phalanx-proximal', 'thumb-tip'));
  // Toward-thumb direction in the palm plane, for the fan sign.
  const toThumb = P('thumb-metacarpal').clone().sub(P('index-finger-metacarpal'));
  toThumb.addScaledVector(n, -toThumb.dot(n)).normalize();
  const fanSign = (fg) => {
    const piv = P(`${fg}-phalanx-proximal`);
    const tip = P(`${fg}-tip`);
    return rotAbout(tip, piv, n, 0.1).sub(tip).dot(toThumb) > 0 ? 1 : -1;
  };
  const fan = Object.fromEntries(FINGERS.map((fg) => [fg, fanSign(fg)]));
  // Thumb opposition signs: toward the palm (about f) and toward the index (about n).
  const tmPivot = P('thumb-metacarpal');
  const tTip = P('thumb-tip');
  const oppPalm = rotAbout(tTip, tmPivot, f, 0.1).sub(tTip).dot(n) > 0 ? 1 : -1;
  const idx = P('index-finger-phalanx-proximal');
  const closer = (axis, s) => rotAbout(tTip, tmPivot, axis, 0.1 * s).distanceTo(idx) < tTip.distanceTo(idx);
  const oppFing = closer(n, 1) ? 1 : -1;

  const q = new THREE.Quaternion();
  const apply = (name, rots) => {
    const parent = parentOf[name];
    const pInv = rest[parent].quat.clone().invert();
    const out = new THREE.Quaternion();
    for (const [axis, ang] of rots) out.multiply(q.setFromAxisAngle(axis.clone().applyQuaternion(pInv), ang));
    bones[name].quaternion.copy(out.multiply(local0[name]));
  };

  function setPose(pose) {
    const sp = pose.spread - SPREAD_REST;
    for (const fg of FINGERS) {
      const a = curlAngles(pose.curl[FINGER_KEY[fg]]);
      const ch = chainOf(fg);
      const abd = ((FAN_DEG[fg] * sp) / (1 - SPREAD_REST)) * DEG * fan[fg];
      apply(ch[1], [[n, abd], [flexAxis[fg], a.proximal * DEG]]);
      apply(ch[2], [[flexAxis[fg], a.intermediate * DEG]]);
      apply(ch[3], [[flexAxis[fg], a.distal * DEG]]);
    }
    const t = curlAngles(pose.curl.thumb);
    apply(THUMB[0], [[f, oppPalm * OPPOSE_DEG.toPalm * DEG * pose.thumbOppose], [n, oppFing * OPPOSE_DEG.toFingers * DEG * pose.thumbOppose]]);
    apply(THUMB[1], [[thumbAxis, t.proximal * DEG]]);
    apply(THUMB[2], [[thumbAxis, t.distal * DEG]]);
  }

  // Materials and ink hull (second SkinnedMesh sharing the skeleton).
  const sk = skinMaterial(colors);
  skinned.material = sk;
  skinned.layers.set(LAYERS.SOLID);
  skinned.frustumCulled = false;
  skinned.geometry.computeBoundingSphere();
  const size = skinned.geometry.boundingSphere.radius * 2;
  const hull = new THREE.SkinnedMesh(skinned.geometry, inkHullMaterial(size * HAND_LOOK.ink));
  hull.bind(skinned.skeleton, skinned.bindMatrix);
  hull.layers.set(LAYERS.HULL);
  hull.frustumCulled = false;
  hull.userData.isHull = true;
  skinned.parent.add(hull);

  // Cuff on the wrist bone, running back along the arm.
  const knit = knitTexture(hex.navy ?? '#1B2A41', hex.ink ?? '#141414');
  const cuffGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.09, 24, 1, true);
  const cuff = new THREE.Mesh(cuffGeo, skinMaterial({ ...colors, lit: colors.navy, shadow: colors.navy }, { map: knit }));
  if (!knit) cuff.material.uniforms.uLit.value = colors.navy;
  const arm = f.clone().negate();
  const wq = rest.wrist.quat.clone();
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), arm);
  cuff.quaternion.copy(wq.clone().invert().multiply(align));
  cuff.position.copy(arm.clone().multiplyScalar(0.05).applyQuaternion(wq.clone().invert()));
  cuff.layers.set(LAYERS.SOLID);
  cuff.frustumCulled = false;
  cuff.material.side = THREE.DoubleSide;
  const cuffHull = new THREE.Mesh(cuffGeo, inkHullMaterial(0.09 * HAND_LOOK.ink));
  cuffHull.layers.set(LAYERS.HULL);
  cuffHull.frustumCulled = false;
  cuffHull.userData.isHull = true;
  cuff.add(cuffHull);
  bones.wrist.add(cuff);

  // Placement: wrist at the group origin; base orientation maps fingers -> -Z (forward), palm normal -> -Y (down).
  const group = new THREE.Group();
  group.name = 'hands3d';
  const armature = root;
  armature.position.copy(P('wrist').clone().negate());
  group.add(armature);
  const m = new THREE.Matrix4();
  const camZ = f.clone().negate(); // hand direction that maps to camera +Z
  const camY = n.clone().addScaledVector(f, -n.dot(f)).normalize().negate(); // hand direction that maps to camera +Y
  const camX = new THREE.Vector3().crossVectors(camY, camZ);
  m.makeBasis(camX, camY, camZ); // columns: hand-space images of camera axes
  const baseQuat = new THREE.Quaternion().setFromRotationMatrix(m).invert(); // hand -> camera
  group.userData.baseQuat = baseQuat;
  return { group, setPose, bones, rest, skinned, hull, cuff, axes: { f, n, across, toThumb }, baseQuat };
}

export async function loadHand(hand = 'right', colors, hex) {
  const gltf = await new GLTFLoader().loadAsync(HAND_MODEL[hand]);
  return buildHand(gltf, colors, hex);
}

// In-frame placement of the hand group for a camera FOV: the viewmodel keeps its screen place when the FOV zooms.
export function placeHand(group, baseQuat, wristDeg, fov, offset = [0, 0, 0]) {
  const k = Math.tan((fov * DEG) / 2) / Math.tan((HAND_FRAME.refFov * DEG) / 2);
  const s = HAND_FRAME.scale * k;
  group.scale.setScalar(s);
  group.position.set((HAND_FRAME.x + offset[0]) * k, (HAND_FRAME.y + offset[1]) * k, -HAND_FRAME.z + offset[2]);
  const wr = new THREE.Quaternion().setFromEuler(new THREE.Euler(wristDeg[0] * DEG, wristDeg[1] * DEG, wristDeg[2] * DEG, 'YXZ'));
  group.quaternion.copy(wr).multiply(baseQuat);
}

// The viewmodel lags the camera's breathing by 2 frames: it sits where the camera was 2 frames ago.
export function breathLag(m, fps) {
  const B = BASE_MOTION;
  const at = (f) => Math.sin((2 * Math.PI * B.breathHz * f) / fps);
  return { pitchDeg: B.breathPitch * (at(m - 2) - at(m)), lift: B.breathLift * (Math.sin((2 * Math.PI * B.breathHz * (m - 2)) / fps + Math.PI / 2) - Math.sin((2 * Math.PI * B.breathHz * m) / fps + Math.PI / 2)) };
}

export async function makeHands(camera, tint, palette, poses) {
  const L = palette.json.light;
  const lit = new THREE.Color(palette.mixHex('lamp', 'paper', 0.55));
  const navy = palette.color('navy');
  const shadow = lit.clone().multiplyScalar(0.7).lerp(navy, 0.2);
  const colors = { lit, shadow, key: palette.color(L.key), rim: palette.color(L.fill), tint, navy };
  const rigs = {};
  for (const hand of new Set(Object.values(poses).map((p) => p.hand ?? 'right'))) rigs[hand] = await loadHand(hand, colors, { navy: palette.hexOf('navy'), ink: palette.json.ink });
  const holder = new THREE.Group();
  holder.name = 'hands';
  holder.visible = false;
  for (const r of Object.values(rigs)) {
    r.group.visible = false;
    holder.add(r.group);
  }
  camera.add(holder);
  return {
    holder,
    rigs,
    // m: frame index in the shot; poseAt(f): pose name (or null) at absolute frame f; all state derives from n.
    update(n, m, poseAt, fps = 24) {
      const pose = poseAtFrame(n, poseAt, poses);
      holder.visible = !!pose;
      for (const r of Object.values(rigs)) r.group.visible = false;
      if (!pose) return;
      const rig = rigs[pose.hand ?? 'right'];
      rig.group.visible = true;
      rig.setPose(pose);
      const k = Math.floor(m / 2);
      const bob = 0.003 * Math.sin(k * 0.52) + 0.0015 * Math.sin(k * 1.31);
      const lag = breathLag(m - (m % 2), fps);
      placeHand(rig.group, rig.baseQuat, [pose.wrist[0] + lag.pitchDeg, pose.wrist[1], pose.wrist[2]], camera.fov, [0, bob + lag.lift, 0]);
      rig.group.updateMatrixWorld(true);
    },
  };
}
