// Quindici daily scoring — reference implementation.
// score = 1000 × precision × pace
//   precision = (par / moves)^2
//   pace      = 1/2 + 1/2 × 2^(−seconds / (3 × par))
// `moves` counts single-tile moves (a Shift+arrow slide of 3 tiles = 3 moves),
// plus HINT_PENALTY per hint used. `par` is the optimal single-tile move count.

const HINT_PENALTY = 3;      // moves added per hint
const PACE_HALF_LIFE = 3;    // seconds per par move for the pace bonus to halve

function scoredMoves(moves, hints = 0) {
  return moves + HINT_PENALTY * hints;
}

function precision(par, moves) {
  if (!(par > 0) || !(moves >= par)) throw new RangeError('moves must be >= par > 0');
  return Math.pow(par / moves, 2);
}

function pace(par, seconds) {
  if (!(seconds >= 0)) throw new RangeError('seconds must be >= 0');
  return 0.5 + 0.5 * Math.pow(2, -seconds / (PACE_HALF_LIFE * par));
}

// Returns { score, precision, pace, moves } — score is an integer 0..1000.
function score({ par, moves, seconds, hints = 0 }) {
  const m = scoredMoves(moves, hints);
  const pr = precision(par, m);
  const pa = pace(par, seconds);
  return { score: Math.round(1000 * pr * pa), precision: pr, pace: pa, moves: m };
}

// "A perfect solve in the same time would have scored X" line on the solved screen.
function perfectAtSamePace(par, seconds) {
  return Math.round(1000 * pace(par, seconds));
}

module.exports = { score, precision, pace, scoredMoves, perfectAtSamePace, HINT_PENALTY, PACE_HALF_LIFE };
