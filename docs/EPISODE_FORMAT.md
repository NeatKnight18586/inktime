# Episode folder: episodes/<id>/
- script.json: {"lines":[{"id":"L1","speaker":"narrator|<castId>","text":"..."}]}
- episode.json: the spec below.
- audio/: voice.mp3 (ONE file, all lines in order, recorded by the user in ElevenLabs; never generated), words.json (from forced alignment), sfx/<name>.mp3 (generated), music.mp3 (supplied by the user).
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
