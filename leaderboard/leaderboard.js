// leaderboard.js: today's ranking and this week's totals for a daily.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const HINT_PENALTY = 3;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const state = { entry: null, today: null, range: 'today', handle: null, request: 0 };
    const params = new URLSearchParams(window.location.search);

    // ---------- dates ----------

    function todayKey() {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
        const override = local && params.get('today');
        if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
        const d = new Date();
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function formatTime(seconds) {
        const t = Math.floor(seconds);
        return `${Math.floor(t / 60)}:${t % 60 < 10 ? '0' : ''}${t % 60}`;
    }

    // ---------- rendering ----------

    function el(tag, className, text) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function rankCell(rank) {
        const cell = el('span', 'cell-rank');
        cell.appendChild(el('span', rank <= 3 ? `rank-chip rank-${rank}` : 'rank-plain', String(rank)));
        return cell;
    }

    function todayRow(r) {
        const li = el('li', 'row' + (r.you ? ' is-you' : ''));
        if (r.you) li.setAttribute('aria-current', 'true');
        const moves = r.moves + HINT_PENALTY * (r.hints || 0);
        const over = moves - state.entry.par;
        const overText = over === 0 ? 'par' : `+${over}`;
        li.appendChild(rankCell(r.rank));
        li.appendChild(el('span', 'cell-name', r.you ? 'You' : r.handle));
        const m = el('span', 'cell-moves num');
        m.append(String(moves) + ' ');
        m.appendChild(el('span', 'over', overText));
        if (r.hints) m.title = `${r.moves} moves + ${r.hints} ${r.hints === 1 ? 'hint' : 'hints'} (+${HINT_PENALTY * r.hints})`;
        li.appendChild(m);
        li.appendChild(el('span', 'cell-time num', formatTime(r.seconds)));
        li.appendChild(el('span', 'cell-compact num', `${moves} · ${formatTime(r.seconds)}`));
        li.appendChild(el('span', 'cell-score', String(r.score)));
        li.setAttribute('aria-label', `${r.rank}. ${r.you ? 'You' : r.handle}: ${moves} moves (${overText}), ${formatTime(r.seconds)}, score ${r.score}`);
        return li;
    }

    function weekRow(r) {
        const li = el('li', 'row' + (r.you ? ' is-you' : ''));
        if (r.you) li.setAttribute('aria-current', 'true');
        li.appendChild(rankCell(r.rank));
        li.appendChild(el('span', 'cell-name', r.you ? 'You' : r.handle));
        li.appendChild(el('span', 'cell-days num', `${r.days} ${r.days === 1 ? 'day' : 'days'}`));
        li.appendChild(el('span', 'cell-score', String(r.score)));
        li.setAttribute('aria-label', `${r.rank}. ${r.you ? 'You' : r.handle}: ${r.score} over ${r.days} ${r.days === 1 ? 'day' : 'days'}`);
        return li;
    }

    function setHead(range) {
        const head = $('tableHead');
        head.textContent = '';
        const cols = range === 'today'
            ? [['#', ''], ['Player', ''], ['Moves', 'cell-moves'], ['Time', 'cell-time'], ['Moves · time', 'cell-compact'], ['Score', 'cell-score']]
            : [['#', ''], ['Player', ''], ['Played', 'cell-days'], ['Total', 'cell-score']];
        for (const [label, cls] of cols) head.appendChild(el('span', cls, label));
        $('table').classList.toggle('is-week', range === 'week');
    }

    function message(text, action) {
        const p = $('tableMessage');
        p.textContent = text;
        if (action) {
            p.append(' ');
            if (action.onClick) {
                const b = el('button', 'inline-link', action.label);
                b.type = 'button';
                b.addEventListener('click', action.onClick);
                p.appendChild(b);
            } else {
                const a = el('a', '', action.label);
                a.href = action.href;
                p.appendChild(a);
            }
        }
        p.hidden = false;
    }

    function setHeading() {
        const e = state.entry;
        const isToday = state.today && e.n === state.today.n;
        const week = state.range === 'week';
        const from = Math.max(1, e.n - 6);
        $('eyebrow').textContent = week
            ? (from === e.n ? `Daily No. ${e.n}` : `Daily No. ${from}–${e.n}`)
            : `Daily No. ${e.n} · par ${e.par}`;
        $('title').innerHTML = week
            ? 'This week'
            : (isToday ? `<span class="desktop-inline">Today's leaderboard</span><span class="phone-inline">Leaderboard</span>` : `Daily No. ${e.n}`);
        $('title').setAttribute('aria-label', week ? 'This week' : (isToday ? "Today's leaderboard" : `Daily No. ${e.n} leaderboard`));
        $('footnote').textContent = week ? 'Total of your scores over the last 7 dailies' : 'Moves · time · score = 1000 × precision × pace';
        document.title = (week ? 'This week' : `Daily No. ${e.n}`) + ' leaderboard - Quindici';
    }

    async function load() {
        const req = ++state.request;
        const range = state.range;
        setHeading();
        setHead(range);
        const rows = $('rows');
        rows.textContent = '';
        rows.setAttribute('aria-busy', 'true');
        $('tableMessage').hidden = true;
        message('Loading…');

        let data;
        try {
            data = await window.Api.leaderboard(state.entry.n, range, 10);
        } catch (error) {
            if (req !== state.request) return;
            rows.removeAttribute('aria-busy');
            message(error.status === 0 ? 'Could not reach the leaderboard. Check your connection.' : error.message,
                { onClick: load, label: 'Try again' });
            return;
        }
        if (req !== state.request) return;
        rows.removeAttribute('aria-busy');
        $('tableMessage').hidden = true;

        const make = range === 'today' ? todayRow : weekRow;
        data.rows.forEach(r => rows.appendChild(make(r)));
        if (data.you && !data.rows.some(r => r.you)) {
            rows.appendChild(el('li', 'row-divider')).setAttribute('aria-hidden', 'true');
            rows.appendChild(make(data.you));
        }
        if (data.rows.length === 0) {
            message(range === 'today' ? `No one has finished Daily No. ${state.entry.n} yet.` : 'No results this week yet.',
                { href: '../', label: 'Play the daily' });
        }

        renderDistribution(range === 'today' ? data : null);

        if (data.you) {
            // Rows show "You"; the handle itself comes from the player endpoint.
            if (!state.handle) loadHandle();
        }
        setHandleLine();
    }

    // ---------- distribution ----------

    // Ten bands of 100; the highlighted band holds your score. Emphasis chart: one hue for you, gray for the rest.
    function renderDistribution(data) {
        const card = $('distCard');
        if (!data || !Array.isArray(data.buckets) || !data.total) {
            card.hidden = true;
            return;
        }
        const buckets = data.buckets;
        const max = Math.max(...buckets);
        const mine = data.you ? Math.min(9, Math.floor(data.you.score / 100)) : -1;
        const label = (i) => (i === 9 ? '900–1000' : `${i * 100}–${i * 100 + 99}`);
        const players = (c) => `${c} ${c === 1 ? 'player' : 'players'}`;

        const chart = $('distChart');
        chart.textContent = '';
        buckets.forEach((count, i) => {
            const col = el('div', 'dist-col' + (i === mine ? ' is-you' : ''));
            col.tabIndex = 0;
            col.setAttribute('role', 'listitem');
            col.dataset.tip = `${label(i)}: ${players(count)}`;
            col.setAttribute('aria-label', col.dataset.tip + (i === mine ? ', your score' : ''));
            if (i === mine) col.appendChild(el('span', 'dist-you', 'You')).setAttribute('aria-hidden', 'true');
            const bar = el('span', 'dist-bar');
            bar.style.height = count ? `${Math.max(4, Math.round(100 * count / max))}%` : '0';
            col.appendChild(bar);
            chart.appendChild(col);
        });

        const you = data.you;
        $('distHeadline').textContent = !you
            ? `${players(data.total)} so far.`
            : data.total === 1
                ? 'You are the first to finish.'
                : `You beat ${Math.floor(100 * you.below / (data.total - 1))}% of ${data.total} players.`;
        card.hidden = false;
    }

    // ---------- handle ----------

    async function loadHandle() {
        try {
            state.handle = (await window.Api.handle()).handle;
        } catch (e) { /* leave the default line */ }
        setHandleLine();
    }

    function setHandleLine() {
        const line = $('handleLine');
        line.textContent = '';
        if (state.handle) {
            line.append('You appear as ');
            line.appendChild(el('strong', 'mono', state.handle));
            line.append(' to other players.');
        } else {
            line.textContent = 'Finish a daily to join the leaderboard. You can pick your name any time.';
        }
    }

    function openHandleForm(open) {
        $('handleForm').hidden = !open;
        $('handleEdit').hidden = open;
        if (open) {
            const input = $('handleInput');
            input.value = state.handle || '';
            $('handleHelp').textContent = '3 to 20 characters: lowercase letters, digits and underscores.';
            $('handleHelp').classList.remove('is-error');
            input.focus();
            if (!state.handle) loadHandle().then(() => { if (!input.value) input.value = state.handle || ''; });
        } else {
            $('handleEdit').focus();
        }
    }

    async function saveHandle(event) {
        event.preventDefault();
        const input = $('handleInput');
        const help = $('handleHelp');
        const handle = input.value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
            help.textContent = '3 to 20 characters: lowercase letters, digits and underscores.';
            help.classList.add('is-error');
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        try {
            state.handle = (await window.Api.setHandle(handle)).handle;
            input.removeAttribute('aria-invalid');
            setHandleLine();
            openHandleForm(false);
            toast('Name saved');
        } catch (error) {
            help.textContent = error.status === 0 ? 'Could not reach the leaderboard. Try again.' : error.message;
            help.classList.add('is-error');
            input.setAttribute('aria-invalid', 'true');
            input.focus();
        }
    }

    function toast(text) {
        const t = $('toast');
        t.textContent = text;
        t.classList.add('is-visible');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => t.classList.remove('is-visible'), 2400);
    }

    // ---------- start ----------

    function bind() {
        document.querySelectorAll('.segmented button').forEach(b => b.addEventListener('click', () => {
            if (!state.entry || state.range === b.dataset.range) return;
            state.range = b.dataset.range;
            document.querySelectorAll('.segmented button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
            const url = new URL(window.location.href);
            if (state.range === 'week') url.searchParams.set('range', 'week'); else url.searchParams.delete('range');
            history.replaceState(null, '', url);
            load();
        }));
        $('handleEdit').addEventListener('click', () => openHandleForm(true));
        $('handleCancel').addEventListener('click', () => openHandleForm(false));
        $('handleForm').addEventListener('submit', saveHandle);

        const help = $('helpDialog');
        $('helpBody').innerHTML = $('explainer').innerHTML.replace(/<h2[^>]*>.*?<\/h2>/, '').replace(/id="halfLife"/, '');
        $('helpButton').addEventListener('click', () => help.showModal());
        help.addEventListener('click', (e) => {
            if (e.target === help || e.target.closest('[data-close]')) help.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === '?' && !e.target.closest('input')) {
                if (help.open) help.close(); else help.showModal();
                e.preventDefault();
            }
        });
    }

    async function init() {
        bind();
        let dailies = [];
        try {
            const res = await fetch('../daily/boards.json');
            dailies = await res.json();
        } catch (e) {
            setHead('today');
            message('The daily boards could not be loaded. Reload to try again.');
            return;
        }
        const key = todayKey();
        state.today = dailies.find(d => d.date === key) || null;
        const wanted = parseInt(params.get('daily'), 10);
        const entry = Number.isInteger(wanted) ? dailies.find(d => d.n === wanted) : state.today;

        if (!entry || entry.date > key) {
            setHead('today');
            $('title').textContent = 'Leaderboard';
            const first = dailies[0];
            if (first && first.date > key) {
                const [y, m, d] = first.date.split('-').map(Number);
                const day = new Date(y, m - 1, d);
                $('eyebrow').textContent = 'Coming soon';
                message(`The first daily arrives on ${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}. Its leaderboard opens then.`,
                    { href: '../?mode=free', label: 'Play free play' });
            } else {
                $('eyebrow').textContent = '';
                message('There is no daily leaderboard for that day.', { href: '../', label: "Today's daily" });
            }
            return;
        }

        state.entry = entry;
        $('halfLife').textContent = formatTime(3 * entry.par);
        if (params.get('range') === 'week') {
            state.range = 'week';
            document.querySelectorAll('.segmented button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.range === 'week')));
        }
        // Copy the explainer again now that it knows today's par.
        $('helpBody').innerHTML = $('explainer').innerHTML.replace(/<h2[^>]*>.*?<\/h2>/, '').replace(/id="halfLife"/, '');
        load();
    }

    init();
})();
