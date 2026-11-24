import * as THREE from 'three';

// STYLE: 3-step ramp 1.0 / 0.62 / 0.35 of base, nearest filtered.
export const RAMP = [0.35, 0.62, 1.0];

let gradient = null;
export function gradientMap() {
  if (gradient) return gradient;
  const data = new Uint8Array(RAMP.length * 4);
  RAMP.forEach((v, i) => {
    const b = Math.round(v * 255);
    data.set([b, b, b, 255], i * 4);
  });
  gradient = new THREE.DataTexture(data, RAMP.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.colorSpace = THREE.NoColorSpace;
  gradient.needsUpdate = true;
  return gradient;
}

// Toon material whose shadow bands shift toward `shadowTo` (a THREE.Color), never grey or black.
export function toonMaterial(color, shadowTo, opts = {}) {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
  const tint = new THREE.Color(shadowTo);
  const lum = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b || 1;
  const tintVec = new THREE.Vector3(tint.r / lum, tint.g / lum, tint.b / lum);
  mat.userData.shadowTint = tintVec;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = { value: tintVec };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uShadowTint;')
      .replace(
        '#include <opaque_fragment>',
        `{
          float lb = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) + 1e-4;
          float lo = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          float shade = clamp(lo / lb, 0.0, 1.0);
          float s = 1.0 - smoothstep(0.35, 1.0, shade);
          vec3 tinted = outgoingLight * mix(vec3(1.0), uShadowTint, 0.85);
          outgoingLight = mix(outgoingLight, tinted, s);
        }
        #include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => 'inktime-toon';
  return mat;
}
