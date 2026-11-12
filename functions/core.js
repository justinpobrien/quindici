// core.js: pure leaderboard logic with no Firebase dependencies, so it can be unit tested.
'use strict';

const crypto = require('crypto');
const Scoring = require('./shared/scoring.js');
const BOARDS = require('./shared/boards.json');

const BY_N = new Map(BOARDS.map(b => [b.n, b]));
const GOAL = '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0';
const MAX_TZ_AHEAD_MS = 14 * 3600 * 1000;   // the earliest time zone (UTC+14) starts a date this early
const CLOCK_SLACK_S = 5;                      // allowed difference between client and server clocks
const MIN_SECONDS_PER_MOVE = 0.15;
const MAX_LOG = 2000;

function daily(n) {
    return BY_N.get(n) || null;
}

// A daily is open once its date has started somewhere on Earth.
function isReleased(entry, now = Date.now()) {
    return Date.parse(entry.date + 'T00:00:00Z') - MAX_TZ_AHEAD_MS <= now;
}

// ---------- signed start tokens ----------

function sign(secret, payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return body + '.' + mac;
}

function verify(secret, token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, mac] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(mac || ''), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        return JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch (e) {
        return null;
    }
}

// ---------- replay ----------

// Parses "11,1,2,15" (or an array) into tile numbers. Returns null if malformed.
function parseLog(movesLog) {
    const list = Array.isArray(movesLog) ? movesLog : String(movesLog || '').split(',');
    if (list.length === 0 || list.length > MAX_LOG) return null;
    const tiles = list.map(Number);
    return tiles.every(t => Number.isInteger(t) && t >= 1 && t <= 15) ? tiles : null;
}

// Replays single-tile moves from the board's hex. Returns true only if every move is legal
// and the final position is solved.
function replaySolves(hex, tiles) {
    const b = hex.split('').map(c => parseInt(c, 16));
    for (const t of tiles) {
        const i = b.indexOf(t), z = b.indexOf(0);
        if (Math.abs((i >> 2) - (z >> 2)) + Math.abs((i & 3) - (z & 3)) !== 1) return false;
        b[z] = t;
        b[i] = 0;
    }
    return b.join(',') === GOAL;
}

// Validates a finished daily and computes its score.
// Returns { ok: true, result } or { ok: false, status, error }.
function checkFinish({ entry, startedAt, now, movesLog, hints, seconds }) {
    const tiles = parseLog(movesLog);
    if (!tiles) return { ok: false, status: 400, error: 'Invalid moves log.' };
    if (!replaySolves(entry.hex, tiles)) return { ok: false, status: 422, error: 'The moves do not solve the board.' };
    if (!Number.isInteger(hints) || hints < 0 || hints > 500) return { ok: false, status: 400, error: 'Invalid hints.' };
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return { ok: false, status: 400, error: 'Invalid time.' };
    if (seconds > (now - startedAt) / 1000 + CLOCK_SLACK_S) return { ok: false, status: 422, error: 'Time is longer than the time since start.' };
    if (seconds < MIN_SECONDS_PER_MOVE * tiles.length) return { ok: false, status: 422, error: 'Too fast to be real.' };

    const s = Scoring.score({ par: entry.par, moves: tiles.length, hints, seconds });
    return {
        ok: true,
        result: {
            tileMoves: tiles.length,
            hints,
            seconds: Math.round(seconds * 1000) / 1000,
            score: s.score,
            movesLog: tiles.join(','),
            startedAt,
            finishedAt: now,
        },
    };
}

// ---------- handles ----------

const ADJECTIVES = ['tile', 'swift', 'quiet', 'lucky', 'clever', 'brave', 'sunny', 'cosmic', 'neon', 'pixel',
    'retro', 'turbo', 'mellow', 'zesty', 'plucky', 'nimble', 'jolly', 'snappy', 'groovy', 'rapid'];
const NOUNS = ['wizard', 'slider', 'fox', 'otter', 'comet', 'panda', 'falcon', 'gecko', 'puzzler', 'robot',
    'koala', 'lynx', 'heron', 'badger', 'walrus', 'mantis', 'yak', 'tiger', 'owl', 'squid'];
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'slut', 'whore', 'rape', 'nazi', 'dick', 'cock', 'pussy', 'asshole', 'retard'];

function randomHandle(rand = Math.random) {
    const pick = (list) => list[Math.floor(rand() * list.length)];
    return `${pick(ADJECTIVES)}_${pick(NOUNS)}_${10 + Math.floor(rand() * 90)}`;
}

// Returns an error message, or null when the handle is acceptable.
function handleError(handle) {
    if (typeof handle !== 'string' || !/^[a-z0-9_]{3,20}$/.test(handle)) {
        return 'Handles are 3 to 20 characters: lowercase letters, digits and underscores.';
    }
    const squashed = handle.replace(/[_0-9]/g, '');
    if (BLOCKED.some(w => squashed.includes(w))) return 'Please choose a different handle.';
    return null;
}

function isPlayerId(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

module.exports = {
    daily, isReleased, sign, verify, parseLog, replaySolves, checkFinish,
    randomHandle, handleError, isPlayerId, BOARDS,
};
