# STYLE — Ink Time (source of truth)

## Format
1080x1920, 24 fps, H.264 yuv420p. Episode 30–55 s, target 35–50 s.

## Look
- Outlines: inverted hull on every mesh (back faces, ink #141414), thickness 1.5–3% of object size, plus a screen-space edge pass on depth and normals. Line width 3 px within 3 m of camera, falling to 1 px beyond 40 m.
- Line boil: the edge pass re-jitters every 2 frames (±0.6 px, seeded).
- Misregistration: the colour layer sits 1–2 px off the line layer, growing to 4 px with distance. This replaces depth-of-field. Never blur.
- Shading: MeshToonMaterial, 3-step ramp (1.0 / 0.62 / 0.35 of base). Shadows shift toward the palette's darkest colour, never grey or black.
- Paper grain: 5% multiply, re-seeded every 2 frames. Fog: linear, palette fog colour.
- Depth: every shot has foreground, midground and background. At least 12 props in view. Every set has 3 story props (signs someone lives there).
- Palette per look: 5 colours + ink #141414 + paper #F4EFE6. Guide accent #E8336D never appears in any palette.

## Characters (2D cards in 3D)
- SVG cards: round white head, dot eyes, one-line mouth, bean torso, stick limbs 7 px, ink outline 5 px (at 1080 wide).
- Identity by one prop + one palette colour, never by faces.
- Billboard on yaw only; flat ellipse contact shadow.
- Animated on twos: pose state updates every 2nd frame. The camera moves on ones.
- 8 poses each; change pose every 1.5–2.5 s while on screen.

## Guide
- Silent mime only "you" can see. Never speaks. On screen in POV except where a shot says otherwise, never off screen more than 8 s. Design: cast/guide/README.md.

## Hands (you)
- SVG in camera space, bottom third. On screen at least 40% of POV time. Animated on twos.

## Sound words
- Hand-lettered SVG from tools/letter.mjs, 3 variants per word, never a font.
- Placed in 3D at the sound source. Pop in over 3 frames (scale 0.6 → 1.1 → 1.0), hold, fade over 12 frames. Max one per 2 s.

## Captions (separate layer)
- 1–2 words per card, timed to words.json. Font: Anton. White, 8 px ink outline, centred at 33% of height. Never in the bottom 20% or right 15%.

## Camera (POV)
- Eye height 1.62 m. three.js vertical FOV: 72° default, 84° scale, 52° insert. At or above 80° the Panini pass keeps verticals straight.
- Bands: top 30% scale/sky, middle 40% subject/eye-line, bottom 30% hands/foreground.
- Walk bob only while walking: 1.8 Hz, 1.5 cm vertical, 0.4° roll. Breathing at rest: 0.25 Hz, 0.3 cm.
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
