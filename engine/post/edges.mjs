import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HASH, LINEAR_DEPTH, VERT, srgbVec } from './common.mjs';
import { INK_SCALE_GLSL, SILHOUETTE_PX } from '../look/hull.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

// Ink hierarchy at 1080 px wide (STYLE):
//  silhouettes (depth breaks) 6-8 px x inkScale(distance); creases (normal breaks) 2-3 px;
//  seeded +-20% width variation along each line, tapered ends; boil every 2 frames (+-0.6 px, seeded);
//  ink #141414 near the camera, mixed toward the haze colour with distance (same 3 bands as the haze).
// tNormal alpha < 0.5 marks inverted-hull ink.
export function edgesPass({ normalTexture, depthTexture, near, far, res, ink, haze, seed = 'boil' }) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tNormal: { value: null },
      tDepth: { value: null },
      uNear: { value: near },
      uFar: { value: far },
      uRes: { value: res.clone() },
      uInk: { value: new THREE.Vector3(...srgbVec(ink)) },
      uHaze: { value: new THREE.Vector3(...srgbVec(haze.color)) },
      uHazeD: { value: new THREE.Vector2(haze.near, haze.far) },
      uHazeA: { value: new THREE.Vector3(...haze.bands) },
      uBoil: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tNormal;
      uniform sampler2D tDepth;
      uniform vec2 uRes;
      uniform vec3 uInk;
      uniform vec3 uHaze;
      uniform vec2 uHazeD;
      uniform vec3 uHazeA;
      uniform vec3 uBoil; // xy: global jitter (px), z: seed
      varying vec2 vUv;
      ${LINEAR_DEPTH}
      ${HASH}
      ${INK_SCALE_GLSL}
      float invD(vec2 uv) { return 1.0 / linDepth(texture2D(tDepth, uv).x); }
      vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }
      const vec2 DIRS[4] = vec2[4](vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(0.7071, 0.7071), vec2(0.7071, -0.7071));
      const float RINGS[5] = float[5](1.0, 1.75, 2.5, 3.25, 4.0);
      void main() {
        vec2 px = 1.0 / uRes;
        vec2 p = vUv * uRes;
        vec2 jit = uBoil.xy + (vec2(vnoise(p / 9.0 + uBoil.z), vnoise(p / 9.0 - uBoil.z * 1.7)) - 0.5) * 0.6;
        vec2 uv = vUv + jit * px;
        float c = invD(uv);
        float vary = 1.0 + 0.2 * (vnoise(p / 14.0 + uBoil.z * 3.1) * 2.0 - 1.0);

        // Silhouettes: second difference of 1/depth across opposite taps (zero on planes), ring by ring.
        float sil = 0.0;
        for (int k = 0; k < 5; k++) {
          float r = RINGS[k];
          float strength = 0.0;
          float nearInv = c;
          for (int j = 0; j < 4; j++) {
            vec2 o = DIRS[j] * r * px;
            float a = invD(uv + o);
            float b = invD(uv - o);
            nearInv = max(nearInv, max(a, b));
            strength = max(strength, abs(a + b - 2.0 * c) / max(max(a, b), max(c, 1e-6)));
          }
          float dNear = 1.0 / nearInv;
          float taper = mix(0.55, 1.0, smoothstep(0.12, 0.4, strength));
          float hw = 0.5 * ${SILHOUETTE_PX.toFixed(1)} * inkScale(dNear) * vary * taper;
          if (strength > 0.12 && r <= hw + 0.5) sil = 1.0;
        }

        // Creases: normal breaks, 2-3 px.
        float dC = 1.0 / max(c, 1e-6);
        float halfC = 0.5 * (2.0 + inkScale(dC)) * vary;
        float crease = 0.0;
        for (int k = 0; k < 2; k++) {
          float r = k == 0 ? 0.75 : 1.5;
          if (r > halfC + 0.25) continue;
          for (int j = 0; j < 4; j++) {
            vec2 o = DIRS[j] * r * px;
            if (dot(nrm(uv + o), nrm(uv - o)) < 0.55) crease = 1.0;
          }
        }

        float hull = step(texture2D(tNormal, uv).a, 0.5);
        float e = max(max(sil, crease), hull);
        float hz = dC < uHazeD.x ? uHazeA.x : (dC < uHazeD.y ? uHazeA.y : uHazeA.z);
        vec3 inkC = mix(uInk, uHaze, hz);
        vec4 col = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(mix(col.rgb, inkC, e), 1.0);
      }`,
  });
  // ShaderPass clones uniforms and drops render-target textures; bind after.
  pass.uniforms.tNormal.value = normalTexture;
  pass.uniforms.tDepth.value = depthTexture;
  pass.setFrame = (n) => {
    const r = rng(hashSeed(`${seed}:${Math.floor(n / 2)}`));
    pass.uniforms.uBoil.value.set((r() * 2 - 1) * 0.3, (r() * 2 - 1) * 0.3, r() * 100);
  };
  return pass;
}
