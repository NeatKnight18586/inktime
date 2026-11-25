# STORY — how Ink Time episodes are made (source of truth)

## Premise (locked)
You are a modern traveller dropped into a real moment seconds before history turns. Nobody notices you; you know what's coming. No present-day setup, no lesson, no return trip on screen.
Tone: tense, with dry jokes. The narrator speaks in second person ("You have forty seconds..."). The guide, Tick, is a silent mime only you can see.

## Topic test (all six must pass)
1. One specific, little-known true detail, not "what was X like".
2. A real moment you can stand inside, in first person.
3. A Money Shot: one scale reveal.
4. A twist that is a true fact with 2 sources.
5. History, or myth and scripture from before 1929. No copyrighted fiction.
6. Not graphic: violence cuts to black; no gore; no distress for its own sake.
For myths, the twist is what the original text actually says.

## Opening and close (brand signature)
Every episode opens with the God's-eye dive: from far above the moment (the whole ship, the city, the battlefield) in one unbroken move straight down into your eyes, in at most 3 s, over the hook line. It closes with the rise back up to the same frame, so the loop is seamless. The plant should be visible from above.

## Hooks (rotate; never the same type 3 episodes in a row)
- countdown (flagship): "You have forty seconds to/before..."
- wrong-detail: "Everyone here is cheering. In forty seconds..."
- instruction: "Whatever happens, don't drop this."
At most 12 words, spoken from frame 1, over the dive. Name the famous thing (Titanic, Pompeii, Apollo 11) in the first line. Countdown hooks call out the time at least twice later ("Thirty seconds."); the guide's ring shows it.

## Beat sheet (target 40 s, 125-140 words at 190-200 words a minute; a new fact, joke, reveal or clock call every 3-5 s)
0-2 s Hook. 2-6 s Stakes: place shown through things, not dates; one exact number. 6-14 s The local: confidently wrong; opens loop 2 before loop 1 closes. 14-28 s Three tightenings: the clock shortens; one modern-reflex near-miss; loop 3 opens. 24-30 s The why: 2-3 short lines, an everyday comparison, never "You see". 26-34 s Money Shot (65-85% of runtime). 34-40 s Twist that re-frames the hook (ep001: there was never a key to find); the last words lead back into the hook sentence.

## Rewatch stack (all four, every episode)
1. Plant: the answer is visible in the first 2 s and means nothing until the twist.
2. Sentence loop: the last line flows into the first.
3. Audio loop: music ends on a bar; room tone continuous across the join.
4. Guide easter egg: in the first 2 s the guide reacts to something the viewer hasn't noticed.

## Voice
One narrator, the brand voice, reads every line in ElevenLabs v4 with audio tags. He voices the people around you himself, like a storyteller. Every quoted line is attributed in words ("Lee doesn't even turn around.") so the story works with eyes closed. Every visual-only gag needs a sound. The last line is delivered exactly like the first.

## Jokes (choose per story)
Your modern reflexes nearly blowing your cover; locals' confident wrong beliefs; the guide's reactions.

## Ending
A true-fact twist. In about 1 of 6 episodes your own action turns out to cause the moment, and only where that shifts no real person's responsibility.

## Writing rules
- One idea per sentence, 6-22 words, written for the ear. Read it aloud.
- One sensory detail per 10 s; one exact number per episode.
- Banned: delve, it's important to note, imagine a world, little did they know, in a world, what if I told you, triple adjectives.
- Folklore is said as folklore. Contested facts are hedged ("many believe").
- Dramatised dialogue is allowed, never presented as a quote.
- Punctuation directs the read: a full stop is a breath, an ellipsis a held beat.

## Variety (policy guardrail)
Only the 0.5 s sting repeats. Hook type, set, beat details, the guide's role and the outcome change every episode. episodes/index.json tracks this; check.mjs enforces it.

## Packaging
Title of at most 6 words, written as the hook. The first frame is the thumbnail. Pin a comment with the sources.

## Production rules (Phase 6b)
1. Show exactly what's said: the picture shows the thing the words name, when they name it.
2. Something new on screen every 1.5-2.5 s.
3. At least 3 locations, reached by at most 2 time jumps (each to a different place; a return is not a jump).
4. A verb in every shot: someone or something does something.
5. The subject fills at least 25% of the frame (an establishing or scale shot may say otherwise in the storyboard).
6. Readability rules: captions, hands, Tick size and breath as in docs/STYLE.md.
7. Storyboard stills first: episodes/<id>/storyboard.json, one still per beat at its word (tools/storyboard.mjs, commit with [stills]), reviewed with the mute and match tests before any motion render.

## Council rulings
- Cutaways (another place or time) are diorama sets (engine/kits/diorama.mjs), not full 3D sets.
- Every storyboard is reviewed with a mute test (what a viewer with the sound off understands) and a blind test (the story works with eyes closed: every quoted line is attributed, every visual gag has a sound).
- Timebox: at most 1 extra stills round per storyboard, on framing and values only.

## Episode workflow
1. Ideate in chat with Claude (outside the repo): lock the script, the shot list (times as L<n>:<w> word anchors, never seconds) and facts.md.
2. The user records the whole script in ElevenLabs as ONE mp3 in line order and uploads episodes/<id>/audio/voice.mp3 and music.mp3.
3. NEW EPISODE prompt: Claude Code writes script.json, facts.md and episode.json exactly as given. Timings come only from aligning voice.mp3.
4. Push -> preview -> review -> FIX prompts -> RENDER prompt.
5. After posting: add the YouTube link and 48-hour stats (viewed vs swiped, average percentage viewed) to episodes/<id>/results.md, and one line per lesson to docs/LEARNINGS.md.

## Starting a new ideation chat
Paste docs/STORY.md and docs/LEARNINGS.md into the chat first, so every decision carries over.
