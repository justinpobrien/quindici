// puzzle.js: board helpers shared by the game and the solver.
// A board is 16 numbers in reading order; 0 is the empty square. The goal is 1..15 then 0.
(function (global) {
    'use strict';

    const SIZE = 4;
    const GOAL = Array.from({ length: SIZE * SIZE - 1 }, (_, i) => i + 1).concat(0);

    // Row a tile belongs in: 1 (tiles 1–4) to 4 (tiles 13–15).
    function homeRow(tile) {
        return Math.floor((tile - 1) / SIZE) + 1;
    }

    function isHome(tile, index) {
        return tile !== 0 && tile === index + 1;
    }

    function isGoal(board) {
        return board.every((v, i) => v === GOAL[i]);
    }

    function isSolvable(board) {
        let inversions = 0;
        const tiles = board.filter(v => v !== 0);
        for (let i = 0; i < tiles.length; i++) {
            for (let j = i + 1; j < tiles.length; j++) {
                if (tiles[i] > tiles[j]) inversions++;
            }
        }
        const blankRowFromBottom = SIZE - Math.floor(board.indexOf(0) / SIZE);
        return (inversions + blankRowFromBottom) % 2 === 1;
    }

    function toHex(board) {
        return board.map(n => n.toString(16)).join('');
    }

    // Parses a 16-character hex code into a board. Throws on anything that is not a permutation of 0..15.
    function fromHex(hex) {
        const code = String(hex).trim().toLowerCase();
        if (!/^[0-9a-f]{16}$/.test(code)) {
            throw new Error('A board code is 16 characters, 0–9 and a–f.');
        }
        const board = code.split('').map(c => parseInt(c, 16));
        if (new Set(board).size !== 16) {
            throw new Error('Each of 0–f must appear exactly once.');
        }
        return board;
    }

    // Accepts a hex code or the older JSON array format ("[6, 1, 13, ...]").
    function parseBoard(input) {
        const text = String(input).trim();
        if (text.startsWith('[')) {
            let board;
            try { board = JSON.parse(text); } catch (e) { throw new Error('That list is not valid.'); }
            if (!Array.isArray(board) || board.length !== 16 || new Set(board).size !== 16 ||
                !board.every(n => Number.isInteger(n) && n >= 0 && n <= 15)) {
                throw new Error('The list needs the numbers 0 to 15, each once.');
            }
            return board;
        }
        return fromHex(text);
    }

    function shuffled() {
        let board;
        do {
            board = GOAL.slice();
            for (let i = board.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [board[i], board[j]] = [board[j], board[i]];
            }
        } while (!isSolvable(board) || isGoal(board));
        return board;
    }

    // Slides one tile (by number) into the adjacent empty square. Returns a new board.
    function applyMove(board, tile) {
        const b = board.slice();
        const i = b.indexOf(tile);
        const z = b.indexOf(0);
        const dist = Math.abs(Math.floor(i / SIZE) - Math.floor(z / SIZE)) + Math.abs((i % SIZE) - (z % SIZE));
        if (dist !== 1) throw new Error('Tile ' + tile + ' is not next to the empty square.');
        b[z] = tile;
        b[i] = 0;
        return b;
    }

    // Fills a container with the 16 cells of a board. Used for the goal card, the solved mini board,
    // and the solver. Options: { tag: 'div' | 'button', solved, lifted (tile number), labels }.
    function renderCells(container, board, options = {}) {
        const tag = options.tag || 'div';
        container.textContent = '';
        board.forEach((value, index) => {
            if (value === 0) {
                const empty = document.createElement('div');
                empty.className = 'cell-empty';
                empty.setAttribute('aria-hidden', 'true');
                container.appendChild(empty);
                return;
            }
            const cell = document.createElement(tag);
            const home = options.colorHome === false ? false : (options.solved || isHome(value, index));
            cell.className = 'tile row-' + homeRow(value) + (home ? ' is-home' : '');
            if (options.lifted === value) cell.classList.add('is-lifted');
            if (tag === 'button') cell.type = 'button';
            cell.textContent = value;
            if (options.labels !== false) {
                let label = 'Tile ' + value + (home ? ', in place' : '');
                if (options.lifted === value) label += ', next to move';
                cell.setAttribute('aria-label', label);
            }
            container.appendChild(cell);
        });
    }

    global.Puzzle = {
        SIZE, GOAL, homeRow, isHome, isGoal, isSolvable, toHex, fromHex, parseBoard,
        shuffled, applyMove, renderCells
    };
})(window);
