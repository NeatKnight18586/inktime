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
import { cameraPose } from './rig/camera.mjs';
import { transitionPass, stampTexture } from './post/transitions.mjs';
import { makeBreath } from './rig/breath.mjs';
import { makeCard } from './rig/card.mjs';
import { makeTick } from './cast/tick.mjs';
import { makeSfx } from './sfxwords.mjs';
import { makeHands, breathLag } from './rig/hands3d.mjs';
import { heldObjectCamera, HELD } from './rig/presets.mjs';
import { installHaze, hazeColorHex } from './look/haze.mjs';
import { bakeCorners } from './look/paint.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';
import { padlock as padlockProp } from '../kits/props/props.mjs';
import { makeSprites } from './kits/sprites.mjs';

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
const state = { plan: null, spec: null, scene: null, camera: null, anchors: null, cards: [], composer: null, passes: null, normalRT: null };

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

// load(planPath): a baked plan (tools/bake.mjs). Static parts (set, cards, sound words) build the scene; renderFrame applies plan[n] only.
async function load(scenePath) {
  const res0 = await fetch(scenePath);
  if (!res0.ok) throw new Error(`plan ${scenePath}: ${res0.status}`);
  const doc = await res0.json();
  const plan = doc.plan;
  const spec = { name: doc.name, seed: doc.seed, look: doc.look, set: doc.set, fps: doc.fps, cards: doc.cards, sfx: doc.sfx, countdown: doc.countdown, frames: doc.frames };
  const palette = await loadLook(spec.look);
  const scene = new THREE.Scene();
  scene.userData.palette = palette;
  const look = palette.json;
  const hazeHex = hazeColorHex(look);
  // Depth haze: 3 bands (0 / 30 / 60%), band edges at haze.near and haze.far.
  scene.fog = new THREE.Fog(new THREE.Color(hazeHex), look.haze.near, look.haze.far);
  const kit = await import(`/kits/sets/${spec.set}.mjs`);
  const built = kit.build(scene, rng(hashSeed(`${spec.seed}:set`)));
  const anchors = built.anchors;
  await built.ready; // lettering on props (stencils, tags, cards) is drawn before the first frame
  addHulls(scene);
  bakeCorners(scene);
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
  // Held object: the real 6 cm brass padlock (kits/props/props.mjs), lifted to HELD.forward m in front of the eye and HELD.down m
  // below it, in camera space, moving with the hands. Shown only in shots whose camera names an object.
  const heldObj = padlockProp(palette).group;
  heldObj.name = 'held_padlock';
  heldObj.visible = false;
  camera.add(heldObj);
  addHulls(heldObj);
  const sfx = await makeSfx(scene, spec.sfx ?? [], anchors, { seed: spec.seed, held: { padlock: heldObj } });

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
  const showable = new Set(doc.showable ?? []);
  const sprites = makeSprites(camera, palette, [...new Set(plan.flatMap((e) => (e?.sprites ?? []).map((s) => s.name)))], tint);
  await sprites.ready;
  // Date stamp cards of the jumps (hand-lettered), made once per text.
  const stamps = {};
  for (const e of plan) if (e?.stamp && !stamps[e.stamp.text]) stamps[e.stamp.text] = await stampTexture(e.stamp.text, { ink: palette.json.ink, paper: palette.json.paper, seed: spec.seed });

  Object.assign(state, { plan, sfx, heldObj, kit: built, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes: { misreg, edges, panini, grain, trans }, breath, palette, showable, stamps, sprites });
  return { frames: spec.frames, anchors: Object.keys(anchors) };
}

async function renderFrame(n) {
  const { plan, sfx, kit, hands, spec, scene, camera, anchors, cards, composer, normalRT, passes, palette, showable, breath, heldObj, stamps, sprites } = state;
  if (!spec) throw new Error('renderFrame before load');
  const e = plan[n];
  if (!e) throw new Error(`no plan entry for frame ${n}`);
  const fps = spec.fps ?? 24;
  const shot = { index: e.shot, show: e.show, sea: e.sea ?? null };
  // World state (ship travel, sway) derives from n; everything else is the baked plan entry.
  kit.update?.(n, { fps, shot });
  scene.updateMatrixWorld(true);
  const c = e.cam;
  camera.position.set(...c.pos);
  camera.quaternion.set(...c.quat);
  if (camera.fov !== c.fov) {
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  passes.misreg.uniforms.uStreak.value.set(...(c.streak ?? [0, 0]));
  passes.panini.setCamera(camera, c.panini > 0, c.panini);
  for (const name of showable) if (anchors[name]) anchors[name].visible = e.show.includes(name);
  // Light state (engine/look/lightstate.mjs, baked as e.fx): berg scale and the crest light's fade-in. The world yaw is in e.cam.
  for (const k of ['iceberg_dark', 'iceberg_rim']) anchors[k]?.scale.setScalar(e.fx?.bergScale ?? 1);
  const glow = anchors.iceberg_glow;
  if (glow?.isLight) {
    glow.userData.base ??= glow.intensity;
    glow.intensity = glow.userData.base * (e.fx ? e.fx.glow : 1);
  }
  cards.forEach((card, i) => card.update(n, camera, e.cards[i]));
  breath.update(n, e.breath ?? null);
  sprites.update(e.sprites ?? []);
  // Transitions (blink, sting, match) and the whip smear frame are drawn last, in ink.
  const tr = e.tr && e.tr.type !== 'smear' ? e.tr : null;
  passes.trans.setState(tr, e.tr?.smear ? { streak: e.tr.smear } : null);
  passes.trans.setStamp(e.stamp ? stamps[e.stamp.text] : null, e.stamp);
  kit.update?.(n, { camera, fps, shot });
  hands.apply(e.hands, e.m, fps, c.lean, e.hands?.cur);
  heldObj.visible = !!e.held;
  if (heldObj.visible) {
    const m = e.m;
    const bob = 0.003 * Math.sin(Math.floor(m / 2) * 0.52) + 0.0015 * Math.sin(Math.floor(m / 2) * 1.31);
    const p = heldObjectCamera(-HELD.tilt);
    heldObj.position.set(0.05, p[1] + bob + breathLag(m - (m % 2), fps).lift, p[2]);
    heldObj.rotation.set(0.25, -0.5, 0.15);
  }
  sfx.update(n, camera, e.sfx);
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
  kit.prepass?.(true);
  sfx.prepass(true);
  camera.layers.set(LAYERS.CARD_BODY);
  renderer.render(scene, camera);
  for (const c of cards) c.prepass(false);
  kit.prepass?.(false);
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
  return { n, shot: e.shot, preset: e.preset, ...cameraPose(camera) };
}

// Hands skin/cuff test (CI stills job, tools/handtest.mjs): every hand pose rendered alone in flat ID colours (skin red, cuff green,
// phone blue, no ink hull) at vFOV 90; returns per pose the skin and cuff shares of the hand's pixel area (the phone excluded).
async function handTest() {
  const palette = await loadLook('titanic_night');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, W / H, NEAR, FAR);
  scene.add(camera);
  const poses = await (await fetch('/cast/hands/poses.json')).json();
  const hands = await makeHands(camera, new THREE.Color(1, 1, 1), palette, poses);
  const ids = { skin: new THREE.MeshBasicMaterial({ color: 0xff0000 }), cuff: new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide }), phone: new THREE.MeshBasicMaterial({ color: 0x0000ff }) };
  // The ID materials go on only for the test render (apply() sets the toon uniforms on the real materials).
  const swaps = [];
  hands.holder.traverse((o) => {
    if (!o.isMesh || o.userData.isHull) return;
    let kind = o.isSkinnedMesh ? 'skin' : 'phone';
    for (let p = o; p; p = p.parent) if (p.name === 'cuff') kind = 'cuff';
    swaps.push([o, o.material, ids[kind]]);
  });
  const hulls = [];
  hands.holder.traverse((o) => o.userData.isHull && hulls.push(o));
  const w = W / 4;
  const h = H / 4;
  const rt = new THREE.WebGLRenderTarget(w, h);
  const px = new Uint8Array(w * h * 4);
  const out = {};
  for (const name of Object.keys(poses)) {
    hands.apply({ name }, 0, 24, 1, name);
    camera.updateMatrixWorld(true);
    for (const [o, , id] of swaps) o.material = id;
    for (const o of hulls) o.visible = false;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    for (const [o, real] of swaps) o.material = real;
    for (const o of hulls) o.visible = true;
    let skin = 0;
    let cuff = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] > 128 && px[i + 1] < 100) skin++;
      else if (px[i + 1] > 128 && px[i] < 100) cuff++;
    }
    const all = skin + cuff;
    out[name] = { skin: all ? skin / all : 0, cuff: all ? cuff / all : 0, pixels: all };
  }
  renderer.setRenderTarget(null);
  rt.dispose();
  return out;
}

window.inktime = {
  load,
  handTest,
  get frameCount() {
    return state.spec?.frames ?? 0;
  },
  renderFrame,
};
