# Episode folder: episodes/<id>/
- script.json: {"lines":[{"id":"L1","speaker":"narrator|<castId>","text":"..."}]}
- episode.json: the spec below.
- audio/: voice.mp3 (ONE file, all lines in order, made by the user by hand; never generated), words.json ({meta:{lead,matchRate}, words:[{line,w,word,start,end,matched}]}, times in timeline seconds, from tools/align.mjs; words.raw.json when there is no script), sfx/<name>.mp3|wav (optional uploads; missing ones are synthesized into out/sfx), music.mp3 (made by the user by hand), voice_edit.wav (only when voicePauseMax or voiceTempo is set).
- facts.md: claim | status (verified / contested / dramatised / device / user verifying) | sources.
- results.md: YouTube link and 48-hour stats, added after posting.
- out/: never committed.

# episode.json
{
 "id": "ep001-titanic-key",
 "title": "...",
 "fps": 24,
 "look": "titanic_night",
 "set": "titanic_crowsnest",
 "cast": ["fleet","lee","guide"],
 "hookType": "countdown|wrong-detail|instruction",
 "countdown": [["L1:0",40],["L4:0",30]],
 "voiceTempo": 1.0,
 "voicePauseMax": 0.28,
 "musicBpm": 70,
 "musicHit": 12.0,
 "sfxLibrary": [{"name":"creak","prompt":"...","seconds":1.5,"loop":false}],
 "beds": ["wind_rigging","engine_hum","sea_calm"],
 "shots": [{
   "id":"S1", "start":"L1:0", "preset":"held", "fov":72,
   "lookAt":"<anchor>", "params":{},
   "hands":[["L1:0","<handPose>"]],
   "guide":[["L1:0","<anchor>","<pose>"]],
   "poses":{"lee":[["L3:0","talk"]]},
   "sfxWords":[["L1:0","CREAK","<anchor>"]],
   "sfx":[["L1:0","creak"]],
   "light":"night", "transitionIn":"sting|blink|whip|match|cut"
 }],
 "moneyShot": {"shot":"S9","hold":0.8},
 "plant": {"anchor":"iceberg_dark","frames":[0,48]},
 "loop": {"lastLine":"L11","firstLine":"L1"}
}
Times: "L<n>:<w>" is the start of word w (0-based) of line Ln from words.json; a number is seconds; "+8f" after a time adds frames (e.g. "L3:0+8f"). Anchors are named Object3Ds exported by the set kit. A shot lasts until the next shot starts.

# Phase 5 additions (bake and gates)
- tools/bake.mjs <dir> -> out/plan.json (one entry per frame; the engine applies plan[n] only). tools/check.mjs <dir> -> review/<id>/gates.txt (exit 1 on FAIL). tools/preview.mjs renders the 14 preview frames.
- Extra episode.json fields the bake reads: "duration" (seconds; default = last word end + "tail" 0.4), "cards":[{cast, anchor, facing, light, blink, track:[[time,pose]], speak:[[t0,t1]]}], "transitions":[{type, at}], sfxWords entries may carry a 4th element {size, lift, hold}, shot "show":[anchors], shot "params" is passed to the camera preset (plus "soundAt": time of the sound the head turns to). Times may be "15+8f" or "12-4f".
- Ids starting with "_" are scratch episodes (no voice): length, frame-1 sound/caption and loop-word gates are WARN, variety is skipped, and CI skips the audio jobs.

# Phase 6 additions (ep001)
- "voiceCuts": [[start, end]] (seconds in voice.mp3): before alignment each span is removed with 10 ms crossfades -> audio/voice_cut.wav, which is aligned and mixed (voice_edit.wav, when asked for, is made from it).
- Alignment reads digits as number words (40 = forty, 1912 = nineteen twelve, 90,000 = ninety thousand).
- Camera slots (engine/rig/slots.mjs) usable as anchors by the guide and by sound words: "cam_left" (x 20%, y 50%), "cam_right" (80%, 50%), "cam_hands" (68%, 66%). Tick at a slot keeps one screen size and draws over the set.
- Shot "light": "iceberg_reveal" (engine/look/lightstate.mjs): over the run of consecutive shots with it, the crest light fades in over 12 frames, the iceberg scales 1.0 -> 1.35 and the world yaws +4 deg.
- The plant gate passes a frame when any part of the anchor object's bounding box is inside the frustum, over plant.frames.
- The first caption card starts at frame 0.
