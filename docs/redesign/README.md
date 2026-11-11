# Quindici redesign: handoff for Claude Code

Everything needed to build the quindici.io redesign: an 80s retro restyle with row-colored tiles, a Daily challenge with par, a new 0–1000 score, sharing, and a leaderboard.

## What's here

```
SPEC.md                    The build spec: phases, screens, behavior, scoring, daily, backend, acceptance criteria, open decisions
design/tokens.css          Colors, fonts, borders, shadows, radii as CSS variables
design/MOCKUPS.md          How to read the mockup sources, plus the screen list
design/mockups/*.dc.html   Mockup sources for 10 screens (desktop and phone); exact values
reference/scoring.js       Scoring formula, reference implementation (CommonJS, no dependencies)
reference/scoring.test.js  `node --test reference/scoring.test.js`
reference/generate-daily.js  Deterministic daily-board generator with a fast IDA* solver
reference/daily-sample.json  30 sample dailies (2026-12-01 → 2026-12-30), each with par and its optimal solution
```

Live design canvas: https://claude.ai/artifact/SL537jiSmjxD3svbH1Ew8W

## How to hand it to Claude Code

1. Copy this folder into the repo as `docs/redesign/`.
2. Settle the open decisions at the end of `SPEC.md`, or let Claude Code take the stated defaults.
3. Start Claude Code in the repo and paste:

> Read docs/redesign/SPEC.md and docs/redesign/design/MOCKUPS.md, then the mockup sources in docs/redesign/design/mockups/ and docs/redesign/design/tokens.css. Implement **Phase 1** (the visual restyle) on a new branch `redesign/phase-1`. Keep the site static with no build step. Keep every existing keyboard shortcut and `?board=` link working. Copy exact values from the mockups. Before you start, give me a short plan listing the files you'll change. When you're done, run the site locally and screenshot it at 1280px and 390px to compare against the mockups, check the Phase 1 acceptance criteria in SPEC.md §11, and open a PR.

For Phase 2, then Phase 3, use the same prompt with the phase changed. For Phase 2, also tell it the launch date so it can generate `daily/boards.json` with `reference/generate-daily.js`.

## Upkeep

`daily/boards.json` covers a fixed range of dates. Regenerate it before it runs out (`node docs/redesign/reference/generate-daily.js --start <date> --days 365`).
