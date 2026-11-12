# Quindici redesign: implementation spec

Status: design approved (80s retro direction with row colors), ready to build.
Design canvas: https://claude.ai/artifact/SL537jiSmjxD3svbH1Ew8W (mockup sources are copied into `design/mockups/`).

## 1. Goals

1. **Restyle** quindici.io in the approved 80s retro look, on desktop and mobile, without losing keyboard play.
2. **Add a Daily challenge.** Everyone gets the same board each day. Its optimal move count (par) is precomputed.
3. **Replace the score.** The current score is `moves + seconds`. The new score is 0–1000 and relative to par, so days of different difficulty are comparable.
4. **Make results shareable** with a spoiler-free text and an image card, so people come back each day.
5. **Add a leaderboard** for each daily (Phase 3, needs a backend).

## 2. What exists today (from the repo, `main` @ 4ce5417)

- Static site with no build step: `index.html`, `script.js` (one `PuzzleGame` class, ~816 lines), `style.css`, Clear Sans in `fonts/`, Google Analytics tag in `index.html`.
- `?board=<16 hex chars>` loads a specific board. The same hex format is used by the solver and the share link.
- `solver/index.html` + `solver/solverWorker.js`: IDA* search with Manhattan distance + linear conflict, step animation, GIF export.
- Solve Step (`s`) uses **greedy best-first search**. It is not optimal and costs 1 move.
- **A Shift+arrow multi-tile slide increments `moveCount` by 1**, whatever the number of tiles shifted (`executeMoveLogic`).
- Score = `moves + floor(seconds)`, shown in `#gameOverOverlay`.
- Keyboard: arrows, Shift+arrow, `a` new game, `s` solve step, `x` pause, `f` solver, `?` help.

## 3. Phases

| Phase | Scope | Backend? |
|---|---|---|
| 1 | Visual restyle of game and solver, row colors, green-when-home, goal instructions, new solved state, mobile layout with bottom nav | No |
| 2 | Daily challenge, new scoring, share text and image, local stats in `localStorage` | No (static `daily/*.json`) |
| 3 | Leaderboard page, result submission with server-side validation, player handles | Yes (see §9) |

Ship each phase on its own. Phase 2 must work fully on a static host.

## 4. Visual system

Tokens: `design/tokens.css`. Exact values come from `design/mockups/*.dc.html` (see `design/MOCKUPS.md`). Copy values exactly; do not round them.

- **Ground:** deep indigo `#1D1A3A` with a 1px grid in `#2A2654` (40px squares on desktop, 32px on phones).
- **Chunky components:** 3px `#120F26` outlines and hard offset shadows (3–8px, no blur). Buttons press in on `:active`, translating 3px and shrinking the shadow.
- **Type:** Bungee for tiles, headings and scores; Inter for UI copy; JetBrains Mono for counters, labels and board codes. Load from Google Fonts and drop Clear Sans.
- **Row colors:** a tile's color tells which row it belongs in.
  - Tiles 1–4 pink `#FF9EC7`, 5–8 yellow `#FFE27A`, 9–12 cyan `#8DE8EC`, 13–15 lavender `#C9B3FF`.
  - **A tile in its home square turns green** `#8EF0A8`, re-evaluated after every move.
  - Text on tiles is always ink `#120F26`.
- **Empty square:** `#1D1A3A` with a 3px dashed `#4A4585` outline.
- **Solved:** every tile is green, the board tray turns `#245C47`, and a yellow "Solved!" sticker is rotated 5° over the board's top edge (see `Desktop-Solved`).
- **Accents:** yellow is primary (headings, main buttons, active nav), pink is precision, cyan is pace and par, lavender is for secondary actions.
- **Logo:** pink "15" tile mark plus the word "quindici" in Bungee. Regenerate the favicons (16/32/48) from the mark.

## 5. Screens

Mockup file → what it becomes:

| Mockup | Implementation |
|---|---|
| `Main.dc.html` (desktop), `Mobile-Start.dc.html` | `index.html` in Daily mode, after the board is revealed |
| `Desktop-Solved.dc.html`, `Mobile-Solved.dc.html` | Solved state; replaces `#gameOverOverlay` (same page, not a modal) |
| `Desktop-Share.dc.html`, `Mobile-Share.dc.html` | Share dialog on desktop; bottom sheet on phones |
| `Desktop-Solver.dc.html`, `Mobile-Solver.dc.html` | `solver/index.html` |
| `Desktop-Leaderboard.dc.html`, `Mobile-Leaderboard.dc.html` | New `leaderboard/index.html` (Phase 3) |

### 5.1 Layout and breakpoints

- **≥ 1025px:** three columns: info and goal | board (max 460px) | stats and score. Top nav bar.
- **641–1024px:** board first, the two side columns wrap below it. Top nav.
- **≤ 640px:** phone layout from the `Mobile-*` mockups: compact header, stats row, board ≈ 350px, actions, goal card, bottom tab bar (Daily · Free play · Solver · Ranks). Respect the safe-area insets.
- Nav: Daily, Free play, Solver, Leaderboard. The current page gets the yellow chip and `aria-current="page"`.

### 5.2 Game screen (Daily and Free play)

- **Left column (Daily):** date label; "Daily No. N" heading; **goal card**; "Shortest solution today: **N moves**"; Hint and Pause buttons.
  - The goal card has a mini 4×4 picture of the finished board in row colors, plus this copy:
    > Slide the tiles into order, 1 to 15, left to right from the top-left corner. The empty square ends up last.
    > Each color is a row: pink tiles belong in row one, yellow in row two, and so on. A tile turns green once it is home.
- **Right column:** Moves (with "/ par N"), Time, precision and pace bars updated live, "Score if solved now" updated live.
- **Footer:** keyboard hints.
- **Free play:** same layout. The heading reads "Free play", the hint button stays, and a **New game** button (`a`) is added. Par is computed in a Web Worker at game start; until it arrives, show "par …" and hide the live score.
- **Start overlay (Daily):** the board stays hidden until the player presses **Start Daily No. N** (Enter). The timer starts on reveal, not on the first move, so players can't plan unseen time. The mockup shows the moment just after reveal.
- **Pause** (`x`, or the tab becoming hidden): stop the timer and cover the board with a "Paused" panel. The board must not be visible while paused.
- **Persistence:** save the in-progress daily (board, moves, hints, elapsed, started) to `localStorage` after every move. A reload resumes the game, paused. It must not reset or rerun the clock.

### 5.3 Solved screen

- **Left:** "DAILY NO. N · SOLVED"; the score in big green Bungee; "out of 1000" (append "· Nth today" only once the leaderboard exists); **Share result** (yellow), **Watch the N-move solution** (cyan, links to the solver with the board), "See the leaderboard" (Phase 3).
- **Center:** the solved board, all green, with the "Solved!" sticker.
- **Right:**
  - Precision bar plus note: "56 moves against a par of 48. That is 8 over." (On par: "Perfect. You matched par.")
  - Pace bar plus note: "Solved in 1:36. Pace never drops below 50%."
  - Formula card: `1000 × 0.735 × 0.815 = 599`.
  - What-if line: "A perfect 48-move solve in the same time would have scored 815." Compute it with `perfectAtSamePace(par, seconds)`. Hide the line when moves equal par.
- **Footer:** "Daily No. N+1 unlocks at midnight, your time."

### 5.4 Share

**Text** (spoiler-free, matches the mockup):

```
quindici #1 · 599
precision ▰▰▰▰▰▰▰▱▱▱ 56/48
pace      ▰▰▰▰▰▰▰▰▱▱ 1:36
https://quindici.io/?daily=1
```

- Bars have 10 cells; filled cells = `round(value × 10)`.
- If hints were used, append ` · 2 hints` to line 1.
- The mockups show the link as `quindici.io/daily/1`. Use `?daily=N` unless the host supports rewrites (`404.html` could redirect `/daily/N` → `/?daily=N`).

**Image card:** a 1200×630 PNG drawn client-side on a `<canvas>` after `document.fonts.ready`. Layout as in the mockup: grid ground, logo, "NO. N · DATE", big green score, precision and pace bars.

**Actions:**
- **Desktop:** Download image, Copy text, Copy link.
- **Phones:** Share (Web Share API with the PNG in `files` where `navigator.canShare({files})` is true, otherwise text + URL), Copy text, Save image.
- Show a "Copied" toast.

The `og:image` / Twitter card for `?daily=N` can stay the generic preview image; dynamic OG images are out of scope.

### 5.5 Solver page

- **Left:** board showing the current step. The tile that moves next is lifted (cream outline, offset −3px, larger shadow). Below it: a scrubber (`<input type="range">`, 0…N), then Previous / Play / Next / speed (1×, 2×, 4×).
- **Right:** "OPTIMAL SOLUTION · A*"; "**N** moves"; board code input plus Solve.
  - Move list: one chip per move showing the tile number. Played moves are dimmed, the current move is cream, and future moves are tinted in the tile's row color.
  - Download GIF (keep the existing feature) and "Play this board" (→ `/?board=hex`).
- **Daily lock:** if the code matches today's daily and the player hasn't solved it on this device, show "Today's daily board stays locked here until you have solved it yourself." in place of the solution. This is a courtesy only: anyone can paste the code into another solver.
- **Performance:** use the faster IDA* in `reference/generate-daily.js`. It runs iterative DFS that skips the reverse move and has no `visited` Set, and is much faster than the current worker. Keep it in a Worker.

### 5.6 Leaderboard page (Phase 3)

- Heading "Today's leaderboard", label "DAILY NO. N · PAR 48", range control (Today · This week · Friends).
- Ranked list: #, player, moves (+over or "par"), time, score. Ranks 1–3 get yellow, cyan and lavender chips. The player's own row is a pink bar and is always shown; if it falls outside the top 10, append it after a divider.
- "How the score works" aside with the formula and the four rules (copy in the mockup).
- **This week** = the sum of a player's scores over the last 7 dailies, so it rewards showing up.
- **Friends** needs accounts; hide it in v1 (see open decisions).

## 6. Scoring

Reference: `reference/scoring.js`. Tests: `node --test reference/scoring.test.js`.

```
score     = round(1000 × precision × pace)
precision = (par / moves)²                       moves = tile moves + 3 × hints
pace      = ½ + ½ × 2^(−seconds / (3 × par))
```

- **Par** is the optimal number of single-tile moves for the starting board.
- **Moves are counted per tile.** A Shift+arrow slide that moves 3 tiles counts as 3. This changes the current behavior and is required for comparison with par. Show the same count in the Moves counter.
- **Hints** (`s`) show the next move of an optimal solution from the current position and add 3 to scored moves.
  - If the position is still on the precomputed optimal path, use the stored `solution`.
  - Otherwise solve the current position in the worker; it is fast near the goal.
  - Free play may keep greedy hints if the solver is too slow early on, but Daily must not.
- **Seconds** is the active time from reveal to solve, excluding pauses, with fractional precision. Display as m:ss.
- **Properties to keep:**
  - 1000 needs a perfect, instant solve.
  - A perfect solve never scores below 500.
  - 41% over par halves the score through precision alone.
  - Pace halves its remaining bonus every 3 s per par move (2:24 at par 48).
- **Examples at par 48:**

  | Moves | Time | Score |
  |---|---|---|
  | 48 | 1:14 | 850 |
  | 50 | 1:01 | 804 |
  | 48 | 3:32 | 680 |
  | 56 | 1:36 | 599 |
  | 58 | 1:10 | 587 |

## 7. Daily challenge

- **Generation:** `node reference/generate-daily.js --start <launch-date> --days 365 --out daily/boards.json`. Deterministic (seeded by date), takes about 15 min for a year.
  - It keeps only boards with optimal length 44–54 (`--min-par/--max-par`) and verifies each solution by replaying it.
  - Sample output: `reference/daily-sample.json` (30 days from 2026-12-01, par 44–54).
- **Shipping:** commit `daily/boards.json`. The client fetches it once and caches it. Entry: `{ n, date, hex, par, solution }`.
- **Which daily:** the player's **local** date picks the entry (Wordle-style). Daily No. = `n`. Before the first date or after the last, show a friendly "No daily today" state. Regenerate before the file runs out (add a reminder in the README).
- **Attempts:** the first completed attempt is the scored one.
  - After solving, "Play again" is allowed but unscored ("practice").
  - Past dailies are playable via `?daily=N` for `N ≤ today`, unscored and not on the leaderboard. Future `N` is refused.
- **URLs:**
  - `/` opens today's daily.
  - `/?daily=N` opens a specific daily.
  - `/?board=hex` stays Free play on that board (keep existing links working).
  - `/?mode=free` opens Free play with a random board.
- **Local stats** (`localStorage` key `quindici.v1`): `{ results: { [n]: { moves, hints, seconds, score, solvedAt } }, inProgress: {...}, streak: { current, best, lastN } }`. Streaks are stored now and displayed later.

## 8. Keyboard and accessibility

| Key | Action |
|---|---|
| ← ↑ ↓ → | Slide the adjacent tile into the gap (unchanged semantics) |
| Shift + arrow | Slide the whole row or column (counts each tile) |
| Enter | Start the daily / reveal the board |
| S | Hint |
| X | Pause / resume |
| A | New game (Free play only) |
| F | Open the solver for this board (blocked for an unsolved daily) |
| ? | Shortcut help |
| Solver page | Space play/pause, ← → step, Home / End jump to start / end |

- Tiles are `<button>` elements with `aria-label="Tile 7"`, or `"Tile 7, in place"` when home. The board is `role="group"` with a label.
- Announce "Solved" and the score in an `aria-live="polite"` region.
- Color is never the only signal: numbers are always shown, and "in place" is in the label.
- Visible focus ring: a 3px cream outline. Touch targets ≥ 44px.
- `prefers-reduced-motion` turns off slide animations and the button press effect.
- Contrast is checked: muted `#C2BCE8` on `#1D1A3A` / `#2A2654` ≥ 7:1, and ink on every pastel ≥ 9.5:1.
- Keep touch handling, but fix the double move: today both `click` and `touchstart` fire `moveTile`. Use `pointerup` instead.

## 9. Leaderboard backend (Phase 3)

The site is static, so this needs a small API. **Recommended: a Cloudflare Worker + D1.** It has a free tier, works next to any static host, and is one file plus a SQL schema. Supabase is an alternative.

**Identity:** an anonymous player id (UUID) in `localStorage`, plus a generated handle such as `tile_wizard_42`, editable from the leaderboard page. No login in v1.

**Schema:**

```sql
CREATE TABLE players (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE results (
  daily_n INTEGER NOT NULL, player_id TEXT NOT NULL REFERENCES players(id),
  tile_moves INTEGER NOT NULL, hints INTEGER NOT NULL, seconds REAL NOT NULL, score INTEGER NOT NULL,
  moves_log TEXT NOT NULL,            -- tile numbers in order, comma-separated
  started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL,
  PRIMARY KEY (daily_n, player_id)
);
CREATE INDEX results_by_day ON results (daily_n, score DESC);
```

**Endpoints:**

- `POST /api/daily/:n/start` → `{ token }`, an HMAC-signed `{ n, playerId, startedAt }`. Called on reveal.
- `POST /api/daily/:n/finish` with `{ token, movesLog, hints, seconds }`. The server:
  1. Verifies the token.
  2. Replays `movesLog` from the board's hex and checks it reaches the goal. The number of tiles moved = `tile_moves`.
  3. Checks `seconds ≤ (now − startedAt) + 5` and `seconds ≥ 0.15 × tile_moves`.
  4. Recomputes the score with the shared scoring module.
  5. Inserts the row; the first submission wins.
  6. Returns `{ score, rank, total }`.
- `GET /api/daily/:n/leaderboard?range=today|week&limit=10` → `{ rows, you }`.
- `PATCH /api/player` with `{ handle }`: unique, 3–20 characters `[a-z0-9_]`, with a basic profanity filter.

**Integrity:** this stops edited scores and impossible times, not someone who copies an optimal solution from a solver. That trade-off is accepted for a hobby game.

## 10. Analytics (existing GA tag)

Events: `daily_start {n}`, `daily_solved {n, score, moves, seconds, hints}`, `hint_used {n}`, `share {method}`, `solver_open {source}`.

## 11. Acceptance criteria

**Phase 1**
- [ ] Every screen matches the mockups at 1280px and 390px wide (colors, borders, shadows, type, spacing).
- [ ] Tiles show their row color and turn green the moment they are home. A solved board is fully green with the sticker.
- [ ] The goal card copy and mini board are on the game screen at every width.
- [ ] All existing shortcuts still work; `?board=` links still work; the solver GIF export still works.
- [ ] No horizontal scroll at 320px. Lighthouse accessibility ≥ 95.

**Phase 2**
- [ ] `/` loads today's daily from `daily/boards.json`. Two browsers on the same local date get the same board.
- [ ] Moves count per tile. Score matches `scoring.js` (unit tests pass), including hints.
- [ ] The board stays hidden until Start; pause and hidden tabs stop the clock and hide the board; a reload resumes paused.
- [ ] Share text matches §5.4 exactly. The image card renders at 1200×630 with the right fonts.
- [ ] A second play of the same daily is marked practice and does not overwrite the first result.

**Phase 3**
- [ ] The finish endpoint rejects a moves log that does not solve the board, and rejects impossible times.
- [ ] The leaderboard shows the top 10 plus the player's own row; the This week totals are correct.

## 12. Open decisions (owner: Justin)

1. **Launch date** (Daily No. 1). **Decided: 2026-11-11** (moved up from 2026-12-01; the generated boards were shifted 20 days earlier).
2. **Backend for the leaderboard.** Default: Cloudflare Workers + D1. **Decided: Firebase** (already set up); the site stays hosted on Netlify. §9's endpoints and checks still apply, built as Cloud Functions with Firestore.
3. **Shift-slides counting per tile.** Default: yes, for every mode.
4. **Friends tab.** Default: hidden in v1.
5. **Past dailies.** Default: playable, unscored.
6. **Daily rollover.** Default: local midnight. The alternative is a global UTC rollover.
