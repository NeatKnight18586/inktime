import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadLook } from './look/palette.mjs';
import { addHulls, hullUniforms } from './look/hull.mjs';
import { LAYERS, COLOUR_LAYERS } from './look/layers.mjs';
import { misregPass } from './post/misreg.mjs';
import { edgesPass } from './post/edges.mjs';
import { grainPass } from './post/grain.mjs';
import { paniniPass } from './post/panini.mjs';
import { poseCamera, shotAt, totalFrames, cameraPose } from './rig/camera.mjs';
import { makeCard } from './rig/card.mjs';
import { makeHands } from './rig/hands.mjs';
import { installHaze, hazeColorHex } from './look/haze.mjs';
import { bakeCorners } from './look/paint.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';

const W = 1080;
const H = 1920;
const NEAR = 0.05;
const FAR = 9000;

const canvas = document.getElementById('view');
canvas.width = W;
canvas.height = H;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!gl) throw new Error('WebGL2 unavailable');

const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

installHaze();
const res = new THREE.Vector2(W, H);
const normalMat = new THREE.MeshNormalMaterial();
const state = { spec: null, scene: null, camera: null, anchors: null, cards: [], composer: null, passes: null, normalRT: null };

async function gpuDone() {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  for (;;) {
    const s = gl.clientWaitSync(sync, 0, 0);
    if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED) break;
    await new Promise((r) => setTimeout(r, 1));
  }
  gl.deleteSync(sync);
}

async function load(scenePath) {
  const res0 = await fetch(scenePath);
  if (!res0.ok) throw new Error(`scene ${scenePath}: ${res0.status}`);
  const spec = await res0.json();
  const palette = await loadLook(spec.look);
  const scene = new THREE.Scene();
  scene.userData.palette = palette;
  const look = palette.json;
  const hazeHex = hazeColorHex(look);
  // Depth haze: 3 bands (0 / 30 / 60%), band edges at haze.near and haze.far.
  scene.fog = new THREE.Fog(new THREE.Color(hazeHex), look.haze.near, look.haze.far);
  const kit = await import(`/kits/sets/${spec.set}.mjs`);
  const built = kit.build(scene, rng(hashSeed(`${spec.seed ?? spec.name}:set`)));
  const anchors = built.anchors;
  addHulls(scene);
  bakeCorners(scene);
  spec.frames = totalFrames(spec);
  // Scene tint: cards and hands are multiplied by it.
  const tint = new THREE.Color(1, 1, 1).lerp(palette.color(look.tint.color), look.tint.mix).multiplyScalar(look.tint.value);
  const cards = [];
  for (const c of spec.cards ?? []) cards.push(await makeCard(scene, c, anchors, palette, { tint, seed: spec.seed, frames: spec.frames }));

  const camera = new THREE.PerspectiveCamera(72, W / H, NEAR, FAR);
  scene.add(camera);
  const hands = await makeHands(camera, tint, undefined, { key: palette.color(look.light.key), rim: palette.color(look.light.fill) });

  state.normalRT?.dispose();
  const normalRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
  normalRT.depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  const misreg = misregPass({ depthTexture: normalRT.depthTexture, near: NEAR, far: FAR, res });
  const edges = edgesPass({ normalTexture: normalRT.texture, depthTexture: normalRT.depthTexture, near: NEAR, far: FAR, res, ink: palette.json.ink, haze: { color: hazeHex, near: look.haze.near, far: look.haze.far, bands: look.haze.bands }, seed: `${spec.seed}:boil` });
  const panini = paniniPass();
  const grain = grainPass({ res, paper: palette.json.paper, seed: `${spec.seed}:grain` });
  composer.addPass(misreg);
  composer.addPass(edges);
  composer.addPass(panini);
  composer.addPass(grain);
  const showable = new Set((spec.shots ?? []).flatMap((s) => s.show ?? []));

  Object.assign(state, { kit: built, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes: { misreg, edges, panini, grain }, palette, showable });
  return { frames: spec.frames, anchors: Object.keys(anchors) };
}

async function renderFrame(n) {
  const { kit, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes, palette, showable } = state;
  if (!spec) throw new Error('renderFrame before load');
  const fps = spec.fps ?? 24;
  const shot = shotAt(spec, n);
  // Set state (ship travel, sway) first so anchors are current, then pose the camera, then camera-dependent state.
  kit.update?.(n, { fps, shot });
  scene.updateMatrixWorld(true);
  const view = poseCamera(camera, shot.camera, anchors, n - shot.start, fps, shot.frames);
  passes.panini.setCamera(camera, view.panini);
  for (const name of showable) if (anchors[name]) anchors[name].visible = shot.show.includes(name);
  for (const c of cards) c.update(n, camera);
  kit.update?.(n, { camera, fps, shot });
  hands.update(n, shot.hands ?? null);
  hullUniforms.uBoil.value = (Math.floor(n / 2) * 0.6180339) % 1 * 100;
  hullUniforms.uRes.value.copy(res);
  hullUniforms.uFocal.value = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
  passes.edges.setFrame(n);
  passes.grain.setFrame(n);
  scene.updateMatrixWorld(true);

  // Line layer: normals + depth for solids, then hull ink marks (alpha 0) on top.
  renderer.setRenderTarget(normalRT);
  renderer.setClearColor(0x8080ff, 1);
  renderer.clear(true, true, true);
  const fog = scene.fog;
  scene.fog = null;
  scene.overrideMaterial = normalMat;
  camera.layers.set(LAYERS.SOLID);
  renderer.autoClear = false;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  camera.layers.set(LAYERS.HULL);
  renderer.render(scene, camera);
  renderer.autoClear = true;
  scene.fog = fog;

  // Colour layer -> misreg -> edges -> grain.
  camera.layers.disableAll();
  for (const l of COLOUR_LAYERS) camera.layers.enable(l);
  renderer.setRenderTarget(null);
  renderer.setClearColor(palette.fog, 1);
  composer.render();
  await gpuDone();
  return { n, shot: shot.index, ...cameraPose(camera) };
}

window.inktime = {
  load,
  get frameCount() {
    return state.spec?.frames ?? 0;
  },
  renderFrame,
};
