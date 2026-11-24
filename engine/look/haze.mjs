import * as THREE from 'three';

// Depth haze in 3 hard bands (0 / 30 / 60%), steel-ice blend. Replaces three's fog chunk for every fogged material.
// Uses THREE.Fog: near = start of band 2, far = start of band 3 (horizon).
let installed = false;
export function installHaze() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float inkHaze = vFogDepth < fogNear ? 0.0 : (vFogDepth < fogFar ? 0.3 : 0.6);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, inkHaze );
#endif
`;
}

// Same banding in JS (for the ink pass and tests). Returns the haze amount 0..0.6.
export function hazeAmount(d, look) {
  const h = look.haze;
  return d < h.near ? h.bands[0] : d < h.far ? h.bands[1] : h.bands[2];
}

export function hazeColorHex(look) {
  const a = new THREE.Color(look.colors[look.haze.colors[0]]);
  const b = new THREE.Color(look.colors[look.haze.colors[1]]);
  return '#' + a.lerp(b, look.haze.iceMix).getHexString();
}
