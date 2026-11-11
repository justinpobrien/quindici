// script.js: the Quindici game (Free play).
// Board helpers live in puzzle.js (window.Puzzle).
(function () {
    'use strict';

    const P = window.Puzzle;
    const SIZE = P.SIZE;
    const SLIDE_MS = 120;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');

    const $ = (id) => document.getElementById(id);

    class PuzzleGame {
        constructor() {
            this.board = [];
            this.initialBoard = [];
            this.fromUrl = false;

            this.moveCount = 0;
            this.hintCount = 0;
            this.hintPath = [];

            this.started = false;   // start cover dismissed
            this.gameWon = false;
            this.paused = false;

            // Active time, excluding pauses. `runningSince` is a performance.now() stamp while the clock runs.
            this.elapsedMs = 0;
            this.runningSince = null;
            this.tick = null;

            // Pending slide animation, so a fast key press can finish it early.
            this.pending = null;

            this.el = {
                main: $('game'),
                board: $('board'),
                boardWrap: document.querySelector('.board-wrap'),
                moves: $('moveCounter'),
                timer: $('timer'),
                boardCode: $('boardCode'),
                hint: $('hintButton'),
                pause: $('pauseButton'),
                newGame: $('newGameButton'),
                startCover: $('startCover'),
                pauseCover: $('pauseCover'),
                summary: $('solvedSummary'),
                solvedMoves: $('solvedMoves'),
                solvedCaption: $('solvedCaption'),
                watch: $('watchSolution'),
                help: $('helpDialog'),
                toast: $('toast'),
                announcer: $('announcer'),
            };
        }

        // ---------- setup ----------

        init() {
            P.renderCells($('goalBoard'), P.GOAL, { colorHome: false, labels: false });
            P.renderCells($('solvedMiniBoard'), P.GOAL, { solved: true, labels: false });

            const hex = new URLSearchParams(window.location.search).get('board');
            let board = null;
            if (hex) {
                try {
                    board = P.fromHex(hex);
                    if (!P.isSolvable(board)) throw new Error('That board cannot be solved.');
                    if (P.isGoal(board)) throw new Error('That board is already solved.');
                } catch (error) {
                    board = null;
                    this.toast('Invalid board link: ' + error.message + ' Starting a new game.', 5000);
                }
            }

            this.fromUrl = !!board;
            this.reset(board || P.shuffled());
            this.showCover('start');
            this.bindEvents();
        }

        reset(board) {
            this.cancelAnimation();
            this.board = board.slice();
            this.initialBoard = board.slice();
            this.moveCount = 0;
            this.hintCount = 0;
            this.hintPath = [];
            this.gameWon = false;
            this.paused = false;
            this.stopClock();
            this.elapsedMs = 0;

            this.el.main.classList.remove('is-solved');
            this.el.boardWrap.classList.remove('is-solved');
            this.el.summary.hidden = true;
            this.showCover(null);

            // A shared ?board= link keeps its board until it is solved.
            this.el.newGame.disabled = this.fromUrl;

            this.render();
            this.updateStats();
            this.updateButtons();

            const hex = P.toHex(this.initialBoard);
            this.el.boardCode.textContent = hex;
            this.el.boardCode.href = './?board=' + hex;
            this.el.watch.href = 'solver/?board=' + hex;
        }

        newGame() {
            if (this.fromUrl && !this.gameWon) return;
            this.fromUrl = false;
            if (window.location.search) {
                history.replaceState(null, '', window.location.pathname);
            }
            this.started = true;
            this.reset(P.shuffled());
        }

        bindEvents() {
            this.el.board.addEventListener('click', (event) => {
                const tile = event.target.closest('.tile');
                if (!tile || !this.el.board.contains(tile)) return;
                const index = Array.prototype.indexOf.call(this.el.board.children, tile);
                if (this.moveTile(index) && coarsePointer.matches && navigator.vibrate) {
                    navigator.vibrate(50);
                }
            });

            this.el.hint.addEventListener('click', () => this.hint());
            this.el.pause.addEventListener('click', () => this.togglePause());
            this.el.newGame.addEventListener('click', () => this.newGame());
            $('playAgainButton').addEventListener('click', () => this.newGame());
            $('startButton').addEventListener('click', () => this.start());
            $('resumeButton').addEventListener('click', () => this.togglePause(false));
            $('shareButton').addEventListener('click', () => this.share());
            $('helpButton').addEventListener('click', () => this.toggleHelp());

            this.el.help.addEventListener('click', (event) => {
                // Close on the backdrop or the × button.
                if (event.target === this.el.help || event.target.closest('[data-close]')) this.el.help.close();
            });
            this.el.help.addEventListener('close', () => this.resumeClockIfPlaying());

            document.addEventListener('keydown', (event) => this.handleKeydown(event));
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.runningSince !== null) this.togglePause(true);
            });
        }

        // ---------- rendering ----------

        render() {
            const focused = document.activeElement;
            const focusedTile = focused && focused.classList.contains('tile') && this.el.board.contains(focused)
                ? Number(focused.textContent) : null;

            P.renderCells(this.el.board, this.board, {
                tag: this.gameWon ? 'div' : 'button',
                solved: this.gameWon,
            });

            if (focusedTile !== null) {
                const again = Array.from(this.el.board.children).find(c => Number(c.textContent) === focusedTile);
                if (again && again.tagName === 'BUTTON') again.focus();
            }

            document.querySelectorAll('.js-solver-link').forEach(link => {
                link.href = 'solver/?board=' + P.toHex(this.board);
            });
        }

        updateStats() {
            this.el.moves.textContent = this.moveCount;
            this.el.timer.textContent = formatTime(this.elapsedNow());
        }

        updateButtons() {
            const playing = this.started && !this.gameWon;
            this.el.hint.disabled = !playing || this.paused;
            this.el.pause.disabled = !playing;
            this.el.pause.textContent = this.paused ? 'Resume' : 'Pause';
            this.el.pause.setAttribute('aria-pressed', String(this.paused));
        }

        showCover(which) {
            this.el.startCover.hidden = which !== 'start';
            this.el.pauseCover.hidden = which !== 'pause';
            const covered = which !== null;
            // While covered, the board must not be seen or reached.
            this.el.board.classList.toggle('is-covered', covered);
            this.el.board.inert = covered;
            if (covered) this.el.board.setAttribute('aria-hidden', 'true');
            else this.el.board.removeAttribute('aria-hidden');
        }

        // ---------- moves ----------

        canMove() {
            return this.started && !this.gameWon && !this.paused && !this.el.help.open;
        }

        // Slides the tile at `index` (and any tiles between it and the empty square) into the gap.
        // Returns true if a move was made.
        moveTile(index, { fromHint = false } = {}) {
            if (!this.canMove() || this.pending) return false;

            const empty = this.board.indexOf(0);
            const row = Math.floor(index / SIZE), col = index % SIZE;
            const emptyRow = Math.floor(empty / SIZE), emptyCol = empty % SIZE;
            if (index === empty || (row !== emptyRow && col !== emptyCol)) return false;

            // Indices of the tiles that slide, and the direction each one travels.
            const stride = row === emptyRow ? 1 : SIZE;
            const step = (empty > index ? 1 : -1) * stride;
            const moving = [];
            for (let i = empty - step; i !== index - step; i -= step) moving.push(i);

            if (!fromHint) this.hintPath = [];

            const commit = () => {
                this.pending = null;
                for (let i = empty; i !== index; i -= step) this.board[i] = this.board[i - step];
                this.board[index] = 0;
                this.moveCount++;
                this.render();
                this.updateStats();
                if (this.runningSince === null && this.elapsedMs === 0) this.startClock();
                if (P.isGoal(this.board)) this.win();
            };

            if (reducedMotion.matches) {
                commit();
                return true;
            }

            const cells = this.el.board.children;
            moving.forEach(i => {
                const tile = cells[i], target = cells[i + step];
                if (!tile || !target) return;
                tile.style.transition = `transform ${SLIDE_MS}ms ease`;
                tile.style.transform = `translate(${target.offsetLeft - tile.offsetLeft}px, ${target.offsetTop - tile.offsetTop}px)`;
            });
            this.pending = { commit, timer: setTimeout(commit, SLIDE_MS) };
            return true;
        }

        // Finishes an in-flight slide immediately (used before a key press so fast typing is never dropped).
        finishAnimation() {
            if (!this.pending) return;
            clearTimeout(this.pending.timer);
            this.pending.commit();
        }

        cancelAnimation() {
            if (!this.pending) return;
            clearTimeout(this.pending.timer);
            this.pending = null;
        }

        // Arrow keys move the tile next to the empty square into it; with Shift, the whole row or column slides.
        moveByKey(key, wholeLine) {
            const offsets = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] };
            const [dr, dc] = offsets[key];
            const empty = this.board.indexOf(0);
            let r = Math.floor(empty / SIZE) + dr, c = empty % SIZE + dc;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
            if (wholeLine) {
                while (r + dr >= 0 && r + dr < SIZE && c + dc >= 0 && c + dc < SIZE) { r += dr; c += dc; }
            }
            this.moveTile(r * SIZE + c);
        }

        // Hint: plays the next move of a greedy best-first path. It costs one move, as before.
        hint() {
            if (!this.canMove()) return;
            this.finishAnimation();
            if (this.gameWon) return;

            if (this.hintPath.length === 0) this.hintPath = greedyPath(this.board);
            const next = this.hintPath.shift();
            if (!next) return;
            const index = this.board.findIndex((v, i) => v !== 0 && next[i] === 0);
            if (index === -1) { this.hintPath = []; return; }
            this.hintCount++;
            this.moveTile(index, { fromHint: true });
        }

        win() {
            this.gameWon = true;
            this.stopClock();
            this.updateStats();

            const focusWasOnBoard = this.el.board.contains(document.activeElement);
            this.render();
            this.el.main.classList.add('is-solved');
            this.el.boardWrap.classList.add('is-solved');
            this.el.newGame.disabled = false;
            this.updateButtons();

            const time = formatTime(this.elapsedMs);
            this.el.solvedMoves.textContent = this.moveCount;
            this.el.solvedCaption.textContent = (this.moveCount === 1 ? 'move' : 'moves') + ' · solved in ' + time;
            this.el.summary.hidden = false;
            this.announce(`Solved in ${this.moveCount} ${this.moveCount === 1 ? 'move' : 'moves'} and ${time}.`);
            if (focusWasOnBoard || document.activeElement === document.body) $('shareButton').focus();
        }

        // ---------- clock ----------

        elapsedNow() {
            return this.elapsedMs + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
        }

        startClock() {
            if (this.runningSince !== null || this.gameWon) return;
            this.runningSince = performance.now();
            this.tick = setInterval(() => this.updateStats(), 250);
        }

        stopClock() {
            if (this.runningSince !== null) {
                this.elapsedMs += performance.now() - this.runningSince;
                this.runningSince = null;
            }
            clearInterval(this.tick);
            this.tick = null;
        }

        // The clock starts on the first move, so only resume it once play has begun.
        resumeClockIfPlaying() {
            if (this.started && !this.gameWon && !this.paused && this.moveCount > 0) this.startClock();
        }

        // ---------- overlays ----------

        start() {
            if (this.started) return;
            this.started = true;
            this.showCover(null);
            this.updateButtons();
            // Keep keyboard focus near the board without drawing a ring on a tile.
            this.el.board.focus({ preventScroll: true });
        }

        togglePause(force) {
            if (!this.started || this.gameWon) return;
            const pause = typeof force === 'boolean' ? force : !this.paused;
            if (pause === this.paused) return;
            this.finishAnimation();
            if (this.gameWon) return;

            this.paused = pause;
            if (pause) {
                this.stopClock();
                this.showCover('pause');
                this.updateStats();
            } else {
                this.showCover(null);
                this.resumeClockIfPlaying();
            }
            this.updateButtons();
            if (pause && this.el.board.contains(document.activeElement)) $('resumeButton').focus();
        }

        toggleHelp() {
            if (this.el.help.open) {
                this.el.help.close();
                return;
            }
            this.stopClock();
            this.el.help.showModal();
        }

        // ---------- keyboard ----------

        handleKeydown(event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key;

            if (key === '?') {
                this.toggleHelp();
                event.preventDefault();
                return;
            }
            if (this.el.help.open) return; // the dialog handles Escape itself

            const target = event.target;
            const inControl = target && target.closest && target.closest('input, textarea, select, a, button:not(.tile)');

            if (!this.started) {
                if (key === 'Enter' && !inControl) {
                    this.start();
                    event.preventDefault();
                }
                return;
            }

            switch (key.toLowerCase()) {
                case 'x':
                    this.togglePause();
                    event.preventDefault();
                    return;
                case 'escape':
                    if (this.paused) { this.togglePause(false); event.preventDefault(); }
                    return;
                case 'a':
                    this.newGame();
                    event.preventDefault();
                    return;
                case 's':
                    this.hint();
                    event.preventDefault();
                    return;
                case 'f':
                    window.open('solver/?board=' + P.toHex(this.board), '_blank');
                    event.preventDefault();
                    return;
            }

            if (key.startsWith('Arrow') && this.canMove()) {
                event.preventDefault();
                this.finishAnimation();
                if (this.canMove()) this.moveByKey(key, event.shiftKey);
            }
        }

        // ---------- sharing ----------

        share() {
            const url = `${window.location.origin}${window.location.pathname}?board=${P.toHex(this.initialBoard)}`;
            const text = `quindici · solved in ${this.moveCount} moves, ${formatTime(this.elapsedMs)}\nCan you beat it?`;

            if (navigator.share) {
                navigator.share({ title: 'Quindici', text, url })
                    .catch((error) => {
                        if (error.name !== 'AbortError') this.copy(`${text}\n${url}`);
                    });
            } else {
                this.copy(`${text}\n${url}`);
            }
        }

        copy(text) {
            navigator.clipboard.writeText(text)
                .then(() => this.toast('Copied'))
                .catch(() => this.toast('Could not copy. Select and copy the board code instead.'));
        }

        toast(message, ms = 2400) {
            const el = this.el.toast;
            el.textContent = message;
            el.classList.add('is-visible');
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
        }

        announce(message) {
            this.el.announcer.textContent = message;
        }
    }

    // ---------- helpers ----------

    function formatTime(ms) {
        const total = Math.floor(ms / 1000);
        const m = Math.floor(total / 60), s = total % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function manhattan(state) {
        let d = 0;
        for (let i = 0; i < state.length; i++) {
            const v = state[i];
            if (v === 0) continue;
            d += Math.abs(Math.floor(i / SIZE) - Math.floor((v - 1) / SIZE)) + Math.abs(i % SIZE - (v - 1) % SIZE);
        }
        return d;
    }

    function neighbors(state) {
        const out = [];
        const z = state.indexOf(0), r = Math.floor(z / SIZE), c = z % SIZE;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
            const n = nr * SIZE + nc, next = state.slice();
            [next[z], next[n]] = [next[n], next[z]];
            out.push(next);
        }
        return out;
    }

    // Greedy best-first search on Manhattan distance. Fast but not optimal; returns the boards after each move.
    function greedyPath(start) {
        const key = (s) => s.join(',');
        const open = [{ state: start, h: manhattan(start) }];
        const cameFrom = new Map([[key(start), null]]);
        while (open.length) {
            let best = 0;
            for (let i = 1; i < open.length; i++) if (open[i].h < open[best].h) best = i;
            const { state } = open.splice(best, 1)[0];
            if (P.isGoal(state)) {
                const path = [];
                for (let s = state; s && key(s) !== key(start); s = cameFrom.get(key(s))) path.unshift(s);
                return path;
            }
            for (const n of neighbors(state)) {
                const k = key(n);
                if (cameFrom.has(k)) continue;
                cameFrom.set(k, state);
                open.push({ state: n, h: manhattan(n) });
            }
        }
        return [];
    }

    new PuzzleGame().init();
})();
