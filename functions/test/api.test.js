// End-to-end against the emulators:  npm run test:emulator
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const core = require('../core');

const API = 'http://127.0.0.1:5001/quindici-io/us-central1/api';
const D1 = core.daily(1), D2 = core.daily(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function call(method, path, body) {
    const res = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8765' },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, cors: res.headers.get('access-control-allow-origin'), data: await res.json() };
}

// Solves daily `entry` with `extra` wasted moves (back and forth) for `playerId`.
async function play(entry, playerId, { extra = 0, hints = 0, seconds } = {}) {
    const start = await call('POST', `/daily/${entry.n}/start`, { playerId });
    assert.strictEqual(start.status, 200, JSON.stringify(start.data));
    const board = entry.hex.split('').map(c => parseInt(c, 16));
    const z = board.indexOf(0), nb = z % 4 < 3 ? z + 1 : z - 1;
    const waste = [];
    for (let i = 0; i < extra; i++) waste.push(board[nb]);
    const log = waste.concat(entry.solution);
    await sleep(Math.ceil(0.15 * log.length * 1000) + 200);
    return call('POST', `/daily/${entry.n}/finish`, {
        playerId, token: start.data.token, movesLog: log.join(','), hints,
        seconds: seconds ?? 0.15 * log.length + 0.1,
    });
}

const players = Array.from({ length: 4 }, () => crypto.randomUUID());

test('start creates a player with a handle and CORS for the site', async () => {
    const r = await call('POST', '/daily/1/start', { playerId: players[0] });
    assert.strictEqual(r.status, 200);
    assert.match(r.data.handle, /^[a-z]+_[a-z]+_\d\d$/);
    assert.strictEqual(r.cors, 'http://localhost:8765');
});

test('rejects unknown dailies, bad ids, forged tokens and non-solving logs', async () => {
    assert.strictEqual((await call('POST', '/daily/9999/start', { playerId: players[0] })).status, 404);
    assert.strictEqual((await call('POST', '/daily/1/start', { playerId: 'nope' })).status, 400);
    const forged = await call('POST', '/daily/1/finish', { playerId: players[0], token: 'x.y', movesLog: D1.solution.join(','), hints: 0, seconds: 60 });
    assert.strictEqual(forged.status, 401);
    const start = await call('POST', '/daily/1/start', { playerId: players[0] });
    const bad = await call('POST', '/daily/1/finish', { playerId: players[0], token: start.data.token, movesLog: D1.solution.slice(1).join(','), hints: 0, seconds: 1 });
    assert.strictEqual(bad.status, 422);
    const tooSlow = await call('POST', '/daily/1/finish', { playerId: players[0], token: start.data.token, movesLog: D1.solution.join(','), hints: 0, seconds: 3600 });
    assert.strictEqual(tooSlow.status, 422);
    const tooFast = await call('POST', '/daily/1/finish', { playerId: players[0], token: start.data.token, movesLog: D1.solution.join(','), hints: 0, seconds: 1 });
    assert.strictEqual(tooFast.status, 422);
    const otherDaily = await call('POST', '/daily/2/finish', { playerId: players[0], token: start.data.token, movesLog: D2.solution.join(','), hints: 0, seconds: 60 });
    assert.strictEqual(otherDaily.status, 401);
});

test('finish scores, ranks, and keeps the first result', async () => {
    const a = await play(D1, players[0]);                 // perfect
    assert.strictEqual(a.status, 200, JSON.stringify(a.data));
    assert.strictEqual(a.data.rank, 1);
    const b = await play(D1, players[1], { extra: 2 });   // 2 over
    assert.strictEqual(b.data.rank, 2);
    assert.strictEqual(b.data.total, 2);
    const again = await play(D1, players[1]);             // a better second try does not count
    assert.strictEqual(again.data.duplicate, true);
    assert.strictEqual(again.data.score, b.data.score);
});

test('leaderboard today: top rows plus your own row; handles can change', async () => {
    await play(D1, players[2], { extra: 4, hints: 1 });
    const renamed = await call('PATCH', '/player', { playerId: players[2], handle: 'pixel_fox_99' });
    assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.data));
    const taken = await call('PATCH', '/player', { playerId: players[3], handle: 'pixel_fox_99' });
    assert.strictEqual(taken.status, 409);
    assert.strictEqual((await call('PATCH', '/player', { playerId: players[3], handle: 'x' })).status, 400);

    const lb = await call('GET', `/daily/1/leaderboard?range=today&limit=2&playerId=${players[2]}`);
    assert.strictEqual(lb.status, 200);
    assert.strictEqual(lb.data.rows.length, 2);
    assert.deepStrictEqual(lb.data.rows.map(r => r.rank), [1, 2]);
    assert.ok(lb.data.rows[0].score >= lb.data.rows[1].score);
    assert.strictEqual(lb.data.you.handle, 'pixel_fox_99');
    assert.strictEqual(lb.data.you.rank, 3);
    assert.strictEqual(lb.data.you.hints, 1);
    assert.strictEqual(lb.data.total, 3);
    assert.ok(!JSON.stringify(lb.data).includes(players[0]), 'player ids are never exposed');
});

test('leaderboard week sums the last 7 dailies', async () => {
    const d2 = await play(D2, players[1]);
    assert.strictEqual(d2.status, 200);
    const lb = await call('GET', `/daily/2/leaderboard?range=week&playerId=${players[1]}`);
    const one = (await call('GET', `/daily/1/leaderboard?range=today&limit=50&playerId=${players[1]}`)).data.you.score;
    assert.strictEqual(lb.data.you.score, one + d2.data.score);
    assert.strictEqual(lb.data.you.days, 2);
    assert.strictEqual(lb.data.you.rank, 1);
    assert.strictEqual(lb.data.total, 3);
});
