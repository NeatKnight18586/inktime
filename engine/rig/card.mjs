import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';
import { rng, hashSeed } from '../../tools/rng.mjs';

export const CARD_HEIGHT = 1.75;

async function svgTextureFromText(text, scale = 6) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth * scale;
  canvas.height = img.naturalHeight * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: canvas.width / canvas.height };
}

// Seeded blinks: closed 2-3 frames, every 2-4 s.
export function blinkFrames(seed, frames, fps = 24) {
  const r = rng(hashSeed(`${seed}:blink`));
  const closed = new Set();
  let f = Math.round((1 + r() * 2) * fps);
  while (f < frames) {
    const len = r() < 0.5 ? 2 : 3;
    for (let i = 0; i < len; i++) closed.add(f + i);
    f += Math.round((2 + r() * 2) * fps);
  }
  return closed;
}

// 2D character card in 3D: yaw-only billboard, flat ellipse contact shadow, multiplied by the scene tint.
// The SVG holds <g id="eyes-open"> and <g id="eyes-closed" display="none"> for blinks.
export async function makeCard(scene, spec, anchors, palette, { tint, seed = 'card', frames = 10000 } = {}) {
  const anchor = anchors[spec.anchor];
  if (!anchor) throw new Error(`card anchor "${spec.anchor}" missing`);
  const res = await fetch(`/cast/${spec.cast}/${spec.pose ?? 'idle'}.svg`);
  const text = await res.text();
  const open = await svgTextureFromText(text);
  const closedText = text
    .replace('id="eyes-open"', 'id="eyes-open" display="none"')
    .replace('id="eyes-closed" display="none"', 'id="eyes-closed"');
  const closed = await svgTextureFromText(closedText);
  const h = spec.height ?? CARD_HEIGHT;
  const aspect = open.aspect;
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  geo.translate(0, h / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ map: open.tex, color: tint ?? 0xffffff, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
  // Dark nest (spec.light "nest"): the card takes the nest's dark tint and only its lit features (cap brim, shoulder, scarf)
  // catch light. The sidecar <pose>.nest.json lists them in card units; shadowBias shifts the lit/shadow terminator
  // (+ = more of the card in shadow, as for materials), so -0.4 leaves only the features on the lit edge.
  if (spec.light === 'nest') {
    const nest = await (await fetch(`/cast/${spec.cast}/${spec.pose ?? 'idle'}.nest.json`)).json();
    const rects = nest.lit.map((r) => new THREE.Vector4(...r));
    while (rects.length < 3) rects.push(new THREE.Vector4(0, 0, 0, 0));
    const u = nest.terminator + 0.3 * (nest.shadowBias + 0.4);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNestDark = { value: new THREE.Vector3(...nest.dark) };
      shader.uniforms.uNestLit = { value: nest.litGain };
      shader.uniforms.uNestTerm = { value: u };
      shader.uniforms.uNestSize = { value: new THREE.Vector2(...nest.size) };
      shader.uniforms.uNestRect = { value: rects };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uNestDark; uniform float uNestLit; uniform float uNestTerm; uniform vec2 uNestSize; uniform vec4 uNestRect[3];')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  vec2 cu = vec2( vMapUv.x * uNestSize.x, ( 1.0 - vMapUv.y ) * uNestSize.y );
  float lit = 0.0;
  for ( int i = 0; i < 3; i++ ) {
    vec4 r = uNestRect[i];
    float x0 = max( r.x, uNestTerm * uNestSize.x );
    if ( cu.x >= x0 && cu.x <= r.y && cu.y >= r.z && cu.y <= r.w ) lit = 1.0;
  }
  diffuseColor.rgb *= lit > 0.5 ? vec3( uNestLit ) : uNestDark;
}`
        );
    };
    mat.customProgramCacheKey = () => 'inktime-card-nest';
  }
  const card = new THREE.Mesh(geo, mat);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 40),
    new THREE.MeshBasicMaterial({ color: palette.ink, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(h * aspect * 0.7, 0.42, 1);
  shadow.position.y = 0.006;
  const group = new THREE.Group();
  group.name = `card:${spec.cast}`;
  group.add(shadow, card);
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(group.position);
  setLayer(group, LAYERS.CARD);
  scene.add(group);
  const base = new THREE.Vector3();
  const blinks = spec.blink === false ? new Set() : blinkFrames(`${seed}:${spec.cast}`, frames);
  return {
    group,
    blinks,
    // Pose state on twos; blinks by frame; billboard follows the camera on ones (yaw only).
    update(n, camera) {
      const k = Math.floor(n / 2);
      card.scale.y = 1 + 0.006 * Math.sin(k * 0.35);
      const tex = blinks.has(n) ? closed.tex : open.tex;
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
      // Follow the anchor (it may ride a moving ship).
      anchor.updateWorldMatrix(true, false);
      anchor.getWorldPosition(base);
      group.position.copy(base);
      const dx = camera.position.x - base.x;
      const dz = camera.position.z - base.z;
      card.rotation.y = Math.atan2(dx, dz);
    },
  };
}
