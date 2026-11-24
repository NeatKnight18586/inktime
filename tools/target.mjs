// Which scene a workflow run is about. Usage: node tools/target.mjs  (env: EVENT, INPUT_TARGET, BEFORE, SHA)
// workflow_dispatch: the input. push: the episode folder the push touched (first by name, real episodes before scratch ones), else the look test.
import { execFileSync } from 'node:child_process';

export const DEFAULT = 'episodes/_looktest';
export function targetFor({ input, changed }) {
  if (input) return input;
  const ids = [...new Set(changed.map((f) => /^episodes\/([^/]+)\//.exec(f)?.[1]).filter(Boolean))].sort();
  const id = ids.find((x) => !x.startsWith('_')) ?? ids[0];
  return id ? `episodes/${id}` : DEFAULT;
}
if (process.argv[1]?.endsWith('target.mjs')) {
  const { INPUT_TARGET, BEFORE, SHA } = process.env;
  let changed = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', BEFORE, SHA], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    /* first push or unknown base */
  }
  console.log(targetFor({ input: INPUT_TARGET, changed }));
}
