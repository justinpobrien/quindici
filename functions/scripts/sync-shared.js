// Copies the site's scoring module and daily boards into functions/shared/ so the
// server scores results with exactly the code and boards the game uses.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const out = path.join(__dirname, '..', 'shared');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'js', 'scoring.js'), path.join(out, 'scoring.js'));
fs.copyFileSync(path.join(root, 'daily', 'boards.json'), path.join(out, 'boards.json'));
console.log('Synced js/scoring.js and daily/boards.json into functions/shared/');
