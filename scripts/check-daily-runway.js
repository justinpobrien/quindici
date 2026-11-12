#!/usr/bin/env node
// Reports how many days of daily boards are left in daily/boards.json.
// Usage: node scripts/check-daily-runway.js [--warn-days 60]
// Prints a summary; in GitHub Actions it also writes last_date, days_left and warn to $GITHUB_OUTPUT.
const fs = require('fs');
const path = require('path');

const i = process.argv.indexOf('--warn-days');
const warnDays = i > -1 ? Number(process.argv[i + 1]) : 60;
const boards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'daily', 'boards.json'), 'utf8'));
const last = boards[boards.length - 1];

// Days from today (UTC) to the last board's date, inclusive of that date.
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const daysLeft = Math.round((Date.parse(last.date + 'T00:00:00Z') - today) / 86400000);
const warn = daysLeft <= warnDays;

console.log(`Daily boards run to ${last.date} (No. ${last.n}): ${daysLeft} days left.${warn ? ` Under ${warnDays} days: extend them.` : ''}`);
if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `last_date=${last.date}\nlast_n=${last.n}\ndays_left=${daysLeft}\nwarn=${warn}\n`);
}
