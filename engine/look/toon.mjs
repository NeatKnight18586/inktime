import * as THREE from 'three';
import { paintTexture, PAINT_SCALE } from './paint.mjs';

// STYLE ramp, 3 steps: shadow = base x 0.55 tinted toward navy, mid = base, lit = base mixed 40% toward the light colour.
// The light level comes from the summed irradiance; each light reaches a surface in hard steps (N.L and pools).
// Spot blacks (comic rule): darkest-step surfaces that face away from every lamp render as solid ink.
export const RAMP = [0.55, 1.0, 1.4];
export const DEFAULT_RAMP = { shadow: 0.55, shadowTint: 0.5, litMix: 0.4, t1: 0.1, t2: 0.3 };

const lightsPars = THREE.ShaderChunk.lights_pars_begin.replace(
  'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );',
  'light.color *= inkPool( lightDistance, pointLight.distance );'
);
const POOL = /* glsl */ `
// Toon falloff: 3 hard-edged pools.
float inkPool( const in float d, const in float range ) {
  if ( range <= 0.0 ) return 1.0;
  float x = d / range;
  return x < 0.34 ? 1.0 : ( x < 0.67 ? 0.55 : ( x < 1.0 ? 0.25 : 0.0 ) );
}
`;
const toonPars = /* glsl */ `
varying vec3 vViewPosition;
struct ToonMaterial { vec3 diffuseColor; };
float inkLampFacing = 0.0; // 1 when any lamp inside its range faces this surface
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float d = dot( geometryNormal, directLight.direction );
  float w = d < -0.2 ? 0.0 : ( d < 0.3 ? 0.5 : 1.0 );
  if ( d > 0.0 && max( directLight.color.r, max( directLight.color.g, directLight.color.b ) ) > 0.0 ) inkLampFacing = 1.0;
  reflectedLight.directDiffuse += w * directLight.color;
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance;
}
#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

// Toon material for palette colour `color`; shadows tint toward `shadowTo`. opts.paint picks a painted texture.
export function toonMaterial(color, shadowTo, opts = {}) {
  const { paint, ramp = DEFAULT_RAMP, ...rest } = opts;
  const mat = new THREE.MeshToonMaterial({ color, ...rest });
  const tint = new THREE.Color(shadowTo);
  const lum = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b || 1;
  const tintVec = new THREE.Vector3(tint.r / lum, tint.g / lum, tint.b / lum);
  const tex = paint ? paintTexture(paint) : null;
  const uniforms = {
    uShadowTint: { value: tintVec },
    uRamp: { value: new THREE.Vector4(ramp.shadow, ramp.shadowTint, ramp.litMix, 0) },
    uThresh: { value: new THREE.Vector2(ramp.t1, ramp.t2) },
    uInkCol: { value: new THREE.Color(ramp.ink ?? '#141414') },
    uPaint: { value: tex },
    uPaintScale: { value: paint ? PAINT_SCALE[paint] : 1 },
  };
  mat.userData.inkUniforms = uniforms;
  mat.userData.paint = paint ?? null;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (tex) shader.defines = { ...(shader.defines ?? {}), INK_PAINT: '' };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aBoxMin;
attribute vec3 aBoxMax;
varying vec3 vInkWPos;
varying vec3 vInkWNrm;
varying vec3 vInkLocal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 iwp = vec4( transformed, 1.0 );
  vec3 iwn = objectNormal;
  #ifdef USE_INSTANCING
  iwp = instanceMatrix * iwp;
  iwn = mat3( instanceMatrix ) * iwn;
  #endif
  vInkWPos = ( modelMatrix * iwp ).xyz;
  vInkWNrm = normalize( mat3( modelMatrix ) * iwn );
  vInkLocal = ( position - aBoxMin ) / max( aBoxMax - aBoxMin, vec3( 1e-4 ) );
}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uShadowTint;
uniform vec4 uRamp;
uniform vec2 uThresh;
uniform vec3 uInkCol;
uniform sampler2D uPaint;
uniform float uPaintScale;
varying vec3 vInkWPos;
varying vec3 vInkWNrm;
varying vec3 vInkLocal;`
      )
      .replace('#include <lights_pars_begin>', POOL + lightsPars)
      .replace('#include <lights_toon_pars_fragment>', toonPars)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef INK_PAINT
{
  vec3 an = abs( vInkWNrm );
  vec2 puv = ( an.x > an.y && an.x > an.z ) ? vInkWPos.zy : ( an.y > an.z ? vInkWPos.xz : vInkWPos.xy );
  diffuseColor.rgb *= texture2D( uPaint, puv / uPaintScale ).rgb;
}
#endif
{
  // Corner darkening: one darker band where two box faces meet.
  vec3 q = clamp( vInkLocal, 0.0, 1.0 );
  vec3 e = step( q, vec3( 0.06 ) ) + step( vec3( 0.94 ), q );
  float n = e.x + e.y + e.z;
  diffuseColor.rgb *= n >= 2.0 ? 0.8 : 1.0;
}`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 E = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float e = dot( E, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 lc = E / max( max( E.r, max( E.g, E.b ) ), 1e-4 );
  vec3 base = diffuseColor.rgb;
  vec3 shadow = base * uRamp.x * mix( vec3( 1.0 ), uShadowTint, uRamp.y );
  shadow = max( shadow, base * 0.3 );
  vec3 lit = mix( base, lc, uRamp.z );
  vec3 dark = inkLampFacing < 0.5 ? uInkCol : shadow;
  outgoingLight = ( e < uThresh.x ? dark : ( e < uThresh.y ? base : lit ) ) + totalEmissiveRadiance;
}
#include <opaque_fragment>`
      );
  };
  mat.customProgramCacheKey = () => `inktime-toon3-${tex ? paint : 'flat'}`;
  return mat;
}
