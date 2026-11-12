// share.js: spoiler-free share text and the 1200×630 image card.
(function (global) {
    'use strict';

    const C = {
        bg: '#1D1A3A', panel: '#2A2654', ink: '#120F26', text: '#FFF6E5', muted: '#C2BCE8',
        pink: '#FF9EC7', cyan: '#8DE8EC', green: '#8EF0A8',
    };

    function bar(value) {
        const filled = Math.max(0, Math.min(10, Math.round(value * 10)));
        return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
    }

    function formatTime(seconds) {
        const total = Math.floor(seconds);
        const m = Math.floor(total / 60), s = total % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    // r: { label ('#1' or 'free play'), score, precision, pace, moves (scored), par, seconds, hints, streak, url }
    function text(r) {
        const hints = r.hints ? ` · ${r.hints} ${r.hints === 1 ? 'hint' : 'hints'}` : '';
        const streak = r.streak >= 2 ? ` · 🔥${r.streak}` : '';
        return [
            `quindici ${r.label} · ${r.score}${hints}${streak}`,
            `precision ${bar(r.precision)} ${r.moves}/${r.par}`,
            `pace      ${bar(r.pace)} ${formatTime(r.seconds)}`,
            r.url,
        ].join('\n');
    }

    function rr(ctx, x, y, w, h, r, fill, stroke, lw) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    }

    function drawBar(ctx, x, y, w, label, valueText, value, color) {
        ctx.textBaseline = 'alphabetic';
        ctx.font = '500 30px Inter, system-ui, sans-serif';
        ctx.fillStyle = C.muted;
        ctx.textAlign = 'left';
        ctx.fillText(label, x, y);
        ctx.font = '500 30px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = C.text;
        ctx.textAlign = 'right';
        ctx.fillText(valueText, x + w, y);
        const by = y + 20, bh = 38;
        rr(ctx, x, by, w, bh, bh / 2, C.ink);
        const inner = Math.max(0, (w - 14) * Math.max(0, Math.min(1, value)));
        if (inner > 0) rr(ctx, x + 7, by + 7, inner, bh - 14, (bh - 14) / 2, color);
    }

    // r: as for text(), plus heading ('NO. 1 · 1 DEC 2026'). Resolves to a PNG Blob.
    async function card(r) {
        try {
            await Promise.all([
                document.fonts.load('400 100px Bungee'),
                document.fonts.load('500 30px "JetBrains Mono"'),
                document.fonts.load('500 30px Inter'),
            ]);
        } catch (e) { /* fall back to system fonts */ }

        const W = 1200, H = 630, P = 72;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        // Ground with grid
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = C.panel;
        for (let x = 0; x < W; x += 48) ctx.fillRect(x, 0, 2, H);
        for (let y = 0; y < H; y += 48) ctx.fillRect(0, y, W, 2);

        // Logo
        rr(ctx, P + 5, P + 5, 64, 64, 14, C.ink);
        rr(ctx, P, P, 64, 64, 14, C.pink, C.ink, 5);
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '400 28px Bungee, "Arial Black", sans-serif';
        ctx.fillText('15', P + 32, P + 34);
        ctx.fillStyle = C.text;
        ctx.textAlign = 'left';
        ctx.font = '400 46px Bungee, "Arial Black", sans-serif';
        ctx.fillText('quindici', P + 86, P + 36);

        // Heading, top right
        ctx.textAlign = 'right';
        ctx.fillStyle = C.cyan;
        ctx.font = '500 30px "JetBrains Mono", ui-monospace, monospace';
        if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
        ctx.fillText(r.heading, W - P, P + 34);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

        // Big score, bottom left, shrunk to clear the bars (four digits are wider)
        const bw = 470, bx = W - P - bw;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        let size = 250;
        do {
            ctx.font = `400 ${size}px Bungee, "Arial Black", sans-serif`;
            size -= 10;
        } while (ctx.measureText(String(r.score)).width > bx - P - 48 && size > 100);
        const baseline = H - P + 10;
        ctx.fillStyle = C.ink;
        ctx.fillText(String(r.score), P + 12, baseline + 12);
        ctx.fillStyle = C.green;
        ctx.fillText(String(r.score), P, baseline);

        // Bars, bottom right
        drawBar(ctx, bx, H - P - 190, bw, 'Precision', `${r.moves} / par ${r.par}`, r.precision, C.pink);
        drawBar(ctx, bx, H - P - 58, bw, 'Pace', formatTime(r.seconds), r.pace, C.cyan);

        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    global.Share = { text, card, bar, formatTime };
})(window);
