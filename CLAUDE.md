# inktime
Renders vertical first-person animated Shorts (1080x1920, 24 fps) from episodes/<id>/episode.json.

## You execute; design is done
- Specs: docs/STYLE.md (look), docs/STORY.md (story rules and episode workflow), docs/EPISODE_FORMAT.md (files). Follow them exactly. Before planning or building any new episode, read docs/STORY.md and docs/LEARNINGS.md. Never improve, rename or redesign. If something is impossible, stop and report it in 3 lines.
- Read only the files the prompt names, plus those two docs when a task touches style or format.

## Token rules
- Never read node_modules/, out/, package-lock.json or binary files (except review/**/contact.jpg when a prompt asks).
- Never render inside this sandbox. Renders run on the GitHub Actions farm (.github/workflows/render.yml): a plain push renders a preview; a commit message containing [render] renders the full video. After pushing, run node tools/wait-render.mjs <name> <commitSha> (repeat while it exits 2), then read only review/<name>/gates.txt, contact.jpg and render.json. Those files are published only to the renders branch (never committed to the working branch); wait-render copies them into review/<name>/, which is gitignored.
- Never paste logs. Report each failure in one line.
- Final reply: changed files plus one line per acceptance check. No recap.

## Audio
- No API keys. Voice and music are made by hand. Alignment = faster-whisper. Sfx = uploaded files first, synthetic fallback.

## Engine rules
- Deterministic: all state derives from the frame index. Randomness only from tools/rng.mjs with a named seed. No Date.now, Math.random or requestAnimationFrame timing.
- The picture contains no text except sound words. Captions are a separate ASS layer burned at assembly.
- JavaScript ESM on Node 22, three.js, Playwright, ffmpeg. No Python, TypeScript, bundlers or new dependencies unless a prompt says so.
- Everything is procedural or SVG drawn in code. No downloaded models or textures.
