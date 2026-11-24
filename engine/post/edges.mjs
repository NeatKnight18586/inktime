import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HASH, LINEAR_DEPTH, VERT, srgbVec } from './common.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

// Screen-space ink on depth + normals, plus the inverted-hull mask (alpha < 0.5 in tNormal).
// STYLE: 3 px within 3 m of camera falling to 1 px beyond 40 m; boil every 2 frames, +-0.6 px, seeded.
export function edgesPass({ normalTexture, depthTexture, near, far, res, ink, seed = 'boil' }) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tNormal: { value: normalTexture },
      tDepth: { value: depthTexture },
      uNear: { value: near },
      uFar: { value: far },
      uRes: { value: res.clone() },
      uInk: { value: new THREE.Vector3(...srgbVec(ink)) },
      uBoil: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tNormal;
      uniform sampler2D tDepth;
      uniform vec2 uRes;
      uniform vec3 uInk;
      uniform vec3 uBoil; // xy: global jitter (px), z: noise seed
      varying vec2 vUv;
      ${LINEAR_DEPTH}
      ${HASH}
      float invD(vec2 uv) { return 1.0 / linDepth(texture2D(tDepth, uv).x); }
      vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; }
      float hullInk(vec2 uv) { return step(texture2D(tNormal, uv).a, 0.5); }
      void main() {
        vec2 px = 1.0 / uRes;
        vec2 p = vUv * uRes;
        vec2 jit = uBoil.xy + (vec2(vnoise(p / 9.0 + uBoil.z), vnoise(p / 9.0 - uBoil.z * 1.7)) - 0.5) * 1.2 * 0.5;
        vec2 uv = vUv + jit * px;
        float d = linDepth(texture2D(tDepth, uv).x);
        float w = mix(3.0, 1.0, smoothstep(3.0, 40.0, d));
        vec2 o = px * w * 0.5;
        float c = invD(uv);
        float l = invD(uv - vec2(o.x, 0.0)), r = invD(uv + vec2(o.x, 0.0));
        float b = invD(uv - vec2(0.0, o.y)), t = invD(uv + vec2(0.0, o.y));
        float lap = abs(l + r + b + t - 4.0 * c) / max(c, 1e-6);
        float edgeD = smoothstep(0.08, 0.16, lap);
        vec3 nl = nrm(uv - vec2(o.x, 0.0)), nr = nrm(uv + vec2(o.x, 0.0));
        vec3 nb = nrm(uv - vec2(0.0, o.y)), nt = nrm(uv + vec2(0.0, o.y));
        vec3 tl = nrm(uv + vec2(-o.x, o.y)), tr = nrm(uv + o), bl = nrm(uv - o), br = nrm(uv + vec2(o.x, -o.y));
        vec3 gx = (tr + 2.0 * nr + br) - (tl + 2.0 * nl + bl);
        vec3 gy = (tl + 2.0 * nt + tr) - (bl + 2.0 * nb + br);
        float g = sqrt(dot(gx, gx) + dot(gy, gy));
        float edgeN = smoothstep(0.9, 1.4, g);
        float hull = hullInk(uv);
        float e = max(max(edgeD, edgeN), hull);
        vec4 col = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(mix(col.rgb, uInk, e), 1.0);
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
