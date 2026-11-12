// solver.js: optimal solution finder and playback.
(function () {
    'use strict';

    const P = window.Puzzle;
    const $ = (id) => document.getElementById(id);
    const SPEEDS = [1, 2, 4];
    const STEP_MS = 600;          // playback at 1×
    const GIF_SIZE = 360;

    const el = {
        main: $('solver'),
        board: $('board'),
        boardWrap: $('boardWrap'),
        scrub: $('scrub'),
        scrubCount: $('scrubCount'),
        prev: $('prevButton'),
        play: $('playButton'),
        next: $('nextButton'),
        speed: $('speedButton'),
        gifButtons: document.querySelectorAll('.js-gif'),
        eyebrow: $('eyebrow'),
        title: $('title'),
        codeToggle: $('codeToggle'),
        codeForm: $('codeForm'),
        code: $('code'),
        solve: $('solveButton'),
        status: $('status'),
        listWrap: $('moveListWrap'),
        moves: $('moves'),
        nextLabel: $('nextLabel'),
        playLink: $('playLink'),
        help: $('helpDialog'),
        toast: $('toast'),
    };

    const state = {
        start: null,       // board being solved
        solution: null,    // tile numbers, one per move
        boards: [],        // boards[k] = position after k moves
        step: 0,
        playing: null,     // interval id
        speed: 0,          // index into SPEEDS
        worker: null,
        buildingGif: false,
    };

    // ---------- daily lock ----------

    // Today's daily stays locked here until it has been solved on this device. A courtesy, not security.
    const todayDaily = fetch('../daily/boards.json')
        .then(r => (r.ok ? r.json() : []))
        .then(list => list.find(d => d.date === todayKey()) || null)
        .catch(() => null);

    function todayKey() {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
        const override = local && new URLSearchParams(window.location.search).get('today');
        if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
        const d = new Date();
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // ---------- solving ----------

    async function load(input, { updateUrl = true } = {}) {
        let board;
        try {
            board = P.parseBoard(input);
        } catch (error) {
            setStatus(error.message, true);
            return;
        }
        if (!P.isSolvable(board)) {
            showBoard(board);
            setStatus('This board cannot be solved: no sequence of slides puts it in order.', true);
            return;
        }

        stop();
        state.start = board;
        state.solution = null;
        state.boards = [board];
        state.step = 0;
        const hex = P.toHex(board);
        el.code.value = hex;
        el.playLink.href = '../?board=' + hex;
        if (updateUrl) history.replaceState(null, '', '?board=' + hex);
        setCodeOpen(false);
        el.moves.textContent = '';
        el.listWrap.hidden = true;
        el.main.classList.remove('is-locked');

        render();
        const daily = await todayDaily;
        if (daily && daily.hex === hex && !(window.QStorage && window.QStorage.result(daily.n))) {
            el.main.classList.add('is-locked');
            el.title.textContent = 'Locked';
            setStatus("Today's daily board stays locked here until you have solved it yourself.");
            return;
        }
        runWorker(board);
    }

    function runWorker(board) {
        if (state.worker) state.worker.terminate();
        el.solve.disabled = true;
        el.title.textContent = 'Solving…';
        setStatus('Searching for the shortest solution…');
        const started = performance.now();

        const worker = new Worker('solverWorker.js');
        state.worker = worker;
        worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'progress') {
                const secs = ((performance.now() - started) / 1000).toFixed(0);
                setStatus(`Searching… no solution is shorter than ${msg.bound} moves (${secs}s).`);
                return;
            }
            worker.terminate();
            state.worker = null;
            el.solve.disabled = false;
            if (msg.type === 'error') {
                el.title.textContent = 'Solver';
                setStatus(msg.message, true);
                return;
            }
            setSolution(msg.solution);
        };
        worker.onerror = (error) => {
            console.error('Solver worker error:', error);
            worker.terminate();
            state.worker = null;
            el.solve.disabled = false;
            el.title.textContent = 'Solver';
            setStatus('Something went wrong while solving.', true);
        };
        worker.postMessage({ board });
    }

    function setSolution(solution) {
        state.solution = solution;
        state.boards = [state.start];
        for (const tile of solution) state.boards.push(P.applyMove(state.boards[state.boards.length - 1], tile));
        state.step = 0;

        const n = solution.length;
        el.title.innerHTML = `<span class="accent-pace">${n}</span> ${n === 1 ? 'move' : 'moves'}`;
        setStatus(n === 0 ? 'This board is already solved.' : '');
        el.scrub.max = String(n);

        el.moves.textContent = '';
        solution.forEach((tile, i) => {
            const li = document.createElement('li');
            li.className = 'move-chip row-' + P.homeRow(tile);
            li.textContent = tile;
            li.dataset.step = String(i);
            el.moves.appendChild(li);
        });
        el.listWrap.hidden = n === 0;
        render();
    }

    // ---------- playback ----------

    function go(step) {
        if (!state.solution) return;
        state.step = Math.max(0, Math.min(state.solution.length, step));
        render();
    }

    function play() {
        if (!state.solution || state.solution.length === 0) return;
        if (state.playing) { stop(); return; }
        if (state.step >= state.solution.length) state.step = 0;
        state.playing = setInterval(tick, STEP_MS / SPEEDS[state.speed]);
        render();
    }

    function tick() {
        if (state.step >= state.solution.length) { stop(); return; }
        state.step++;
        render();
        if (state.step >= state.solution.length) stop();
    }

    function stop() {
        if (!state.playing) return;
        clearInterval(state.playing);
        state.playing = null;
        render();
    }

    function cycleSpeed() {
        state.speed = (state.speed + 1) % SPEEDS.length;
        const label = SPEEDS[state.speed] + '×';
        el.speed.textContent = label;
        el.speed.setAttribute('aria-label', 'Playback speed, ' + label);
        if (state.playing) {
            clearInterval(state.playing);
            state.playing = setInterval(tick, STEP_MS / SPEEDS[state.speed]);
        }
    }

    // ---------- rendering ----------

    function showBoard(board) {
        P.renderCells(el.board, board);
        el.boardWrap.classList.toggle('is-solved', P.isGoal(board));
    }

    function render() {
        const sol = state.solution;
        const total = sol ? sol.length : 0;
        const step = state.step;
        const board = state.boards[step] || state.start || P.GOAL;
        const next = sol && step < total ? sol[step] : null;

        P.renderCells(el.board, board, { lifted: next });
        el.boardWrap.classList.toggle('is-solved', !!state.start && P.isGoal(board));
        el.board.setAttribute('aria-label', sol ? `Board at move ${step} of ${total}` : 'Board');

        const ready = !!sol && total > 0;
        el.scrub.disabled = !ready;
        el.scrub.value = String(step);
        el.scrubCount.innerHTML = `${step} / ${total}` + (next ? `<span class="phone-only"> · next: ${next}</span>` : '');
        el.prev.disabled = !ready || step === 0;
        el.next.disabled = !ready || step === total;
        el.play.disabled = !ready;
        el.play.classList.toggle('is-playing', !!state.playing);
        el.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
        el.gifButtons.forEach(b => { b.disabled = !ready || state.buildingGif; });
        el.nextLabel.innerHTML = next ? `Next: <strong>${next}</strong>` : (ready ? '<strong>Solved</strong>' : '');

        Array.from(el.moves.children).forEach((li, i) => {
            li.classList.toggle('is-done', i < step);
            li.classList.toggle('is-current', i === step);
            if (i === step) li.setAttribute('aria-current', 'step');
            else li.removeAttribute('aria-current');
        });
        const current = el.moves.children[step];
        if (current && state.playing) current.scrollIntoView({ block: 'nearest' });
    }

    function setStatus(message, isError = false) {
        el.status.innerHTML = '';
        el.status.textContent = message;
        el.status.classList.toggle('is-error', isError);
        el.status.hidden = !message;
    }

    function setCodeOpen(open) {
        el.main.classList.toggle('code-open', open);
        el.codeToggle.setAttribute('aria-expanded', String(open));
        // Visible text leads the accessible name; the full code is added for screen readers.
        el.codeToggle.innerHTML = open ? 'Close<span class="sr-only"> board code</span>' :
            (state.start ? P.toHex(state.start).slice(0, 8) + '…  Edit<span class="sr-only"> board code, currently ' +
                P.toHex(state.start) + '</span>' : 'Edit<span class="sr-only"> board code</span>');
        if (open) el.code.focus();
    }

    function toast(message, ms = 2400) {
        el.toast.textContent = message;
        el.toast.classList.add('is-visible');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => el.toast.classList.remove('is-visible'), ms);
    }

    // ---------- GIF ----------

    const COLORS = {
        bg: '#1D1A3A', panel: '#2A2654', solved: '#245C47', ink: '#120F26', line: '#4A4585', text: '#FFF6E5',
        rows: ['#FF9EC7', '#FFE27A', '#8DE8EC', '#C9B3FF'], home: '#8EF0A8',
    };

    function drawFrame(ctx, board, lifted) {
        const s = GIF_SIZE;
        const solved = P.isGoal(board);
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, s, s);

        // Board tray with its hard shadow
        const m = 12, shadow = 6, tray = s - 2 * m - shadow;
        roundRect(ctx, m + shadow, m + shadow, tray, tray, 18, COLORS.ink);
        roundRect(ctx, m, m, tray, tray, 18, solved ? COLORS.solved : COLORS.panel, COLORS.ink, 3);

        const pad = 12, gap = 9;
        const cell = (tray - 2 * pad - 3 * gap) / 4;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `400 ${Math.round(cell * 0.42)}px Bungee, "Arial Black", sans-serif`;

        board.forEach((v, i) => {
            let x = m + pad + (i % 4) * (cell + gap);
            let y = m + pad + Math.floor(i / 4) * (cell + gap);
            if (v === 0) {
                ctx.setLineDash([6, 4]);
                roundRect(ctx, x + 1.5, y + 1.5, cell - 3, cell - 3, 9, COLORS.bg, COLORS.line, 3);
                ctx.setLineDash([]);
                return;
            }
            const isLifted = v === lifted;
            const fill = solved || P.isHome(v, i) ? COLORS.home : COLORS.rows[P.homeRow(v) - 1];
            if (isLifted) {
                x -= 3; y -= 3;
                roundRect(ctx, x + 6, y + 6, cell, cell, 9, COLORS.ink);
                roundRect(ctx, x - 3, y - 3, cell + 6, cell + 6, 11, COLORS.ink);
                roundRect(ctx, x, y, cell, cell, 9, fill, COLORS.text, 3);
            } else {
                roundRect(ctx, x + 3, y + 3, cell, cell, 9, COLORS.ink);
                roundRect(ctx, x, y, cell, cell, 9, fill, COLORS.ink, 3);
            }
            ctx.fillStyle = COLORS.ink;
            ctx.fillText(String(v), x + cell / 2, y + cell / 2 + 2);
        });
    }

    function roundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
    }

    async function downloadGif() {
        if (!state.solution || state.buildingGif || typeof GIF === 'undefined') {
            if (typeof GIF === 'undefined') toast('The GIF library did not load.');
            return;
        }
        state.buildingGif = true;
        render();
        const label = (text) => el.gifButtons.forEach(b => { if (b.classList.contains('gif-long')) b.textContent = text; });
        label('Building GIF…');

        try {
            await document.fonts.load('400 30px Bungee');
        } catch (e) { /* fall back to Arial Black */ }

        const canvas = $('gifCanvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const gif = new GIF({ workers: 2, quality: 10, workerScript: 'gif.worker.js', width: GIF_SIZE, height: GIF_SIZE });
        const last = state.boards.length - 1;
        state.boards.forEach((board, k) => {
            drawFrame(ctx, board, k < last ? state.solution[k] : null);
            gif.addFrame(ctx, { copy: true, delay: k === 0 ? 1000 : k === last ? 2500 : 450 });
        });

        const done = () => {
            state.buildingGif = false;
            label('Download GIF');
            render();
        };
        gif.on('progress', (p) => label(`Building GIF… ${Math.round(p * 100)}%`));
        gif.on('finished', (blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = P.toHex(state.start) + '.gif';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            done();
        });
        try {
            gif.render();
        } catch (error) {
            console.error('GIF error:', error);
            toast('Could not build the GIF.');
            done();
        }
    }

    // ---------- events ----------

    el.codeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        load(el.code.value);
    });
    el.codeToggle.addEventListener('click', () => setCodeOpen(!el.main.classList.contains('code-open')));
    el.scrub.addEventListener('input', () => { stop(); go(Number(el.scrub.value)); });
    el.prev.addEventListener('click', () => { stop(); go(state.step - 1); });
    el.next.addEventListener('click', () => { stop(); go(state.step + 1); });
    el.play.addEventListener('click', play);
    el.speed.addEventListener('click', cycleSpeed);
    el.gifButtons.forEach(b => b.addEventListener('click', downloadGif));
    el.moves.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li) { stop(); go(Number(li.dataset.step)); }
    });

    $('helpButton').addEventListener('click', () => el.help.showModal());
    el.help.addEventListener('click', (e) => {
        if (e.target === el.help || e.target.closest('[data-close]')) el.help.close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === '?') {
            if (el.help.open) el.help.close(); else el.help.showModal();
            e.preventDefault();
            return;
        }
        if (el.help.open) return;
        const t = e.target;
        if (t && t.closest && t.closest('input, textarea, select')) return;
        // Space on a focused button or link activates it natively.
        if (e.key === ' ' && t && t.closest && t.closest('button, a')) return;
        switch (e.key) {
            case ' ': play(); break;
            case 'ArrowLeft': stop(); go(state.step - 1); break;
            case 'ArrowRight': stop(); go(state.step + 1); break;
            case 'Home': stop(); go(0); break;
            case 'End': stop(); go(Infinity); break;
            default: return;
        }
        e.preventDefault();
    });

    // ---------- start ----------

    const hex = new URLSearchParams(window.location.search).get('board');
    if (hex) {
        load(hex, { updateUrl: false });
    } else {
        render();
        setCodeOpen(true);
    }
})();
