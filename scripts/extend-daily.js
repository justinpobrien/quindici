#!/usr/bin/env node
// Appends more daily boards to daily/boards.json, continuing the dates and the numbering.
// Usage: node scripts/extend-daily.js [--days 365]
// Uses docs/redesign/reference/generate-daily.js, so a date always gets the same board.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const file = path.join(root, 'daily', 'boards.json');
const i = process.argv.indexOf('--days');
const days = i > -1 ? process.argv[i + 1] : '365';

const boards = JSON.parse(fs.readFileSync(file, 'utf8'));
const last = boards[boards.length - 1];
const next = new Date(last.date + 'T00:00:00Z');
next.setUTCDate(next.getUTCDate() + 1);
const start = next.toISOString().slice(0, 10);

const tmp = path.join(os.tmpdir(), `quindici-daily-${Date.now()}.json`);
execFileSync('node', [path.join(root, 'docs/redesign/reference/generate-daily.js'), '--start', start, '--days', days, '--out', tmp], { stdio: 'inherit' });
const added = JSON.parse(fs.readFileSync(tmp, 'utf8')).map((d, k) => ({ ...d, n: last.n + 1 + k }));
fs.unlinkSync(tmp);

fs.writeFileSync(file, JSON.stringify(boards.concat(added), null, 1));
console.log(`Added Daily No. ${added[0].n}–${added[added.length - 1].n} (${added[0].date} to ${added[added.length - 1].date}).`);
