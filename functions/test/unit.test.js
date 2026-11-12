// node --test test/unit.test.js   (pure logic, no emulator needed)
const test = require('node:test');
const assert = require('node:assert');
const core = require('../core');
const Scoring = require('../shared/scoring.js');

const D1 = core.daily(1);
const T0 = 1_800_000_000_000;

test('daily lookup and release window', () => {
    assert.strictEqual(D1.date, '2026-12-01');
    assert.strictEqual(core.daily(9999), null);
    assert.ok(!core.isReleased(D1, Date.parse('2026-11-30T09:00:00Z')));
    assert.ok(core.isReleased(D1, Date.parse('2026-11-30T10:00:00Z')));   // already Dec 1 in UTC+14
});

test('tokens verify and reject tampering', () => {
    const t = core.sign('s', { n: 1, playerId: 'p', startedAt: 5 });
    assert.deepStrictEqual(core.verify('s', t), { n: 1, playerId: 'p', startedAt: 5 });
    assert.strictEqual(core.verify('other', t), null);
    const [body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ n: 1, playerId: 'p', startedAt: 0 })).toString('base64url');
    assert.strictEqual(core.verify('s', forged + '.' + mac), null);
    assert.strictEqual(core.verify('s', 'garbage'), null);
});

test('optimal solution replays to goal; a broken log does not', () => {
    assert.ok(core.replaySolves(D1.hex, D1.solution));
    assert.ok(!core.replaySolves(D1.hex, D1.solution.slice(0, -1)));
    const swapped = D1.solution.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    assert.ok(!core.replaySolves(D1.hex, swapped));
});

test('finish: accepts a real solve and scores it with the shared module', () => {
    const r = core.checkFinish({ entry: D1, startedAt: T0, now: T0 + 100_000, movesLog: D1.solution.join(','), hints: 1, seconds: 90 });
    assert.ok(r.ok);
    assert.strictEqual(r.result.tileMoves, D1.par);
    assert.strictEqual(r.result.score, Scoring.score({ par: D1.par, moves: D1.par, hints: 1, seconds: 90 }).score);
});

test('finish: rejects bad logs and impossible times', () => {
    const base = { entry: D1, startedAt: T0, now: T0 + 100_000, hints: 0, seconds: 90 };
    assert.strictEqual(core.checkFinish({ ...base, movesLog: D1.solution.slice(1).join(',') }).status, 422);
    assert.strictEqual(core.checkFinish({ ...base, movesLog: 'a,b' }).status, 400);
    assert.strictEqual(core.checkFinish({ ...base, movesLog: D1.solution, seconds: 200 }).status, 422);   // longer than since start
    assert.strictEqual(core.checkFinish({ ...base, movesLog: D1.solution, seconds: 2 }).status, 422);     // too fast
    assert.strictEqual(core.checkFinish({ ...base, movesLog: D1.solution, hints: -1 }).status, 400);
});

test('handles', () => {
    assert.match(core.randomHandle(), /^[a-z]+_[a-z]+_\d\d$/);
    assert.strictEqual(core.handleError('tile_wizard_42'), null);
    assert.ok(core.handleError('ab'));
    assert.ok(core.handleError('Has Caps'));
    assert.ok(core.handleError('a'.repeat(21)));
    assert.ok(core.handleError('sh_it_fuck'));
});
