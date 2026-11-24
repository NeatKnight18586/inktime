import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from './layers.mjs';

// Shared uniforms: updated once per frame by the renderer.
export const hullUniforms = {
  uRes: { value: new THREE.Vector2(1080, 1920) },
  uFocal: { value: 1321 }, // pixels per world unit at distance 1
  uBoil: { value: 0 }, // re-seeded every 2 frames
};

// STYLE ink hierarchy: silhouettes 6-8 px (7 nominal) x distance scale: 1 within 5 m, 0.6 at 30 m, 0.35 beyond 200 m.
export const SILHOUETTE_PX = 7;
export function inkScale(d) {
  if (d <= 5) return 1;
  if (d <= 30) return 1 - 0.4 * ((d - 5) / 25);
  if (d <= 200) return 0.6 - 0.25 * ((d - 30) / 170);
  return 0.35;
}
export const INK_SCALE_GLSL = /* glsl */ `
float inkScale(float d) {
  if (d <= 5.0) return 1.0;
  if (d <= 30.0) return 1.0 - 0.4 * ((d - 5.0) / 25.0);
  if (d <= 200.0) return 0.6 - 0.25 * ((d - 30.0) / 170.0);
  return 0.35;
}`;

// Thickness is capped at 1.5-3% of object size so small props keep thin lines.
const HULL_FRACTION = 0.022;

const vertexShader = /* glsl */ `
uniform vec2 uRes;
uniform float uFocal;
uniform float uWorld;
uniform float uLine;
uniform float uBoil;
${INK_SCALE_GLSL}
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vec3 wn = normalize(mat3(m) * normal);
  vec4 vp = viewMatrix * wp;
  float d = max(-vp.z, 0.01);
  // Outer half of the silhouette width; seeded +-20% variation along the line (brush).
  float vary = 1.0 + 0.2 * (fract(sin(dot(wp.xyz + uBoil, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 2.0 - 1.0);
  float maxPx = 0.5 * ${SILHOUETTE_PX.toFixed(1)} * inkScale(d) * vary * uLine;
  float px = clamp(uWorld * uLine * uFocal / d, 0.0, maxPx);
  vec4 clip = projectionMatrix * vp;
  vec3 vn = mat3(viewMatrix) * wn;
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(0.0);
  clip.xy += dir * px * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;

// The line pass reads alpha < 0.5 as ink.
const fragmentShader = /* glsl */ `
void main() { gl_FragColor = vec4(0.5, 0.5, 1.0, 0.0); }`;

const geoCache = new WeakMap();
function hullGeometry(geo) {
  if (geoCache.has(geo)) return geoCache.get(geo);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position'));
  if (geo.index) g.setIndex(geo.index);
  const merged = mergeVertices(g.index ? g.toNonIndexed() : g, 1e-4);
  merged.computeVertexNormals();
  geoCache.set(geo, merged);
  return merged;
}

// lineScale (material control) multiplies the outline width.
export function hullMaterial(worldThickness, lineScale = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...hullUniforms, uWorld: { value: worldThickness }, uLine: { value: lineScale } },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
  });
}

function objectSize(mesh) {
  const geo = mesh.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const s = new THREE.Vector3();
  mesh.getWorldScale(s);
  return geo.boundingSphere.radius * 2 * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
}

// Attach an inverted hull to every solid mesh under root (skips userData.noHull).
export function addHulls(root) {
  root.updateMatrixWorld(true);
  const targets = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isHull || o.userData.noHull) return;
    if (!o.layers.isEnabled(LAYERS.SOLID)) return;
    if (!o.geometry.getAttribute('position')) return;
    targets.push(o);
  });
  for (const mesh of targets) {
    const geo = hullGeometry(mesh.geometry);
    const ws = new THREE.Vector3();
    mesh.getWorldScale(ws);
    const scale = Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)) || 1;
    // uWorld is applied after the world transform, so express it in world units.
    const lineScale = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.userData?.ink?.lineScale ?? 1;
    const mat = hullMaterial(objectSize(mesh) * HULL_FRACTION, lineScale);
    let hull;
    if (mesh.isInstancedMesh) {
      hull = new THREE.InstancedMesh(geo, mat, mesh.count);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.frustumCulled = false;
    } else {
      hull = new THREE.Mesh(geo, mat);
    }
    hull.userData.isHull = true;
    hull.userData.scale = scale;
    hull.layers.set(LAYERS.HULL);
    hull.renderOrder = mesh.renderOrder;
    mesh.add(hull);
  }
  return targets.length;
}
