// Shared helpers for the browser tests: a static server for the repo, Chrome, and a tiny check runner.
const fs = require('fs');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
};

// Serves the repo like Netlify does: /dir/ → /dir/index.html, and /daily/N → /index.html (see _redirects).
// Listens on 127.0.0.1 so the game treats it
// as local (the ?today= override works and the leaderboard uses the emulator).
function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            // Like Netlify, a rewrite never shadows a file that exists (daily/boards.json).
            if (/^\/daily\/[^/]+\/?$/.test(pathname) && !fs.existsSync(path.join(ROOT, pathname))) pathname = '/index.html';
            let file = path.join(ROOT, pathname);
            if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
            if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

function chromePath() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
    return found;
}

async function launch() {
    return puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
}

function runner() {
    let fails = 0;
    const errors = [];
    return {
        errors,
        check(name, ok, extra = '') {
            if (!ok) fails++;
            console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== '' ? ' — ' + extra : ''));
        },
        finish() {
            if (errors.length) { console.log('page errors:\n' + errors.join('\n')); fails += errors.length; }
            console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
            process.exitCode = fails ? 1 : 0;
        },
    };
}

// Opens a page in a fresh, isolated browser context (its own localStorage).
async function opener(browser, base, errors) {
    return async function open(url, o = {}, ctx) {
        const context = ctx || await browser.createBrowserContext();
        const p = await context.newPage();
        p.on('pageerror', e => errors.push(url + ': ' + e.message));
        await p.setViewport({ width: o.w || 1280, height: o.h || 820, isMobile: !!o.phone, hasTouch: !!o.phone });
        if (o.reduced !== false) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await p.goto(base + url, { waitUntil: 'networkidle0' });
        await p.evaluate(() => document.fonts.ready);
        p.context = context;
        return p;
    };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const boards = require(path.join(ROOT, 'daily', 'boards.json'));
const Scoring = require(path.join(ROOT, 'js', 'scoring.js'));
const hexOf = (b) => b.map(n => n.toString(16)).join('');
const text = (p, sel) => p.$eval(sel, e => e.textContent.trim());
const visible = (p, sel) => p.$eval(sel, e => !e.hidden && getComputedStyle(e).display !== 'none');
const board = (p) => p.evaluate(() => Array.from(document.getElementById('board').children).map(c => Number(c.textContent) || 0));
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('quindici.v1') || 'null'));
const clickTile = (p, n) => p.evaluate((n) => Array.from(document.querySelectorAll('#board button.tile')).find(b => Number(b.textContent) === n).click(), n);

module.exports = { serve, launch, runner, opener, sleep, boards, Scoring, hexOf, text, visible, board, store, clickTile, ROOT };
