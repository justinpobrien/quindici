// Leaderboard flow against the Firebase emulators (demo project, no login needed).
// Run from functions/:  firebase emulators:exec --project demo-quindici --only functions,firestore "node ../tests/browser/leaderboard.test.js"
const crypto = require('crypto');
const H = require('./helpers');
const { boards, sleep, text } = H;

const API = 'http://127.0.0.1:5001/demo-quindici/us-central1/api';
const D1 = boards[0], D2 = boards[1];
const DAY1 = D1.date;
const NAMES = ['nico', 'tessera', 'halfstep', 'mk_slides', 'ortho', 'lento', 'paritybit', 'blank16', 'rowmajor', 'gridlock', 'manhattan', 'slidewell'];
const EXTRA = [0, 2, 0, 2, 4, 0, 6, 10, 8, 12, 14, 16];

const call = (m, p, b) => fetch(API + p, {
    method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
}).then(r => r.json());

// Twelve players finish Daily No. 1 (and some Daily No. 2), wasting EXTRA moves each.
async function seed() {
    for (const day of [D1, D2]) {
        const plays = await Promise.all(NAMES.map(async (name, i) => {
            if (day.n === 2 && i % 3 === 0) return null;
            const playerId = crypto.randomUUID();
            const s = await call('POST', `/daily/${day.n}/start`, { playerId });
            if (day.n === 1) await call('PATCH', '/player', { playerId, handle: name });
            return { playerId, token: s.token, i };
        }));
        await sleep(15000);   // the server rejects solves faster than 0.15 s per move
        for (const p of plays.filter(Boolean)) {
            const b = day.hex.split('').map(c => parseInt(c, 16)), z = b.indexOf(0), nb = z % 4 < 3 ? z + 1 : z - 1;
            const log = Array(EXTRA[p.i]).fill(b[nb]).concat(day.solution);
            const seconds = Math.min(19, Math.max(0.15 * log.length + 0.5, 9 + p.i * 0.4));
            const r = await call('POST', `/daily/${day.n}/finish`, { playerId: p.playerId, token: p.token, movesLog: log.join(','), hints: p.i === 4 ? 1 : 0, seconds });
            if (r.error) throw new Error(`seed ${NAMES[p.i]}: ${r.error}`);
        }
    }
}

(async () => {
    const { server, base } = await H.serve();
    const browser = await H.launch();
    const t = H.runner();
    const open = await H.opener(browser, base, t.errors);
    const { check } = t;

    try {
        await seed();

        // Before playing
        let p = await open(`/leaderboard/?today=${DAY1}`);
        await p.waitForFunction(() => document.querySelectorAll('#rows .row').length > 0, { timeout: 15000 });
        check('lists the top 10', (await p.$$eval('#rows .row', r => r.length)) === 10);
        check('eyebrow shows daily and par', (await text(p, '#eyebrow')) === `Daily No. 1 · par ${D1.par}`);
        check('top 3 chips', (await p.$$eval('.rank-chip', c => c.length)) === 3);
        check('no "you" row before playing', (await p.$$eval('.row.is-you', r => r.length)) === 0);
        check('half-life uses par', (await text(p, '#halfLife')) === `${Math.floor(3 * D1.par / 60)}:${String(3 * D1.par % 60).padStart(2, '0')}`);
        check('distribution shown without a "you" band', await H.visible(p, '#distCard') &&
            (await text(p, '#distHeadline')) === '12 players so far.' && (await p.$$eval('.dist-col.is-you', c => c.length)) === 0);
        check('distribution has 10 bands adding up to 12', await p.$$eval('.dist-col', cs =>
            cs.length === 10 && cs.reduce((a, c) => a + Number(c.dataset.tip.match(/: (\d+)/)[1]), 0) === 12));
        await p.context.close();

        // Play Daily No. 1 with 20 wasted moves, slowly enough for the server's speed check
        p = await open(`/?today=${DAY1}`);
        const ctx = p.context;
        await p.keyboard.press('Enter');
        await p.waitForFunction(() => (JSON.parse(localStorage.getItem('quindici.v1') || '{}').inProgress || {}).token, { timeout: 10000 });
        check('start token saved with progress', true);
        const b = D1.hex.split('').map(c => parseInt(c, 16)), z = b.indexOf(0), nb = z % 4 < 3 ? z + 1 : z - 1;
        for (const tile of Array(20).fill(b[nb]).concat(D1.solution)) {
            await H.clickTile(p, tile);
            await sleep(170);
        }
        await p.waitForFunction(() => /today/.test(document.getElementById('solvedCaption').textContent), { timeout: 15000 });
        check('rank shown after submitting', /out of 1000 · 13th today/.test(await text(p, '#solvedCaption')), await text(p, '#solvedCaption'));
        check('"better than" line', (await text(p, '#solvedBeat')) === "Better than 0% of today's 13 players.", await text(p, '#solvedBeat'));
        const res = (await H.store(p)).results['1'];
        check('server result stored, token cleared', res.server && res.server.rank === 13 && res.server.below === 0 && !res.token);
        check('leaderboard link', (await p.$eval('#leaderboardLink', a => !a.hidden && a.getAttribute('href'))) === 'leaderboard/?daily=1');
        await p.close();

        // Leaderboard: your row after a divider; your band in the chart; change your name
        p = await open(`/leaderboard/?today=${DAY1}`, {}, ctx);
        await p.waitForSelector('.row.is-you', { timeout: 15000 });
        check('your row after a divider', (await p.$$eval('.row-divider', d => d.length)) === 1 && (await text(p, '.row.is-you .cell-rank')) === '13');
        check('your band highlighted', (await p.$$eval('.dist-col.is-you', c => c.length)) === 1 &&
            (await text(p, '#distHeadline')) === 'You beat 0% of 13 players.');
        await p.waitForFunction(() => /You appear as/.test(document.getElementById('handleLine').textContent));
        check('name shown', /^You appear as [a-z]+_[a-z]+_\d\d to other players\.$/.test(await text(p, '#handleLine')));
        await p.click('#handleEdit');
        await p.$eval('#handleInput', e => { e.value = ''; });
        await p.type('#handleInput', 'nico');
        await p.click('#handleForm button[type=submit]');
        await p.waitForFunction(() => !document.getElementById('handleHelp').textContent.startsWith('3 to'));
        check('taken name rejected', /taken/.test(await text(p, '#handleHelp')));
        await p.$eval('#handleInput', e => { e.value = ''; });
        await p.type('#handleInput', 'Quindici_Fan');
        await p.click('#handleForm button[type=submit]');
        await p.waitForFunction(() => /quindici_fan/.test(document.getElementById('handleLine').textContent));
        check('name saved, lowercased', true);
        await p.click('[data-range="week"]');
        await p.waitForFunction(() => document.querySelector('#table').classList.contains('is-week') && document.querySelectorAll('#rows .row').length > 0);
        check('week view: days played', /1 day/.test(await text(p, '#rows .row .cell-days')));
        check('week view hides the distribution', !(await H.visible(p, '#distCard')));
        await p.close();

        // Reopening the solved daily refreshes rank and percentage
        p = await open(`/?today=${DAY1}`, {}, ctx);
        await p.waitForFunction(() => /13th today/.test(document.getElementById('solvedCaption').textContent) &&
            !document.getElementById('solvedBeat').hidden, { timeout: 10000 });
        check('stored result shows rank and percentage', true);
        await ctx.close();

        // Phone and pre-launch
        p = await open(`/leaderboard/?today=${DAY1}`, { w: 390, h: 844, phone: true });
        await p.waitForSelector('#rows .row');
        check('phone: no horizontal scroll', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
        await p.context.close();
        p = await open('/leaderboard/?today=2026-11-01');
        check('before the first daily: message', /first daily arrives on Wed 11 Nov/.test(await text(p, '#tableMessage')));
        await p.context.close();
    } catch (error) {
        check('suite ran without throwing', false, error.stack);
    } finally {
        await browser.close();
        server.close();
        t.finish();
    }
})();
