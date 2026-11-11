// solverWorker.js: optimal 15-puzzle solver.
// IDA* with Manhattan distance + linear conflict, as in docs/redesign/reference/generate-daily.js:
// an in-place iterative DFS that never undoes the previous move and keeps no visited set.
//
// In:  { board: number[16] }
// Out: { type: 'progress', bound } while deepening, then { type: 'done', solution } where
//      solution lists the tile number slid at each step ([] when the board is already solved),
//      or { type: 'error', message }.

function heuristic(b) {
    let d = 0;
    for (let i = 0; i < 16; i++) {
        const v = b[i];
        if (!v) continue;
        const g = v - 1;
        d += Math.abs((i >> 2) - (g >> 2)) + Math.abs((i & 3) - (g & 3));
    }
    for (let r = 0; r < 4; r++) {
        for (let a = 0; a < 4; a++) {
            const va = b[r * 4 + a];
            if (!va || ((va - 1) >> 2) !== r) continue;
            for (let c = a + 1; c < 4; c++) {
                const vc = b[r * 4 + c];
                if (vc && ((vc - 1) >> 2) === r && vc < va) d += 2;
            }
        }
    }
    for (let c = 0; c < 4; c++) {
        for (let a = 0; a < 4; a++) {
            const va = b[a * 4 + c];
            if (!va || ((va - 1) & 3) !== c) continue;
            for (let r = a + 1; r < 4; r++) {
                const vc = b[r * 4 + c];
                if (vc && ((vc - 1) & 3) === c && vc < va) d += 2;
            }
        }
    }
    return d;
}

function isSolvable(b) {
    let inv = 0;
    const f = b.filter((x) => x);
    for (let i = 0; i < 15; i++) for (let j = i + 1; j < 15; j++) if (f[i] > f[j]) inv++;
    return (inv + 4 - Math.floor(b.indexOf(0) / 4)) % 2 === 1;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function solve(start, onBound) {
    const b = start.slice();
    const path = [];
    let bound = heuristic(b);

    function dfs(z, g, prev) {
        const h = heuristic(b);
        const f = g + h;
        if (f > bound) return f;
        if (h === 0) return -1;
        let min = Infinity;
        const zr = z >> 2, zc = z & 3;
        for (const [dr, dc] of DIRS) {
            const r = zr + dr, c = zc + dc;
            if (r < 0 || r > 3 || c < 0 || c > 3) continue;
            const n = r * 4 + c;
            if (n === prev) continue;
            const tile = b[n];
            b[z] = tile; b[n] = 0; path.push(tile);
            const res = dfs(n, g + 1, z);
            if (res === -1) return -1;
            b[n] = tile; b[z] = 0; path.pop();
            if (res < min) min = res;
        }
        return min;
    }

    for (;;) {
        onBound(bound);
        const r = dfs(b.indexOf(0), 0, -1);
        if (r === -1) return path.slice();
        if (r === Infinity) return null;
        bound = r;
    }
}

onmessage = function (e) {
    const board = e.data && e.data.board;
    if (!Array.isArray(board) || board.length !== 16 || new Set(board).size !== 16) {
        postMessage({ type: 'error', message: 'Invalid board.' });
        return;
    }
    if (!isSolvable(board)) {
        postMessage({ type: 'error', message: 'This board cannot be solved.' });
        return;
    }
    const solution = solve(board, (bound) => postMessage({ type: 'progress', bound }));
    if (solution) postMessage({ type: 'done', solution });
    else postMessage({ type: 'error', message: 'No solution found.' });
};
