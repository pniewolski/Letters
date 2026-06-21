/**
 * @file board.js
 * @description Plansza 15x15: budowa, renderowanie i obsługa drag&drop.
 *
 * Naprawione zachowania:
 * - klocki położone w bieżącej turze można PRZESUWAĆ (drag) i COFAĆ (klik / drag na stojak),
 * - nie można układać klocków poza swoją turą (canInteract),
 * - blanki działają: dane przeciąganego klocka są zapamiętywane lokalnie przed
 *   otwarciem modala (wcześniej `dragend` zerował je za wcześnie).
 */

import { dom, $$ } from './dom.js';
import { state, canInteract } from './state.js';
import { CONFIG, pointsOf } from './config.js';
import { showBlankModal } from './blank.js';
import { sendLivePreview } from './livePreview.js';
import { renderGame } from './game.js';

/** Buduje siatkę pól planszy z bonusami wg CONFIG.boardLayout (jednorazowo). */
export function buildBoard() {
    dom.board.innerHTML = '';
    const layout = CONFIG.boardLayout;

    for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;

            const bonus = (layout[x] && layout[x][y]) || { w: 1, l: 1 };
            if (x === 7 && y === 7) cell.classList.add('center');
            if (bonus.w === 2) { cell.classList.add('bonus-w2'); cell.dataset.bonusLabel = '2×S'; }
            if (bonus.w === 3) { cell.classList.add('bonus-w3'); cell.dataset.bonusLabel = '3×S'; }
            if (bonus.l === 2) { cell.classList.add('bonus-l2'); cell.dataset.bonusLabel = '2×L'; }
            if (bonus.l === 3) { cell.classList.add('bonus-l3'); cell.dataset.bonusLabel = '3×L'; }

            cell.addEventListener('dragover', onCellDragOver);
            cell.addEventListener('dragleave', onCellDragLeave);
            cell.addEventListener('drop', onCellDrop);

            dom.board.appendChild(cell);
        }
    }
}

/** Ustawia literę i (opcjonalnie) punkty w polu. */
function setCellLetter(cell, letter, isBlank) {
    cell.textContent = letter;
    const pts = isBlank ? 0 : pointsOf(letter);
    if (pts > 0) {
        const span = document.createElement('span');
        span.className = 'letter-pts';
        span.textContent = pts;
        cell.appendChild(span);
    }
}

/** Renderuje stan planszy: litery stałe + klocki bieżącej tury. */
export function renderBoard() {
    const g = state.gameState;
    if (!g) return;
    const cells = dom.board.children;
    const board = g.board;

    // Reset wszystkich pól (w tym uchwytów zdarzeń — zapobiega „przyklejaniu się").
    for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
            const cell = cells[y * 15 + x];
            cell.classList.remove('has-letter', 'has-current', 'is-blank', 'live-preview-dot', 'drop-target');
            cell.textContent = '';
            cell.onclick = null;
            cell.ondragstart = null;
            cell.ondragend = null;
            cell.draggable = false;
            cell.style.cursor = '';
            cell.style.opacity = '';

            const tile = board[x][y];
            if (tile.letter) {
                cell.classList.add('has-letter');
                if (tile.isBlank) cell.classList.add('is-blank');
                setCellLetter(cell, tile.letter, tile.isBlank);
            }
        }
    }

    // Klocki położone w tej turze — przesuwalne i cofane.
    for (const p of state.placedTiles) {
        const cell = cells[p.y * 15 + p.x];
        cell.classList.add('has-current');
        if (p.isBlank) cell.classList.add('is-blank');
        setCellLetter(cell, p.letter, p.isBlank);

        cell.draggable = true;
        cell.style.cursor = 'grab';
        cell.title = 'Kliknij, aby cofnąć na stojak (lub przeciągnij)';

        cell.onclick = () => recallTile(p.x, p.y);
        cell.ondragstart = (e) => {
            state.drag = { source: 'board', x: p.x, y: p.y, letter: p.letter, isBlank: p.isBlank, rackIndex: p.rackIndex };
            e.dataTransfer.effectAllowed = 'move';
            cell.style.opacity = '0.5';
        };
        cell.ondragend = () => {
            cell.style.opacity = '1';
            state.drag = null;
            $$('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
        };
    }
}

/** Czy pole (x,y) jest wolne (brak litery stałej i brak klocka bieżącego)? */
export function isCellEmpty(x, y) {
    if (state.gameState.board[x][y].letter) return false;
    if (state.placedTiles.some(p => p.x === x && p.y === y)) return false;
    return true;
}

function onCellDragOver(e) {
    const d = state.drag;
    if (!d) return;
    // Z stojaka można kłaść tylko w swojej turze.
    if (d.source === 'rack' && !canInteract()) return;

    const cell = e.currentTarget;
    const x = parseInt(cell.dataset.x, 10);
    const y = parseInt(cell.dataset.y, 10);

    if (isCellEmpty(x, y)) {
        e.preventDefault();
        cell.classList.add('drop-target');
        e.dataTransfer.dropEffect = 'move';
    }
}

function onCellDragLeave(e) {
    e.currentTarget.classList.remove('drop-target');
}

function onCellDrop(e) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drop-target');

    // Zapamiętujemy dane LOKALNIE — modal blanka jest asynchroniczny, a `dragend`
    // wyzerowałby state.drag zanim gracz wybierze literę.
    const d = state.drag;
    if (!d) return;

    const x = parseInt(cell.dataset.x, 10);
    const y = parseInt(cell.dataset.y, 10);
    if (!isCellEmpty(x, y)) return;

    if (d.source === 'board') {
        // Przeniesienie już położonego klocka w nowe miejsce.
        movePlacedTile(d.x, d.y, x, y);
        return;
    }

    // Z stojaka — tylko w swojej turze.
    if (!canInteract()) return;

    if (d.letter === '*') {
        showBlankModal((chosenLetter) => placeTile(d.rackIndex, chosenLetter, x, y, true));
    } else {
        placeTile(d.rackIndex, d.letter, x, y, false);
    }
}

/** Dokłada klocek ze stojaka na pole. */
export function placeTile(rackIndex, letter, x, y, isBlank) {
    state.placedTiles.push({ letter, x, y, isBlank, rackIndex });
    renderGame();
    sendLivePreview();
}

/** Przenosi już położony klocek na inne wolne pole. */
export function movePlacedTile(oldX, oldY, newX, newY) {
    const tile = state.placedTiles.find(t => t.x === oldX && t.y === oldY);
    if (!tile) return;
    tile.x = newX;
    tile.y = newY;
    renderGame();
    sendLivePreview();
}

/** Cofa klocek z pola z powrotem na stojak. */
export function recallTile(x, y) {
    state.placedTiles = state.placedTiles.filter(t => !(t.x === x && t.y === y));
    renderGame();
    sendLivePreview();
}


