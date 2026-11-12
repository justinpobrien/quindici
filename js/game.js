// game.js: the Quindici game: Daily challenge and Free play.
// Depends on puzzle.js (Puzzle), scoring.js (Scoring), storage.js (QStorage), share.js (Share) and api.js (Api).
(function () {
    'use strict';

    const P = window.Puzzle;
    const S = window.Scoring;
    const Store = window.QStorage;
    const SIZE = P.SIZE;
    const SLIDE_MS = 120;
    const FREE_HINT_BUDGET_MS = 3000;   // Free play falls back to a greedy hint after this
    const WORKER_URL = 'solver/solverWorker.js';
    const DAILY_URL = 'daily/boards.json';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const phoneLayout = window.matchMedia('(max-width: 640px)');

    const $ = (id) => document.getElementById(id);

    function track(name, params) {
        if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
    }

    class Game {
        constructor() {
            this.mode = 'daily';        // 'daily' | 'free'
            this.entry = null;          // daily entry { n, date, hex, par, solution }
            this.dailies = [];
            this.todayEntry = null;
            this.scored = false;        // true for the first attempt at today's daily
            this.practice = false;      // a daily played again or a past daily

            this.board = [];
            this.initialBoard = [];
            this.fromUrl = false;

            this.par = null;
            this.nextMove = new Map();  // board hex → tile to slide next on a shortest path
            this.parWorker = null;
            this.hintWorker = null;
            this.hintBusy = false;

            this.tileMoves = 0;
            this.hints = 0;
            this.log = [];              // tile numbers in the order they moved
            this.startedAt = null;
            this.token = null;          // signed start token from the leaderboard API

            this.started = false;       // board revealed
            this.gameWon = false;
            this.paused = false;
            this.clockStarted = false;
            this.elapsedMs = 0;
            this.runningSince = null;
            this.tick = null;
            this.pending = null;        // in-flight slide animation
            this.result = null;         // { moves, hints, seconds, score } once solved

            this.el = {
                main: $('game'),
                board: $('board'),
                boardWrap: document.querySelector('.board-wrap'),
                eyebrow: $('eyebrow'),
                title: $('title'),
                parChip: $('parChip'),
                parLine: $('parLine'),
                boardCodeLine: $('boardCodeLine'),
                boardCode: $('boardCode'),
                hint: $('hintButton'),
                pause: $('pauseButton'),
                newGame: $('newGameButton'),
                moves: $('moveCounter'),
                movesLabel: $('movesLabel'),
                statPar: $('statPar'),
                timer: $('timer'),
                liveBars: $('liveBars'),
                scoreNowRow: $('scoreNowRow'),
                scoreNow: $('scoreNow'),
                scoreNowSmall: $('scoreNowSmall'),
                precisionPct: $('precisionPct'),
                precisionBar: $('precisionBar'),
                pacePct: $('pacePct'),
                paceBar: $('paceBar'),
                live: $('live'),
                result: $('result'),
                startCover: $('startCover'),
                pauseCover: $('pauseCover'),
                messageCover: $('messageCover'),
                summary: $('solvedSummary'),
                footer: $('footer'),
                solvedFooter: $('solvedFooter'),
                help: $('helpDialog'),
                share: $('shareDialog'),
                toast: $('toast'),
                announcer: $('announcer'),
            };
        }

        // ================= setup =================

        async init() {
            P.renderCells($('goalBoard'), P.GOAL, { colorHome: false, labels: false });
            P.renderCells($('solvedMiniBoard'), P.GOAL, { solved: true, labels: false });
            this.bindEvents();
            Store.pendingSubmissions().forEach(n => this.submit(n));

            const params = new URLSearchParams(window.location.search);
            const hex = params.get('board');

            if (hex) {
                try {
                    const board = P.fromHex(hex);
                    if (!P.isSolvable(board)) throw new Error('That board cannot be solved.');
                    if (P.isGoal(board)) throw new Error('That board is already solved.');
                    this.fromUrl = true;
                    this.startFree(board);
                    return;
                } catch (error) {
                    this.toast('Invalid board link: ' + error.message + ' Starting a new game.', 5000);
                    this.startFree(P.shuffled());
                    return;
                }
            }
            if (params.get('mode') === 'free') {
                this.startFree(P.shuffled());
                return;
            }

            // Daily
            this.mode = 'daily';
            this.renderChrome();
            try {
                const res = await fetch(DAILY_URL);
                if (!res.ok) throw new Error(res.status);
                this.dailies = await res.json();
            } catch (error) {
                console.error('Could not load the daily boards:', error);
                this.showMessage('Daily unavailable', 'The daily board could not be loaded. Check your connection and reload, or play free play.');
                return;
            }

            const today = todayKey();
            this.todayEntry = this.dailies.find(d => d.date === today) || null;
            const wanted = params.get('daily');

            if (wanted !== null) {
                const n = parseInt(wanted, 10);
                const entry = this.dailies.find(d => d.n === n);
                if (!entry || entry.date > today) {
                    const latest = this.todayEntry;
                    this.showMessage(
                        `Daily No. ${wanted} isn't out yet`,
                        latest ? `Today's board is Daily No. ${latest.n}.` : firstDailyText(this.dailies, today),
                        latest ? { href: './', label: `Play Daily No. ${latest.n}` } : null);
                    return;
                }
                if (!this.todayEntry || entry.n !== this.todayEntry.n) {
                    this.startDaily(entry, { practice: true });
                    return;
                }
            }

            if (!this.todayEntry) {
                this.showMessage('No daily today', firstDailyText(this.dailies, today));
                return;
            }
            this.startDaily(this.todayEntry);
        }

        // Today's daily: shows a stored result, resumes an attempt in progress, or waits for Start.
        startDaily(entry, { practice = false } = {}) {
            this.mode = 'daily';
            this.entry = entry;
            this.par = entry.par;
            this.scored = !practice;
            this.practice = practice;

            const stored = this.scored ? Store.result(entry.n) : null;
            if (stored) {
                this.scored = false;
                this.reset(P.fromHex(entry.hex));
                this.showStoredResult(stored);
                return;
            }

            this.reset(P.fromHex(entry.hex));
            if (practice) {
                this.started = true;
                this.updateButtons();
                return;
            }

            const saved = Store.inProgress(entry.n);
            if (saved && Array.isArray(saved.board) && saved.board.length === 16) {
                this.board = saved.board.slice();
                this.tileMoves = saved.moves || 0;
                this.hints = saved.hints || 0;
                this.log = saved.log || [];
                this.elapsedMs = saved.elapsedMs || 0;
                this.startedAt = saved.startedAt || Date.now();
                this.token = saved.token || null;
                if (!this.token) this.requestToken();
                this.started = true;
                this.clockStarted = true;
                this.paused = true;
                this.render();
                this.updateStats();
                this.showCover('pause');
                this.updateButtons();
                return;
            }

            $('startEyebrow').textContent = `Daily No. ${entry.n} · par ${entry.par}`;
            $('startButton').innerHTML = `Start Daily No. ${entry.n} <kbd>Enter</kbd>`;
            this.showCover('start');
        }

        startFree(board) {
            this.mode = 'free';
            this.entry = null;
            this.scored = false;
            this.practice = false;
            this.par = null;
            this.reset(board);
            this.started = true;
            this.updateButtons();
            this.findPar();
        }

        newGame() {
            if (this.mode !== 'free') return;
            if (this.fromUrl && !this.gameWon) return;
            this.fromUrl = false;
            if (window.location.search !== '?mode=free') history.replaceState(null, '', '?mode=free');
            this.startFree(P.shuffled());
        }

        playAgain() {
            if (this.mode === 'free') {
                this.newGame();
                return;
            }
            this.startDaily(this.entry, { practice: true });
            this.el.board.focus({ preventScroll: true });
        }

        reset(board) {
            this.cancelAnimation();
            this.stopWorkers();
            this.stopClock();
            this.board = board.slice();
            this.initialBoard = board.slice();
            this.nextMove = new Map();
            if (this.entry && this.mode === 'daily') this.learnPath(this.initialBoard, this.entry.solution);
            this.tileMoves = 0;
            this.hints = 0;
            this.log = [];
            this.startedAt = null;
            this.token = null;
            this.started = false;
            this.gameWon = false;
            this.paused = false;
            this.clockStarted = false;
            this.elapsedMs = 0;
            this.result = null;
            clearInterval(this.countdownTimer);
            this.countdownDay = null;
            $('solvedBeat').hidden = true;

            this.el.main.classList.remove('is-solved', 'is-message');
            this.el.boardWrap.classList.remove('is-solved');
            this.el.summary.hidden = true;
            this.el.result.hidden = true;
            this.el.live.hidden = false;
            this.el.footer.hidden = false;
            this.el.solvedFooter.hidden = true;
            this.showCover(null);

            this.renderChrome();
            this.render();
            this.updateStats();
            this.updateButtons();
        }

        showMessage(title, text, action) {
            this.mode = 'daily';
            this.entry = null;
            this.par = null;
            this.board = P.GOAL.slice();
            this.render();
            this.renderChrome();
            this.el.main.classList.add('is-message');
            $('messageTitle').textContent = title;
            $('messageText').textContent = text;
            const link = $('messageAction');
            link.href = action ? action.href : './?mode=free';
            link.textContent = action ? action.label : 'Play free play';
            this.showCover('message');
            this.updateButtons();
        }

        bindEvents() {
            this.el.board.addEventListener('click', (event) => {
                const tile = event.target.closest('.tile');
                if (!tile || !this.el.board.contains(tile)) return;
                const index = Array.prototype.indexOf.call(this.el.board.children, tile);
                if (this.moveTile(index) && coarsePointer.matches && navigator.vibrate) navigator.vibrate(50);
            });

            this.el.hint.addEventListener('click', () => this.hint());
            this.el.pause.addEventListener('click', () => this.togglePause());
            this.el.newGame.addEventListener('click', () => this.newGame());
            $('againButton').addEventListener('click', () => this.playAgain());
            $('startButton').addEventListener('click', () => this.start());
            $('resumeButton').addEventListener('click', () => this.togglePause(false));
            $('shareButton').addEventListener('click', () => this.openShare());
            $('helpButton').addEventListener('click', () => this.toggleHelp());
            $('watchSolution').addEventListener('click', () => track('solver_open', { source: 'solved' }));

            for (const dialog of [this.el.help, this.el.share]) {
                dialog.addEventListener('click', (event) => {
                    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
                });
            }
            this.el.help.addEventListener('close', () => this.resumeClockIfPlaying());

            $('copyText').addEventListener('click', () => this.copy(this.shareData.text, 'text'));
            $('copyLink').addEventListener('click', () => this.copy(this.shareData.url, 'link'));
            $('downloadImage').addEventListener('click', () => this.saveImage());
            $('saveImage').addEventListener('click', () => this.saveImage());
            $('nativeShare').addEventListener('click', () => this.nativeShare());

            document.addEventListener('keydown', (event) => this.handleKeydown(event));
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.runningSince !== null) this.togglePause(true);
            });
            window.addEventListener('pagehide', () => this.saveProgress());
        }

        // ================= rendering =================

        renderChrome() {
            const daily = this.mode === 'daily';
            document.body.classList.toggle('mode-free', !daily);
            document.querySelectorAll('[data-nav]').forEach(a => {
                if (a.dataset.nav === this.mode) a.setAttribute('aria-current', 'page');
                else a.removeAttribute('aria-current');
            });

            const e = this.entry;
            if (daily) {
                this.el.eyebrow.textContent = e ? dateLabel(e.date) + (this.practice ? ' · practice' : '') : dateLabel(todayKey());
                this.el.title.innerHTML = e ? `Daily<br class="desktop-only"> No. ${e.n}` : 'Daily';
                document.title = e ? `Quindici Daily No. ${e.n}` : 'Quindici - Daily 15-Puzzle with Solver';
            } else {
                this.el.eyebrow.textContent = 'Classic 15-puzzle';
                this.el.title.innerHTML = 'Free<br class="desktop-only"> play';
                document.title = 'Quindici Free Play';
            }

            this.el.parChip.hidden = !(e || !daily);
            this.el.parChip.textContent = this.par ? `par ${this.par}` : 'par …';

            if (daily && e) {
                this.el.parLine.innerHTML = `Shortest solution${this.practice ? '' : ' today'}: <strong>${this.par} moves</strong>.`;
            } else if (!daily) {
                this.el.parLine.innerHTML = this.par ? `Shortest solution: <strong>${this.par} moves</strong>.` : 'Finding the shortest solution…';
            } else {
                this.el.parLine.textContent = '';
            }

            this.el.newGame.hidden = daily;
            this.el.newGame.disabled = this.fromUrl && !this.gameWon;
            this.el.boardCodeLine.hidden = daily;
            const hex = P.toHex(this.initialBoard.length ? this.initialBoard : P.GOAL);
            this.el.boardCode.textContent = hex;
            this.el.boardCode.href = './?board=' + hex;
            this.updateSolverLinks();
        }

        // The solver must not show today's daily before it has been solved here.
        updateSolverLinks() {
            const locked = this.isLocked();
            document.querySelectorAll('.js-solver-link').forEach(link => {
                link.href = locked || !this.board.length ? 'solver/' : 'solver/?board=' + P.toHex(this.board);
            });
        }

        isLocked() {
            return this.mode === 'daily' && this.scored && !this.gameWon;
        }

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
            this.updateSolverLinks();
        }

        updateStats() {
            const seconds = this.elapsedNow() / 1000;
            this.el.moves.textContent = this.tileMoves;
            this.el.movesLabel.textContent = this.hints ? `Moves · ${this.hints} ${this.hints === 1 ? 'hint' : 'hints'} (+${S.HINT_PENALTY * this.hints})` : 'Moves';
            this.el.statPar.textContent = this.par ? `par ${this.par}` : (this.mode === 'free' ? 'par …' : '');
            this.el.timer.textContent = formatTime(seconds);

            const known = !!this.par;
            this.el.liveBars.hidden = !known;
            this.el.scoreNowRow.hidden = !known;
            if (!known) {
                this.el.scoreNowSmall.textContent = '…';
                return;
            }
            const live = S.live({ par: this.par, moves: this.tileMoves, hints: this.hints, seconds });
            const pr = Math.round(live.precision * 100), pa = Math.round(live.pace * 100);
            this.el.precisionPct.textContent = pr + '%';
            this.el.precisionBar.style.width = pr + '%';
            this.el.pacePct.textContent = pa + '%';
            this.el.paceBar.style.width = pa + '%';
            this.el.scoreNow.textContent = live.score;
            this.el.scoreNowSmall.textContent = live.score;
        }

        updateButtons() {
            const playing = this.started && !this.gameWon && !this.el.main.classList.contains('is-message');
            this.el.hint.disabled = !playing || this.paused || this.hintBusy;
            this.el.hint.innerHTML = this.hintBusy ? 'Thinking…' : '<span>Hint +3<span class="hint-extra"> moves</span></span>';
            this.el.pause.disabled = !playing;
            this.el.pause.textContent = this.paused ? 'Resume' : 'Pause';
            this.el.pause.setAttribute('aria-pressed', String(this.paused));
        }

        showCover(which) {
            this.el.startCover.hidden = which !== 'start';
            this.el.pauseCover.hidden = which !== 'pause';
            this.el.messageCover.hidden = which !== 'message';
            const covered = which !== null;
            // While covered, the board must not be seen or reached.
            this.el.board.classList.toggle('is-covered', covered);
            this.el.board.inert = covered;
            if (covered) this.el.board.setAttribute('aria-hidden', 'true');
            else this.el.board.removeAttribute('aria-hidden');
        }

        // ================= moves =================

        canMove() {
            return this.started && !this.gameWon && !this.paused && !this.el.help.open && !this.el.share.open;
        }

        // Slides the tile at `index` (and any tiles between it and the empty square) into the gap.
        // Every tile that moves counts as one move. Returns true if a move was made.
        moveTile(index) {
            if (!this.canMove() || this.pending) return false;

            const empty = this.board.indexOf(0);
            const row = Math.floor(index / SIZE), col = index % SIZE;
            const emptyRow = Math.floor(empty / SIZE), emptyCol = empty % SIZE;
            if (index === empty || (row !== emptyRow && col !== emptyCol)) return false;

            const stride = row === emptyRow ? 1 : SIZE;
            const step = (empty > index ? 1 : -1) * stride;
            const moving = [];
            for (let i = empty - step; i !== index - step; i -= step) moving.push(i);

            const commit = () => {
                this.pending = null;
                // Tiles nearest the gap move first; log them in that order.
                for (const i of moving) this.log.push(this.board[i]);
                for (let i = empty; i !== index; i -= step) this.board[i] = this.board[i - step];
                this.board[index] = 0;
                this.tileMoves += moving.length;
                if (!this.clockStarted) this.startClock();
                this.render();
                this.updateStats();
                if (P.isGoal(this.board)) this.win();
                else this.saveProgress();
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

        // ================= hints and par =================

        // Records a shortest path so later hints from any position on it are instant.
        learnPath(board, solution) {
            let b = board.slice();
            for (const tile of solution) {
                this.nextMove.set(P.toHex(b), tile);
                b = P.applyMove(b, tile);
            }
        }

        // Plays the next move of a shortest solution from the current position. Costs 3 moves.
        hint() {
            if (!this.canMove() || this.hintBusy) return;
            this.finishAnimation();
            if (!this.canMove()) return;

            const key = P.toHex(this.board);
            const known = this.nextMove.get(key);
            if (known) {
                this.playHint(known);
                return;
            }

            // Off the known path: solve from here in a worker.
            this.hintBusy = true;
            this.updateButtons();
            const from = this.board.slice();
            const worker = new Worker(WORKER_URL);
            this.hintWorker = worker;

            const finish = (tile) => {
                clearTimeout(fallback);
                worker.terminate();
                if (this.hintWorker === worker) this.hintWorker = null;
                this.hintBusy = false;
                this.updateButtons();
                if (tile && P.toHex(this.board) === key && this.canMove()) this.playHint(tile);
            };

            // Free play only: very scrambled positions can be slow, so fall back to a greedy step.
            const fallback = this.mode === 'free' ? setTimeout(() => {
                const next = greedyPath(from)[0];
                finish(next ? next[from.indexOf(0)] : null);
            }, FREE_HINT_BUDGET_MS) : null;

            worker.onmessage = (e) => {
                if (e.data.type === 'progress') return;
                if (e.data.type === 'done' && e.data.solution.length) {
                    this.learnPath(from, e.data.solution);
                    finish(e.data.solution[0]);
                } else {
                    finish(null);
                }
            };
            worker.onerror = () => finish(null);
            worker.postMessage({ board: from });
        }

        playHint(tile) {
            const index = this.board.indexOf(tile);
            this.hints++;
            if (this.entry) track('hint_used', { n: this.entry.n });
            if (!this.moveTile(index)) this.hints--;
        }

        // Free play: find par in the background. Until then the live score is hidden.
        findPar() {
            const board = this.initialBoard.slice();
            const worker = new Worker(WORKER_URL);
            this.parWorker = worker;
            worker.onmessage = (e) => {
                if (e.data.type === 'progress') return;
                worker.terminate();
                if (this.parWorker !== worker) return;
                this.parWorker = null;
                if (e.data.type !== 'done') return;
                this.par = e.data.solution.length;
                this.learnPath(board, e.data.solution);
                this.renderChrome();
                this.updateStats();
                if (this.gameWon) this.showResult(this.result);
            };
            worker.postMessage({ board });
        }

        stopWorkers() {
            for (const w of [this.parWorker, this.hintWorker]) if (w) w.terminate();
            this.parWorker = null;
            this.hintWorker = null;
            this.hintBusy = false;
        }

        // ================= finishing =================

        win() {
            this.gameWon = true;
            this.stopClock();
            if (this.hintWorker) { this.hintWorker.terminate(); this.hintWorker = null; this.hintBusy = false; }
            const seconds = this.elapsedMs / 1000;
            const result = { moves: this.tileMoves, hints: this.hints, seconds, solvedAt: Date.now(), log: this.log.join(',') };

            if (this.par) result.score = S.score({ par: this.par, moves: result.moves, hints: result.hints, seconds }).score;

            if (this.scored) {
                result.token = this.token;
                Store.saveResult(this.entry.n, result);
                this.submit(this.entry.n);
                track('daily_solved', { n: this.entry.n, score: result.score, moves: result.moves, seconds: Math.round(seconds), hints: result.hints });
            }

            const focusWasOnBoard = this.el.board.contains(document.activeElement);
            this.showResult(result);
            const scoreText = result.score !== undefined ? ` Score ${result.score} out of 1000.` : '';
            this.announce(`Solved in ${result.moves} ${result.moves === 1 ? 'move' : 'moves'} and ${formatTime(seconds)}.${scoreText}`);
            if (focusWasOnBoard || document.activeElement === document.body) $('shareButton').focus();
        }

        showStoredResult(stored) {
            this.board = P.GOAL.slice();
            this.tileMoves = stored.moves;
            this.hints = stored.hints || 0;
            this.elapsedMs = stored.seconds * 1000;
            this.started = true;
            this.gameWon = true;
            this.showResult(stored);
            this.refreshRank(this.entry.n);
        }

        // Fills the solved screen. Works before par is known in Free play (score shows once it arrives).
        showResult(result) {
            this.result = result;
            this.gameWon = true;
            this.render();
            this.renderChrome();
            this.updateStats();
            this.updateButtons();
            this.el.main.classList.add('is-solved');
            this.el.boardWrap.classList.add('is-solved');
            this.el.summary.hidden = false;
            this.el.live.hidden = true;
            this.el.footer.hidden = true;

            const e = this.entry;
            const daily = this.mode === 'daily' && e;
            $('solvedEyebrow').textContent = daily
                ? `Daily No. ${e.n} · ${this.practice ? 'practice' : 'solved'}`
                : 'Free play · solved';
            $('againButton').textContent = daily ? 'Play again (practice)' : 'New game';

            const isToday = daily && this.todayEntry && e.n === this.todayEntry.n;
            clearInterval(this.countdownTimer);
            if (isToday && this.dailies.some(d => d.n === e.n + 1)) {
                this.updateCountdown();
                this.countdownTimer = setInterval(() => this.updateCountdown(), 1000);
            } else {
                const footnote = daily
                    ? (isToday ? nextDailyText(this.dailies, e.n) : 'Past dailies are practice. They do not change your results.')
                    : '';
                this.setFootnote(footnote);
            }
            this.updateBeat();

            const hex = P.toHex(this.initialBoard);
            const watch = $('watchSolution');
            watch.href = 'solver/?board=' + hex;

            if (!this.par) {
                $('solvedScore').textContent = result.moves;
                $('solvedScore').classList.toggle('is-long', String(result.moves).length > 3);
                $('solvedCaption').textContent = `moves in ${formatTime(result.seconds)} · finding par…`;
                watch.textContent = 'Watch the shortest solution';
                this.el.result.hidden = true;
                return;
            }

            const s = S.score({ par: this.par, moves: result.moves, hints: result.hints, seconds: result.seconds });
            result.score = s.score;
            $('solvedScore').textContent = s.score;
            $('solvedScore').classList.toggle('is-long', String(s.score).length > 3);
            $('solvedCaption').textContent = 'out of 1000' + (this.practice ? ' · practice, not counted' : this.rankText());
            const board = $('leaderboardLink');
            board.hidden = !daily;
            if (daily) board.href = 'leaderboard/?daily=' + e.n;
            watch.textContent = `Watch the ${this.par}-move solution`;

            const pr = Math.round(s.precision * 100), pa = Math.round(s.pace * 100);
            $('resultPrecisionPct').textContent = pr + '%';
            $('resultPrecisionBar').style.width = pr + '%';
            $('resultPacePct').textContent = pa + '%';
            $('resultPaceBar').style.width = pa + '%';

            const over = s.moves - this.par;
            const hintText = result.hints
                ? `${result.moves} moves plus ${result.hints} ${result.hints === 1 ? 'hint' : 'hints'} (+${S.HINT_PENALTY * result.hints})`
                : `${result.moves} moves`;
            $('precisionNote').textContent = over === 0
                ? 'Perfect. You matched par.'
                : `${hintText} against a par of ${this.par}. That is ${over} over.`;
            $('paceNote').textContent = `Solved in ${formatTime(result.seconds)}. Pace never drops below 50%.`;
            $('formulaLine').innerHTML = `1000 × ${s.precision.toFixed(3)} × ${s.pace.toFixed(3)} = <span class="c-home">${s.score}</span>`;
            const whatIf = $('whatIf');
            whatIf.hidden = over === 0;
            whatIf.textContent = `A perfect ${this.par}-move solve in the same time would have scored ${S.perfectAtSamePace(this.par, result.seconds)}.`;
            this.el.result.hidden = false;
        }

        // ================= leaderboard =================

        // Asks the API for a signed start token. Play never waits on it; offline play stays local.
        requestToken() {
            const n = this.entry && this.entry.n;
            if (!n || !this.scored || !window.Api) return;
            window.Api.start(n).then((r) => {
                if (!this.entry || this.entry.n !== n || !this.scored) return;
                this.token = r.token;
                if (this.gameWon) {
                    Store.updateResult(n, { token: r.token });
                    this.submit(n);
                } else {
                    this.saveProgress();
                }
            }).catch((error) => console.warn('Leaderboard start failed:', error.message));
        }

        // Sends a stored result to the leaderboard. Network failures stay pending and retry on the next visit;
        // a rejected result is marked so it is not retried.
        submit(n) {
            const r = Store.result(n);
            if (!r || r.server || !r.token || !window.Api) return;
            window.Api.finish(n, { token: r.token, movesLog: r.log, hints: r.hints, seconds: r.seconds })
                .then((res) => {
                    Store.updateResult(n, { server: { rank: res.rank, total: res.total, below: res.below, score: res.score }, token: undefined });
                    this.updateRank(n, { rank: res.rank, below: res.below, total: res.total });
                })
                .catch((error) => {
                    if (error.status >= 400 && error.status < 500) {
                        Store.updateResult(n, { server: { rejected: error.message }, token: undefined });
                    }
                    console.warn('Leaderboard submit failed:', error.message);
                });
        }

        // Ranks move as others finish, so a stored result fetches its current rank.
        refreshRank(n) {
            const r = Store.result(n);
            if (!r || !window.Api) return;
            if (!r.server) { this.submit(n); return; }
            if (r.server.rejected) return;
            window.Api.leaderboard(n, 'today', 1, { distribution: false })
                .then((lb) => { if (lb.you) this.updateRank(n, { rank: lb.you.rank, below: lb.you.below, total: lb.total }); })
                .catch(() => {});
        }

        updateRank(n, standing) {
            const r = Store.result(n);
            if (r && r.server) Store.updateResult(n, { server: Object.assign({}, r.server, standing) });
            if (this.gameWon && this.entry && this.entry.n === n && !this.practice) {
                $('solvedCaption').textContent = 'out of 1000' + this.rankText();
                this.updateBeat();
            }
        }

        // "Better than 72% of today's players", from how many finished scores are below yours.
        updateBeat() {
            const line = $('solvedBeat');
            const r = this.mode === 'daily' && this.entry && !this.practice ? Store.result(this.entry.n) : null;
            const s = r && r.server;
            if (!s || s.rejected || typeof s.below !== 'number' || !s.total) {
                line.hidden = true;
                return;
            }
            line.textContent = s.total === 1
                ? 'You are the first to finish today.'
                : `Better than ${Math.floor(100 * s.below / (s.total - 1))}% of today's ${s.total} players.`;
            line.hidden = false;
        }

        // Counts down to the next daily, which unlocks at the player's local midnight.
        updateCountdown() {
            const next = this.entry.n + 1;
            const now = new Date();
            const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const ms = midnight - now;
            if (ms <= 0 || (this.countdownDay && this.countdownDay !== now.toDateString())) {
                clearInterval(this.countdownTimer);
                this.setFootnote(`Daily No. ${next} is out. <a href="./">Play it</a>`, true);
                return;
            }
            this.countdownDay = this.countdownDay || now.toDateString();
            this.setFootnote(`Daily No. ${next} unlocks in <span class="countdown">${formatCountdown(ms)}</span>, at midnight your time.`, true);
        }

        setFootnote(text, html = false) {
            for (const el of [this.el.solvedFooter, $('solvedFootnoteMobile')]) {
                // One wrapping element, so the footer's flex gap doesn't split the sentence.
                el.textContent = '';
                if (text) {
                    const span = document.createElement('span');
                    if (html) span.innerHTML = text; else span.textContent = text;
                    el.appendChild(span);
                }
                el.hidden = !text;
            }
        }

        rankText() {
            if (!this.entry || this.mode !== 'daily') return '';
            const r = Store.result(this.entry.n);
            return r && r.server && r.server.rank ? ` · ${ordinal(r.server.rank)} today` : '';
        }

        saveProgress() {
            if (!this.scored || !this.started || this.gameWon || !this.entry) return;
            Store.saveProgress({
                n: this.entry.n,
                board: this.board.slice(),
                moves: this.tileMoves,
                hints: this.hints,
                elapsedMs: this.elapsedNow(),
                startedAt: this.startedAt,
                log: this.log.slice(),
                token: this.token,
            });
        }

        // ================= clock =================

        elapsedNow() {
            return this.elapsedMs + (this.runningSince === null ? 0 : performance.now() - this.runningSince);
        }

        startClock() {
            if (this.runningSince !== null || this.gameWon) return;
            this.clockStarted = true;
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

        resumeClockIfPlaying() {
            if (this.started && !this.gameWon && !this.paused && this.clockStarted &&
                !this.el.help.open && !this.el.share.open) this.startClock();
        }

        // ================= covers and dialogs =================

        // Reveals today's daily. The clock starts now, not on the first move.
        start() {
            if (this.started || !this.entry) return;
            this.started = true;
            this.startedAt = Date.now();
            this.showCover(null);
            this.startClock();
            this.updateButtons();
            this.saveProgress();
            this.requestToken();
            track('daily_start', { n: this.entry.n });
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
                this.saveProgress();
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
            if (this.el.share.open) this.el.share.close();
            this.stopClock();
            this.el.help.showModal();
        }

        // ================= sharing =================

        shareInfo() {
            const r = this.result;
            const s = S.score({ par: this.par, moves: r.moves, hints: r.hints, seconds: r.seconds });
            const base = window.location.origin + window.location.pathname;
            const daily = this.mode === 'daily' && this.entry;
            const url = daily ? `${base}?daily=${this.entry.n}` : `${base}?board=${P.toHex(this.initialBoard)}`;
            const info = {
                label: daily ? `#${this.entry.n}` : 'free play',
                heading: daily ? `NO. ${this.entry.n} · ${shortDate(this.entry.date)}` : `FREE PLAY · ${shortDate(todayKey())}`,
                score: s.score, precision: s.precision, pace: s.pace, moves: s.moves,
                par: this.par, seconds: r.seconds, hints: r.hints, url,
            };
            info.text = window.Share.text(info);
            return info;
        }

        async openShare() {
            if (!this.result || !this.par) {
                this.toast('Still finding par for this board. Try again in a moment.');
                return;
            }
            const info = this.shareInfo();
            this.shareData = info;
            $('shareText').textContent = info.text;
            $('shareNote').textContent = this.mode === 'daily'
                ? (phoneLayout.matches ? "No spoilers. The link opens today's board." : 'The link opens the same board, so friends play the same puzzle.')
                : 'No spoilers. The link opens this board.';
            $('nativeShare').hidden = !navigator.share;
            const img = $('shareCard');
            img.alt = `Quindici ${info.label}: ${info.score} out of 1000`;
            this.stopClock();
            this.el.share.showModal();

            info.blob = await window.Share.card(info);
            if (this.shareData !== info) return;
            if (this.shareUrl) URL.revokeObjectURL(this.shareUrl);
            this.shareUrl = URL.createObjectURL(info.blob);
            img.src = this.shareUrl;
        }

        imageName() {
            return this.mode === 'daily' && this.entry ? `quindici-${this.entry.n}.png` : `quindici-${P.toHex(this.initialBoard)}.png`;
        }

        async saveImage() {
            const info = this.shareData;
            if (!info) return;
            if (!info.blob) info.blob = await window.Share.card(info);
            const url = URL.createObjectURL(info.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = this.imageName();
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            track('share', { method: 'image' });
        }

        async nativeShare() {
            const info = this.shareData;
            if (!info || !navigator.share) return;
            if (!info.blob) info.blob = await window.Share.card(info);
            const file = new File([info.blob], this.imageName(), { type: 'image/png' });
            const data = navigator.canShare && navigator.canShare({ files: [file] })
                ? { text: info.text, files: [file] }
                : { text: info.text };
            try {
                await navigator.share(data);
                track('share', { method: data.files ? 'native_image' : 'native_text' });
            } catch (error) {
                if (error.name !== 'AbortError') this.copy(info.text, 'text');
            }
        }

        copy(text, method) {
            if (!text) return;
            const done = () => { this.toast('Copied'); track('share', { method: 'copy_' + method }); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => this.toast('Could not copy. Select the text and copy it instead.'));
            } else {
                this.toast('Could not copy. Select the text and copy it instead.');
            }
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

        // ================= keyboard =================

        handleKeydown(event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key;

            if (key === '?') {
                this.toggleHelp();
                event.preventDefault();
                return;
            }
            if (this.el.help.open || this.el.share.open) return; // dialogs handle Escape themselves

            const target = event.target;
            const inControl = target && target.closest && target.closest('input, textarea, select, a, button:not(.tile)');

            if (!this.started) {
                if (key === 'Enter' && !inControl && !this.el.startCover.hidden) {
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
                    if (this.mode === 'free') { this.newGame(); event.preventDefault(); }
                    return;
                case 's':
                    this.hint();
                    event.preventDefault();
                    return;
                case 'f':
                    event.preventDefault();
                    if (this.isLocked()) {
                        this.toast("The solver unlocks once you've solved today's daily.");
                        return;
                    }
                    track('solver_open', { source: 'key' });
                    window.open('solver/?board=' + P.toHex(this.gameWon ? this.initialBoard : this.board), '_blank');
                    return;
            }

            if (key.startsWith('Arrow') && this.canMove()) {
                event.preventDefault();
                this.finishAnimation();
                if (this.canMove()) this.moveByKey(key, event.shiftKey);
            }
        }
    }

    // ================= helpers =================

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // The player's local date picks the daily. On a local server, ?today=YYYY-MM-DD overrides it for testing.
    function todayKey() {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
        const override = local && new URLSearchParams(window.location.search).get('today');
        if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function parseKey(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    function dateLabel(key) {
        const d = parseKey(key);
        return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }

    function shortDate(key) {
        const d = parseKey(key);
        return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`.toUpperCase();
    }

    function firstDailyText(dailies, today) {
        const first = dailies[0];
        if (first && first.date > today) {
            const d = parseKey(first.date);
            return `Daily No. 1 arrives on ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}. Until then, try free play.`;
        }
        return 'There is no daily board for today. Check back soon, or try free play.';
    }

    function nextDailyText(dailies, n) {
        return dailies.some(d => d.n === n + 1)
            ? `Daily No. ${n + 1} unlocks at midnight, your time.`
            : 'That is the last daily for now. More are on the way.';
    }

    function formatCountdown(ms) {
        const total = Math.ceil(ms / 1000);
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        if (h > 0) return `${h}h ${m < 10 ? '0' : ''}${m}m`;
        if (m > 0) return `${m}m ${s < 10 ? '0' : ''}${s}s`;
        return `${s}s`;
    }

    function formatTime(seconds) {
        const total = Math.floor(seconds);
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

    // Greedy best-first search on Manhattan distance: Free play's fallback hint when the optimal search is slow.
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

    new Game().init();
})();
