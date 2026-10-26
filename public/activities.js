// ==========================================================================
// ACTIVITIES & MINI-GAMES MODULE
// ==========================================================================

(() => {
    // --- Elements ---
    const activitiesBtn = document.getElementById('activitiesBtn');
    const activitiesModal = document.getElementById('activitiesModal');
    const closeActivitiesBtn = document.getElementById('closeActivitiesBtn');
    const tabs = document.querySelectorAll('.activity-tab');
    const views = {
        tictactoe: document.getElementById('viewTictactoe'),
        doodle: document.getElementById('viewDoodle')
    };

    // --- Modal Navigation ---
    if (activitiesBtn && activitiesModal) {
        activitiesBtn.addEventListener('click', () => {
            activitiesModal.classList.remove('hidden');
        });
    }

    if (closeActivitiesBtn && activitiesModal) {
        closeActivitiesBtn.addEventListener('click', () => {
            activitiesModal.classList.add('hidden');
        });
    }

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && activitiesModal && !activitiesModal.classList.contains('hidden')) {
            activitiesModal.classList.add('hidden');
        }
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            Object.keys(views).forEach(k => {
                if (views[k]) {
                    if (k === target) {
                        views[k].classList.remove('hidden');
                    } else {
                        views[k].classList.add('hidden');
                    }
                }
            });
            if (target === 'doodle') {
                resizeDoodleCanvas();
            }
        });
    });

    // Helper to send game actions over Socket.io
    function emitGame(game, type, payload) {
        const room = window.getCurrentRoom ? window.getCurrentRoom() : '';
        const user = window.getCurrentUser ? window.getCurrentUser() : 'Anonymous';
        if (window.appSocket && room) {
            window.appSocket.emit('gameAction', { room, game, type, payload, user });
        }
    }

    // Socket listener for all mini-game events
    if (window.appSocket) {
        window.appSocket.on('gameAction', ({ game, type, payload, user, senderId }) => {
            if (game === 'tictactoe') handleTttAction(type, payload, user, senderId);
            if (game === 'doodle') handleDoodleAction(type, payload, user, senderId);
        });
    }

    // ======================================================================
    // 2. TIC-TAC-TOE (井字棋)
    // ======================================================================
    const tttCells = document.querySelectorAll('.ttt-cell');
    const tttStatus = document.getElementById('tttStatus');
    const tttResetBtn = document.getElementById('tttResetBtn');
    const myScoreEl = document.getElementById('myScore');
    const theirScoreEl = document.getElementById('theirScore');

    let tttBoard = Array(9).fill(null);
    let mySymbol = 'X';
    let currentTurn = 'X';
    let gameOver = false;
    let myScore = 0;
    let theirScore = 0;

    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    tttCells.forEach(cell => {
        cell.addEventListener('click', () => {
            const idx = parseInt(cell.getAttribute('data-index'), 10);
            if (gameOver || tttBoard[idx] || currentTurn !== mySymbol) return;

            emitGame('tictactoe', 'move', { index: idx, symbol: mySymbol });
        });
    });

    if (tttResetBtn) {
        tttResetBtn.addEventListener('click', () => {
            emitGame('tictactoe', 'reset', {});
        });
    }

    function checkTttWinner() {
        for (const pattern of winPatterns) {
            const [a, b, c] = pattern;
            if (tttBoard[a] && tttBoard[a] === tttBoard[b] && tttBoard[a] === tttBoard[c]) {
                return tttBoard[a];
            }
        }
        if (tttBoard.every(cell => cell !== null)) {
            return 'tie';
        }
        return null;
    }

    function renderTttBoard() {
        tttCells.forEach((cell, idx) => {
            cell.textContent = tttBoard[idx] || '';
            cell.className = 'ttt-cell' + (tttBoard[idx] ? ` ${tttBoard[idx].toLowerCase()}` : '');
            cell.disabled = !!tttBoard[idx] || gameOver || currentTurn !== mySymbol;
        });

        if (gameOver) return;

        if (currentTurn === mySymbol) {
            tttStatus.textContent = `Your Turn (${mySymbol}) - 你的回合`;
            tttStatus.style.color = '#38bdf8';
        } else {
            tttStatus.textContent = `Friend's Turn (${mySymbol === 'X' ? 'O' : 'X'}) - 对方回合`;
            tttStatus.style.color = 'var(--text-secondary)';
        }
    }

    function handleTttAction(type, payload, user, senderId) {
        const isMe = window.appSocket && senderId === window.appSocket.id;

        if (type === 'move') {
            const { index, symbol } = payload;
            tttBoard[index] = symbol;
            const winner = checkTttWinner();

            if (winner) {
                gameOver = true;
                if (winner === 'tie') {
                    tttStatus.textContent = "🤝 Game Drawn! (平局)";
                    tttStatus.style.color = '#facc15';
                } else if (winner === mySymbol) {
                    tttStatus.textContent = "🎉 You Won! (你赢了!)";
                    tttStatus.style.color = '#38bdf8';
                    myScore++;
                    if (myScoreEl) myScoreEl.textContent = myScore;
                } else {
                    tttStatus.textContent = `💀 ${user} Won! (${user} 获胜!)`;
                    tttStatus.style.color = '#f87171';
                    theirScore++;
                    if (theirScoreEl) theirScoreEl.textContent = theirScore;
                }
            } else {
                currentTurn = symbol === 'X' ? 'O' : 'X';
            }
            renderTttBoard();
        } else if (type === 'reset') {
            tttBoard = Array(9).fill(null);
            gameOver = false;
            // Swap symbols on rematch for fairness
            if (!isMe) {
                mySymbol = 'O';
            } else {
                mySymbol = 'X';
            }
            currentTurn = 'X';
            renderTttBoard();
        }
    }

    // Initialize board on load
    renderTttBoard();

    // ======================================================================
    // 3. SYNCED SHARED CANVAS / QUICK DOODLE
    // ======================================================================
    const canvas = document.getElementById('doodleCanvas');
    const colorDots = document.querySelectorAll('.color-dot');
    const eraserBtn = document.getElementById('eraserBtn');
    const clearCanvasBtn = document.getElementById('clearCanvasBtn');

    let ctx = null;
    let isDrawing = false;
    let currentColor = '#f8fafc';
    let currentLineWidth = 3;
    let isEraser = false;
    let lastX = 0;
    let lastY = 0;

    if (canvas) {
        ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    function resizeDoodleCanvas() {
        if (!canvas) return;
        // Keep internal resolution crisp
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            canvas.width = rect.width;
            canvas.height = rect.height;
            if (ctx) {
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
            }
        }
    }

    colorDots.forEach(dot => {
        dot.addEventListener('click', () => {
            colorDots.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            currentColor = dot.getAttribute('data-color') || '#f8fafc';
            isEraser = false;
            currentLineWidth = 3;
            if (eraserBtn) eraserBtn.classList.remove('active');
        });
    });

    if (eraserBtn) {
        eraserBtn.addEventListener('click', () => {
            isEraser = !isEraser;
            if (isEraser) {
                eraserBtn.classList.add('active');
                currentLineWidth = 16;
            } else {
                eraserBtn.classList.remove('active');
                currentLineWidth = 3;
            }
        });
    }

    if (clearCanvasBtn) {
        clearCanvasBtn.addEventListener('click', () => {
            clearCanvas();
            emitGame('doodle', 'clear', {});
        });
    }

    function clearCanvas() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawLine(x0, y0, x1, y1, color, width, emit) {
        if (!ctx) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();

        if (emit) {
            // Normalize coordinates as percentage to handle any screen size/resolution differences
            const w = canvas.width || 1;
            const h = canvas.height || 1;
            emitGame('doodle', 'draw', {
                x0: x0 / w,
                y0: y0 / h,
                x1: x1 / w,
                y1: y1 / h,
                color,
                width
            });
        }
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    if (canvas) {
        const onStart = (e) => {
            isDrawing = true;
            const { x, y } = getCanvasCoords(e);
            lastX = x;
            lastY = y;
        };

        const onMove = (e) => {
            if (!isDrawing) return;
            const { x, y } = getCanvasCoords(e);
            const drawColor = isEraser ? '#030508' : currentColor;
            drawLine(lastX, lastY, x, y, drawColor, currentLineWidth, true);
            lastX = x;
            lastY = y;
        };

        const onEnd = () => {
            isDrawing = false;
        };

        canvas.addEventListener('mousedown', onStart);
        canvas.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        canvas.addEventListener('touchstart', onStart, { passive: true });
        canvas.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd);
    }

    function handleDoodleAction(type, payload, user, senderId) {
        const isMe = window.appSocket && senderId === window.appSocket.id;
        if (isMe) return; // already rendered locally

        if (type === 'draw' && canvas) {
            const w = canvas.width || 1;
            const h = canvas.height || 1;
            drawLine(
                payload.x0 * w,
                payload.y0 * h,
                payload.x1 * w,
                payload.y1 * h,
                payload.color,
                payload.width,
                false
            );
        } else if (type === 'clear') {
            clearCanvas();
        }
    }
})();
