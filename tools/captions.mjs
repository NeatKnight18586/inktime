// Captions from words.json. Usage: node tools/captions.mjs <episodeDir>   -> out/captions.ass, out/captions.srt
// 1-2 words per card, never across punctuation. Anton, white, 8 px ink #141414 outline, centred at 33% of the height.
// Safe zones: never in the bottom 20% or the right 15% of 1080x1920 (the centred card is kept within x 162..918).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWords } from './audiolib.mjs';

export const W = 1080;
export const H = 1920;
export const OUTLINE = 8;
export const FONT_SIZE = 100;
export const CX = W / 2;
export const CY = Math.round(H * 0.33);
export const SAFE = { right: W * 0.85, bottom: H * 0.8 };
const MAX_TEXT_W = 2 * (SAFE.right - CX); // centred text may not cross the right safe line
const AVG_EM = 0.5; // Anton average glyph width (em), conservative

export const textWidth = (text, size) => text.length * size * AVG_EM + 2 * OUTLINE;
const END_PUNCT = /[.,;:!?…–—)"”’]$|[.,;:!?…–—]["”’)]$|[–—]$/;

export function splitCards(words) {
  const cards = [];
  let i = 0;
  while (i < words.length) {
    const group = [words[i]];
    const next = words[i + 1];
    if (next && !END_PUNCT.test(words[i].word) && textWidth(`${words[i].word} ${next.word}`, FONT_SIZE) <= MAX_TEXT_W) group.push(next);
    const text = group.map((w) => w.word).join(' ');
    cards.push({ text, start: group[0].start, end: group[group.length - 1].end, words: group.length });
    i += group.length;
  }
  cards.forEach((c, k) => {
    const nx = cards[k + 1];
    c.end = nx ? Math.max(c.end, Math.min(nx.start, c.end + 0.3)) : c.end + 0.3; // hold a little past the word, never over the next card
    c.size = Math.min(FONT_SIZE, Math.max(40, Math.floor((MAX_TEXT_W - 2 * OUTLINE) / (c.text.length * AVG_EM))));
    c.x = CX;
    c.y = CY;
    c.width = textWidth(c.text, c.size);
    c.height = c.size * 1.25;
  });
  return cards;
}

const ts = (s, ass) => {
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  const p = (v, n = 2) => String(v).padStart(n, '0');
  return ass ? `${h}:${p(m)}:${p(sec)}.${p(c)}` : `${p(h)}:${p(m)}:${p(sec)},${p(c * 10, 3)}`;
};

export function assFile(cards) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Anton,${FONT_SIZE},&H00FFFFFF,&H00FFFFFF,&H00141414,&H00141414,0,0,0,0,100,100,0,0,1,${OUTLINE},0,5,${Math.round(W * 0.15)},${Math.round(W * 0.15)},${Math.round(H * 0.2)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = cards.map((c) => `Dialogue: 0,${ts(c.start, true)},${ts(c.end, true)},Default,,0,0,0,,{\\an5\\pos(${c.x},${c.y})\\fs${c.size}}${c.text.replace(/[{}]/g, '')}`);
  return head + ev.join('\n') + '\n';
}

export const srtFile = (cards) => cards.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');

export function captions(dir) {
  const { words } = loadWords(dir);
  const cards = splitCards(words);
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'captions.ass'), assFile(cards));
  writeFileSync(join(out, 'captions.srt'), srtFile(cards));
  console.log(`captions: ${cards.length} cards`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: captions.mjs <episodeDir>');
    process.exit(2);
  }
  captions(process.argv[2]);
}
