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
  - Rim: a painted wooden cap rail; frost only as thin hatch strokes and small drifts in the corners (no "cake icing" frost).
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
- Key: every deck lamp and porthole is a lamp #E8A64B light with toon falloff in 3 hard-edged pools, plus a 2-step additive halo sprite; lamps flicker plus or minus 3% on twos. Fill: cool hemisphere light, ice #9FD3E0 at 35%.
- Toon ramp, 3 steps: shadow = base x 0.55 tinted toward navy (never black), mid = base, lit = base mixed 40% toward the light colour. True black is ink only.
- Spot blacks (comic rule): surfaces in the darkest step that face away from every lamp, and contact shadows under objects, render as solid ink #141414 instead of the tinted shadow tone.
- Depth haze in 3 bands, steel/ice blend: 0% at the camera, 60% at the horizon.
- Ship exterior: rows of lit portholes (lamp squares in 2 px ink frames) and lit bridge windows, so the aerial reads as a glowing ship. Halos and lit portholes are at least 6 px on screen at any distance, so the ship sparkles.
- The aerial is alive (it is the hook): the ship steams forward at 22 knots (11.3 m/s) and the camera tracks with it; a frost-white V of foam spreads from the stern plus a bow wave, both animated and outlined in ink; funnel smoke drifts aft at ship speed; the camera adds a slow push of 3% per second. Aerial per-shot targets: p95 at least 170, motion median at least 1.5%. Four funnels; smoke from the first three only (the fourth was a ventilation dummy): ink-outlined puffs on twos, drifting aft.

## Ink
- At 1080 px wide. Silhouettes (depth breaks) 6-8 px, scaled by distance: x1 within 5 m, x0.6 at 30 m, x0.35 beyond 200 m.
- Creases (normal breaks) 2-3 px. Texture lines 1-2 px.
- Seeded width variation of plus or minus 20% along each line and tapered ends, so it reads as brush. Boil every 2 frames (±0.6 px, seeded).
- Ink #141414 near the camera, mixed toward the haze colour with distance.
- Inverted hull on every mesh (back faces, ink) plus the screen-space pass on depth and normals.

## Characters (hybrid cards in 3D)
- Units are head diameters (D). Proportions: height 3.5 D; round paper-white #F4EFE6 head; capsule body 0.88 D wide; stick limbs 0.05 D; ink-nub hands 0.12 D.
- Face: dot eyes 0.075 D, spaced 0.27 D, with a tiny highlight; tapered brows; a one-line mouth.
- Outline 0.06 D brush, width varying plus or minus 25%.
- Shading: a flat shadow tone plus 45 deg ink hatching (3 px spacing) on the side away from the key light; a 2 px rim in the key colour on the lit edge; the whole card multiplied by the scene tint.
- Blinks: 2-3 frames closed, every 2-4 s, seeded.
- Identity by one prop + one palette colour, never by faces. Fleet: peaked cap, amber scarf, navy coat.
- Fleet at cam_lookout is a foreground edge silhouette — cap brim, shoulder and amber scarf — filling the left 12-20% of frame width. His face is shown only in glance shots (FOV 52), framed head and shoulders. Characters keep 3.5 D proportions.
- Billboard on yaw only; flat ellipse contact shadow.
- Animated on twos: pose state updates every 2nd frame. The camera moves on ones.
- 8 poses each; change pose every 1.5–2.5 s while on screen.

## Guide
- Silent mime only "you" can see. Never speaks. On screen in POV except where a shot says otherwise, never off screen more than 8 s. Design: cast/guide/README.md.

## Hands (you)
- XIII style. Realistic proportions, never cartoon nubs.
- Two flat skin tones: lit = lamp #E8A64B mixed 55% toward paper #F4EFE6; shadow = lit x 0.7 toward navy. One hard-edged shadow shape per finger group.
- Outline 8 px, knuckle creases 2-3 px; navy wool cuff with knit hatching.
- Drawn as a camera-space quad in the bottom-right 25-35% of the frame, multiplied by the scene tint (engine/rig/hands.mjs).
- On screen at least 40% of POV time. Animated on twos.

## Sound words
- Hand-lettered SVG from tools/letter.mjs, 3 variants per word, never a font.
- Placed in 3D at the sound source. Pop in over 3 frames (scale 0.6 → 1.1 → 1.0), hold, fade over 12 frames. Max one per 2 s.

## Captions (separate layer)
- 1–2 words per card, timed to words.json. Font: Anton. White, 8 px ink outline, centred at 33% of height. Never in the bottom 20% or right 15%.

## Camera (POV)
- Eye height 1.62 m. three.js vertical FOV: 72° default, 84° scale, 52° insert. At or above 80° the Panini pass keeps verticals straight.
- Bands: top 30% scale/sky, middle 40% subject/eye-line, bottom 30% hands/foreground.
- Dolly only in walk, dive and rise. Lookout and held shots have dolly 0: FOV push and breathing only.
- Walk bob only while walking: 1.8 Hz, 1.5 cm vertical, 0.4° roll. Breathing at rest: 0.25 Hz, 4 mm (0.15 deg pitch).
- Glance 0.35–0.6 s ease-in-out, then a 2–3 frame settle. Max rotation 90°/s except whip (8 frames).
- Sound leads camera: the head turns to an off-frame sound 6–10 frames after it starts.
- Presets: walk, glance, look-up, look-down, kneel, held, witness (third-person wide, at most 15% of runtime, never in the first 3 s), whip, dive (the God's-eye opening: one unbroken move from the episode's aerial anchor straight into the POV eye in at most 3 s), rise (the reverse, closing the loop on frame 1's exact pose).
- Transitions: blink (8 frames, ink eyelids), sting (12-frame ink-splash reveal under the first word; it also closes the loop), whip-glance, match-cut through a round shape.

## Pacing
- A visual change every 1.5–2.5 s. No freeze of 1.2 s or more. Frame 1 has motion, a sound word and the first caption. Narration runs at 190-200 words a minute.
- Money Shot starts between 65% and 85% of runtime and holds 0.8 s.

## Loop (every episode)
- Every episode opens with the dive and closes with the rise. The last line leads back into the hook sentence; the rise ends on frame 1's exact pose.
- Plant and guide easter egg visible in the first 2 s. Music cut to the bar. Room tone continuous across the join.

## Audio
- -14 LUFS integrated, -1 dBTP. Music ducks 9 dB under voice. Room tone is never silent.
