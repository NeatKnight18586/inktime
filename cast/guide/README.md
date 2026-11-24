# Tick, the guide

Silent mime only "you" can see. Never speaks. Code: `engine/cast/tick.mjs` (drawn parametrically to a canvas, like the
stick cast; same six 2.5D tricks). Poses: `cast/guide/poses.json`. Units: head diameters D (1 D = 0.5 m, the cast unit).

## Design
- A floating pocket watch 0.34 m (0.68 D) across: a white face (paper #F4EFE6) shaded as a sphere toward the key light,
  0.035 D ink outline (+-15% brush), 4 tick marks at 12, 3, 6 and 9, no numerals.
- One large dot eye (0.15 D) just above centre (0.06 D), with a tiny highlight; blinks seeded like the cast.
- Two clock hands grow from the eye and are its brows (hour 0.19 D, minute 0.26 D, tapered). Expression = hand angles:
  calm 10:10, alert 12:00 (both up), sad 8:20, worried 9:15.
- A winding crown on top in #E8336D (the only accent colour, never in a palette) with a short hanging ink chain.
- Two stick arms (0.62 D, 0.045 D thick, ink-nub hands 0.12 D), no legs.
- Floats: 0.6 Hz, 2 cm bob. Its shadow is a silhouette decal on the nearest surface (rays down, +-x, +-z), never a lamp
  shadow: Tick casts and receives no shadow-map shadow, so it never darkens another character.

## Countdown ring
episode.json `"countdown": [{ "at": frame, "value": v }, ...]`: a magenta (#E8336D) arc round the face rim from 12 o'clock,
clockwise. Keys interpolate linearly; full = the first value. At 0 the ring flashes 3 times on twos (12 frames). A later
key with a higher value refills it over 12 frames from that key's frame. No `countdown`: no ring.

## Poses (params)
`armL`/`armR` [shoulder, elbow] deg (as the stick cast) or `reachL`/`reachR` [x, y] D from the face centre (2-bone IK),
`face` (calm | alert | sad | worried) or `hands` {hour, minute} deg, `eye` (dot | wide | closed), `tilt`, `dx`, `dy`,
`shake` (D, alternates on twos), `spin` (hand spin deg; the minute hand spins twice as fast). Multi-drawing poses list
`drawings` shown on twos (`loop: false` holds the last); `drift` [x, y, z] m/s moves Tick away.
idle, stare, point, panic (hands spinning, 3 drawings), facepalm (hand over the eye), shiver, slap (arm swing, 3 drawings,
once), mime_walk_away (pats a pocket and struts, 4 drawings).

## Placement
Card spec `{ "cast": "guide", "anchor": "guide_spot", "track": [...] }` (optional `face` override, `offset` [x, y, z] m,
`facing` deg; by default Tick faces the eye). guide_spot is a free spot inside the basket above Fleet's head line, outside
the centre 40% of the frame, never occluding a character's face (tests/rig.test.mjs). In the crow's nest: 25 deg left of
forward, 1.1 m from the eye, 0.15 m above it (kits/sets/titanic_crowsnest.mjs GUIDE).
