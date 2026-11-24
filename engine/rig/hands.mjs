import * as THREE from 'three';
import { LAYERS } from '../look/layers.mjs';

// "You" hands, XIII style: SVG drawn on a camera-space quad in the bottom-right of the frame,
// multiplied by the scene tint. Animated on twos. Phase 2 extends this file.
export const HAND_POSES = ['rail_grip', 'padlock_hold'];
export const HAND_FRAME = { width: 0.33, bleedX: 0.03, bleedY: 0.02, z: 0.3 };

async function svgTexture(url, scale = 2) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: canvas.width / canvas.height };
}

// Hand light (until the 3D hands of Fix 1b.3): a warm amber key from below and a cool ice rim on the upper edge.
// key/rim are palette colours (lamp, ice). The quad is lit in its own shader: uv.y 0 = bottom.
export const HAND_LIGHT = { keyMix: 0.55, keyFall: 0.75, topDim: 0.62, rimPx: 0.02, rimMix: 0.9 };

export async function makeHands(camera, tint, poses = HAND_POSES, light = null) {
  const textures = {};
  for (const p of poses) textures[p] = await svgTexture(`/cast/hands/${p}.svg`);
  const mat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, alphaTest: 0.5, depthTest: false, depthWrite: false, fog: false });
  if (light) {
    const H = HAND_LIGHT;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uKey = { value: new THREE.Color(light.key) };
      shader.uniforms.uRim = { value: new THREE.Color(light.rim) };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uKey;\nuniform vec3 uRim;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
#ifdef USE_MAP
{
  float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  float below = 1.0 - smoothstep( 0.0, ${H.keyFall.toFixed(2)}, vMapUv.y );
  // Key from below: surfaces warm toward amber at the bottom of the hand and dim toward the top. Ink stays ink.
  vec3 lit = mix( diffuseColor.rgb * ${H.topDim.toFixed(2)}, mix( diffuseColor.rgb, diffuseColor.rgb * uKey * 1.6, ${H.keyMix.toFixed(2)} ), below );
  // Rim: pixels whose neighbour straight above is empty paper get the ice rim (not on ink outlines).
  float aboveA = texture2D( map, vMapUv + vec2( 0.0, ${H.rimPx.toFixed(3)} ) ).a;
  float rim = ( aboveA < 0.5 && lum > 0.25 ) ? ${H.rimMix.toFixed(2)} : 0.0;
  diffuseColor.rgb = mix( lit, uRim, rim );
}
#endif`
        );
    };
    mat.customProgramCacheKey = () => "inktime-hands-lit";
  }
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.name = 'hands';
  quad.renderOrder = 1000;
  quad.frustumCulled = false;
  quad.layers.set(LAYERS.CARD);
  quad.visible = false;
  camera.add(quad);
  return {
    quad,
    // pose: name or null. Size follows the current FOV so the hand keeps its place in frame.
    update(n, pose) {
      if (!pose) {
        quad.visible = false;
        return;
      }
      const t = textures[pose];
      if (!t) throw new Error(`hands pose "${pose}" not loaded`);
      quad.visible = true;
      if (mat.map !== t.tex) {
        mat.map = t.tex;
        mat.needsUpdate = true;
      }
      const z = HAND_FRAME.z;
      const fh = 2 * z * Math.tan((camera.fov * Math.PI) / 360);
      const fw = fh * camera.aspect;
      const qw = HAND_FRAME.width * fw;
      const qh = qw / t.aspect;
      const k = Math.floor(n / 2); // on twos
      const bob = 0.004 * fh * Math.sin(k * 0.52) + 0.002 * fh * Math.sin(k * 1.31);
      quad.scale.set(qw, qh, 1);
      quad.position.set(fw / 2 - qw / 2 + HAND_FRAME.bleedX * fw, -fh / 2 + qh / 2 - HAND_FRAME.bleedY * fh + bob, -z);
    },
  };
}
