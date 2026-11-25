// Captions from words.json. Usage: node tools/captions.mjs <episodeDir>   -> out/captions.ass, out/captions.srt
// 1-3 words per card, never across punctuation. Anton 110 px at 1080 wide, white, 10 px ink #141414 outline plus a soft 6 px
// shadow; the key word is yellow #FFD23F (numbers and episode.json "captionKeys"). Each card pops in over 3 frames from 115%.
// Centred at 64% of the height; safe zones: never in the bottom 20% or the right 15% (the centred card stays within x 162..918).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWords } from './audiolib.mjs';

export const W = 1080;
export const H = 1920;
export const OUTLINE = 10;
export const SHADOW = 6;
export const FONT_SIZE = 110;
export const MAX_WORDS = 3;
export const KEY_COLOUR = '#FFD23F';
export const POP = { frames: 3, scale: 115 };
export const CX = W / 2;
export const CY = Math.round(H * 0.64);
export const SAFE = { right: W * 0.85, bottom: H * 0.8 };
const MAX_TEXT_W = 2 * (SAFE.right - CX); // centred text may not cross the right safe line
const AVG_EM = 0.5; // Anton average glyph width (em), conservative

export const textWidth = (text, size) => text.length * size * AVG_EM + 2 * OUTLINE;
const END_PUNCT = /[.,;:!?…–—)"”’]$|[.,;:!?…–—]["”’)]$|[–—]$/;
const NUMBER_WORDS = new Set('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million'.split(' '));
const bare = (w) => w.toLowerCase().replace(/[^a-z0-9£]/g, '');
// The key word: a number (digits or a number word) or a word listed in captionKeys (case-insensitive, punctuation ignored).
export function isKey(word, keys = []) {
  const b = bare(word);
  return /\d/.test(b) || NUMBER_WORDS.has(b) || keys.some((k) => bare(k) === b);
}

export function splitCards(words, { keys = [] } = {}) {
  const cards = [];
  let i = 0;
  while (i < words.length) {
    const group = [words[i]];
    while (group.length < MAX_WORDS && !END_PUNCT.test(group.at(-1).word)) {
      const next = words[i + group.length];
      if (!next || textWidth([...group, next].map((w) => w.word).join(' '), FONT_SIZE) > MAX_TEXT_W) break;
      group.push(next);
    }
    const text = group.map((w) => w.word).join(' ');
    cards.push({ text, start: group[0].start, end: group[group.length - 1].end, words: group.length, keys: group.map((w) => isKey(w.word, keys)) });
    i += group.length;
  }
  // Frame 1 has the first caption: the first card is extended backward to the timeline's start (all others keep their word times).
  if (cards.length) cards[0].start = 0;
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

const assColour = (hex) => `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
const cardText = (c) => c.text.replace(/[{}]/g, '').split(' ').map((w, i) => (c.keys?.[i] ? `{\\1c${assColour(KEY_COLOUR)}}${w}{\\1c&HFFFFFF&}` : w)).join(' ');
export function assFile(cards, fps = 24) {
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
  const popMs = Math.round((POP.frames / fps) * 1000);
  const pop = `\\fscx${POP.scale}\\fscy${POP.scale}\\t(0,${popMs},\\fscx100\\fscy100)`;
  const ev = cards.flatMap((c) => {
    const t = `${ts(c.start, true)},${ts(c.end, true)},Default,,0,0,0,,`;
    // Layer 0: the soft shadow (ink, 6 px down-right, blurred); layer 1: the card.
    const shadow = `Dialogue: 0,${t}{\\an5\\pos(${c.x + SHADOW},${c.y + SHADOW})\\fs${c.size}\\1c&H141414&\\3c&H141414&\\alpha&H70&\\blur${SHADOW}${pop}}${c.text.replace(/[{}]/g, '')}`;
    const main = `Dialogue: 1,${t}{\\an5\\pos(${c.x},${c.y})\\fs${c.size}${pop}}${cardText(c)}`;
    return [shadow, main];
  });
  return head + ev.join('\n') + '\n';
}

export const srtFile = (cards) => cards.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');

export const captionKeysOf = (dir) => {
  const f = join(dir, 'episode.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).captionKeys ?? [] : [];
};
export function captions(dir) {
  const { words } = loadWords(dir);
  const cards = splitCards(words, { keys: captionKeysOf(dir) });
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
