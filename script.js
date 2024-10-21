// script.js

// Wrap the entire code in an IIFE to avoid polluting the global namespace
(function() {
    'use strict';

    // Class representing the puzzle game
    class PuzzleGame {
        constructor(size) {
            // Game configuration
            this.size = size;
            this.goalState = Array.from({ length: size * size - 1 }, (_, i) => i + 1).concat(0);

            // Game state variables
            this.board = [];
            this.initialBoard = [];
            this.gameWon = false;
            this.gamePaused = false;
            this.solutionPath = [];

            // Timer and move counter
            this.moveCount = 0;
            this.timerInterval = null;
            this.startTime = null;
            this.elapsedTime = 0;
            this.finalTime = 0;

            // Overlay state
            this.currentActiveOverlay = null;
            this.shortcutOverlayOpen = false;

            // Bind methods to the instance
            this.initializeGame = this.initializeGame.bind(this);
            this.newGame = this.newGame.bind(this);
            this.renderBoard = this.renderBoard.bind(this);
            this.moveTile = this.moveTile.bind(this);
            this.solveStep = this.solveStep.bind(this);
            this.handleKeydown = this.handleKeydown.bind(this);
            this.shareGame = this.shareGame.bind(this);
        }

        // Initializes the game
        initializeGame() {
            const params = new URLSearchParams(window.location.search);
            const hexString = params.get('board');

            if (hexString) {
                try {
                    const boardArray = this.hexToBoard(hexString);
                    if (!this.isSolvable(boardArray)) {
                        throw new Error("The provided board state is not solvable.");
                    }
                    this.board = boardArray;
                    this.initialBoard = boardArray.slice();
                    this.renderBoard();
                    document.getElementById('solveButton').disabled = false;
                    OverlayManager.show('instructionsOverlay');

                    // Disable the "New Game" button to prevent shuffling
                    const newGameButton = document.getElementById('newGameButton');
                    if (newGameButton) {
                        newGameButton.disabled = true;
                    }
                } catch (error) {
                    console.error("Error initializing board from URL:", error);
                    alert("Invalid board state provided in URL. Starting a new game instead.");
                    this.newGame();
                }
            } else {
                // No 'board' parameter; start a new game
                this.newGame();
                OverlayManager.show('instructionsOverlay');
            }

            // Set up event listeners
            this.addEventListeners();
            this.updateFooterLinks();
        }

        // Starts a new game
        newGame() {
            this.board = Array.from({ length: this.size * this.size - 1 }, (_, i) => i + 1).concat(0);
            this.shuffleBoard();
            while (!this.isSolvable() || this.isGameWon()) {
                this.shuffleBoard();
            }
            this.initialBoard = this.board.slice();
            this.gameWon = false;
            this.gamePaused = false;
            this.solutionPath = [];

            this.renderBoard();
            document.getElementById('solveButton').disabled = false;

            // Hide all overlays
            OverlayManager.hideAll();

            // Reset move counter and timer
            this.moveCount = 0;
            this.updateMoveCounter();
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            this.startTime = null;
            this.elapsedTime = 0;
            this.finalTime = 0;
            this.updateTimerDisplay(0);

            // Enable the "New Game" button
            const newGameButton = document.getElementById('newGameButton');
            if (newGameButton) {
                newGameButton.disabled = false;
            }
        }

        // Shuffles the board
        shuffleBoard() {
            for (let i = this.board.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.board[i], this.board[j]] = [this.board[j], this.board[i]];
            }
        }

        // Converts a hex string to a board array
        hexToBoard(hexString) {
            if (hexString.length !== 16) {
                throw new Error("Invalid hexadecimal string length. It should be 16 characters long.");
            }
            return hexString.split('').map(char => {
                const value = parseInt(char, 16);
                if (isNaN(value)) {
                    throw new Error("Invalid character in hexadecimal string.");
                }
                return value;
            });
        }

        // Checks if the board is solvable
        isSolvable(boardArray = this.board) {
            let inversionCount = 0;
            const boardLength = boardArray.length;

            for (let i = 0; i < boardLength; i++) {
                for (let j = i + 1; j < boardLength; j++) {
                    if (boardArray[i] !== 0 && boardArray[j] !== 0 && boardArray[i] > boardArray[j]) {
                        inversionCount++;
                    }
                }
            }

            const blankIndex = boardArray.indexOf(0);
            const blankRowFromBottom = this.size - Math.floor(blankIndex / this.size);

            if (this.size % 2 === 1) {
                return inversionCount % 2 === 0;
            } else {
                return (inversionCount + blankRowFromBottom) % 2 === 1;
            }
        }

        // Converts the board to a hex string
        boardToHex(board) {
            return board.map(n => n.toString(16)).join('');
        }

        // Updates footer links with the current board state
        updateFooterLinks() {
            const solverLink = document.getElementById('solverLink');
            if (solverLink) {
                const hexBoard = this.boardToHex(this.board);
                solverLink.href = '/solver/?board=' + hexBoard;
            }
        }

        vibrateOnTouch() {
            if ('vibrate' in navigator) {
                navigator.vibrate(50); // Vibrate for 50 milliseconds
            } else {
                console.log('Vibration API not supported on this device.');
            }
        }
        
    

        // Renders the board
        renderBoard() {
            const boardElement = document.getElementById('board');
            const tilesElement = document.getElementById('tiles');
            tilesElement.innerHTML = '';
            boardElement.style.backgroundColor = this.gameWon ? '#ADADAD' : '#B9AEA1';
        
            this.board.forEach((value, i) => {
                const tile = document.createElement('div');
                tile.className = 'tile';
                if (value === 0) {
                    tile.classList.add('empty');
                    if (this.gameWon) {
                        tile.style.backgroundColor = '#E4E4E4';
                    }
                } else {
                    const span = document.createElement('span');
                    span.textContent = value;
                    tile.appendChild(span);
                    if (!this.gameWon) {
                        tile.addEventListener('click', () => {
                            this.moveTile(i);
                            this.vibrateOnTouch();
                        });
                        tile.addEventListener('touchstart', () => {
                            this.moveTile(i);
                            this.vibrateOnTouch();
                        });
                        tile.classList.remove('disabled');
                    } else {
                        tile.classList.add('disabled');
                    }
                }
                tilesElement.appendChild(tile);
            });
        
            this.updateFooterLinks();
        }
        
        // Checks if the game is won
        isGameWon() {
            return this.board.every((value, index) => value === this.goalState[index]);
        }

        // Moves a tile
        moveTile(index) {
            if (this.gameWon || this.gamePaused || this.shortcutOverlayOpen) return;
            const emptyIndex = this.board.indexOf(0);
            const row = Math.floor(index / this.size);
            const col = index % this.size;
            const emptyRow = Math.floor(emptyIndex / this.size);
            const emptyCol = emptyIndex % this.size;

            if (row === emptyRow) {
                const step = emptyCol > col ? 1 : -1;
                for (let i = emptyCol; i !== col; i -= step) {
                    this.board[emptyRow * this.size + i] = this.board[emptyRow * this.size + i - step];
                }
                this.board[emptyRow * this.size + col] = 0;
                this.moveCount++;
            } else if (col === emptyCol) {
                const step = emptyRow > row ? 1 : -1;
                for (let i = emptyRow; i !== row; i -= step) {
                    this.board[i * this.size + emptyCol] = this.board[(i - step) * this.size + emptyCol];
                }
                this.board[row * this.size + emptyCol] = 0;
                this.moveCount++;
            }

            this.renderBoard();
            this.updateMoveCounter();

            if (!this.timerInterval) {
                this.startTimer();
            }

            if (this.isGameWon()) {
                this.endGame();
            }
        }

        // Ends the game
        endGame() {
            this.gameWon = true;
            this.renderBoard();
            this.stopTimer();

            // Calculate stats
            const totalMoves = this.moveCount;
            const totalTime = Math.floor(this.finalTime);
            const totalScore = totalMoves + totalTime;

            // Update the stats in the overlay
            document.getElementById('scoreValue').innerText = totalScore;
            document.getElementById('movesValue').innerText = totalMoves;
            document.getElementById('timeValue').innerText = totalTime + 's';

            OverlayManager.show('gameOverOverlay');
            document.getElementById('solveButton').disabled = true;
            document.getElementById('newGameButton').disabled = false;
            
        }

        // Performs a solve step
        solveStep() {
            if (this.gameWon || this.gamePaused || this.shortcutOverlayOpen) return;

            if (this.solutionPath.length === 0) {
                this.solutionPath = this.greedyBestFirstSearch(this.board.slice());
            }
            if (this.solutionPath.length > 0) {
                this.board = this.solutionPath.shift();
                this.renderBoard();

                this.moveCount++;
                this.updateMoveCounter();

                if (!this.timerInterval) {
                    this.startTimer();
                }

                if (this.isGameWon()) {
                    this.endGame();
                }
            }
        }

        // Updates the move counter display
        updateMoveCounter() {
            document.getElementById('moveCounter').textContent = this.moveCount;
        }

        // Starts the game timer
        startTimer() {
            if (this.timerInterval) return;
            this.startTime = Date.now();
            this.timerInterval = setInterval(() => {
                const currentTime = Date.now();
                this.elapsedTime += (currentTime - this.startTime) / 1000;
                this.startTime = currentTime;
                this.updateTimerDisplay(Math.floor(this.elapsedTime));
            }, 1000);
        }

        // Pauses the game timer
        pauseTimer() {
            if (!this.timerInterval) return;
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            const currentTime = Date.now();
            this.elapsedTime += (currentTime - this.startTime) / 1000;
            this.startTime = null;
        }

        // Stops the game timer
        stopTimer() {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
            this.finalTime = this.elapsedTime;
            this.elapsedTime = 0;
            this.startTime = null;
        }

        // Updates the timer display
        updateTimerDisplay(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            document.getElementById('timer').textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        }

        // Greedy Best-First Search algorithm
        greedyBestFirstSearch(startState) {
            const openSet = [];
            openSet.push({ state: startState, priority: this.manhattanDistance(startState) });
            const cameFrom = new Map();
            const closedSet = new Set();

            while (openSet.length > 0) {
                openSet.sort((a, b) => a.priority - b.priority);
                const current = openSet.shift();

                if (this.arraysEqual(current.state, this.goalState)) {
                    return this.reconstructPath(cameFrom, current.state);
                }

                closedSet.add(this.arrayToString(current.state));

                const neighbors = this.getNeighbors(current.state);
                for (const neighbor of neighbors) {
                    const neighborString = this.arrayToString(neighbor);
                    if (closedSet.has(neighborString)) {
                        continue;
                    }
                    if (!openSet.some(item => this.arraysEqual(item.state, neighbor))) {
                        openSet.push({ state: neighbor, priority: this.manhattanDistance(neighbor) });
                        cameFrom.set(neighborString, current.state);
                    }
                }
            }

            return [];
        }

        // Reconstructs the path from the search algorithm
        reconstructPath(cameFrom, current) {
            const path = [current];
            while (cameFrom.has(this.arrayToString(current))) {
                current = cameFrom.get(this.arrayToString(current));
                path.unshift(current);
            }
            return path.slice(1);
        }

        // Gets neighboring states
        getNeighbors(state) {
            const neighbors = [];
            const emptyIndex = state.indexOf(0);
            const row = Math.floor(emptyIndex / this.size);
            const col = emptyIndex % this.size;

            const directions = [
                { rowOffset: -1, colOffset: 0 },
                { rowOffset: 1, colOffset: 0 },
                { rowOffset: 0, colOffset: -1 },
                { rowOffset: 0, colOffset: 1 }
            ];

            directions.forEach(({ rowOffset, colOffset }) => {
                const newRow = row + rowOffset;
                const newCol = col + colOffset;
                if (newRow >= 0 && newRow < this.size && newCol >= 0 && newCol < this.size) {
                    const newIndex = newRow * this.size + newCol;
                    const newState = state.slice();
                    [newState[emptyIndex], newState[newIndex]] = [newState[newIndex], newState[emptyIndex]];
                    neighbors.push(newState);
                }
            });

            return neighbors;
        }

        // Calculates the Manhattan distance heuristic
        manhattanDistance(state) {
            let distance = 0;
            state.forEach((value, i) => {
                if (value !== 0) {
                    const correctPosition = value - 1;
                    const currentRow = Math.floor(i / this.size);
                    const currentCol = i % this.size;
                    const correctRow = Math.floor(correctPosition / this.size);
                    const correctCol = correctPosition % this.size;
                    distance += Math.abs(currentRow - correctRow) + Math.abs(currentCol - correctCol);
                }
            });
            return distance;
        }

        // Checks if two arrays are equal
        arraysEqual(a, b) {
            return a.length === b.length && a.every((val, index) => val === b[index]);
        }

        // Converts an array to a string
        arrayToString(array) {
            return array.join(',');
        }

        // Handles keydown events
        handleKeydown(event) {
            if (this.gameWon) return;

            if (this.handleOverlayKeys(event)) return;
            if (this.handlePauseKey(event)) return;
            if (this.handleGameControls(event)) return;

            this.handleTileMovement(event);
        }

        // Handles overlay-related key events
        handleOverlayKeys(event) {
            if (event.key === '?') {
                this.toggleShortcutOverlay();
                event.preventDefault();
                return true;
            }
            if (event.key === 'Escape') {
                if (OverlayManager.currentOverlay && OverlayManager.currentOverlay !== 'gameOverOverlay') {
                    if (OverlayManager.currentOverlay === 'shortcutOverlay') {
                        this.toggleShortcutOverlay();
                    } else if (OverlayManager.currentOverlay === 'pauseOverlay') {
                        this.togglePauseGame();
                    } else {
                        OverlayManager.hide(OverlayManager.currentOverlay);
                    }
                    event.preventDefault();
                    return true;
                }
            }
            return false;
        }
        

        // Handles pause key events
        handlePauseKey(event) {
            if (event.key.toLowerCase() === 'x') {
                this.togglePauseGame();
                event.preventDefault();
                return true;
            }
            return false;
        }

        // Handles game control keys
        handleGameControls(event) {
            switch (event.key.toLowerCase()) {
                case 'a':
                    this.newGame();
                    event.preventDefault();
                    return true;
                case 's':
                    this.solveStep();
                    event.preventDefault();
                    return true;
                case 'f':
                    this.openSolverLink();
                    event.preventDefault();
                    return true;
            }
            return false;
        }

        // Handles tile movement keys
        handleTileMovement(event) {
            if (this.gamePaused || this.shortcutOverlayOpen) return;

            let emptyIndex = this.board.indexOf(0);
            const row = Math.floor(emptyIndex / this.size);
            const col = emptyIndex % this.size;
            let targetRow = row;
            let targetCol = col;
            let rowOffset = 0;
            let colOffset = 0;

            switch (event.key) {
                case 'ArrowUp':
                    rowOffset = 1;
                    event.preventDefault();
                    break;
                case 'ArrowDown':
                    rowOffset = -1;
                    event.preventDefault();
                    break;
                case 'ArrowLeft':
                    colOffset = 1;
                    event.preventDefault();
                    break;
                case 'ArrowRight':
                    colOffset = -1;
                    event.preventDefault();
                    break;
                default:
                    return;
            }

            if ((rowOffset !== 0 || colOffset !== 0) && event.shiftKey) {
                while (true) {
                    const newRow = targetRow + rowOffset;
                    const newCol = targetCol + colOffset;

                    if (newRow < 0 || newRow >= this.size || newCol < 0 || newCol >= this.size) {
                        break;
                    }

                    const newIndex = newRow * this.size + newCol;
                    [this.board[emptyIndex], this.board[newIndex]] = [this.board[newIndex], this.board[emptyIndex]];
                    emptyIndex = newIndex;
                    targetRow = newRow;
                    targetCol = newCol;
                }
            } else if (rowOffset !== 0 || colOffset !== 0) {
                const newRow = targetRow + rowOffset;
                const newCol = targetCol + colOffset;

                if (newRow < 0 || newRow >= this.size || newCol < 0 || newCol >= this.size) {
                    return;
                }

                const newIndex = newRow * this.size + newCol;
                [this.board[emptyIndex], this.board[newIndex]] = [this.board[newIndex], this.board[emptyIndex]];
            } else {
                return;
            }

            this.renderBoard();
            this.moveCount++;
            this.updateMoveCounter();
            this.vibrateOnTouch();

            if (!this.timerInterval) {
                this.startTimer();
            }

            if (this.isGameWon()) {
                this.endGame();
            }
        }

        // Toggles the shortcut overlay
        toggleShortcutOverlay() {
            if (this.shortcutOverlayOpen) {
                OverlayManager.hide('shortcutOverlay');
                this.shortcutOverlayOpen = false;
                if (!this.gamePaused) {
                    this.startTimer();
                }
            } else {
                OverlayManager.show('shortcutOverlay');
                this.shortcutOverlayOpen = true;
                this.pauseTimer();
            }
        }

        // Toggles the pause overlay
        togglePauseGame() {
            if (this.gamePaused) { // if (OverlayManager.currentOverlay === 'pauseOverlay')
                OverlayManager.hide('pauseOverlay');
                this.gamePaused = false;
                this.startTimer();
            } else {
                OverlayManager.show('pauseOverlay');
                this.gamePaused = true;
                this.pauseTimer();
            }
        }

        // Opens the solver link
        openSolverLink() {
            const solverLink = document.getElementById('solverLink');
            if (solverLink) {
                window.open(solverLink.href, '_blank');
            }
        }

        // Shares the game
        shareGame() {
            const currentUrl = window.location.origin + window.location.pathname;
            const hexBoard = this.boardToHex(this.initialBoard);
            const shareUrl = `${currentUrl}?board=${hexBoard}`;

            const totalMoves = this.moveCount;
            const totalTime = Math.floor(this.finalTime);
            const totalScore = totalMoves + totalTime;

            const shareMessage = `15-Puzzle Stats: ${totalScore} (${totalMoves} moves + ${totalTime}s)\nCan you beat ${totalScore}?\n${shareUrl}`;

            if (navigator.share) {
                navigator.share({
                    title: '15-Puzzle Challenge',
                    text: `15-Puzzle Stats: ${totalScore} (${totalMoves} moves + ${totalTime}s)\nCan you beat ${totalScore}?`,
                    url: shareUrl,
                })
                .then(() => {
                    this.showTemporaryMessage("Shared!");
                })
                .catch((error) => {
                    console.error('Error sharing:', error);
                    alert("Failed to share the game stats. Please try again.");
                });
            } else {
                navigator.clipboard.writeText(shareMessage).then(() => {
                    this.showTemporaryMessage("Copied to clipboard!");
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                    alert("Failed to copy the message. Please copy it manually.");
                });
            }
        }

        // Displays a temporary message
        showTemporaryMessage(message) {
            const messageDiv = document.getElementById('shareMessage');
            messageDiv.textContent = message;
            messageDiv.style.display = 'block';

            setTimeout(() => {
                messageDiv.style.display = 'none';
            }, 3000);
        }

        // Adds event listeners
        addEventListeners() {
            // Buttons
            document.getElementById('newGameButton').addEventListener('click', this.newGame);
            document.getElementById('solveButton').addEventListener('click', this.solveStep);

            // Overlay buttons
            const overlayButtons = document.querySelectorAll('.overlayButton');
            overlayButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    const overlayId = event.target.getAttribute('data-overlay');
                    if (overlayId) {
                        OverlayManager.hide(overlayId);
                    }
                });
            });

            // Close overlay links
            const closeLinks = document.querySelectorAll('.close button');
            closeLinks.forEach(link => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    const overlayId = event.target.getAttribute('data-overlay');
                    if (overlayId) {
                        if (overlayId === 'shortcutOverlay') {
                            this.toggleShortcutOverlay();
                        } else if (overlayId === 'pauseOverlay') {
                            this.togglePauseGame();
                        } else {
                            OverlayManager.hide(overlayId);
                        }
                    }
                });
            });

            // Keydown event
            document.addEventListener('keydown', this.handleKeydown);

            // Share button
            const shareButton = document.querySelector('#gameOverOverlay .overlayButton');
            if (shareButton) {
                shareButton.addEventListener('click', this.shareGame);
            }
        }
    }

    // Overlay Manager
    const OverlayManager = {
        currentOverlay: null,

        show(overlayId) {
            this.hideAll();
            const overlay = document.getElementById(overlayId);
            if (overlay) {
                overlay.style.display = 'flex';
                this.currentOverlay = overlayId;
            }
        },

        hide(overlayId) {
            const overlay = document.getElementById(overlayId);
            if (overlay) {
                overlay.style.display = 'none';
                if (this.currentOverlay === overlayId) {
                    this.currentOverlay = null;
                }
            }
        },

        hideAll() {
            document.querySelectorAll('.overlay').forEach(overlay => {
                overlay.style.display = 'none';
            });
            this.currentOverlay = null;
        }
    };

    // Instantiate and initialize the game
    const game = new PuzzleGame(4);
    game.initializeGame();

})();
