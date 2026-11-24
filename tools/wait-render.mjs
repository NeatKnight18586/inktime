// Wait for the render farm. Usage: node tools/wait-render.mjs <name> <commitSha>
// Polls the "renders" branch every 45 s for up to 9 minutes for renders/<name>/render.json with commit == sha.
// Exit 0: done/preview. Exit 1: failed (prints job and step). Exit 2: still running.
// Status comes from the renders branch only (nothing is committed to the working branch). On a result the small review files
// (contact.jpg, measure.txt, gates.txt, render.json, ...) are copied from renders/<name>/ into review/<name>/, which is gitignored.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [name, sha] = process.argv.slice(2);
if (!name || !sha) {
  console.error('usage: wait-render.mjs <name> <commitSha>');
  process.exit(2);
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const full = (() => {
  try {
    return git('rev-parse', sha);
  } catch {
    return sha;
  }
})();
const deadline = Date.now() + 9 * 60 * 1000;

function check() {
  try {
    git('fetch', '--quiet', 'origin', 'renders');
    const s = JSON.parse(git('show', `FETCH_HEAD:renders/${name}/render.json`));
    if (!s.commit || !(s.commit === full || full.startsWith(s.commit) || s.commit.startsWith(sha))) return null;
    return s;
  } catch {
    return null;
  }
}

for (;;) {
  const s = check();
  if (s) {
    try {
      mkdirSync(`review/${name}`, { recursive: true });
      for (const f of git('ls-tree', '--name-only', 'FETCH_HEAD', `renders/${name}/`).split('\n').filter(Boolean)) {
        if (/\.(mp4|wav)$/.test(f)) continue; // videos stay on the renders branch
        const buf = execFileSync('git', ['show', `FETCH_HEAD:${f}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
        writeFileSync(`review/${name}/${f.split('/').pop()}`, buf);
      }
    } catch {
      /* review files stay on the renders branch */
    }
    if (s.status === 'failed') {
      console.log(`failed: job "${s.job}" step "${s.step}" ${s.run_url ?? ''}`);
      process.exit(1);
    }
    console.log(`${s.status}: ${s.mp4_url ?? ''} ${s.seconds_per_frame ?? '?'} s/frame, ${s.machine_minutes ?? '?'} machine-min, slowest shard ${s.slowest_shard_minutes ?? '?'} min`);
    process.exit(0);
  }
  if (Date.now() + 45000 > deadline) break;
  await new Promise((r) => setTimeout(r, 45000));
}
console.log('still running');
process.exit(2);
