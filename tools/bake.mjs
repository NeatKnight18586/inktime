// Bake. Usage: node tools/bake.mjs <episodeDir>  ->  <episodeDir>/out/plan.json
// episode.json + audio/words.json -> one plan entry per frame. The engine's renderFrame(n) applies plan[n] only; tools/check.mjs
// judges the same plan. Deterministic: every value derives from the frame index and named seeds.
// Entry: { n, shot, preset, m, light, cam {pos, target, quat, yaw, pitch, roll, fov, panini, streak, smear, rest, lean}, tr, show,
//   hands {name, from?, w?, cur}|null, held, cards [per header card: stick {pose, mouth, blink, breath} | Tick {anchor, pose, name,
//   start, ring, blink}], sfx [{i, word, variant, anchor, scale, opacity, ...}], caption, g {gate facts} }.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { makePalette } from '../engine/look/palette.mjs';
import { shotAt, totalFrames } from '../engine/rig/camera.mjs';
import { makeShotCam } from '../engine/rig/shotcam.mjs';
import { transitionAt, jumpState, stampState, JUMP } from '../engine/post/transitions.mjs';
import { paniniStrength } from '../engine/post/panini.mjs';
import { HELD, heldObjectCamera } from '../engine/rig/presets.mjs';
import { handsPlan } from '../engine/rig/hands3d.mjs';
import { poseAt, mouthAt, breathAt, blinkFrames } from '../engine/cast/stickmath.mjs';
import { tickPoseAt, countdownAt, bobAt } from '../engine/cast/tick.mjs';
import { sfxState, pickVariant, sfxTilt, SIZE as SFX_SIZE } from '../engine/sfxwords.mjs';
import { splitCards } from './captions.mjs';
import { cardSpan, tickView, faceDisc, sfxBox, makeCam, toScreen, W, H } from './framing.mjs';
import { loadEpisode, compile, readJson } from './timeline.mjs';
import { rng, hashSeed } from './rng.mjs';
import { isSlot, slotPoint, slotOutward, tickSlotDistance, sfxSlotDistance, TICK_IDLE_WIDTH } from '../engine/rig/slots.mjs';
import { lightFx, LIGHT_STATES } from '../engine/look/lightstate.mjs';
import { wispFrames, placeWisp } from '../engine/rig/breath.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPath = (...p) => join(ROOT, ...p);
const DEG = 180 / Math.PI;
const HELD_ANCHORS = new Set(['padlock']); // anchors that a held shot turns into the hand-held object
export const NOT_POV = new Set(['dive', 'rise', 'witness']);

const handsAt = (spec, f) => {
  const h = shotAt(spec, f).hands;
  if (!h) return null;
  if (typeof h === 'string') return h;
  let pose = null;
  for (const e of h) if (e.at <= f) pose = e.pose;
  return pose;
};
const tickAnchorAt = (card, n) => {
  let a = card.anchor;
  for (const e of card.anchors ?? []) if (e.at <= n) a = e.anchor;
  return a;
};

// spec: the compiled scene spec (tools/timeline.mjs) or a legacy scene (tests/styleframes). range [a, b): only those frames are baked
// (the others are null), so one-frame stills stay cheap. words: words.json array (captions, narrator mouth).
export async function bakeSpec(spec, { words = [], range = null } = {}) {
  const fps = spec.fps ?? 24;
  const frames = totalFrames(spec);
  const [a, b] = range ?? [0, frames];
  const seed = spec.seed ?? spec.name;
  const look = readJson(rootPath('engine', 'looks', `${spec.look}.json`));
  const scene = new THREE.Scene();
  scene.userData.palette = makePalette(look, spec.look);
  const kitMod = await import(`../kits/sets/${spec.set}.mjs`);
  const kit = kitMod.build(scene, rng(hashSeed(`${seed}:set`)));
  const anchors = kit.anchors;
  const camera = new THREE.PerspectiveCamera(72, W / H, 0.05, 9000);
  scene.add(camera);
  const shotCam = makeShotCam({ spec, anchors, kit, camera, fps });
  const world = (name) => {
    const an = anchors[name];
    if (!an) throw new Error(`anchor "${name}" missing`);
    an.updateWorldMatrix(true, false);
    return an.getWorldPosition(new THREE.Vector3());
  };
  // Static card data.
  const cards = (spec.cards ?? []).map((c) => {
    const isGuide = c.cast === 'guide';
    const track = c.track ?? [{ at: 0, pose: c.pose ?? 'idle' }];
    const poses = readJson(rootPath('cast', c.cast, 'poses.json'));
    const cardSeed = seed;
    const blinks = c.blink === false ? new Set() : blinkFrames(isGuide ? `${cardSeed}:guide${c.anchor}${(c.offset ?? []).join(',')}` : `${cardSeed}:${c.cast}`, frames);
    return { c, isGuide, track, poses, blinks };
  });
  const sfxDefs = (spec.sfx ?? []).map((ev) => {
    const variant = pickVariant(seed, ev);
    const svg = readFileSync(rootPath('sfx-words', ev.word, `v${variant}.svg`), 'utf8');
    const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
    return { ev, variant, aspect: Number(w) / Number(h), tilt: sfxTilt(seed, ev) };
  });
  const capCards = words.length ? splitCards(words, { keys: spec.captionKeys ?? [] }) : [];
  const plan = new Array(frames).fill(null);
  // Light-state runs: consecutive shots sharing a light state (engine/look/lightstate.mjs) form one run [start, start + len).
  const runs = [];
  {
    const sh = spec.shots ?? [];
    const lightOf = (i) => sh[i].light ?? spec.light ?? 'night';
    let at = 0;
    sh.forEach((x, i) => {
      const light = lightOf(i);
      if (i && lightOf(i - 1) === light) runs.push(runs[i - 1]);
      else runs.push({ light, start: at, len: 0 });
      runs[i].len += x.frames;
      at += x.frames;
    });
  }
  const berg = ['iceberg_dark', 'iceberg_rim'].map((k) => anchors[k]).filter(Boolean);
  const frustum = new THREE.Frustum();
  const box = new THREE.Box3();
  const heldPos = (cam) => {
    const p = heldObjectCamera(-HELD.tilt);
    return new THREE.Vector3(0.05, p[1], p[2]).applyMatrix4(cam.matrixWorld);
  };

  for (let n = a; n < b; n++) {
    const shot0 = shotAt(spec, n);
    const shot = { ...shot0, sea: shot0.sea ?? spec.sea ?? null };
    const m = n - shot.start;
    const ne = n - (n % 2);
    // The renderer's order (engine/main.mjs): world state, pose the camera, then camera-dependent state.
    kit.update?.(n, { fps, shot });
    scene.updateMatrixWorld(true);
    const view = shotCam.pose(n);
    // Light state: crest light, berg scale and the world yaw (applied to the camera, so the berg slides right).
    const run = spec.shots ? runs[shot.index] : null;
    const fx = run && LIGHT_STATES[run.light] ? lightFx(run.light, n - run.start, run.len) : null;
    for (const o of berg) o.scale.setScalar(fx?.bergScale ?? 1);
    if (fx?.yaw) {
      camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fx.yaw / DEG));
      camera.updateMatrixWorld(true);
    }
    const tr = transitionAt(spec.transitions, n);
    if (tr?.type === 'match' && anchors[tr.anchor]) {
      const q = world(tr.anchor).project(camera);
      tr.centre = [(q.x + 1) / 2, (q.y + 1) / 2];
    }
    kit.update?.(n, { camera, fps, shot });
    scene.updateMatrixWorld(true);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const preset = view.preset ?? shot.camera?.preset ?? 'held';
    const strength = view.panini ? paniniStrength(camera.fov) : 0;
    const cam = makeCam(camera.position.toArray(), camera.quaternion.toArray(), camera.fov);
    const entry = {
      n,
      shot: shot.index,
      preset,
      m,
      light: shot.light ?? spec.light ?? 'night',
      cam: {
        pos: camera.position.toArray(),
        target: camera.position.clone().addScaledVector(fwd, 100).toArray(),
        quat: camera.quaternion.toArray(),
        yaw: e.y * DEG,
        pitch: e.x * DEG,
        roll: e.z * DEG,
        fov: camera.fov,
        panini: strength,
        streak: view.streak ?? [0, 0],
        smear: !!view.smear,
        rest: view.rest ?? true,
        lean: view.lean ?? 1,
      },
      tr: tr ? { type: tr.type, k: tr.k, ...(tr.back ? { back: true } : {}), ...(tr.centre ? { centre: tr.centre } : {}), ...(view.smear ? { smear: view.streak } : {}) } : view.smear ? { type: 'smear', k: 0, smear: view.streak } : null,
      stamp: (spec.transitions ?? []).map((t) => stampState(t, n, fps)).find(Boolean) ?? null,
      show: shot.show ?? [],
      hands: null,
      held: shot.camera?.object ?? null,
      fx: fx ? { glow: fx.glow, bergScale: fx.bergScale, yaw: fx.yaw } : null,
      sea: shot.sea ?? spec.sea ?? null,
      sprites: shot.sprites ?? [],
    };
    // Hands (blend names, so the engine only mixes two poses).
    const hp = handsPlan(n, (f) => handsAt(spec, f));
    if (hp) entry.hands = { ...hp, cur: handsAt(spec, n) };
    // Cards on twos: stick characters and Tick.
    const isPov = !NOT_POV.has(preset) && preset !== 'whip' && preset !== 'snap';
    const g = { pov: !NOT_POV.has(preset), spans: [], exempt: [], faces: [], sfx: [] };
    entry.cards = cards.map(({ c, isGuide, track, poses, blinks }, i) => {
      const an = isGuide ? tickAnchorAt(c, n) : c.anchor;
      const jumping = isGuide && tr?.type === 'jump';
      const slot = isGuide && (isSlot(an) || jumping);
      const spot = slot ? null : world(an).toArray();
      const aimed = [shot.camera?.to, shot.camera?.from].some((x) => (typeof x === 'string' ? x : x?.anchor) === c.anchor);
      g.exempt.push(!isPov || aimed || tr?.type === 'jump');
      if (isGuide) {
        let t = tickPoseAt(poses, track, ne);
        let pos = null;
        if (slot) {
          // Camera slot: the point in front of the camera; a drift pose walks outward, away from the centre.
          const home = isSlot(an) ? an : 'cam_right';
          // c.slotScale: Tick that many times its slot size (closer to the eye), e.g. 'Tick close'.
          const p = slotPoint(home, camera, tickSlotDistance(camera.fov) / (c.slotScale ?? 1));
          const drift = poses[t.name]?.drift;
          if (drift && !jumping) p.addScaledVector(slotOutward(home, camera), Math.hypot(...drift) * (Math.max(0, n - t.start) / fps));
          if (jumping) {
            // The jump: Tick flies to the centre and grows to JUMP.tickWidth of the width (closer to the eye), hands spinning.
            const js = jumpState(tr.k, !!tr.back);
            const e = js.fly * js.fly * (3 - 2 * js.fly);
            const c = slotPoint('cam_centre', camera, tickSlotDistance(camera.fov) * (TICK_IDLE_WIDTH / JUMP.tickWidth));
            p.lerp(c, e);
            if (js.spin) t = { ...tickPoseAt(poses, [{ at: 0, pose: 'spin' }], ne), name: 'spin', start: tr.at ?? n };
            g.jumpCentre = toScreen(p, cam);
          }
          pos = p.toArray();
        }
        const base = slot ? new THREE.Vector3(...pos) : new THREE.Vector3(...spot).add(new THREE.Vector3(...(c.offset ?? [0, 0, 0])));
        base.y += bobAt(n);
        const v = tickView(t.pose, base, cam);
        g.spans.push(v.hi >= v.lo ? [v.lo, v.hi] : null);
        g.tick = { visible: v.visible };
        return { anchor: an, ...(pos ? { pos } : {}), pose: t.pose, name: t.name, start: t.start, ring: countdownAt(spec.countdown ?? null, ne), blink: blinks.has(ne) };
      }
      const { pose: p0 } = poseAt(poses, track, ne);
      const sp = cardSpan(c, p0, spot, cam);
      g.spans.push(sp.hi >= sp.lo ? [sp.lo, sp.hi] : null);
      const fd = faceDisc(c, p0, spot, cam);
      if (fd) g.faces.push(fd);
      return { pose: p0, mouth: mouthAt(ne, p0, c.speak), blink: blinks.has(ne), breath: breathAt(ne) };
    });
    if (entry.tr?.type === 'jump' && g.jumpCentre) entry.tr.centre = [g.jumpCentre[0], 1 - g.jumpCentre[1]];
    // Sound words.
    entry.sfx = [];
    sfxDefs.forEach(({ ev, variant, aspect, tilt }, i) => {
      const s = sfxState(ev, n);
      if (!s) return;
      const held = shot.camera?.object === ev.anchor && HELD_ANCHORS.has(ev.anchor);
      const pos = (held ? heldPos(camera) : isSlot(ev.anchor) ? slotPoint(ev.anchor, camera, sfxSlotDistance(camera.fov)) : world(ev.anchor)).toArray();
      pos[1] += ev.lift ?? 0;
      const size = ev.size ?? SFX_SIZE;
      entry.sfx.push({ i, word: ev.word, variant, anchor: ev.anchor, scale: s.scale, opacity: s.fade, size, lift: ev.lift ?? 0, tilt, held, pos });
      g.sfx.push({ word: ev.word, start: n === ev.at, box: sfxBox(pos, cam, size, aspect, s.scale, tilt) });
    });
    // Plant anchor in the frustum (frames named by the episode).
    if (spec.plant && n >= spec.plant.frames[0] && n <= spec.plant.frames[1]) {
      // Any part of the anchor object's world bounding box inside the frustum (an empty object: its point).
      const an = anchors[spec.plant.anchor];
      if (!an) throw new Error(`anchor "${spec.plant.anchor}" missing`);
      an.updateWorldMatrix(true, true);
      box.setFromObject(an);
      if (box.isEmpty()) box.setFromCenterAndSize(world(spec.plant.anchor), new THREE.Vector3());
      frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      g.plant = frustum.intersectsBox(box);
    }
    // Breath wisp (cold looks, camera at rest): placed clear of every subject box (cards, Tick, hands, the held object).
    entry.breath = null;
    if (look.cold && entry.cam.rest && !NOT_POV.has(preset)) {
      const w = wispFrames(n, fps, spec.breathPhase ?? 0)[0];
      if (w) {
        const subj = g.spans.filter(Boolean).map(([lo, hi]) => ({ x0: lo, x1: hi, y0: 0, y1: 1 }));
        if (entry.hands) subj.push(handsAt(spec, n) === 'rub' || entry.hands.cur === 'rub' ? { x0: 0, x1: 1, y0: 0.72, y1: 1 } : { x0: 0.6, x1: 1, y0: 0.74, y1: 1 });
        if (entry.held) subj.push({ x0: 0.38, x1: 0.66, y0: 0.6, y1: 0.95 });
        const x = placeWisp(subj, W / H);
        if (x !== null) entry.breath = { x, age: w.age };
      }
    }
    // Caption active at this frame.
    const cap = capCards.find((c) => n >= Math.round(c.start * fps) && n < Math.round(c.end * fps));
    entry.caption = cap ? { text: cap.text, x: cap.x, y: cap.y, width: cap.width, height: cap.height } : null;
    entry.g = g;
    plan[n] = entry;
  }
  const header = {
    version: 1,
    name: spec.name ?? spec.id,
    id: spec.id ?? spec.name,
    fps,
    frames,
    seed,
    look: spec.look,
    set: spec.set,
    hookType: spec.hookType ?? null,
    showable: [...new Set((spec.shots ?? []).flatMap((s) => s.show ?? []))],
    presets: (spec.shots ?? []).map((s) => s.camera?.preset ?? 'held'),
    shots: (spec.shots ?? []).map((s, i) => ({ id: s.id ?? `S${i + 1}`, frames: s.frames, preset: s.camera?.preset ?? 'held' })),
    cards: (spec.cards ?? []).map((c) => ({ cast: c.cast, anchor: c.anchor, blink: c.blink, light: c.light, facing: c.facing, facingCam: c.facingCam, offset: c.offset, face: c.face, faceAnchor: c.faceAnchor })),
    sfx: sfxDefs.map(({ ev, variant }) => ({ word: ev.word, at: ev.at, anchor: ev.anchor, variant })),
    countdown: spec.countdown ?? null,
    transitions: spec.transitions ?? [],
    moneyShot: spec.moneyShot ?? null,
    plant: spec.plant ?? null,
    loop: spec.loop ?? null,
    range: [a, b],
  };
  return { ...header, plan };
}

const round = (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
export const planJson = (doc) => JSON.stringify(doc, round);

export async function bakeEpisode(dir) {
  const { ep, words, script } = loadEpisode(dir);
  const spec = compile(ep, { words, script });
  const doc = await bakeSpec(spec, { words });
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'plan.json'), planJson(doc));
  return { doc, spec, words, script, ep, file: join(out, 'plan.json') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !existsSync(join(dir, 'episode.json'))) {
    console.error('usage: bake.mjs <episodeDir>   (needs episode.json)');
    process.exit(2);
  }
  try {
    const { doc, file } = await bakeEpisode(dir);
    console.log(`bake: ${doc.frames} frames -> ${file}`);
  } catch (e) {
    console.error(`bake: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
}
