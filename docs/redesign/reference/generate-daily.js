#!/usr/bin/env node
// Precompute daily boards with their optimal (par) solutions.
// Usage: node generate-daily.js --start 2026-12-01 --days 365 --out daily.json [--min-par 44 --max-par 54]
// Deterministic: the same start date + day number always yields the same board.
// Each entry: { n, date, hex, par, solution }  — solution lists the tile number moved at each step.
// Solver: IDA* with Manhattan distance + linear conflict (same heuristic as solver/solverWorker.js),
// iterative DFS without a visited Set, so it is much faster than the current worker.

const fs = require('fs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : dflt;
}
const START = arg('start', '2026-12-01');
const DAYS = parseInt(arg('days', '30'), 10);
const OUT = arg('out', 'daily.json');
const MIN_PAR = parseInt(arg('min-par', '44'), 10);
const MAX_PAR = parseInt(arg('max-par', '54'), 10);
const TIME_LIMIT_MS = parseInt(arg('time-limit', '4000'), 10);

// --- seeded RNG (string → 32-bit seed → mulberry32) ---
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- puzzle helpers (board = 16 numbers, 0 = blank, goal = 1..15,0) ---
function isSolvable(b) {
  let inv = 0;
  const f = b.filter((x) => x);
  for (let i = 0; i < 15; i++) for (let j = i + 1; j < 15; j++) if (f[i] > f[j]) inv++;
  const blankRowFromBottom = 4 - Math.floor(b.indexOf(0) / 4);
  return (inv + blankRowFromBottom) % 2 === 1;
}
function isGoal(b) { for (let i = 0; i < 15; i++) if (b[i] !== i + 1) return false; return true; }
function heuristic(b) {
  let d = 0;
  for (let i = 0; i < 16; i++) {
    const v = b[i]; if (!v) continue;
    const g = v - 1;
    d += Math.abs((i >> 2) - (g >> 2)) + Math.abs((i & 3) - (g & 3));
  }
  for (let r = 0; r < 4; r++) for (let a = 0; a < 4; a++) {
    const va = b[r * 4 + a]; if (!va || ((va - 1) >> 2) !== r) continue;
    for (let c = a + 1; c < 4; c++) { const vc = b[r * 4 + c]; if (vc && ((vc - 1) >> 2) === r && vc < va) d += 2; }
  }
  for (let c = 0; c < 4; c++) for (let a = 0; a < 4; a++) {
    const va = b[a * 4 + c]; if (!va || ((va - 1) & 3) !== c) continue;
    for (let r = a + 1; r < 4; r++) { const vc = b[r * 4 + c]; if (vc && ((vc - 1) & 3) === c && vc < va) d += 2; }
  }
  return d;
}
// Returns array of tile numbers to slide, or null on timeout or when the optimum exceeds maxBound.
function solve(start, limitMs, maxBound = Infinity) {
  const b = start.slice();
  const t0 = Date.now();
  let bound = heuristic(b), nodes = 0, timedOut = false;
  const path = [];
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function dfs(z, g, prev) {
    const h = heuristic(b), f = g + h;
    if (f > bound) return f;
    if (h === 0) return -1;
    if ((++nodes & 0xffff) === 0 && Date.now() - t0 > limitMs) { timedOut = true; return Infinity; }
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
      if (timedOut) return Infinity;
      if (res < min) min = res;
    }
    return min;
  }
  for (;;) {
    const r = dfs(b.indexOf(0), 0, -1);
    if (r === -1) return path.slice();
    if (timedOut || r === Infinity) return null;
    bound = r;
    if (bound > maxBound) return null;            // optimal is longer than we want: give up early
  }
}
function applySolution(board, solution) {
  const b = board.slice();
  for (const tile of solution) {
    const i = b.indexOf(tile), z = b.indexOf(0);
    if (Math.abs((i >> 2) - (z >> 2)) + Math.abs((i & 3) - (z & 3)) !== 1) throw new Error('illegal move ' + tile);
    b[z] = tile; b[i] = 0;
  }
  return b;
}
const toHex = (b) => b.map((n) => n.toString(16)).join('');

// --- generate ---
const startDate = new Date(START + 'T00:00:00Z');
const out = [];
for (let n = 1; n <= DAYS; n++) {
  const date = new Date(startDate.getTime() + (n - 1) * 86400000).toISOString().slice(0, 10);
  const rnd = mulberry32(hashSeed('quindici-daily-' + date));
  let entry = null, attempts = 0;
  while (!entry) {
    attempts++;
    const b = [...Array(16).keys()];
    for (let i = 15; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    if (!isSolvable(b) || isGoal(b)) continue;
    const lb = heuristic(b);
    if (lb > MAX_PAR) continue;                       // cheap reject: lower bound already too high
    const sol = solve(b, TIME_LIMIT_MS, MAX_PAR);
    if (!sol || sol.length < MIN_PAR || sol.length > MAX_PAR) continue;
    if (!isGoal(applySolution(b, sol))) throw new Error('solution check failed');
    entry = { n, date, hex: toHex(b), par: sol.length, solution: sol };
  }
  out.push(entry);
  process.stderr.write(`#${n} ${date} par ${entry.par} (${attempts} tries)\n`);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
process.stderr.write(`wrote ${out.length} boards to ${OUT}\n`);
