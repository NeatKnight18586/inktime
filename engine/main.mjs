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
import { shotAt, totalFrames, cameraPose } from './rig/camera.mjs';
import { makeShotCam } from './rig/shotcam.mjs';
import { transitionPass, transitionAt } from './post/transitions.mjs';
import { makeBreath } from './rig/breath.mjs';
import { makeCard } from './rig/card.mjs';
import { makeTick } from './cast/tick.mjs';
import { makeSfx } from './sfxwords.mjs';
import { makeHands, breathLag } from './rig/hands3d.mjs';
import { heldObjectCamera, HELD } from './rig/presets.mjs';
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
// Real shadows only from the invisible character shadow proxies (engine/rig/card.mjs); everything else casts none.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

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
  const keyLight = built.keyLight ?? null;
  // The guide (Tick) is a card too, but it never casts a lamp shadow: its shadow is a decal on the nearest surface.
  for (const c of spec.cards ?? []) cards.push(c.cast === 'guide' ? await makeTick(scene, c, anchors, palette, { tint, seed: spec.seed, frames: spec.frames, countdown: spec.countdown ?? null }) : await makeCard(scene, c, anchors, palette, { tint, seed: spec.seed, frames: spec.frames, keyLight }));
  // Surfaces the shadow proxy can fall on (toon solids) receive its shadow.
  if (cards.length && keyLight) scene.traverse((o) => { if (o.isMesh && o.layers.isEnabled(LAYERS.SOLID) && !o.userData.isHull) o.receiveShadow = true; });

  const camera = new THREE.PerspectiveCamera(72, W / H, NEAR, FAR);
  scene.add(camera);
  const poses = await (await fetch('/cast/hands/poses.json')).json();
  const hands = await makeHands(camera, tint, palette, poses);
  const breath = makeBreath(camera, palette, tint);
  // Held object (a brass padlock): lifted to HELD.forward m in front of the eye and HELD.down m below it, in camera space,
  // moving with the hands. Shown only in shots whose camera names an object.
  const heldObj = new THREE.Group();
  heldObj.name = 'held_padlock';
  const brass = new THREE.MeshBasicMaterial({ color: palette.color('lamp').multiply(tint), fog: false });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.035), brass);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), brass);
  shackle.position.y = 0.0425;
  heldObj.add(body, shackle);
  heldObj.visible = false;
  camera.add(heldObj);
  addHulls(heldObj);
  const sfx = await makeSfx(scene, spec.sfx ?? [], anchors, { seed: spec.seed, held: { padlock: heldObj } });
  const shotCam = makeShotCam({ spec, anchors, kit: built, camera, fps: spec.fps ?? 24 });

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
  const trans = transitionPass({ res, ink: palette.json.ink, seed: `${spec.seed}:transition` });
  composer.addPass(trans);
  const showable = new Set((spec.shots ?? []).flatMap((s) => s.show ?? []));

  Object.assign(state, { sfx, heldObj, kit: built, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes: { misreg, edges, panini, grain, trans }, breath, shotCam, palette, showable });
  return { frames: spec.frames, anchors: Object.keys(anchors) };
}

async function renderFrame(n) {
  const { sfx, kit, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes, palette, showable, breath, shotCam, heldObj } = state;
  if (!spec) throw new Error('renderFrame before load');
  const fps = spec.fps ?? 24;
  const shot = shotAt(spec, n);
  // Set state (ship travel, sway) first so anchors are current, then pose the camera, then camera-dependent state.
  kit.update?.(n, { fps, shot });
  scene.updateMatrixWorld(true);
  const view = shotCam.pose(n);
  passes.misreg.uniforms.uStreak.value.set(...(view.streak ?? [0, 0]));
  passes.panini.setCamera(camera, view.panini);
  for (const name of showable) if (anchors[name]) anchors[name].visible = shot.show.includes(name);
  for (const c of cards) c.update(n, camera);
  breath.update(n, view.rest ?? true, fps);
  // Transitions (blink, sting, match) and the whip smear frame are drawn last, in ink.
  const tr = transitionAt(spec.transitions, n);
  if (tr?.type === 'match' && anchors[tr.anchor]) {
    const q = anchors[tr.anchor].getWorldPosition(new THREE.Vector3()).project(camera);
    tr.centre = [(q.x + 1) / 2, (q.y + 1) / 2];
  }
  passes.trans.setState(tr, view.smear ? { streak: view.streak } : null);
  kit.update?.(n, { camera, fps, shot });
  hands.update(n, n - shot.start, (f) => shotAt(spec, f).hands ?? null, fps, view.lean ?? 1);
  heldObj.visible = !!shot.camera?.object;
  if (heldObj.visible) {
    const m = n - shot.start;
    const bob = 0.003 * Math.sin(Math.floor(m / 2) * 0.52) + 0.0015 * Math.sin(Math.floor(m / 2) * 1.31);
    const p = heldObjectCamera(-HELD.tilt);
    heldObj.position.set(0.05, p[1] + bob + breathLag(m - (m % 2), fps).lift, p[2]);
    heldObj.rotation.set(0.25, -0.5, 0.15);
  }
  sfx.update(n, camera, shot);
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
  // Cards are solid occluders in the line layer: cutout depth + normals, so nothing behind a body shows through its ink.
  for (const c of cards) c.prepass(true);
  sfx.prepass(true);
  camera.layers.set(LAYERS.CARD_BODY);
  renderer.render(scene, camera);
  for (const c of cards) c.prepass(false);
  sfx.prepass(false);
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
  return { n, shot: shot.index, preset: view.preset ?? null, ...cameraPose(camera) };
}

window.inktime = {
  load,
  get frameCount() {
    return state.spec?.frames ?? 0;
  },
  renderFrame,
};
