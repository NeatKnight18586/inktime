// Phase 3: Tick (the guide), its countdown ring, the lettering generator, sound words and the phone hand.
// Tick's six-trick snapshots live in tests/tick.snapshot.json; regenerate with UPDATE_SNAPSHOT=1 node --test tests/guide.test.mjs.
import { loadSpec } from '../tools/timeline.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { D_METRES, billboardAngles, lightInCamera, faceTurn } from '../engine/cast/stickmath.mjs';
import { TICK, TICK_CARD, ACCENT, EXPRESSIONS, expressionAngles, clockAngles, countdownAt, tickPoseAt, drawTick, bobAt, nearestSurface, decalBasis, jointsOf, armChain, REFILL_FRAMES } from '../engine/cast/tick.mjs';
import { sfxState, sfxEnd, pickVariant, sfxMaterial, POP, FADE_FRAMES } from '../engine/sfxwords.mjs';
import { GLYPHS, WORDS, LETTER, LAMP, strokeOutline, layoutWord, wordSvg } from '../tools/letter.mjs';
import { rng, hashSeed } from '../tools/rng.mjs';

const DEG = Math.PI / 180;
const url = (p) => new URL(p, import.meta.url);
const night = JSON.parse(readFileSync(url('../engine/looks/titanic_night.json')));
const day = JSON.parse(readFileSync(url('../engine/looks/day.json')));
const poses = JSON.parse(readFileSync(url('../cast/guide/poses.json')));
const spec = loadSpec('episodes/_looktest');
const snapPath = url('./tick.snapshot.json');
const snap = {};
const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
const check = (name, value) => (snap[name] = round(value));
test.after(() => {
  if (process.env.UPDATE_SNAPSHOT || !existsSync(snapPath)) {
    writeFileSync(snapPath, JSON.stringify(snap, null, 2) + '\n');
    return;
  }
  assert.deepEqual(snap, JSON.parse(readFileSync(snapPath)), 'tick snapshot changed (UPDATE_SNAPSHOT=1 to accept)');
});

// A recording 2D context: every call and property set, in order, with arguments.
function recorder() {
  const ev = [];
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { const g = { kind: k, args: a, stops: [] }; ev.push(g); return { addColorStop: (o, c) => g.stops.push(c) }; };
      return (...a) => ev.push({ call: k, args: a });
    },
    set: (_, k, v) => { ev.push({ set: k, v }); return true; },
  });
  return { ctx, ev };
}
const W = Math.round(TICK_CARD.w * 300);
const H = Math.round(TICK_CARD.h * 300);
const camAt = (yawDeg) => {
  const cam = new THREE.PerspectiveCamera(72, 9 / 16, 0.05, 100);
  cam.quaternion.setFromEuler(new THREE.Euler(0, yawDeg * DEG, 0, 'YXZ'));
  return cam;
};
const stFor = (look, { pose = tickPoseAt(poses, [{ at: 0, pose: 'idle' }], 0).pose, angle = 0, shift = 0.05, yaw = 0, ring = null } = {}) => ({
  pose,
  angle,
  look: { shift },
  light: { key: look.colors[look.cast.key], shade: look.colors[look.cast.shade], rim: look.colors[look.cast.rim], cam: lightInCamera(look.cast.keyDir, camAt(yaw)) },
  ring,
  blink: false,
  seed: 't',
  n: 0,
});

test('Tick design: a 0.34 m pocket watch, 0.035 D ink, 4 tick marks, one dot eye, clock-hand brows, accent crown only', () => {
  assert.ok(Math.abs(TICK.face * D_METRES - 0.34) < 1e-12);
  assert.equal(TICK.outline, 0.035);
  assert.ok(TICK.eyeUp > 0 && TICK.eyeUp < 0.1, 'eye just above centre');
  assert.deepEqual(EXPRESSIONS, { calm: '10:10', alert: '12:00', sad: '8:20', worried: '9:15' });
  assert.deepEqual(expressionAngles('alert'), { hour: 0, minute: 0 }, 'alert: both hands up');
  assert.deepEqual(clockAngles('10:10'), { hour: 305, minute: 60 });
  assert.deepEqual(clockAngles('8:20'), { hour: 250, minute: 120 });
  assert.deepEqual(clockAngles('9:15'), { hour: 277.5, minute: 90 });
  for (const l of [night, day]) assert.ok(!Object.values(l.colors).map((c) => c.toUpperCase()).includes(ACCENT), 'the accent is in no palette');
  assert.equal(ACCENT, '#E8336D');
  // The drawing: 4 tick marks (butt strokes from r0 to r1), no text calls at all.
  const { ctx, ev } = recorder();
  drawTick(ctx, W, H, stFor(night));
  assert.ok(!ev.some((e) => e.call === 'fillText' || e.call === 'strokeText'), 'no numerals, no text');
  const butt = ev.findIndex((e) => e.set === 'lineCap' && e.v === 'butt');
  const marks = ev.slice(butt).filter((e) => e.call === 'stroke').length;
  assert.ok(marks >= 4);
  assert.ok(ev.some((e) => e.set === 'fillStyle' && typeof e.v === 'string' && e.v.startsWith('rgb(')), 'crown shaded in its own colour');
  // Bob: 0.6 Hz, 2 cm, from the frame index.
  const b = Array.from({ length: 80 }, (_, n) => bobAt(n));
  assert.ok(Math.abs(Math.max(...b) - 0.02) < 1e-3 && Math.abs(bobAt(40) - bobAt(0)) < 1e-12, 'period 40 frames at 24 fps');
  check('design', { expressions: Object.fromEntries(Object.keys(EXPRESSIONS).map((k) => [k, expressionAngles(k)])), bob: [bobAt(0), bobAt(10), bobAt(20), bobAt(30)] });
});

test('Tick poses: params only; panic 3 drawings, slap 3 (once), mime_walk_away 4, all on twos', () => {
  for (const n of ['idle', 'stare', 'point', 'panic', 'facepalm', 'shiver', 'slap', 'mime_walk_away']) assert.ok(poses[n], n);
  assert.equal(poses.panic.drawings.length, 3);
  assert.equal(poses.slap.drawings.length, 3);
  assert.equal(poses.slap.loop, false);
  assert.equal(poses.mime_walk_away.drawings.length, 4);
  const tr = (p) => [{ at: 0, pose: p }];
  const ids = (p, from, to) => Array.from({ length: to - from }, (_, i) => tickPoseAt(poses, tr(p), from + i).pose.drawing);
  assert.deepEqual(ids('panic', 0, 12), [0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual(ids('slap', 0, 10), [0, 0, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(ids('mime_walk_away', 0, 8), [0, 0, 1, 1, 2, 2, 3, 3]);
  const spin = [0, 2, 4].map((n) => tickPoseAt(poses, tr('panic'), n).pose.hands.hour);
  assert.ok(new Set(spin).size === 3, 'the hands spin');
  // facepalm: the hand reaches over the eye (2-bone IK).
  const fp = tickPoseAt(poses, tr('facepalm'), 0).pose;
  const w = armChain(fp, 'R').wrist;
  assert.ok(Math.hypot(w.x - 0.02, w.y - 0.08) < 0.01, `hand over the eye: ${w.x.toFixed(3)}, ${w.y.toFixed(3)}`);
  assert.equal(fp.face, 'sad');
  // Blend: 6 frames between poses (on twos), discrete fields switch midway.
  const t2 = [{ at: 0, pose: 'idle' }, { at: 20, pose: 'stare' }];
  const mid = tickPoseAt(poses, t2, 23).pose;
  assert.ok(mid.armL[0] < poses.idle.armL[0] && mid.armL[0] > poses.stare.armL[0]);
  assert.deepEqual(tickPoseAt(poses, t2, 21).pose, tickPoseAt(poses, t2, 20).pose, 'twos');
  check('poses', { facepalmR: jointsOf(poses.facepalm, 'R'), panicHours: spin, blendArmL: mid.armL });
});

test('Tick trick a) billboard: yaw faces the camera, pitch limited to 15 deg about the face centre', () => {
  const base = new THREE.Vector3(0.2, 1.9, -1);
  const a = billboardAngles(base, new THREE.Vector3(0, 1.62, 0), 0);
  assert.ok(Math.abs(a.yaw - Math.atan2(-0.2, 1)) < 1e-9);
  const b = billboardAngles(base, new THREE.Vector3(0, 30, 0), 0);
  assert.ok(Math.abs(b.pitch + 15 * DEG) < 1e-9);
  check('tick_billboard', { yawDeg: a.yaw / DEG, pitchDeg: a.pitch / DEG, clampedDeg: b.pitch / DEG });
});

test('Tick trick b) the face is shaded as a sphere toward the key light in camera space (flips when the camera orbits)', () => {
  const hl = (yaw) => {
    const { ctx, ev } = recorder();
    drawTick(ctx, W, H, stFor(night, { yaw }));
    // The face gradient is the radial gradient whose outer radius is about the face radius.
    const R = TICK.r * 300;
    const g = ev.filter((e) => e.kind === 'createRadialGradient').find((e) => e.args[5] > R * 0.95 && e.args[5] < R * 1.5);
    assert.ok(g, 'face sphere gradient');
    return { hx: g.args[0] - g.args[3], hy: g.args[1] - g.args[4], stops: g.stops };
  };
  const a = hl(0);
  const b = hl(180);
  assert.ok(Math.sign(a.hx) === -Math.sign(b.hx) && Math.abs(a.hx) > 1, 'the lit side follows the camera');
  assert.equal(a.stops.length, 4, 'lit, mid, shade');
  check('tick_light', { hx0: a.hx, hy0: a.hy, hx180: b.hx });
});

test('Tick trick c) face shift: the eye and its hands slide toward the look direction (0.05-0.18 D, scaled to the face)', () => {
  const eyeX = (shift, angle) => {
    const { ctx, ev } = recorder();
    drawTick(ctx, W, H, stFor(night, { shift, angle }));
    const e = ev.filter((x) => x.call === 'ellipse').find((x) => Math.abs(x.args[3] - (TICK.eye / 2) * 300) < 1);
    return e.args[0];
  };
  const base = new THREE.Vector3(0, 0, 0);
  const cam = new THREE.Vector3(0, 0, 5);
  const rows = {};
  for (const deg of [0, 30, 90, -30]) {
    const t = faceTurn(deg * DEG, base, cam, 1);
    rows[deg] = { shift: t.shift, eyePx: eyeX(t.shift, t.angle) };
  }
  assert.ok(rows[30].eyePx > rows[0].eyePx && rows[90].eyePx > rows[30].eyePx && rows[-30].eyePx < 0, 'shifts toward the turn');
  assert.ok(Math.abs(rows[90].eyePx - 0.18 * TICK.shiftScale * 300) < 1, 'max shift 0.18 D x 0.6');
  check('tick_faceShift', rows);
});

test('Tick trick d) shadow proxy on the nearest surface: a decal lying on it, never a lamp shadow', () => {
  const scene = new THREE.Scene();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4), new THREE.MeshBasicMaterial());
  floor.position.y = -0.05;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 4), new THREE.MeshBasicMaterial());
  wall.position.x = -0.6;
  scene.add(floor, wall);
  scene.updateMatrixWorld(true);
  const s1 = nearestSurface(new THREE.Vector3(-0.3, 1.5, 0), [floor, wall]);
  assert.deepEqual(s1.dir, [-1, 0, 0], 'the wall is nearer than the floor');
  assert.ok(Math.abs(s1.distance - 0.25) < 1e-6 && s1.normal.x > 0.99);
  const s2 = nearestSurface(new THREE.Vector3(0.5, 0.4, 0), [floor, wall]);
  assert.deepEqual(s2.dir, [0, -1, 0]);
  const m = decalBasis(s1.normal, night.cast.keyDir);
  const n = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(m));
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(m));
  assert.ok(n.dot(s1.normal) > 0.999 && up.y > 0.99, 'the decal lies on the wall, upright');
  const fl = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(decalBasis(s2.normal, night.cast.keyDir)));
  assert.ok(fl.y > 0.999, 'on the floor it lies flat');
  const src = readFileSync(url('../engine/cast/tick.mjs'), 'utf8');
  assert.match(src, /decal\.castShadow = false/);
  assert.match(src, /card\.receiveShadow = false/);
  check('tick_shadow', { wall: [s1.distance, s1.normal.toArray()], floor: [s2.distance, s2.normal.toArray()] });
});

test('Tick trick e) depth order: the far arm behind the face, 10% darker; the near arm in front', () => {
  const arms = (angle) => {
    const { ctx, ev } = recorder();
    drawTick(ctx, W, H, stFor(day, { angle }));
    const faceFill = ev.findIndex((e) => e.kind === 'createRadialGradient' && e.args[5] > TICK.r * 300 * 0.95 && e.args[5] < TICK.r * 300 * 1.5);
    const armCol = ev.map((e, i) => [e, i]).filter(([e, i]) => e.set === 'strokeStyle' && typeof e.v === 'string' && e.v.startsWith('rgb(') && ev[i + 1]?.set === 'lineWidth' && Math.abs(ev[i + 1].v - TICK.limb * 300) < 1e-6);
    return { faceFill, before: armCol.filter(([, i]) => i < faceFill).map(([e]) => e.v), after: armCol.filter(([, i]) => i > faceFill).map(([e]) => e.v) };
  };
  const r = arms(40 * DEG);
  assert.equal(r.before.length, 2, 'two far-arm segments before the face');
  assert.equal(r.after.length, 2, 'two near-arm segments after it');
  const lum = (c) => c.match(/\d+/g).map(Number).reduce((s, v) => s + v, 0);
  assert.ok(lum(r.before[0]) < lum(r.after[0]), 'far arm darker');
  assert.ok(Math.abs(lum(r.before[0]) / lum(r.after[0]) - 0.9) < 0.03, '10% darker');
  check('tick_depthOrder', { far: r.before[0], near: r.after[0] });
});

test('Tick trick f) lighting per scene: key, shade and rim from the look file (day and night differ)', () => {
  const face = (look) => {
    const { ctx, ev } = recorder();
    drawTick(ctx, W, H, stFor(look));
    return ev.filter((e) => e.kind === 'createRadialGradient').find((e) => e.args[5] > TICK.r * 300 * 0.95 && e.args[5] < TICK.r * 300 * 1.5).stops;
  };
  const a = face(night);
  const b = face(day);
  assert.notDeepEqual(a, b);
  const src = readFileSync(url('../engine/cast/tick.mjs'), 'utf8');
  assert.match(src, /palette\.json\.cast/);
  check('tick_lighting', { night: a, day: b });
});

test('countdown ring: linear keys, full = the first value, 3 flashes on twos at 0, refill over 12 frames, hidden without keys', () => {
  assert.equal(countdownAt(null, 10), null);
  assert.equal(countdownAt([], 10), null);
  // The looktest: 40 -> 20 over the walkthrough.
  const k = spec.countdown;
  assert.deepEqual(k, [{ at: 72, value: 40 }, { at: 456, value: 20 }]);
  assert.equal(countdownAt(k, 0).frac, 1);
  assert.equal(countdownAt(k, 72).frac, 1);
  assert.ok(Math.abs(countdownAt(k, 264).value - 30) < 1e-9);
  assert.equal(countdownAt(k, 456).frac, 0.5);
  assert.equal(countdownAt(k, 479).frac, 0.5);
  // To zero, then a refill.
  const z = [{ at: 0, value: 10 }, { at: 100, value: 0 }, { at: 140, value: 6 }];
  assert.equal(countdownAt(z, 50).frac, 0.5);
  const flashes = Array.from({ length: 14 }, (_, i) => countdownAt(z, 100 + i).flash);
  assert.deepEqual(flashes, [true, true, false, false, true, true, false, false, true, true, false, false, null, null]);
  assert.equal(countdownAt(z, 99).flash, null);
  assert.equal(countdownAt(z, 120).frac, 0, 'empty after the flashes');
  assert.equal(countdownAt(z, 139).value, 0, 'holds until the refill key');
  assert.ok(Math.abs(countdownAt(z, 146).value - 3) < 1e-9, 'halfway through the 12-frame refill');
  assert.equal(countdownAt(z, 140 + REFILL_FRAMES).value, 6);
  // Drawn: an arc from 12 o'clock clockwise, in the accent colour; none without a countdown; full while flashing on.
  const arc = (ring) => {
    const { ctx, ev } = recorder();
    drawTick(ctx, W, H, stFor(night, { ring }));
    const i = ev.findIndex((e) => e.set === 'strokeStyle' && e.v === ACCENT);
    if (i < 0) return null;
    const a = ev.slice(i).find((e) => e.call === 'arc');
    return [a.args[3], a.args[4]];
  };
  assert.equal(arc(null), null);
  for (const [n, frac] of [[72, 1], [264, 0.75], [456, 0.5]]) {
    const [a0, a1] = arc(countdownAt(k, n));
    assert.ok(Math.abs(a0 + Math.PI / 2) < 1e-9 && Math.abs(a1 - a0 - frac * 2 * Math.PI) < 1e-9, `frame ${n}: ${frac}`);
  }
  assert.deepEqual(arc(countdownAt(z, 100)).map((v) => Math.round(v * 1e6)), [-Math.PI / 2, 1.5 * Math.PI].map((v) => Math.round(v * 1e6)), 'flash on: full ring');
  assert.equal(arc(countdownAt(z, 102)), null, 'flash off');
  check('countdown', { looktest: [72, 264, 456].map((n) => countdownAt(k, n).frac), refill: [140, 143, 146, 152].map((n) => countdownAt(z, n).value) });
});

test('letter.mjs: a skeleton stroke alphabet for the seven words; tapered brush strokes, 1.5% wobble, ink outline, lamp fill; 3 variants', () => {
  const need = new Set(WORDS.join('').split(''));
  assert.deepEqual([...need].sort(), Object.keys(GLYPHS).sort(), 'exactly the letters in the seven words');
  // Wobble: the centreline never strays more than 1.5% of the letter height from the skeleton.
  const r = rng(hashSeed('wobble'));
  const o = strokeOutline([[0, 0], [0, 1]], { r });
  assert.ok(Math.max(...o.centre.map(([x]) => Math.abs(x))) <= LETTER.wobble + 1e-9);
  assert.ok(Math.max(...o.centre.map(([x]) => Math.abs(x))) > LETTER.wobble * 0.3, 'it does wobble');
  // Taper: the ends are thinner than the middle.
  const wAt = (i) => Math.hypot(o.rings[0][i][0] - o.rings[0][o.rings[0].length - 1 - i][0], o.rings[0][i][1] - o.rings[0][o.rings[0].length - 1 - i][1]);
  assert.ok(wAt(0) < wAt(Math.floor(o.centre.length / 2)) * 0.6, 'tapered ends');
  for (const w of WORDS) {
    const files = [1, 2, 3].map((v) => readFileSync(url(`../sfx-words/${w}/v${v}.svg`), 'utf8'));
    for (const [i, svg] of files.entries()) {
      assert.equal(svg, wordSvg(w, `v${i + 1}`), `${w} v${i + 1} is the generator's output (node tools/letter.mjs)`);
      assert.ok(!/<text|font-family|@font-face/.test(svg), 'never a font');
      assert.ok(svg.includes(`fill="${LAMP}"`) && /stroke="#141414" stroke-width="28"/.test(svg), 'lamp fill, heavy ink outline');
    }
    assert.ok(new Set(files).size === 3, `${w}: three different seeds`);
  }
  assert.equal(layoutWord('SLAP', 'v1').strokes.length, 5);
  check('letter', { slapWidth: layoutWord('SLAP', 'v1').width, creakV1: wordSvg('CREAK', 'v1').length });
});

test('sound words: pop in over 3 frames (0.6 -> 1.15 -> 1.0), hold, fade over 6 frames; a solid cutout; variant by seed', () => {
  const ev = { word: 'CREAK', at: 100, hold: 10 };
  assert.deepEqual(POP, [0.6, 1.15, 1.0]);
  assert.equal(sfxState(ev, 99), null);
  assert.deepEqual([100, 101, 102].map((n) => sfxState(ev, n).scale), [0.6, 1.15, 1.0]);
  assert.equal(sfxState(ev, 112).phase, 'hold');
  const fade = Array.from({ length: FADE_FRAMES }, (_, i) => sfxState(ev, 113 + i));
  assert.ok(fade.every((s) => s.phase === 'fade') && fade.every((s, i) => i === 0 || s.fade < fade[i - 1].fade), 'fades over 6 frames');
  assert.equal(sfxState(ev, 113 + FADE_FRAMES), null);
  assert.equal(sfxEnd(ev), 119);
  for (const e of spec.sfx) {
    const v = pickVariant(spec.seed, e);
    assert.ok(v >= 1 && v <= 3 && v === pickVariant(spec.seed, e));
  }
  assert.deepEqual(spec.sfx.map((e) => [e.word, e.at, e.anchor]), [['CREAK', 72, 'forestay_top'], ['DING-DING-DING', 372, 'bell'], ['RATTLE', 420, 'padlock']]);
  // Solid cutout: opaque, depth written, alpha < 0.5 discarded, the dissolve discards (never blends); renders in the prepass.
  const m = sfxMaterial(null);
  assert.equal(m.transparent, false);
  assert.equal(m.depthWrite, true);
  assert.match(m.fragmentShader, /if \(c\.a < 0\.5\) discard;/);
  assert.match(m.fragmentShader, /gl_FragColor = vec4\(c\.rgb, 1\.0\)/);
  const main = readFileSync(url('../engine/main.mjs'), 'utf8');
  const pre = main.indexOf('sfx.prepass(true)');
  assert.ok(pre > main.indexOf('camera.layers.set(LAYERS.SOLID)') && pre < main.indexOf('camera.layers.set(LAYERS.HULL)'), 'sound words are occluders in the depth/normal prepass');
  const solid = readFileSync(url('../tools/solidtest.mjs'), 'utf8');
  assert.match(solid, /\['sound word', check\('sfx'/, 'the farm see-through test covers a sound word');
});

test('hands: the phone pose holds a modern phone in the right hand; its screen glows lamp colour, faces the eye and lights the fingers', async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { buildHand, buildPhone, placeHand, PHONE } = await import('../engine/rig/hands3d.mjs');
  const hp = JSON.parse(readFileSync(url('../cast/hands/poses.json')));
  assert.equal(hp.phone.prop, 'phone');
  assert.equal(hp.phone.hand, 'right');
  const b = readFileSync(url('../assets/hands/right.glb'));
  const gltf = await new Promise((ok, no) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, no));
  const colors = { lit: new THREE.Color('#EFCEA0'), shadow: new THREE.Color('#8B7C67'), key: new THREE.Color('#E8A64B'), rim: new THREE.Color('#9FD3E0'), tint: new THREE.Color(1, 1, 1), navy: new THREE.Color('#1B2A41'), glow: new THREE.Color('#E8A64B') };
  const rig = buildHand(gltf, colors, {});
  const phone = buildPhone(rig, colors);
  assert.equal(phone.group.parent, rig.bones.wrist, 'held by the wrist');
  assert.ok(phone.screen.material.color.equals(new THREE.Color('#E8A64B')) && phone.screen.material.toneMapped === false, 'lamp-coloured glowing screen');
  const cam = new THREE.PerspectiveCamera(90, 1080 / 1920, 0.05, 100);
  const scene = new THREE.Scene();
  scene.add(cam);
  cam.add(rig.group);
  rig.setPose(hp.phone);
  placeHand(rig.group, rig.baseQuat, hp.phone.wrist, 90);
  scene.updateMatrixWorld(true);
  const c = phone.screen.getWorldPosition(new THREE.Vector3());
  const nrm = new THREE.Vector3(0, 0, 1).transformDirection(phone.screen.matrixWorld);
  assert.ok(nrm.dot(c.clone().negate().normalize()) > 0.9, 'the screen faces the eye');
  const q = c.clone().project(cam);
  assert.ok(q.x > 0 && q.y < -0.1, 'bottom-right of the frame');
  // Fingers within reach of the screen light (the skin shader's hard-edged glow pool).
  const tips = ['index-finger-tip', 'middle-finger-tip', 'thumb-tip'].map((n) => rig.bones[n].getWorldPosition(new THREE.Vector3()).distanceTo(c));
  assert.ok(Math.min(...tips) < PHONE.glowR, `a finger within ${PHONE.glowR} m of the screen (${Math.min(...tips).toFixed(3)})`);
  const u = rig.skinned.material.uniforms;
  assert.ok(u.uGlowOn && u.uGlowPos && u.uGlowCol.value.equals(new THREE.Color('#E8A64B')));
  assert.match(rig.skinned.material.fragmentShader, /uGlowOn > 0\.5/);
});
