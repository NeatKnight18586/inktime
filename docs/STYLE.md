# STYLE — Ink Time (source of truth)

## Format
1080x1920, 24 fps, H.264 yuv420p. Episode 30–55 s, target 35–50 s.

## Method
- Shading, ink and blacks are authored per material and per object, never fixed with global light knobs (the Guilty Gear Xrd rule). Each material takes four controls, set by the kit per object:
  - shadowBias (-1..1): shifts both toon thresholds by bias x 0.3 (+ = more of the surface in shadow).
  - spotBlack (false | true | "unlit"): the darkest step becomes ink #141414 — never, always, or only where no lamp faces it (default "unlit").
  - lineScale: multiplies the outline width. noRim: the material takes no rim light.
- The ramp thresholds are fixed (t1 0.10, t2 0.30) and are never tuned again.
- The look is approved on still style frames (tests/styleframes.json, commit with [stills]) before any motion render. Each still is measured and reduced to a notan: 3 values (dark < 60, mid, light >= 140 luma) on an 18x32 grid. WARN only: dark mass 20-55% of cells, and the brightest cell cluster within 1 cell of the frame's focus anchor.

## Look
- Painted textures (engine/look/paint.mjs): seeded canvas textures, 512 px, cached per material. Each uses 2-3 flat values with hard edges (painted, never noise) plus 5% paper grain.
  - wood: planks with 1-2 px ink seams, grain streaks, worn patches.
  - steel: plate seams, rivet dots, rust/grime streaks running down from rivets, a darker bottom edge.
  - rope and canvas: hatching.
  - ice: faceted, with frost hatch strokes on the lit side.
  - Corner darkening: one darker band in creases and corners (baked per vertex).
  - Rim: a painted wooden cap rail 3 cm high, so its top reads as a thin cool line and never a band; frost only as thin hatch strokes and small drifts in the corners (no "cake icing" frost).
- Depth and motion, every frame:
  - Three layers: foreground (hands, forestay, rim edge), middle (lit forecastle: lamps, windlass, bollards), background (sea, haze, iceberg).
  - Rigging and ropes sway 0.25 Hz, plus or minus 1.5 deg.
  - Camera base motion on every shot, bounded: the dolly eases in and out and moves at most 0.25 m per shot; beyond that only the FOV push (1 deg/s, at most 8 deg per shot) plus breathing sway (0.25 Hz, 0.15 deg pitch, 4 mm). The eye never comes closer than 0.45 m to the rim. No frame is ever still.
- Misregistration: the colour layer sits 1–2 px off the line layer, growing to 4 px with distance. This replaces depth-of-field. Never blur.
- Paper grain: 5% multiply, re-seeded every 2 frames.
- Every shot has foreground, midground and background. At least 12 props in view. Every set has 3 story props (signs someone lives there).
- Palette per look: 5 colours + ink #141414 + paper #F4EFE6. Guide accent #E8336D never appears in any palette.
- Night targets (tools/measure.mjs, 270 px wide; every shot and the whole film): luma mean 70-95; share < 40 between 6% and 30%; p5 at most 25; p95 at least 170; saturation 0.30-0.50; motion median 1.5-6%; still frames at most 10%; longest still run at most 19 frames.

## Light
- The ship is the key light.
- Sky: posterized 3-band vertical gradient, zenith navy #1B2A41 to a horizon band of steel #4A5A6A lifted 25% in value; stars only above 15 deg elevation; 5% of stars twinkle on twos.
- Sea: banded steel-navy, low swell (0.3 m, 8 s period), short frost-coloured glint dashes that drift with the swell.
- Key: every deck lamp and porthole is a lamp #E8A64B light with toon falloff in 3 hard-edged pools, plus a real glow: an additive sprite (fog false, toneMapped false) in two hard steps of lamp #E8A64B at 60% and 25% alpha, never grey; lamps flicker plus or minus 3% on twos. Fill: cool hemisphere light, ice #9FD3E0 at 35%.
- Toon ramp, 3 steps: shadow = base x 0.55 tinted toward navy (never black), mid = base, lit = base mixed 40% toward the light colour. True black is ink only.
- Spot blacks (comic rule): surfaces in the darkest step that face away from every lamp, and contact shadows under objects, render as solid ink #141414 instead of the tinted shadow tone.
- Depth haze in 3 bands, steel/ice blend: 0% at the camera, 60% at the horizon.
- Ship exterior: rows of lit portholes (lamp squares in 2 px ink frames) and lit bridge windows, so the aerial reads as a glowing ship. Porthole and bridge-window cores emit a warm white #FFE7B8 inside the lamp-colour glow; the bow wave and wake are frost white with fog off (per material). Halos and lit portholes are at least 6 px on screen at any distance, so the ship sparkles.
- The aerial is alive (it is the hook): the ship steams forward at 22 knots (11.3 m/s); a frost-white V of foam spreads from the stern plus a bow wave, both animated and outlined in ink; funnel smoke drifts aft at ship speed. Four funnels; smoke from the first three only (the fourth was a ventilation dummy): ink-outlined puffs on twos, drifting aft. Aerial per-shot targets: p95 at least 170, p5 at most 25, motion median at least 1.5%.
- Scale facts: the iceberg stands 18 m above the water; the bow is 850 m from it at frame 0 and 457 m at the money shot; the ship makes 11.3 m/s. The ship's heading starts 42 deg off the line to the iceberg and turns to dead ahead of it by the money shot (about 33 s), so the aerial sees her three-quarter on.
- Aerial frame 0 is a telephoto: the camera sits 55 m behind the iceberg's crest and 6 m above it, vFOV 30. The ship fills 50-70% of the width in the middle band, with four funnels and lit porthole rows; the iceberg is a near-black mass (spotBlack, fog false, a 2 px frost rim on its top edge only) in the bottom-left 30-40%.
- The dive (at most 3 s) is a dolly-zoom FPV move on one Catmull-Rom spline: push over the crest, drop to 4 m above the water, rush at the bow (ease-in; speed streaks are a directional misregistration of the colour layer), pull up the foremast, flip into the nest facing forward, a 2-frame landing shake. FOV 30 -> 84 during the rush, settling to 72. Speed may exceed realism. The rise is its exact reverse and ends on frame 0's pose and FOV.

## Ink
- At 1080 px wide. Silhouettes (depth breaks) 6-8 px, scaled by distance: x1 within 5 m, x0.6 at 30 m, x0.35 beyond 200 m.
- Creases (normal breaks) 2-3 px. Texture lines 1-2 px.
- Seeded width variation of plus or minus 20% along each line and tapered ends, so it reads as brush. Boil every 2 frames (±0.6 px, seeded).
- Ink #141414 near the camera, mixed toward the haze colour with distance.
- Inverted hull on every mesh (back faces, ink) plus the screen-space pass on depth and normals.

## Characters (parametric stick rigs, 2.5D)
- Code: engine/cast/stick.mjs draws a parametric 2D character to a canvas texture (maths in engine/cast/stickmath.mjs, card in engine/rig/card.mjs). No hand-drawn SVGs. Units are head diameters (D); 1 D = 0.5 m in the world.
- Proportions: total height 3.5 D. Round head 1 D overlapping the body by 0.08 D. Capsule body 0.88 D wide, 1.4 D long. Legs 1.0 D. Stick limbs 0.045 D thick, arms 1.3 D. Ink-nub hands 0.12 D. Dark oval shoes 0.18 D.
- Ink: outline 0.035 D, varying plus or minus 15% for a brush feel, colour #141414.
- Face: dot eyes 0.075 D with a tiny highlight, spaced 0.27 D, at head centre; default smug half-lid; tapered brows 0.19 D wide, 0.17 D above the eyes; mouth set line, smirk, o, grin, gritted, frown, shout; optional soft cheek patch.
- Params, no new code per character (cast/<id>/char.json): hat {type, colours}, shirt colour plus details (pocket, buttons, collar, scarf), trousers colour, accessories. Identity by one prop + one palette colour, never by faces. Fleet: dark peaked cap, navy coat, amber scarf. Lee: frost-white knit cap, collar turned up.
- Poses (cast/<id>/poses.json) are joint angles: shoulders, elbows, hips, knees, head tilt, plus eyes, brows, mouth, e.g. {"armL": [40, 90], "armR": [-10, 20], "legL": [5, 0], "legR": [-5, 0], "tilt": 4, "eyes": "half", "mouth": "smirk"}. Each character has idle, lean_forward, squint, point, alarm, shiver; Fleet also edge (leaning, back three-quarter) and phone_shout; Lee also talk and scoff.
- Animation, cheap: the player interpolates poses (6-frame blend) and updates the drawing on twos; the camera moves on ones. Idle breathing: body scale y plus 1.5% at 0.3 Hz. Blinks: closed 2-3 frames, every 2-4 s, seeded. Talk: the mouth alternates o/line on twos while the character speaks.
- The six 2.5D tricks (all required):
  - a) Billboard: the card yaw-faces the camera every frame; pitch-billboard limited to 15 deg.
  - b) Volume shading: the head is shaded as a sphere, the body and limbs as cylinders, with a smooth radial/linear gradient (lit, mid, shade) in the card's own colours. The light direction is the scene key light converted into camera space each frame, so the lit side moves as the camera moves. Rim light 0.03 D in the key colour on the lit edge. The whole card is multiplied by the scene tint.
  - c) Fake head turn: face features shift toward the look direction (0.05-0.18 D, from the angle between the character's facing and the camera) and the hat brim shifts with them.
  - d) Ground shadow: an invisible shadow-proxy plane with the same silhouette, rotated to face the key light, casts a real shadow (alphaTest, colorWrite false). A soft contact ellipse at the feet.
  - e) Depth order: the far arm and far leg are drawn behind the body, 10% darker.
  - f) Lighting per scene: key direction, shade colour, rim colour and tint come from the look file (cast block), so the same character works in day and night.
- Fleet at cam_lookout is a foreground edge silhouette in the edge pose: only the cap brim, shoulder and amber scarf catch light and fill the left 12-20% of frame width; the rest of him, face included, is on the shadow side (dark nest tone). His face is shown only in glance shots (FOV 52), framed head and shoulders.
- 8 poses each; change pose every 1.5–2.5 s while on screen.

## Guide
- Silent mime only "you" can see. Never speaks. On screen in POV except where a shot says otherwise, never off screen more than 8 s. Design: cast/guide/README.md.

## Hands (you)
- XIII style. Realistic proportions, never cartoon nubs.
- Two flat skin tones: lit = lamp #E8A64B mixed 55% toward paper #F4EFE6; shadow = lit x 0.7 toward navy. One hard-edged shadow shape per finger group.
- Outline 8 px, knuckle creases 2-3 px; navy wool cuff with knit hatching.
- A 3D viewmodel, as in FPS games (engine/rig/hands3d.mjs): an existing rigged hand (@webxr-input-profiles generic-hand, MIT; assets/hands/) in camera space, bottom-right 25-35% of the frame, multiplied by the scene tint. Material: the toon ramp in the two skin tones, lit by the 1b.2 hand light (warm amber key from below, ice rim on the upper edges). Ink: a second SkinnedMesh sharing the skeleton, back faces pushed out along the skinned normal in the vertex shader, lineScale 1.3. Cuff: a navy knit-hatch cylinder on the wrist bone.
- Poses are tiny JSON (cast/hands/poses.json): curl per finger 0..1, spread, thumbOppose, wrist [pitch, yaw, roll] deg. Curl c gives proximal 70c, intermediate 95c, distal 65c deg. rail_grip (curls 0.75-0.9, thumbOppose 0.7) wraps a 4 cm rail; padlock_hold. Poses blend over 3 frames, updated on twos; the viewmodel lags the camera breathing by 2 frames and keeps its place in frame when the FOV zooms.
- On screen at least 40% of POV time. Animated on twos. Look 2.1 is frozen for Episode 1: further look ideas go to docs/LEARNINGS.md.

## Sound words
- Hand-lettered SVG from tools/letter.mjs, 3 variants per word, never a font.
- Placed in 3D at the sound source. Pop in over 3 frames (scale 0.6 → 1.1 → 1.0), hold, fade over 12 frames. Max one per 2 s.

## Captions (separate layer)
- 1–2 words per card, timed to words.json. Font: Anton. White, 8 px ink outline, centred at 33% of height. Never in the bottom 20% or right 15%.

## Camera (POV)
- Eye height 1.62 m. three.js vertical FOV: 72° default, 84° scale, 52° insert, 20° snap zoom. A reveal (the money shot) is a subjective snap zoom to vFOV 20, an insert: p5 and dark40 do not apply to it, the target sits at 40% of frame height and the bow is out of frame. At or above 80° the Panini pass keeps verticals straight.
- Bands: top 30% scale/sky, middle 40% subject/eye-line, bottom 30% hands/foreground.
- Dolly only in walk, dive and rise. Lookout and held shots have dolly 0: FOV push and breathing only.
- Walk bob only while walking: 1.8 Hz, 1.5 cm vertical, 0.4° roll. Breathing at rest: 0.25 Hz, 4 mm (0.15 deg pitch).
- Glance 0.35–0.6 s ease-in-out, then a 2–3 frame settle. Max rotation 90°/s except whip (8 frames).
- Sound leads camera: the head turns to an off-frame sound 6–10 frames after it starts.
- Presets: walk, glance, look-up, look-down, kneel, held, witness (third-person wide, at most 15% of runtime, never in the first 3 s), whip, dive (the God's-eye opening: one unbroken telephoto-to-dolly-zoom move from the episode's aerial frame straight into the POV eye in at most 3 s), rise (its exact reverse, closing the loop on frame 1's exact pose and FOV).
- Transitions: blink (8 frames, ink eyelids), sting (12-frame ink-splash reveal under the first word; it also closes the loop), whip-glance, match-cut through a round shape.

## Pacing
- A visual change every 1.5–2.5 s. No freeze of 1.2 s or more. Frame 1 has motion, a sound word and the first caption. Narration runs at 190-200 words a minute.
- Money Shot starts between 65% and 85% of runtime and holds 0.8 s.

## Loop (every episode)
- Every episode opens with the dive and closes with the rise. The last line leads back into the hook sentence; the rise ends on frame 1's exact pose.
- Plant and guide easter egg visible in the first 2 s. Music cut to the bar. Room tone continuous across the join.

## Audio
- -14 LUFS integrated, -1 dBTP. Music ducks 9 dB under voice. Room tone is never silent.
