// solverWorker.js

// Heuristic Functions
function manhattanDistance(state) {
    let distance = 0;
    const size = 4;
    for (let i = 0; i < state.length; i++) {
        if (state[i] !== 0) {
            const target = state[i] - 1;
            const currentRow = Math.floor(i / size);
            const currentCol = i % size;
            const targetRow = Math.floor(target / size);
            const targetCol = target % size;
            distance += Math.abs(currentRow - targetRow) + Math.abs(currentCol - targetCol);
        }
    }
    return distance;
}

function linearConflict(state) {
    let conflict = 0;
    const size = 4;

    // Rows
    for (let row = 0; row < size; row++) {
        let max = -1;
        for (let col = 0; col < size; col++) {
            const index = row * size + col;
            const tile = state[index];
            if (tile !== 0 && Math.floor((tile - 1) / size) === row) {
                if (tile > max) {
                    max = tile;
                } else {
                    conflict += 2;
                }
            }
        }
    }

    // Columns
    for (let col = 0; col < size; col++) {
        let max = -1;
        for (let row = 0; row < size; row++) {
            const index = row * size + col;
            const tile = state[index];
            if (tile !== 0 && (tile - 1) % size === col) {
                if (tile > max) {
                    max = tile;
                } else {
                    conflict += 2;
                }
            }
        }
    }

    return conflict;
}

function enhancedHeuristic(state) {
    return manhattanDistance(state) + linearConflict(state);
}

// Utility Functions
function arraysEqual(a, b) {
    return a.length === b.length && a.every((val, index) => val === b[index]);
}

function arrayToString(array) {
    return array.join(',');
}

function goalState() {
    return Array.from({ length: 15 }, (_, i) => i + 1).concat(0);
}

function getNeighbors(state) {
    const neighbors = [];
    const size = 4;
    const emptyIndex = state.indexOf(0);
    const row = Math.floor(emptyIndex / size);
    const col = emptyIndex % size;

    const directions = [
        { rowOffset: -1, colOffset: 0 }, // Up
        { rowOffset: 1, colOffset: 0 },  // Down
        { rowOffset: 0, colOffset: -1 }, // Left
        { rowOffset: 0, colOffset: 1 }   // Right
    ];

    for (const { rowOffset, colOffset } of directions) {
        const newRow = row + rowOffset;
        const newCol = col + colOffset;
        if (newRow >= 0 && newRow < size && newCol >= 0 && newCol < size) {
            const newIndex = newRow * size + newCol;
            const newState = state.slice();
            // Swap the empty tile with the adjacent tile
            [newState[emptyIndex], newState[newIndex]] = [newState[newIndex], newState[emptyIndex]];
            neighbors.push(newState);
        }
    }

    return neighbors;
}

// IDA* Implementation
function idaStar(startState) {
    const goal = goalState();
    let threshold = enhancedHeuristic(startState);
    const path = [startState];
    let found = false;
    let finalPath = [];

    function search(state, g, threshold, path, visited) {
        const f = g + enhancedHeuristic(state);
        if (f > threshold) {
            return f;
        }
        if (arraysEqual(state, goal)) {
            finalPath = path.slice();
            found = true;
            return f;
        }

        let min = Infinity;
        const neighbors = getNeighbors(state);

        for (const neighbor of neighbors) {
            const neighborKey = arrayToString(neighbor);
            if (!visited.has(neighborKey)) {
                visited.add(neighborKey);
                path.push(neighbor);
                const temp = search(neighbor, g + 1, threshold, path, visited);
                if (found) {
                    return temp;
                }
                if (temp < min) {
                    min = temp;
                }
                path.pop();
                visited.delete(neighborKey);
            }
        }
        return min;
    }

    while (true) {
        const visited = new Set();
        visited.add(arrayToString(startState));
        const temp = search(startState, 0, threshold, path, visited);
        if (found) {
            return finalPath;
        }
        if (temp === Infinity) {
            return []; // No solution found
        }
        threshold = temp;
    }
}

onmessage = function(e) {
    const startState = e.data;
    const path = idaStar(startState);
    postMessage(path);
};
