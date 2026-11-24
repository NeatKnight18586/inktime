import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VERT } from './common.mjs';

// Panini projection (d = 1) as a resample of the rectilinear frame. STYLE: on at vFOV >= 80, keeps verticals straight.
// Plane units: x = tan(azimuth) on the image plane at distance 1.

// Panini plane -> rectilinear plane.
export function paniniToRect(vx, vy) {
  const f = 4 / (vx * vx + 4);
  const g = f / (2 * f - 1);
  return [vx * g, vy * g];
}

// Rectilinear plane -> panini plane.
export function rectToPanini(rx, ry) {
  const vx = Math.abs(rx) < 1e-9 ? rx : (2 * (Math.sqrt(1 + rx * rx) - 1)) / rx;
  const f = 4 / (vx * vx + 4);
  return [vx, (ry * (2 * f - 1)) / f];
}

// Scale k so the horizontal frame edge maps exactly onto the source edge (no out-of-frame samples at mid-height).
export function paniniScale(ex) {
  const a = (-4 + Math.sqrt(16 + 16 * ex * ex)) / (2 * ex);
  return a / ex;
}

// Rectilinear NDC -> output NDC after the Panini pass, for a camera with the given vFOV (deg) and aspect.
// Panini strength by vFOV: 0 at 78 deg, 0.5 at 90, 0.7 at 100 (linear ramp, clamped).
export function paniniStrength(fovDeg) {
  if (fovDeg <= 78) return 0;
  if (fovDeg <= 90) return (0.5 * (fovDeg - 78)) / 12;
  return Math.min(0.7, 0.5 + (0.2 * (fovDeg - 90)) / 10);
}

export function paniniNdc(x, y, fovDeg, aspect, strength = paniniStrength(fovDeg)) {
  const ey = Math.tan((fovDeg * Math.PI) / 360);
  const ex = ey * aspect;
  const k = paniniScale(ex);
  const [vx, vy] = rectToPanini(x * ex, y * ey);
  const s = strength;
  return [x + (vx / (ex * k) - x) * s, y + (vy / (ey * k) - y) * s];
}

export function paniniPass() {
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uExt: { value: new THREE.Vector2(1, 1) }, uK: { value: 1 }, uS: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uExt;
      uniform float uK;
      uniform float uS;
      varying vec2 vUv;
      void main() {
        vec2 v = (vUv * 2.0 - 1.0) * uExt * uK;
        float f = 4.0 / (v.x * v.x + 4.0);
        vec2 r = v * f / (2.0 * f - 1.0);
        vec2 r0 = (vUv * 2.0 - 1.0) * uExt;
        r = mix(r0, r, uS);
        vec2 uv = r / uExt * 0.5 + 0.5;
        gl_FragColor = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
      }`,
  });
  pass.setCamera = (camera, on) => {
    const s = paniniStrength(camera.fov);
    pass.enabled = on && s > 0;
    pass.uniforms.uS.value = s;
    const ey = Math.tan((camera.fov * Math.PI) / 360);
    const ex = ey * camera.aspect;
    pass.uniforms.uExt.value.set(ex, ey);
    pass.uniforms.uK.value = paniniScale(ex);
  };
  return pass;
}
