import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HASH, VERT, srgbVec } from './common.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

// STYLE: procedural paper grain, 5% multiply, re-seeded every 2 frames.
export function grainPass({ res, paper, seed = 'grain', amount = 0.05 }) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uRes: { value: res.clone() },
      uPaper: { value: new THREE.Vector3(...srgbVec(paper)) },
      uSeed: { value: 0 },
      uAmount: { value: amount },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uRes;
      uniform vec3 uPaper;
      uniform float uSeed;
      uniform float uAmount;
      varying vec2 vUv;
      ${HASH}
      void main() {
        vec2 p = vUv * uRes + uSeed * 37.0;
        float fine = hash12(floor(p));
        float tooth = vnoise(p / 3.0);
        float fibre = vnoise(vec2(p.x / 40.0, p.y / 2.5));
        float g = 0.55 * fine + 0.3 * tooth + 0.15 * fibre;
        vec3 sheet = uPaper * (0.85 + 0.3 * g);
        vec3 col = texture2D(tDiffuse, vUv).rgb;
        gl_FragColor = vec4(col * mix(vec3(1.0), clamp(sheet, 0.0, 1.0), uAmount), 1.0);
      }`,
  });
  pass.setFrame = (n) => {
    pass.uniforms.uSeed.value = rng(hashSeed(`${seed}:${Math.floor(n / 2)}`))() * 1000;
  };
  return pass;
}
