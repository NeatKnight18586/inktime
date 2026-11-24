// Publish render outputs to the orphan branch "renders": one commit holding the latest files only.
// Usage: node tools/publish-renders.mjs <name> <src>=<dest> [...]   (dest is a file name inside renders/<name>/)
// Other names' latest files are kept; the branch is rebuilt as a single root commit and force-pushed.
// Needs GH_TOKEN and GITHUB_REPOSITORY. Links: https://github.com/<repo>/raw/renders/renders/<name>/<file>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const rawUrl = (repo, name, file, server = 'https://github.com') => `${server}/${repo}/raw/renders/renders/${name}/${file}`;

const [name, ...pairs] = process.argv.slice(2);
if (!name || !pairs.length) {
  console.error('usage: publish-renders.mjs <name> <src>=<dest> ...');
  process.exit(2);
}
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const dir = mkdtempSync(join(tmpdir(), 'renders-'));
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.name', 'github-actions[bot]');
git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
git('remote', 'add', 'origin', `https://x-access-token:${token}@github.com/${repo}.git`);
let had = false;
try {
  git('fetch', '-q', '--depth', '1', 'origin', 'renders');
  had = true;
} catch {
  /* first publish */
}
if (had) {
  git('read-tree', 'FETCH_HEAD');
  git('checkout-index', '-a', '-f');
}
const out = join(dir, 'renders', name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of pairs) {
  const [src, dest] = p.split('=');
  copyFileSync(resolve(src), join(out, dest));
}
git('add', '-A');
git('commit', '-q', '-m', `renders: ${name} ${(process.env.GITHUB_SHA ?? '').slice(0, 7)} [skip ci]`);
for (let i = 1; i <= 4; i++) {
  try {
    git('push', '-q', '-f', 'origin', 'HEAD:renders');
    console.log(`published renders/${name}: ${pairs.map((p) => p.split('=')[1]).join(', ')}`);
    process.exit(0);
  } catch (e) {
    if (i === 4) {
      console.error(`publish-renders: push failed: ${String(e.stderr ?? e.message).split('\n')[0]}`);
      process.exit(1);
    }
    execFileSync('sleep', [String(i * 5)]);
  }
}
