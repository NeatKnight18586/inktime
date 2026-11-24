import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { LINEAR_DEPTH, VERT } from './common.mjs';

// STYLE: colour layer sits 1-2 px off the line layer, growing to 4 px with distance. Never blur.
export function misregPass({ depthTexture, near, far, res, angle = 0.62 }) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      uNear: { value: near },
      uFar: { value: far },
      uRes: { value: res.clone() },
      uDir: { value: new THREE.Vector2(Math.cos(angle), Math.sin(angle)) },
      uStreak: { value: new THREE.Vector2(0, 0) }, // px: speed streaks, a directional misregistration of the colour layer
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      uniform vec2 uRes;
      uniform vec2 uDir;
      uniform vec2 uStreak;
      varying vec2 vUv;
      ${LINEAR_DEPTH}
      void main() {
        float d = linDepth(texture2D(tDepth, vUv).x);
        float px = mix(1.5, 4.0, smoothstep(3.0, 300.0, d));
        vec2 uv = vUv + uDir * px / uRes;
        vec4 c = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));
        // Streaks: hard offset copies of the colour layer along the motion; the lightest wins (no blur).
        if (dot(uStreak, uStreak) > 0.25) {
          c = max(c, texture2D(tDiffuse, clamp(uv + uStreak * 0.5 / uRes, vec2(0.0), vec2(1.0))));
          c = max(c, texture2D(tDiffuse, clamp(uv + uStreak / uRes, vec2(0.0), vec2(1.0))));
        }
        gl_FragColor = c;
      }`,
  });
  // ShaderPass clones uniforms and drops render-target textures; bind after.
  pass.uniforms.tDepth.value = depthTexture;
  return pass;
}
