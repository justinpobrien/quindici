// Daily challenge, scoring, sharing and free play in headless Chrome.
// Run: cd tests && npm install && npm run test:daily   (no emulator needed)
const H = require('./helpers');
const { boards, Scoring, sleep, hexOf, text, visible, board, store, clickTile } = H;

const D1 = boards[0];
const DAY1 = D1.date;                       // 2026-11-11
const DAY2 = boards[1].date;
const BEFORE = '2026-11-01';

(async () => {
    const { server, base } = await H.serve();
    const browser = await H.launch();
    const t = H.runner();
    const open = await H.opener(browser, base, t.errors);
    const { check } = t;

    try {
        // --- No daily before the first date
        let p = await open(`/?today=${BEFORE}`);
        check('before the first daily: message', await visible(p, '#messageCover') && /arrives on Wed 11 Nov/.test(await text(p, '#messageText')));
        await p.context.close();

        // --- Daily No. 1: start cover, clock from reveal
        p = await open(`/?today=${DAY1}`);
        check('title Daily No. 1', /Daily\s*No\. 1/.test(await text(p, '#title')));
        check('eyebrow date', (await text(p, '#eyebrow')) === 'Wed 11 Nov 2026');
        check('start cover hides board', await visible(p, '#startCover') &&
            await p.evaluate(() => getComputedStyle(document.querySelector('#board .tile')).visibility === 'hidden'));
        await sleep(1200);
        check('clock not running before start', (await text(p, '#timer')) === '0:00');
        await p.keyboard.press('Enter');
        check('board is Daily No. 1', hexOf(await board(p)) === D1.hex);
        await sleep(1300);
        check('clock runs from reveal', (await text(p, '#timer')) !== '0:00');
        check('par shown', (await text(p, '#statPar')) === `par ${D1.par}` && /Shortest solution today/.test(await text(p, '#parLine')));
        check('solver link locked during daily', (await p.$eval('.site-nav .js-solver-link', a => a.getAttribute('href'))) === 'solver/');

        for (const tile of D1.solution.slice(0, 3)) await clickTile(p, tile);
        check('moves count per tile', (await text(p, '#moveCounter')) === '3');
        const live = Number(await text(p, '#scoreNow'));
        check('live score shown', live > 500 && live <= 1000, String(live));

        const before = await board(p);
        const zc = before.indexOf(0) % 4;
        await p.keyboard.down('Shift');
        await p.keyboard.press(zc >= 2 ? 'ArrowRight' : 'ArrowLeft');
        await p.keyboard.up('Shift');
        const slid = zc >= 2 ? zc : 3 - zc;
        check('shift slide counts each tile', (await text(p, '#moveCounter')) === String(3 + slid));
        const saved = (await store(p)).inProgress;
        check('progress saved after moves', saved && saved.n === 1 && saved.moves === 3 + slid && saved.log.length === 3 + slid);

        await p.keyboard.press('f');
        await sleep(100);
        check('F blocked with toast', /unlocks once/.test(await text(p, '#toast')));
        await p.reload({ waitUntil: 'networkidle0' });
        check('reload resumes paused', await visible(p, '#pauseCover') && hexOf(await board(p)) === hexOf((await store(p)).inProgress.board));
        check('reload keeps moves', (await text(p, '#moveCounter')) === String(3 + slid));
        const pausedAt = await text(p, '#timer');
        await sleep(1200);
        check('clock stays stopped while paused', (await text(p, '#timer')) === pausedAt);

        await p.keyboard.press('x');
        const bh = await board(p);
        await p.keyboard.press('s');
        await p.waitForFunction(() => /Hint \+3/.test(document.getElementById('hintButton').textContent), { timeout: 30000 });
        await sleep(200);
        const ah = await board(p);
        check('hint plays one legal move', bh.filter((v, i) => v !== ah[i]).length === 2);
        check('hint shown in moves label', /1 hint \(\+3\)/.test(await text(p, '#movesLabel')));

        await p.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        check('hidden tab pauses', await visible(p, '#pauseCover'));
        await p.context.close();

        // --- Solve Daily No. 1 two over par; check score, share, practice
        p = await open(`/?today=${DAY1}`);
        await p.keyboard.press('Enter');
        const start = await board(p);
        const z0 = start.indexOf(0), nb = z0 % 4 < 3 ? z0 + 1 : z0 - 1;
        await clickTile(p, start[nb]);
        await clickTile(p, start[nb]);
        for (const tile of D1.solution) await clickTile(p, tile);
        await sleep(200);
        check('solved screen', await p.evaluate(() => document.getElementById('game').classList.contains('is-solved')));
        const res = (await store(p)).results['1'];
        const expected = Scoring.score({ par: D1.par, moves: D1.par + 2, seconds: res.seconds }).score;
        check('stored result', res && res.moves === D1.par + 2 && res.hints === 0 && res.score === expected);
        check('displayed score matches scoring.js', (await text(p, '#solvedScore')) === String(expected));
        check('precision note', (await text(p, '#precisionNote')) === `${D1.par + 2} moves against a par of ${D1.par}. That is 2 over.`);
        check('what-if line', (await text(p, '#whatIf')) ===
            `A perfect ${D1.par}-move solve in the same time would have scored ${Scoring.perfectAtSamePace(D1.par, res.seconds)}.`);
        check('watch link', (await text(p, '#watchSolution')) === `Watch the ${D1.par}-move solution`);
        check('countdown to the next daily', /^Daily No\. 2 unlocks in (\d+h \d\dm|\d+m \d\ds|\d+s), at midnight your time\.$/.test(await text(p, '#solvedFooter')),
            await text(p, '#solvedFooter'));
        check('streak recorded', (await store(p)).streak.current === 1);
        let b = D1.hex.split('').map(c => parseInt(c, 16));
        for (const tile of res.log.split(',').map(Number)) { const i = b.indexOf(tile), z = b.indexOf(0); b[z] = tile; b[i] = 0; }
        check('moves log replays to the goal', b.join(',') === '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0');

        await p.click('#shareButton');
        await p.waitForFunction(() => document.getElementById('shareCard').naturalWidth > 0, { timeout: 10000 });
        const s = Scoring.score({ par: D1.par, moves: D1.par + 2, seconds: res.seconds });
        const bar = (v) => { const f = Math.round(v * 10); return '▰'.repeat(f) + '▱'.repeat(10 - f); };
        const fmt = (sec) => { const x = Math.floor(sec); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
        const want = `quindici #1 · ${s.score}\nprecision ${bar(s.precision)} ${D1.par + 2}/${D1.par}\npace      ${bar(s.pace)} ${fmt(res.seconds)}\n${base}/daily/1`;
        check('share text exact', (await p.$eval('#shareText', e => e.textContent)) === want);
        check('image card 1200×630', await p.$eval('#shareCard', e => e.naturalWidth === 1200 && e.naturalHeight === 630));
        await p.keyboard.press('Escape');

        await p.reload({ waitUntil: 'networkidle0' });
        check('reload shows stored result', (await text(p, '#solvedScore')) === String(expected));
        await p.click('#againButton');
        check('practice label', /practice/.test(await text(p, '#eyebrow')));
        check('practice: no start cover', !(await visible(p, '#startCover')));
        for (const tile of D1.solution) await clickTile(p, tile);
        await sleep(200);
        check('practice result marked', /practice, not counted/.test(await text(p, '#solvedCaption')));
        check('first result kept', (await store(p)).results['1'].score === expected);
        const ctx = p.context;
        await p.close();

        // --- Solver: unlocked after solving here, locked elsewhere
        p = await open(`/solver/?board=${D1.hex}&today=${DAY1}`, {}, ctx);
        await p.waitForFunction(() => !document.getElementById('moveListWrap').hidden, { timeout: 60000 });
        check('solver unlocked after solving', /moves/.test(await text(p, '#title')));
        await ctx.close();
        p = await open(`/solver/?board=${D1.hex}&today=${DAY1}`);
        await sleep(500);
        check('solver locked before solving', (await text(p, '#title')) === 'Locked' && /stays locked/.test(await text(p, '#status')));
        await p.context.close();

        // --- Pretty links (/daily/N), future and past dailies
        p = await open(`/daily/1?today=${DAY1}`);
        check('/daily/1 today: the scored daily, styled', /Daily\s*No\. 1/.test(await text(p, '#title')) && await visible(p, '#startCover') &&
            (await p.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(29, 26, 58)');
        await p.keyboard.press('Enter');
        const bp = await board(p);
        await p.keyboard.press('s');
        await p.waitForFunction((b) => Array.from(document.getElementById('board').children).map(c => Number(c.textContent) || 0).join() !== b, { timeout: 30000 }, bp.join());
        check('/daily/1: hint worker loads from the root', true);
        check('/daily/1: nav links resolve from the root', (await p.$eval('.site-nav a[data-nav="free"]', a => a.href)) === `${base}/?mode=free`);
        await p.context.close();
        p = await open(`/daily/2?today=${DAY1}`);
        check('future daily refused', /isn't out yet/.test(await text(p, '#messageTitle')));
        await p.context.close();
        p = await open(`/daily/1?today=${DAY2}`);
        check('past daily is practice', /practice/.test(await text(p, '#eyebrow')) && hexOf(await board(p)) === D1.hex && !(await visible(p, '#startCover')));
        await p.context.close();
        p = await open(`/?daily=1&today=${DAY2}`);
        check('old ?daily=1 links still work and tidy to /daily/1', (await p.evaluate(() => location.pathname + location.search)) === `/daily/1?today=${DAY2}` &&
            /practice/.test(await text(p, '#eyebrow')));
        await p.context.close();
        p = await open(`/?today=${DAY2}`);
        check('next day: Daily No. 2', /No\. 2/.test(await text(p, '#title')) && await visible(p, '#startCover'));
        await p.context.close();

        // --- Free play
        p = await open('/?board=7586ac3f0b1294ed');
        await p.waitForFunction(() => /par \d+/.test(document.getElementById('statPar').textContent), { timeout: 60000 });
        check('free play finds par', (await text(p, '#statPar')) === 'par 48');
        check('free play nav current', (await p.$eval('.site-nav [aria-current="page"]', a => a.textContent)) === 'Free play');
        await p.context.close();
        p = await open('/?mode=free');
        const fb = hexOf(await board(p));
        await p.keyboard.press('a');
        await sleep(100);
        check('A starts a new free game', hexOf(await board(p)) !== fb);
        await p.context.close();
        p = await open('/?board=123456789abcde0f');
        await p.waitForFunction(() => /par 1/.test(document.getElementById('statPar').textContent));
        await p.keyboard.press('ArrowLeft');
        await sleep(200);
        check('board link: solved with a score', (await text(p, '#solvedScore')) === '1000' && /out of 1000/.test(await text(p, '#solvedCaption')));
        await p.context.close();

        // --- Streak: Daily No. 1 then No. 2 on the same device
        p = await open(`/?today=${DAY1}`);
        const sctx = p.context;
        await p.keyboard.press('Enter');
        for (const tile of D1.solution) await clickTile(p, tile);
        await sleep(200);
        check('no streak shown after one day', !(await visible(p, '#solvedStreak')));
        await p.close();
        p = await open(`/?today=${DAY2}`, {}, sctx);
        await p.keyboard.press('Enter');
        for (const tile of boards[1].solution) await clickTile(p, tile);
        await sleep(200);
        check('streak shown after two days', (await text(p, '#solvedStreak')) === '🔥 2-day streak');
        await p.click('#shareButton');
        await p.waitForFunction(() => document.getElementById('shareText').textContent.length > 0);
        check('streak in share text', /^quindici #2 · \d+ · 🔥2\n/.test(await p.$eval('#shareText', e => e.textContent)));
        await sctx.close();

        // --- Midnight while the page is open (a fake clock jumps a day ahead)
        const fakeClock = () => {
            const Real = Date;
            const off = () => Number(sessionStorage.getItem('__dayOffset') || 0);
            class FakeDate extends Real {
                constructor(...a) { if (a.length) super(...a); else super(Real.now() + off()); }
                static now() { return Real.now() + off(); }
            }
            window.Date = FakeDate;
        };
        const nextDay = (p) => p.evaluate(() => {
            sessionStorage.setItem('__dayOffset', String(86400000));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const pad = (x) => String(x).padStart(2, '0');
        const now = new Date();
        const todayN = (boards.find(b => b.date === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`) || {}).n;
        if (todayN && boards.some(b => b.n === todayN + 1)) {
            const ctx = await browser.createBrowserContext();
            let q = await ctx.newPage();
            await q.evaluateOnNewDocument(fakeClock);
            await q.goto(base + '/', { waitUntil: 'networkidle0' });
            check('midnight: today\'s daily before', new RegExp(`No\\. ${todayN}$`).test(await text(q, '#title')));
            await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle0' }), nextDay(q)]);
            check('midnight: an untouched start screen reloads into the next daily', new RegExp(`No\\. ${todayN + 1}$`).test(await text(q, '#title')));
            await ctx.close();

            const ctx2 = await browser.createBrowserContext();
            q = await ctx2.newPage();
            await q.evaluateOnNewDocument(fakeClock);
            await q.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
            await q.goto(base + '/', { waitUntil: 'networkidle0' });
            await q.keyboard.press('Enter');
            const entry = boards.find(b => b.n === todayN);
            await clickTile(q, entry.solution[0]);
            await nextDay(q);
            await sleep(200);
            check('midnight: a game in progress keeps going, with a note', /A new day/.test(await text(q, '#toast')) &&
                new RegExp(`No\\. ${todayN}$`).test(await text(q, '#title')));
            for (const tile of entry.solution.slice(1)) await clickTile(q, tile);
            await sleep(1300);
            check('midnight: solved screen says the next daily is out', (await text(q, '#solvedFooter')) === `Daily No. ${todayN + 1} is out. Play it`);
            await ctx2.close();
        } else {
            check('midnight tests need today and tomorrow in daily/boards.json', false);
        }

        // --- Phone
        p = await open(`/?today=${DAY1}`, { w: 390, h: 844, phone: true });
        await p.tap('#startButton');
        for (const tile of D1.solution) await clickTile(p, tile);
        await sleep(300);
        check('phone solved: no horizontal scroll', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
        check('phone countdown shown', /unlocks in/.test(await text(p, '#solvedFootnoteMobile')));
        await p.tap('#shareButton');
        await p.waitForFunction(() => document.getElementById('shareCard').naturalWidth > 0);
        check('phone share sheet fits', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 390);
        await p.context.close();
        p = await open('/?mode=free', { w: 390, h: 844, phone: true });
        check('phone free play: hint label fits on one line', await p.$eval('#hintButton', e => e.scrollHeight <= e.clientHeight + 2 && e.getBoundingClientRect().height <= 50));
        await p.context.close();
    } catch (error) {
        check('suite ran without throwing', false, error.stack);
    } finally {
        await browser.close();
        server.close();
        t.finish();
    }
})();
