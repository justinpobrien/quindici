// storage.js: local stats and the in-progress daily, in localStorage under `quindici.v1`.
// Shape: { results: { [n]: { moves, hints, seconds, score, solvedAt, log } },
//          inProgress: { n, board, moves, hints, elapsedMs, startedAt, log } | null,
//          streak: { current, best, lastN } }
// Every access is wrapped: private windows and blocked storage must never break the game.
(function (global) {
    'use strict';

    const KEY = 'quindici.v1';

    function empty() {
        return { results: {}, inProgress: null, streak: { current: 0, best: 0, lastN: null } };
    }

    function load() {
        try {
            const data = JSON.parse(localStorage.getItem(KEY));
            if (!data || typeof data !== 'object') return empty();
            return Object.assign(empty(), data);
        } catch (e) {
            return empty();
        }
    }

    function save(data) {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
        } catch (e) { /* storage unavailable: play continues, nothing persists */ }
    }

    function update(fn) {
        const data = load();
        fn(data);
        save(data);
        return data;
    }

    const Storage = {
        result(n) {
            return load().results[n] || null;
        },

        inProgress(n) {
            const p = load().inProgress;
            return p && p.n === n ? p : null;
        },

        saveProgress(progress) {
            update(d => { d.inProgress = progress; });
        },

        clearProgress() {
            update(d => { d.inProgress = null; });
        },

        // Records the first completed attempt of daily `n`. Later attempts never overwrite it.
        saveResult(n, result) {
            return update(d => {
                if (d.results[n]) return;
                d.results[n] = result;
                if (d.inProgress && d.inProgress.n === n) d.inProgress = null;
                const s = d.streak;
                s.current = s.lastN === n - 1 ? s.current + 1 : 1;
                s.best = Math.max(s.best, s.current);
                s.lastN = n;
            });
        },
    };

    global.QStorage = Storage;
})(window);
