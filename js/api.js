// api.js: client for the leaderboard API (functions/index.js).
// The player is an anonymous id kept in localStorage; it is never shown to anyone.
(function (global) {
    'use strict';

    const PROD = 'https://us-central1-quindici-io.cloudfunctions.net/api';
    const EMULATOR = 'http://127.0.0.1:5001/quindici-io/us-central1/api';
    const PLAYER_KEY = 'quindici.player';

    // On a local server the emulator is used, unless ?api=prod is in the address.
    function base() {
        const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(global.location.hostname);
        const params = new URLSearchParams(global.location.search);
        return local && params.get('api') !== 'prod' ? EMULATOR : PROD;
    }

    function uuid() {
        if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    function playerId() {
        try {
            let id = localStorage.getItem(PLAYER_KEY);
            if (!id) {
                id = uuid();
                localStorage.setItem(PLAYER_KEY, id);
            }
            return id;
        } catch (e) {
            // Storage blocked: a per-page id still lets this visit play, but nothing carries over.
            if (!global.__quindiciPlayer) global.__quindiciPlayer = uuid();
            return global.__quindiciPlayer;
        }
    }

    class ApiError extends Error {
        constructor(status, message) { super(message); this.status = status; }
    }

    async function call(method, path, body, timeoutMs = 12000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(base() + path, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl.signal,
            });
            let data = {};
            try { data = await res.json(); } catch (e) { /* empty body */ }
            if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed.');
            return data;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(0, 'Could not reach the leaderboard.');
        } finally {
            clearTimeout(timer);
        }
    }

    global.Api = {
        ApiError,
        playerId,
        start: (n) => call('POST', `/daily/${n}/start`, { playerId: playerId() }),
        finish: (n, { token, movesLog, hints, seconds }) =>
            call('POST', `/daily/${n}/finish`, { playerId: playerId(), token, movesLog, hints, seconds }),
        leaderboard: (n, range = 'today', limit = 10) =>
            call('GET', `/daily/${n}/leaderboard?range=${range}&limit=${limit}&playerId=${encodeURIComponent(playerId())}`),
        handle: () => call('GET', `/player?playerId=${encodeURIComponent(playerId())}`),
        setHandle: (handle) => call('PATCH', '/player', { playerId: playerId(), handle }),
    };
})(window);
