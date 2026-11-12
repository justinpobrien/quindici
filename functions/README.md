# Quindici leaderboard API

Firebase project: `quindici-io`. One HTTPS Cloud Function, `api`, implements SPEC §9 on Firestore.
The site stays on Netlify and calls the function directly (CORS allows quindici.io, Netlify previews and localhost).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/daily/:n/start` | `{ playerId }` | `{ token, handle }` |
| POST | `/daily/:n/finish` | `{ playerId, token, movesLog, hints, seconds }` | `{ score, rank, below, total, duplicate }` |
| GET | `/daily/:n/leaderboard` | `?range=today\|week&limit=10&playerId=` | `{ rows, you, total, buckets }` (`buckets`: today's scores in ten bands of 100) |
| GET | `/player` | `?playerId=` | `{ handle }` |
| PATCH | `/player` | `{ playerId, handle }` | `{ handle }` |

`finish` verifies the HMAC start token, replays `movesLog` from the daily's board, checks the time
(no longer than the time since start + 5 s, at least 0.15 s per move), rescores with `js/scoring.js`,
and keeps only the first submission. Player ids are never returned.

`scripts/sync-shared.js` copies `js/scoring.js` and `daily/boards.json` into `functions/shared/`
before tests and every deploy, so the server always uses the game's own scoring and boards.

## Commands (run in `functions/`)

```
npm install
npm test                 # unit tests, no emulator
npm run test:emulator    # end-to-end against the Functions + Firestore emulators
npm run serve            # local emulators (project demo-quindici); API at http://127.0.0.1:5001/demo-quindici/us-central1/api
```

Emulator-only settings live in `.env.local` and `.secret.local` (git-ignored).

## First deploy

1. Upgrade the project to the Blaze plan (Cloud Functions requires it).
2. Set the token secret once: `firebase functions:secrets:set TOKEN_SECRET` (any long random string).
3. `firebase deploy --only functions,firestore` from the repo root.

Keep `firebase-functions` on v6: v7 does not load in the installed Firebase CLI's emulator.

## The site's client

`js/api.js` talks to the deployed function. On a local server (localhost or 127.0.0.1) it uses the
emulator instead; add `?api=prod` to the address to use production. The game gets a start token
when the daily is revealed, submits when it is solved, and retries on the next visit if offline.
The leaderboard page is `leaderboard/` (`?daily=N`, `?range=week`).
