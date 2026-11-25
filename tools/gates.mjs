// Gates: pure functions over a baked plan (tools/bake.mjs). Each gate returns { name, status: PASS|WARN|FAIL, msg }.
// runGates({ doc, words, script, index, id, stills, full }) -> gates[]. Ids starting with "_" are scratch episodes: the gates that
// need a voice, a script or episode history are downgraded to WARN or skipped.
import { poseDelta, isStill } from './measure.mjs';
import { W, H } from './framing.mjs';

export const BANNED = ['delve', "it's important to note", 'imagine a world', 'little did they know', 'in a world', 'what if i told you'];
export const LOOK = {
  night: { lumaMean: [70, 95], dark40: [0, 0.45], p5: [0, 25], p95: [170, 255], sat: [0.22, 0.5] },
  day: { lumaMean: [120, 145], dark40: [0, 0.05], sat: [0.4, 0.5] },
};
const g = (name, status, msg) => ({ name, status, msg });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const camOf = (e) => ({ pos: e.cam.pos, quat: e.cam.quat });
const HOOK = new Set(['dive', 'rise']);

export function editRatio(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m && !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n] / Math.max(m, n);
}

export function runGates({ doc, words = [], script = null, index = [], id = doc.id, stills = null, full = null }) {
  const plan = doc.plan.filter(Boolean);
  const N = doc.frames;
  const fps = doc.fps;
  const soft = String(id).startsWith('_');
  const voiceless = soft && !words.length;
  const failOr = (cond, msg, soften = false) => (cond ? null : soften ? 'WARN' : 'FAIL');
  const out = [];

  // length
  {
    const s = N / fps;
    const st = s < 30 || s > 55 ? (soft ? 'WARN' : 'FAIL') : s < 35 || s > 50 ? 'WARN' : 'PASS';
    out.push(g('length', st, `${s.toFixed(1)} s (30-55 hard, 35-50 target${soft && st === 'WARN' ? '; scratch episode' : ''})`));
  }
  // frame 1
  {
    const e0 = plan[0];
    const e1 = plan[1];
    const moving = e0 && e1 && !isStill(camOf(e0), camOf(e1));
    const sound = !!e0?.sfx?.length;
    const cap = !!e0?.caption;
    const bad = [!moving && 'camera still', !sound && 'no sound word', !cap && 'no caption'].filter(Boolean);
    const st = !bad.length ? 'PASS' : !moving ? 'FAIL' : voiceless ? 'WARN' : 'FAIL';
    out.push(g('frame1', st, bad.length ? bad.join(', ') + (voiceless ? ' (no voice)' : '') : 'moving, sound word, caption'));
  }
  // stillness
  {
    let run = 0;
    let longest = 0;
    let stills_ = 0;
    let known = 0;
    for (let n = 1; n < plan.length; n++) {
      if (plan[n].shot !== plan[n - 1].shot) {
        run = 0;
        continue;
      }
      known++;
      if (isStill(camOf(plan[n - 1]), camOf(plan[n]))) {
        stills_++;
        run++;
        longest = Math.max(longest, run);
      } else run = 0;
    }
    const share = known ? stills_ / known : 0;
    out.push(g('stillness', longest > 19 || share > 0.1 ? 'FAIL' : 'PASS', `longest still run ${longest} frames (max 19), still frames ${(share * 100).toFixed(1)}% (max 10%)`));
  }
  // rotation
  {
    let worst = 0;
    let at = -1;
    for (let n = 1; n < plan.length; n++) {
      if (plan[n].shot !== plan[n - 1].shot || ['whip', 'dive', 'rise'].includes(plan[n].preset)) continue;
      const { deg } = poseDelta(camOf(plan[n - 1]), camOf(plan[n]));
      if (deg * fps > worst) {
        worst = deg * fps;
        at = n;
      }
    }
    out.push(g('rotation', worst > 90 ? 'FAIL' : 'PASS', `peak ${worst.toFixed(1)} deg/s at frame ${at} (max 90 outside whip, dive, rise)`));
  }
  // witness, dive length
  {
    const wit = plan.filter((e) => e.preset === 'witness');
    const early = wit.find((e) => e.n < 3 * fps);
    const dive = doc.shots.find((s) => s.preset === 'dive');
    const diveBad = dive && (dive.frames > 3 * fps || doc.shots[0] !== dive);
    const bad = [wit.length / N > 0.15 && `witness ${((wit.length / N) * 100).toFixed(1)}% > 15%`, early && `witness at frame ${early.n} before 3 s`, diveBad && 'dive not on frame 0 or longer than 3 s'].filter(Boolean);
    out.push(g('witness', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : `${((wit.length / N) * 100).toFixed(1)}% of runtime, none before 3 s`));
  }
  // hands
  {
    const pov = plan.filter((e) => e.g.pov);
    const share = pov.length ? pov.filter((e) => e.hands).length / pov.length : 0;
    out.push(g('hands', share >= 0.4 ? 'PASS' : 'WARN', `hands in ${(share * 100).toFixed(1)}% of POV frames (min 40%)`));
  }
  // Tick
  {
    if (!plan[0].g.tick) out.push(g('tick', 'WARN', 'no guide card'));
    else {
      let run = 0;
      let longest = 0;
      for (const e of plan) {
        run = e.g.tick?.visible ? 0 : run + 1;
        longest = Math.max(longest, run);
      }
      out.push(g('tick', longest > 192 ? 'FAIL' : 'PASS', `longest out-of-frame run ${longest} frames (max 192)`));
    }
  }
  // centre 40%
  {
    let bad = null;
    let checked = 0;
    for (const e of plan) {
      e.g.spans.forEach((sp, i) => {
        if (!sp || e.g.exempt[i]) return;
        checked++;
        if (!(sp[1] <= 0.31 || sp[0] >= 0.69) && !bad) bad = `frame ${e.n}: ${doc.cards[i]?.cast} spans ${sp[0].toFixed(2)}-${sp[1].toFixed(2)}`;
      });
    }
    out.push(g('centre40', bad ? 'FAIL' : 'PASS', bad ?? `${checked} card-frames clear of the centre 40%`));
  }
  // visual change interval
  {
    const ev = new Set();
    let ph = null;
    plan.forEach((e, k) => {
      if (k && e.shot !== plan[k - 1].shot) ev.add(e.n);
      if (e.g.sfx.some((s) => s.start)) ev.add(e.n);
      if ((e.hands?.cur ?? null) !== ph) {
        if (k) ev.add(e.n);
        ph = e.hands?.cur ?? null;
      }
      const t = e.cards.find((c) => c.name);
      if (k && t && plan[k - 1].cards.find((c) => c.name)?.name !== t.name) ev.add(e.n);
    });
    const at = [...ev].sort((a, b) => a - b);
    const gaps = at.slice(1).map((v, i) => (v - at[i]) / fps);
    const med = median(gaps);
    out.push(g('change', med >= 1.5 && med <= 2.5 ? 'PASS' : 'WARN', `median visual-change interval ${med.toFixed(2)} s over ${at.length} changes (1.5-2.5)`));
  }
  // sound words
  {
    const starts = doc.sfx.map((s) => s.at).sort((a, b) => a - b);
    const close = starts.find((v, i) => i && v - starts[i - 1] < 48);
    let cover = null;
    for (const e of plan) {
      for (const s of e.g.sfx) {
        if (!s.box) continue;
        for (const f of e.g.faces) {
          const dx = Math.max(s.box.x0 - f.x, 0, f.x - s.box.x1);
          const dy = Math.max(s.box.y0 - f.y, 0, f.y - s.box.y1);
          if (Math.hypot(dx, dy) <= f.r && !cover) cover = `frame ${e.n}: ${s.word} covers ${f.cast}'s face`;
        }
      }
    }
    const bad = [close !== undefined && `two sound words start within 48 frames (frame ${close})`, cover].filter(Boolean);
    out.push(g('soundwords', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : `${starts.length} words, spaced 48+ frames, no face covered`));
  }
  // jumps (STORY): at most 2 time jumps per episode, each to a different destination; returns ("jump_back") do not count.
  {
    const jumps = (doc.transitions ?? []).filter((t) => t.type === 'jump');
    const dests = jumps.map((t) => t.dest ?? t.stamp ?? '');
    const bad = [jumps.length > 2 && `${jumps.length} jumps (max 2)`, new Set(dests).size < dests.length && 'two jumps to the same destination'].filter(Boolean);
    out.push(g('jumps', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : `${jumps.length} jump${jumps.length === 1 ? '' : 's'}${dests.length ? ` (${dests.join(', ')})` : ''}`));
  }
  // money shot
  {
    const ms = doc.moneyShot;
    if (!ms) out.push(g('money', 'FAIL', 'no moneyShot in episode.json'));
    else {
      const i = doc.shots.findIndex((s) => s.id === ms.shot);
      const start = doc.shots.slice(0, i).reduce((s, x) => s + x.frames, 0);
      const pct = start / N;
      const hold = i >= 0 ? doc.shots[i].frames / fps : 0;
      const ok = i >= 0 && pct >= 0.65 && pct <= 0.85 && hold >= 0.8 && (ms.hold ?? 0.8) >= 0.8;
      out.push(g('money', ok ? 'PASS' : 'FAIL', `${ms.shot} starts at ${(pct * 100).toFixed(1)}% (65-85) and holds ${hold.toFixed(2)} s (min 0.8)`));
    }
  }
  // plant
  {
    const pl = doc.plant;
    if (!pl) out.push(g('plant', 'FAIL', 'no plant in episode.json'));
    else {
      const miss = plan.filter((e) => e.n >= pl.frames[0] && e.n <= pl.frames[1] && !e.g.plant);
      out.push(g('plant', miss.length ? 'FAIL' : 'PASS', miss.length ? `${pl.anchor} outside the frustum in ${miss.length} frames (first ${miss[0].n})` : `${pl.anchor} in frame for frames ${pl.frames[0]}-${pl.frames[1]}`));
    }
  }
  // loop
  {
    const { dp, deg } = poseDelta(camOf(plan[0]), camOf(plan.at(-1)));
    const last = words.at(-1);
    const gap = last ? Math.abs(N / fps - last.end) : null;
    const bad = [deg > 0.5 && `rotation off by ${deg.toFixed(2)} deg`, dp > 0.02 && `position off by ${(dp * 100).toFixed(1)} cm`, last && gap > 0.6 && `last word ends ${gap.toFixed(2)} s from the end`, !last && !voiceless && 'no words.json'].filter(Boolean);
    const st = bad.length ? 'FAIL' : voiceless ? 'WARN' : 'PASS';
    out.push(g('loop', st, bad.length ? bad.join('; ') : `pose within ${deg.toFixed(2)} deg / ${(dp * 100).toFixed(1)} cm${last ? `, last word ${gap.toFixed(2)} s from the end` : '; no voice, word end not checked'}`));
  }
  // captions
  {
    let bad = null;
    for (const e of plan) {
      const c = e.caption;
      if (!c) continue;
      if (c.x + c.width / 2 > W * 0.85 || c.x - c.width / 2 < 0 || c.y + c.height / 2 > H * 0.8) {
        bad = `frame ${e.n}: "${c.text}" outside the safe zone`;
        break;
      }
    }
    out.push(g('captions', bad ? 'FAIL' : 'PASS', bad ?? (words.length ? 'inside the safe zone (not bottom 20%, not right 15%)' : 'no captions (no voice)')));
  }
  // script
  {
    if (!script) out.push(g('script', soft ? 'PASS' : 'WARN', 'no script.json'));
    else {
      const text = script.lines.map((l) => l.text).join(' \n').toLowerCase().replace(/[’‘]/g, "'");
      const hit = BANNED.filter((p) => text.includes(p));
      const odd = [];
      for (const l of script.lines.filter((x) => x.speaker === 'narrator')) {
        for (const sen of l.text.replace(/\[[^\]]*\]/g, ' ').split(/(?<=[.!?…])\s+/).filter((x) => x.trim())) {
          const n = sen.trim().split(/\s+/).length;
          if (n < 6 || n > 22) odd.push(`${l.id} ${n}w`);
        }
      }
      if (hit.length) out.push(g('script', 'FAIL', `banned: ${hit.join(', ')}`));
      else out.push(g('script', odd.length ? 'WARN' : 'PASS', odd.length ? `sentences outside 6-22 words: ${odd.slice(0, 6).join(', ')}` : 'sentences 6-22 words, no banned phrases'));
    }
  }
  // variety
  {
    if (soft) out.push(g('variety', 'PASS', 'scratch episode: not compared'));
    else {
      const prev = index.filter((x) => x.id !== id);
      const bad = [];
      const two = prev.slice(-2);
      if (two.length && two.every((x) => x.hookType === doc.hookType)) bad.push(`hookType "${doc.hookType}" equals the previous ${two.length}`);
      for (const x of prev.slice(-5)) {
        const r = editRatio(doc.presets, x.presets);
        if (r < 0.3) bad.push(`preset sequence only ${(r * 100).toFixed(0)}% different from ${x.id}`);
      }
      out.push(g('variety', bad.length ? 'FAIL' : 'PASS', bad.length ? bad.join('; ') : `${prev.length} earlier episodes compared`));
    }
  }
  // look (preview stills)
  {
    if (!stills) out.push(g('look', 'WARN', 'no preview stills measured'));
    else {
      const bad = [];
      let used = 0;
      for (const mode of ['night', 'day']) {
        const set = stills.filter((s) => s.light === mode && !HOOK.has(s.preset) && s.preset !== 'snap');
        if (!set.length) continue;
        used += set.length;
        const mean = (k) => set.reduce((a, s) => a + s[k], 0) / set.length;
        for (const [k, [lo, hi]] of Object.entries(LOOK[mode])) {
          const v = mean(k);
          if (v < lo || v > hi) bad.push(`${mode} ${k} ${k === 'dark40' || k === 'sat' ? v.toFixed(3) : v.toFixed(1)} outside ${lo}-${hi}`);
        }
      }
      out.push(g('look', !used ? 'WARN' : bad.length ? 'FAIL' : 'PASS', !used ? 'only dive, rise and snap stills' : bad.length ? bad.join('; ') : `${used} stills in range`));
    }
  }
  // full render only
  if (full) {
    const m = full.motion;
    out.push(g('motion', m === null || m === undefined ? 'WARN' : m < 0.015 || m > 0.06 ? 'FAIL' : full.shotsOver?.length ? 'WARN' : 'PASS', `median ${m === null || m === undefined ? 'n/a' : (m * 100).toFixed(2) + '%'} (1.5-6%)${full.shotsOver?.length ? `; shots over 6%: ${full.shotsOver.join(', ')}` : ''}`));
    const l = full.lufs;
    out.push(g('loudness', l === null || l === undefined ? 'WARN' : Math.abs(l + 14) > 0.5 ? 'FAIL' : 'PASS', `${l === null || l === undefined ? 'n/a' : l.toFixed(1)} LUFS (-14 +-0.5)`));
  }
  return out;
}

export const formatGates = (gates) => gates.map((x) => `${x.status} ${x.name}: ${x.msg}`).join('\n') + '\n';
export const failed = (gates) => gates.some((x) => x.status === 'FAIL');
