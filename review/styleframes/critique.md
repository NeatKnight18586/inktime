# Style frame critique (look 2.1, round 3, commit 089746e)

Aerial frame 0 and the money shot are the new frames. Rounds used: 1 + 2 (per-material controls and light positions only). Stills do not pass fully, see "Open".

## F1_aerial (aerial frame 0): lumaMean 83.4, dark40 12.1%, p5 20, p95 126 MISS, sat 0.299 MISS; notan dark 19.1 (WARN) / mid 78.5 / light 2.4
- Value structure: a mid-tone frame. The near-black iceberg fills the bottom-left, the ship is the only light mass in the middle band; sky and sea are flat mid bands. Dark mass is 19.1%, just under the 20% WARN.
- Focal point: the ship's midships is the brightest cluster (12 cells, peak 202), 0 cells from the focus anchor.
- Ink weight: the iceberg is solid ink with a thin frost edge on its top only; the ship carries thin ink at 850 m (x0.35), so she reads as a light shape, not a lined one.
- Depth layers: iceberg (foreground, bottom-left), ship (middle), sea and sky (background). The sea between is empty.
- Readability at phone size: the ship spans 60% of the width, three-quarter on, with four funnels, white superstructure and an amber porthole band. Funnel smoke and the reflection read. p95 stays low because the lit area (ship) is under 5% of the frame.

## F2_lookout (lookout at 2 s): p5 20, mean 81.3, p95 174, dark40 16.6%; notan dark 24.8 / mid 70.1 / light 5.0. All targets met
- Value structure: black basket along the bottom, lit amber deck, mid sky/sea; the top 60% is still a flat run of mid bands.
- Focal point: the brightest cluster is the hand (cell 16,26), 1 cell from the hand anchor. Fleet's card is no longer the brightest: his card is dark, with only brim, shoulder and scarf lit.
- Ink weight: the hand has an 8 px class outline from the skinned hull, the cuff a heavy one; the cap rail is now a thin line.
- Depth layers: the hand and the rail are the foreground, the lit forecastle the midground, the sea and horizon the background.
- Readability at phone size: the hand reads as a gripping fist with a knit cuff. Seen from behind and above it is foreshortened; the pose (wrist) is fixed after round 1, so it was not changed in later rounds.

## F3_money (money shot, vFOV 20, 457 m): lumaMean 95.1 MISS (limit 95), p95 118 MISS; p5 and dark40 n/a (insert); notan dark 9.5 / mid 88.9 / light 1.6
- Value structure: the frost-lit crest is the only light mass; below it the berg is solid ink. The rest is mid sea and sky.
- Focal point: the brightest cluster (6 cells, peak 201) sits on the crest, 0 cells from the anchor.
- Ink weight: the forestay is a heavy vertical ink line through the centre of the berg; the berg shows a thin frost edge.
- Depth layers: berg and horizon are background only; the stay is the sole foreground element.
- Readability at phone size: the berg is 207 px tall (target 90), centred at 40% height, the bow is out of frame.

## Open (look frozen for Episode 1; ideas go to docs/LEARNINGS.md)
- F1 p95 126 (target 170), sat 0.299 (0.30), notan dark 19.1% (20%): a single aerial frame has too little lit area. The per-shot figures come from the full looktest render, which was not run.
- F3 p95 118 (170) and lumaMean 95.1 (95): the insert is a small bright patch in a mid frame.
