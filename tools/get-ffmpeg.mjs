// Fetch a static ffmpeg + ffprobe build (gzip, no xz needed) into <dir>. Usage: node tools/get-ffmpeg.mjs <dir>
// CI caches <dir> under a fixed key, so this runs once.
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

export const FFMPEG_BUILD = 'b6.0';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_BUILD}`;
const dir = process.argv[2] ?? '.ffmpeg';
mkdirSync(dir, { recursive: true });
for (const tool of ['ffmpeg', 'ffprobe']) {
  const res = await fetch(`${BASE}/${tool}-linux-x64.gz`);
  if (!res.ok) {
    console.error(`get-ffmpeg: ${tool} ${res.status}`);
    process.exit(1);
  }
  const file = join(dir, tool);
  writeFileSync(file, gunzipSync(Buffer.from(await res.arrayBuffer())));
  chmodSync(file, 0o755);
}
console.log(`ffmpeg ${FFMPEG_BUILD} in ${dir}`);
