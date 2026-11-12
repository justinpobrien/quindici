// Run: node --test tests/scoring.test.js
const test = require('node:test');
const assert = require('node:assert');
const { score, perfectAtSamePace } = require('../js/scoring.js');

test('mockup example: par 48, 56 moves, 96 s → 599', () => {
  assert.strictEqual(score({ par: 48, moves: 56, seconds: 96 }).score, 599);
});
test('perfect instant solve → 1000', () => {
  assert.strictEqual(score({ par: 48, moves: 48, seconds: 0 }).score, 1000);
});
test('perfect solve never drops below 500', () => {
  assert.ok(score({ par: 48, moves: 48, seconds: 100000 }).score >= 500);
});
test('hints add 3 moves each', () => {
  assert.strictEqual(score({ par: 48, moves: 53, seconds: 96, hints: 1 }).score,
                     score({ par: 48, moves: 56, seconds: 96 }).score);
});
test('perfect at same pace line', () => {
  assert.strictEqual(perfectAtSamePace(48, 96), 815);
});
test('leaderboard mockup values', () => {
  const rows = [[48,74,850],[50,61,804],[48,131,766],[50,88,762],[52,97,693],[48,212,680],[54,83,660],[56,96,599],[58,70,587],[56,142,553]];
  for (const [m, t, s] of rows) assert.strictEqual(score({ par: 48, moves: m, seconds: t }).score, s);
});
test('rejects moves below par', () => {
  assert.throws(() => score({ par: 48, moves: 40, seconds: 10 }));
});
test('live score clamps moves below par', () => {
  assert.strictEqual(score({ par: 48, moves: 48, seconds: 0 }).score,
                     require('../js/scoring.js').live({ par: 48, moves: 10, seconds: 0 }).score);
});
