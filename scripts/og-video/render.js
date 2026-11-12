#!/usr/bin/env node
// Renders the link-preview still and video from preview.html:
//   assets/preview-image.jpg  (frame 0, 1200×630)
//   assets/preview-video.mp4  (the board solving in 48 moves, then holding solved; loops)
// Needs Google Chrome and ffmpeg (with libx264). Usage:
//   cd scripts/og-video && npm install && node render.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const FPS = 30;
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

// Minimal static server for the repo, so preview.html can load the site's CSS.
function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); res.end(); return;
            }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

(async () => {
    const server = await serve();
    const url = `http://127.0.0.1:${server.address().port}/scripts/og-video/preview.html`;
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);

    await page.evaluate(() => window.renderAt(0));
    await page.screenshot({ path: path.join(ASSETS, 'preview-image.jpg'), type: 'jpeg', quality: 88 });

    const duration = await page.evaluate(() => window.DURATION);
    const frames = Math.round(duration * FPS);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quindici-og-'));
    for (let k = 0; k < frames; k++) {
        await page.evaluate((t) => window.renderAt(t), k / FPS);
        await page.screenshot({ path: path.join(tmp, `f${String(k).padStart(4, '0')}.png`) });
    }
    await browser.close();
    server.close();

    const out = path.join(ASSETS, 'preview-video.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(tmp, 'f%04d.png'),
        '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '24',
        '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Wrote ${frames} frames (${duration.toFixed(1)} s) to ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB) and assets/preview-image.jpg`);
})();
