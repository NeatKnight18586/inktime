// Episode folder -> scene spec. Pure JSON, no three.js. Usage (library): loadEpisode(dir), compile(ep, { words, script }).
// Resolves every time ("L<n>:<w>", seconds, "+Nf" / "-Nf" offsets, e.g. "L3:0+8f", 12.5, "15+8f") against audio/words.json
// (timeline seconds) and returns the scene spec the bake consumes (shots with frame counts, cards, sfx, countdown, transitions).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
export const isScratch = (id) => String(id).startsWith('_');

export function parseTime(t, words = [], fps = 24) {
  if (typeof t === 'number') return t;
  const m = /^(?:L(\d+):(\d+)|(\d+(?:\.\d+)?))(?:([+-]\d+)f)?$/.exec(String(t).trim());
  if (!m) throw new Error(`bad time "${t}"`);
  let s;
  if (m[3] !== undefined) s = Number(m[3]);
  else {
    const w = words.find((x) => String(x.line) === `L${m[1]}` && x.w === Number(m[2]));
    if (!w) throw new Error(`time "${t}": no such word in words.json`);
    s = w.start;
  }
  return s + (m[4] ? Number(m[4]) / fps : 0);
}
export const frameOf = (t, words, fps = 24) => Math.round(parseTime(t, words, fps) * fps + 1e-6);

export function loadEpisode(dir) {
  const ep = readJson(join(dir, 'episode.json'));
  const wf = join(dir, 'audio', 'words.json');
  const wordsDoc = existsSync(wf) ? readJson(wf) : null;
  const sf = join(dir, 'script.json');
  return { ep, words: wordsDoc?.words ?? [], wordsDoc, script: existsSync(sf) ? readJson(sf) : null };
}

const TRANSITION_LEAD = { blink: 3, sting: 0, match: 6, jump: 14, jump_back: 6 }; // frames before the cut that each overlay starts

export function compile(ep, { words = [], script = null } = {}) {
  const fps = ep.fps ?? 24;
  const F = (t) => frameOf(t, words, fps);
  let total;
  if (ep.duration != null) total = Math.round(ep.duration * fps);
  else {
    const last = words.at(-1);
    if (!last) throw new Error('episode has no duration and no words.json');
    total = Math.round((last.end + (ep.tail ?? 0.4)) * fps);
  }
  const src = ep.shots ?? [];
  if (!src.length) throw new Error('episode.json has no shots');
  const starts = src.map((s) => F(s.start));
  if (starts[0] !== 0) throw new Error('the first shot must start at 0');
  for (let i = 1; i < starts.length; i++) if (starts[i] <= starts[i - 1]) throw new Error(`shot ${src[i].id ?? i} does not start after the previous one`);
  const shots = src.map((s, i) => {
    const end = i + 1 < src.length ? starts[i + 1] : total;
    const preset = s.preset ?? 'held';
    const params = { ...(s.params ?? {}) };
    if (params.soundAt !== undefined) {
      params.soundFrame = F(params.soundAt);
      delete params.soundAt;
    }
    const camera = { anchor: s.anchor ?? (preset === 'dive' || preset === 'rise' ? 'aerial' : 'cam_lookout'), preset, ...(s.fov !== undefined ? { fov: s.fov } : {}), ...(s.lookAt ? { to: s.lookAt } : {}), ...params };
    const out = { id: s.id ?? `S${i + 1}`, start: starts[i], frames: end - starts[i], camera, show: s.show ?? [], light: s.light ?? ep.light ?? 'night' };
    const sea = s.sea ?? ep.sea;
    if (sea) out.sea = sea;
    if (s.hands?.length) {
      const track = s.hands.map(([t, pose]) => ({ at: F(t), pose }));
      out.hands = track.length === 1 && track[0].at === starts[i] ? track[0].pose : track;
    }
    if (s.guide?.length) out.guide = s.guide.map(([t, anchor, pose]) => ({ at: F(t), anchor, pose }));
    if (s.poses) out.poses = Object.fromEntries(Object.entries(s.poses).map(([c, l]) => [c, l.map(([t, pose]) => ({ at: F(t), pose }))]));
    return out;
  });
  const transitions = (ep.transitions ?? []).map((t) => ({ ...t, at: F(t.at) }));
  src.forEach((s, i) => {
    if (s.transitionIn && !['cut', 'whip'].includes(s.transitionIn)) transitions.push({ type: s.transitionIn, at: Math.max(0, starts[i] - (TRANSITION_LEAD[s.transitionIn] ?? 0)), ...(s.transitionAnchor ? { anchor: s.transitionAnchor } : {}), ...(s.jump ? { stamp: s.jump.stamp, dest: s.jump.dest } : {}) });
  });
  // Cards: one per cast member that has a card entry; the guide (Tick) gets one automatically from the shots' guide lists.
  const cards = [];
  const speakOf = (cast) => {
    if (!script) return [];
    return script.lines.filter((l) => l.speaker === cast).flatMap((l) => {
      const ws = words.filter((w) => String(w.line) === l.id);
      return ws.length ? [[Math.round(ws[0].start * fps), Math.round(ws.at(-1).end * fps)]] : [];
    });
  };
  for (const c of ep.cards ?? []) {
    const track = (c.track ?? [[0, c.pose ?? 'idle']]).map(([t, pose]) => ({ at: F(t), pose }));
    for (const s of shots) for (const e of s.poses?.[c.cast] ?? []) track.push(e);
    if (c.cast === 'guide') for (const s of shots) for (const g of s.guide ?? []) track.push({ at: g.at, pose: g.pose });
    track.sort((a, b) => a.at - b.at);
    const speak = [...(c.speak ?? []).map(([a, b]) => [F(a), F(b)]), ...speakOf(c.cast)];
    const card = { cast: c.cast, track, anchor: c.anchor, blink: c.blink ?? true, ...(c.light ? { light: c.light } : {}), ...(c.facing !== undefined ? { facing: c.facing } : {}), ...(c.facingCam !== undefined ? { facingCam: c.facingCam } : {}), ...(c.slotScale !== undefined ? { slotScale: c.slotScale } : {}), ...(c.pop !== undefined ? { pop: F(c.pop) } : {}), ...(speak.length ? { speak } : {}) };
    if (c.cast === 'guide') {
      const anchors = [{ at: 0, anchor: c.anchor }];
      for (const s of shots) for (const g of s.guide ?? []) anchors.push({ at: g.at, anchor: g.anchor });
      card.anchors = anchors.sort((a, b) => a.at - b.at);
      for (const k of ['offset', 'face', 'faceAnchor']) if (c[k] !== undefined) card[k] = c[k];
    }
    cards.push(card);
  }
  const sfx = [];
  const addSfx = ([t, word, anchor, opts]) => sfx.push({ word, at: F(t), anchor, ...(opts ?? {}) });
  (ep.sfxWords ?? []).forEach(addSfx);
  src.forEach((s) => (s.sfxWords ?? []).forEach(addSfx));
  sfx.sort((a, b) => a.at - b.at);
  const countdown = (ep.countdown ?? []).map(([t, value]) => ({ at: F(t), value }));
  const spec = { name: ep.id, id: ep.id, fps, seed: ep.seed ?? ep.id, look: ep.look, set: ep.set, shots, cards, transitions, sfx, hookType: ep.hookType ?? null, frames: total };
  if (countdown.length) spec.countdown = countdown;
  if (ep.captionKeys) spec.captionKeys = ep.captionKeys;
  if (ep.moneyShot) spec.moneyShot = { ...ep.moneyShot, index: shots.findIndex((s) => s.id === ep.moneyShot.shot) };
  if (ep.plant) spec.plant = { anchor: ep.plant.anchor, frames: ep.plant.frames };
  if (ep.loop) spec.loop = ep.loop;
  if (spec.moneyShot && spec.moneyShot.index < 0) throw new Error(`moneyShot.shot "${ep.moneyShot.shot}" is not a shot id`);
  return spec;
}

export function loadSpec(dir) {
  const { ep, words, script } = loadEpisode(dir);
  return compile(ep, { words, script });
}
