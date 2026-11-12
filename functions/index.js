// Quindici leaderboard API: one HTTPS Cloud Function, `api`, implementing SPEC §9.
//
//   POST  /daily/:n/start        { playerId }                              → { token, handle }
//   POST  /daily/:n/finish       { playerId, token, movesLog, hints, seconds } → { score, rank, below, total, duplicate }
//   GET   /daily/:n/leaderboard  ?range=today|week&limit=10&playerId=…      → { rows, you, total, buckets }
//   GET   /player                ?playerId=…                               → { handle }
//   PATCH /player                { playerId, handle }                      → { handle }
//
// Firestore (clients have no direct access; see firestore.rules):
//   players/{playerId}       { handle, createdAt }
//   handles/{handle}         { playerId }
//   results/{n}_{playerId}   { n, playerId, tileMoves, hints, seconds, score, movesLog, startedAt, finishedAt }
'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const core = require('./core');

initializeApp();
const db = getFirestore();
const TOKEN_SECRET = defineSecret('TOKEN_SECRET');
// Emulator only: pretend it is later, so tests can play dailies before launch.
const RELEASE_OFFSET_MS = process.env.FUNCTIONS_EMULATOR === 'true' ? Number(process.env.QUINDICI_RELEASE_OFFSET_MS || 0) : 0;

const ALLOWED_ORIGINS = [
    /^https:\/\/(www\.)?quindici\.io$/,
    /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/,   // Netlify deploy previews and branch deploys
    /^https:\/\/[a-z0-9-]+\.netlify\.app$/,
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

// ---------- players ----------

async function ensurePlayer(playerId) {
    if (!core.isPlayerId(playerId)) throw new HttpError(400, 'Invalid player id.');
    const ref = db.collection('players').doc(playerId);
    const snap = await ref.get();
    if (snap.exists) return snap.data().handle;

    // New player: claim a free generated handle.
    for (let attempt = 0; attempt < 8; attempt++) {
        const handle = core.randomHandle();
        try {
            await db.runTransaction(async (tx) => {
                const [p, h] = await Promise.all([tx.get(ref), tx.get(db.collection('handles').doc(handle))]);
                if (p.exists) return;
                if (h.exists) throw new Error('taken');
                tx.set(ref, { handle, createdAt: Date.now() });
                tx.set(db.collection('handles').doc(handle), { playerId });
            });
            return (await ref.get()).data().handle;
        } catch (e) {
            if (e.message !== 'taken') throw e;
        }
    }
    throw new HttpError(503, 'Could not create a player. Try again.');
}

async function setHandle(playerId, handle) {
    if (!core.isPlayerId(playerId)) throw new HttpError(400, 'Invalid player id.');
    const problem = core.handleError(handle);
    if (problem) throw new HttpError(400, problem);
    await ensurePlayer(playerId);

    const playerRef = db.collection('players').doc(playerId);
    await db.runTransaction(async (tx) => {
        const player = await tx.get(playerRef);
        const old = player.data().handle;
        if (old === handle) return;
        const wanted = db.collection('handles').doc(handle);
        if ((await tx.get(wanted)).exists) throw new HttpError(409, 'That handle is taken.');
        tx.set(wanted, { playerId });
        tx.delete(db.collection('handles').doc(old));
        tx.update(playerRef, { handle });
    });
    return handle;
}

async function handlesFor(ids) {
    if (ids.length === 0) return new Map();
    const snaps = await db.getAll(...ids.map(id => db.collection('players').doc(id)));
    return new Map(snaps.map(s => [s.id, s.exists ? s.data().handle : 'player']));
}

// ---------- dailies ----------

function getDaily(nParam) {
    const n = Number(nParam);
    const entry = Number.isInteger(n) ? core.daily(n) : null;
    if (!entry) throw new HttpError(404, 'No such daily.');
    if (!core.isReleased(entry, Date.now() + RELEASE_OFFSET_MS)) throw new HttpError(403, 'That daily is not out yet.');
    return entry;
}

async function start(entry, body) {
    const handle = await ensurePlayer(body.playerId);
    const token = core.sign(TOKEN_SECRET.value(), { n: entry.n, playerId: body.playerId, startedAt: Date.now() });
    return { token, handle };
}

async function finish(entry, body) {
    const claims = core.verify(TOKEN_SECRET.value(), body.token);
    if (!claims || claims.n !== entry.n || claims.playerId !== body.playerId) {
        throw new HttpError(401, 'Invalid or expired start token.');
    }
    const check = core.checkFinish({
        entry, startedAt: claims.startedAt, now: Date.now(),
        movesLog: body.movesLog, hints: body.hints, seconds: body.seconds,
    });
    if (!check.ok) throw new HttpError(check.status, check.error);

    // The first accepted submission wins.
    const ref = db.collection('results').doc(`${entry.n}_${body.playerId}`);
    let duplicate = false;
    await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) { duplicate = true; return; }
        tx.set(ref, { n: entry.n, playerId: body.playerId, ...check.result });
    });
    const saved = (await ref.get()).data();

    const day = db.collection('results').where('n', '==', entry.n);
    const [above, below, total] = await Promise.all([
        day.where('score', '>', saved.score).count().get(),
        day.where('score', '<', saved.score).count().get(),
        day.count().get(),
    ]);
    return {
        score: saved.score, rank: above.data().count + 1, below: below.data().count,
        total: total.data().count, duplicate,
    };
}

// Today's scores in ten bands of 100 (the last band, 900–1000, includes 1000), from count queries
// so a busy day costs a handful of reads rather than one per result.
async function distribution(day) {
    const counts = await Promise.all(Array.from({ length: 10 }, (_, i) => {
        const hi = i === 9 ? 1001 : (i + 1) * 100;
        return day.where('score', '>=', i * 100).where('score', '<', hi).count().get();
    }));
    return counts.map(c => c.data().count);
}

function rowFor(doc, rank, handles, playerId) {
    return {
        rank,
        handle: handles.get(doc.playerId) || 'player',
        moves: doc.tileMoves,
        hints: doc.hints,
        seconds: doc.seconds,
        score: doc.score,
        you: doc.playerId === playerId,
    };
}

async function leaderboard(entry, query) {
    const range = query.range === 'week' ? 'week' : 'today';
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 50);
    const playerId = core.isPlayerId(query.playerId) ? query.playerId : null;

    if (range === 'today') {
        const day = db.collection('results').where('n', '==', entry.n);
        const [top, total] = await Promise.all([
            day.orderBy('score', 'desc').orderBy('finishedAt', 'asc').limit(limit).get(),
            day.count().get(),
        ]);
        const docs = top.docs.map(d => d.data());
        let mine = null, myRank = null, myBelow = null;
        if (playerId) {
            const snap = await db.collection('results').doc(`${entry.n}_${playerId}`).get();
            if (snap.exists) {
                mine = snap.data();
                const [above, below] = await Promise.all([
                    day.where('score', '>', mine.score).count().get(),
                    day.where('score', '<', mine.score).count().get(),
                ]);
                myRank = above.data().count + 1;
                myBelow = below.data().count;
            }
        }
        const buckets = query.distribution === '0' ? null : await distribution(day);
        const handles = await handlesFor([...new Set(docs.map(d => d.playerId).concat(mine ? [playerId] : []))]);

        // Rank ties share a number: a row's rank is 1 + the number of higher scores.
        const rows = [];
        docs.forEach((d, i) => {
            const rank = i > 0 && d.score === docs[i - 1].score ? rows[i - 1].rank : i + 1;
            rows.push(rowFor(d, rank, handles, playerId));
        });
        const you = mine ? { ...rowFor(mine, myRank, handles, playerId), below: myBelow } : null;
        return { range, n: entry.n, par: entry.par, rows, you, total: total.data().count, buckets };
    }

    // This week: the sum of each player's scores over the last 7 dailies, ending at n.
    const from = Math.max(1, entry.n - 6);
    const snap = await db.collection('results').where('n', '>=', from).where('n', '<=', entry.n).get();
    const totals = new Map();
    for (const doc of snap.docs) {
        const d = doc.data();
        const t = totals.get(d.playerId) || { playerId: d.playerId, score: 0, days: 0 };
        t.score += d.score;
        t.days += 1;
        totals.set(d.playerId, t);
    }
    const sorted = [...totals.values()].sort((a, b) => b.score - a.score);
    const ranked = [];
    sorted.forEach((t, i) => {
        ranked.push({ ...t, rank: i > 0 && t.score === sorted[i - 1].score ? ranked[i - 1].rank : i + 1 });
    });
    const top = ranked.slice(0, limit);
    const mine = playerId ? ranked.find(t => t.playerId === playerId) || null : null;
    const handles = await handlesFor([...new Set(top.map(t => t.playerId).concat(mine ? [playerId] : []))]);
    const shape = (t) => ({ rank: t.rank, handle: handles.get(t.playerId) || 'player', score: t.score, days: t.days, you: t.playerId === playerId });
    return { range, n: entry.n, from, rows: top.map(shape), you: mine ? shape(mine) : null, total: ranked.length };
}

// ---------- router ----------

async function route(req) {
    const path = req.path.replace(/^\/api(?=\/)/, '').replace(/\/+$/, '');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let m;

    if ((m = path.match(/^\/daily\/(\d+)\/(start|finish|leaderboard)$/))) {
        const entry = getDaily(m[1]);
        if (m[2] === 'start' && req.method === 'POST') return start(entry, body);
        if (m[2] === 'finish' && req.method === 'POST') return finish(entry, body);
        if (m[2] === 'leaderboard' && req.method === 'GET') return leaderboard(entry, req.query);
        throw new HttpError(405, 'Method not allowed.');
    }
    if (path === '/player') {
        if (req.method === 'GET') return { handle: await ensurePlayer(req.query.playerId) };
        if (req.method === 'PATCH') return { handle: await setHandle(body.playerId, body.handle) };
        throw new HttpError(405, 'Method not allowed.');
    }
    throw new HttpError(404, 'Not found.');
}

exports.api = onRequest(
    { cors: ALLOWED_ORIGINS, secrets: [TOKEN_SECRET], maxInstances: 10, memory: '256MiB', concurrency: 40 },
    async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.status(200).json(await route(req));
        } catch (error) {
            if (error instanceof HttpError) {
                res.status(error.status).json({ error: error.message });
            } else {
                console.error(error);
                res.status(500).json({ error: 'Server error.' });
            }
        }
    }
);
