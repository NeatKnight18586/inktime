// Hand-lettering generator for sound words (docs/STYLE.md, Sound words): never a font. A skeleton stroke alphabet
// (polylines in em units, y up, letter height 1) for only the letters in the words below; each word is rendered as tapered
// brush strokes with seeded wobble (1.5% of the letter height), a heavy ink outline and a palette fill (lamp by default).
// Usage: node tools/letter.mjs [WORD ...] [--fill #RRGGBB] [--out sfx-words]
// Output: <out>/<WORD>/v1.svg, v2.svg, v3.svg (three seeds). Words are added on demand.
// The alphabet and the SVG maker live in engine/look/lettering.mjs (browser-safe), re-exported here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORDS, INK, LAMP, LETTER, wordSvg } from '../engine/look/lettering.mjs';

export * from '../engine/look/lettering.mjs';

export function writeWord(word, { out = 'sfx-words', fill = LAMP } = {}) {
  const dir = join(out, word);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (let v = 1; v <= 3; v++) {
    const f = join(dir, `v${v}.svg`);
    writeFileSync(f, wordSvg(word, `v${v}`, { fill }));
    files.push(f);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const fill = flag('--fill', LAMP);
  const out = flag('--out', 'sfx-words');
  const words = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  for (const w of words.length ? words : WORDS) console.log(writeWord(w.toUpperCase(), { out, fill }).join(' '));
}
