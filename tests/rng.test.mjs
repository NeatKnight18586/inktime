import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, hashSeed } from '../tools/rng.mjs';

const first5 = (s) => { const r = rng(hashSeed(s)); return Array.from({ length: 5 }, r); };

test('same seed gives same first 5 values', () => {
  assert.deepEqual(first5('a'), first5('a'));
  for (const v of first5('a')) assert.ok(v >= 0 && v < 1);
});

test('different seeds differ', () => {
  assert.notDeepEqual(first5('a'), first5('b'));
});
