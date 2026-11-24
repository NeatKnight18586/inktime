import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from './layers.mjs';

// Shared uniforms: updated once per frame by the renderer.
export const hullUniforms = {
  uRes: { value: new THREE.Vector2(1080, 1920) },
  uFocal: { value: 1321 }, // pixels per world unit at distance 1
};

// STYLE: thickness 1.5-3% of object size; line width 3 px within 3 m, 1 px beyond 40 m.
const HULL_FRACTION = 0.022;

const vertexShader = /* glsl */ `
uniform vec2 uRes;
uniform float uFocal;
uniform float uWorld;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vec3 wn = normalize(mat3(m) * normal);
  vec4 vp = viewMatrix * wp;
  float d = max(-vp.z, 0.01);
  float maxPx = mix(3.0, 1.0, smoothstep(3.0, 40.0, d));
  float px = clamp(uWorld * uFocal / d, 0.0, maxPx);
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

export function hullMaterial(worldThickness) {
  return new THREE.ShaderMaterial({
    uniforms: { ...hullUniforms, uWorld: { value: worldThickness } },
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
    const mat = hullMaterial(objectSize(mesh) * HULL_FRACTION);
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
