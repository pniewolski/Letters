/**
 * @file board.js
 * @description Plansza: budowa siatki, rysowanie stanu i układanie klocków
 * (przeciąganiem myszą albo dotknięciami na telefonie).
 *
 * Rozmiar planszy, premie i kolory pól biorą się **wyłącznie** z trybu gry
 * przysłanego przez serwer — front nie zna żadnych reguł na pamięć.
 */

import { el, $$ } from '../ui.js';
import { store, canPlay, touch } from '../store.js';
import { showBlankModal } from './blank.js';
import { sendPreview } from './preview.js';

/** Znak pola planszy → klasa CSS i podpis. */
const CELL_STYLES = {
    '2': { cls: 'bonus-w2', label: '2×S', title: 'Podwójna wartość słowa' },
    '3': { cls: 'bonus-w3', label: '3×S', title: 'Potrójna wartość słowa' },
    '4': { cls: 'bonus-w4', label: '4×S', title: 'Poczwórna wartość słowa' },
    'd': { cls: 'bonus-l2', label: '2×L', title: 'Podwójna wartość litery' },
    't': { cls: 'bonus-l3', label: '3×L', title: 'Potrójna wartość litery' },
    'q': { cls: 'bonus-l4', label: '4×L', title: 'Poczwórna wartość litery' },
    '@': { cls: 'cell-start', label: '', title: 'Pole startowe' },
};

let boardEl = null;
let builtSignature = '';

/**
 * Zwraca liczbę punktów za literę wg trybu bieżącej partii.
 * @param {string} letter - Litera
 * @param {boolean} [isBlank=false] - Czy to blank
 * @returns {number}
 */
export function pointsOf(letter, isBlank = false) {
    const variant = store.game?.variant;
    if (!variant) return 0;
    if (isBlank) return variant.letterPoints[variant.blankSymbol] || 0;
    return variant.letterPoints[String(letter || '').toUpperCase()] || 0;
}

/**
 * Buduje siatkę planszy (tylko gdy zmienił się tryb albo rozmiar).
 * @param {HTMLElement} container - Element, w którym ma powstać plansza
 * @returns {HTMLElement} Element planszy
 */
export function buildBoard(container) {
    const variant = store.game?.variant;
    if (!variant) return container;

    const signature = `${variant.slug}:${variant.size}:${variant.grid.join('')}`;
    if (boardEl && builtSignature === signature && container.contains(boardEl)) return boardEl;

    builtSignature = signature;
    const size = variant.size;

    applyVariantColors(variant);

    const cols = el('div', { class: 'col-labels' });
    const rows = el('div', { class: 'row-labels' });
    for (let i = 0; i < size; i++) {
        cols.append(el('div', { class: 'coord-label' }, columnLabel(i)));
        rows.append(el('div', { class: 'coord-label' }, String(i + 1)));
    }

    boardEl = el('div', { class: 'board', id: 'board' });

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const code = variant.grid[y][x];
            const style = CELL_STYLES[code];

            const cell = el('div', {
                class: `cell ${style ? style.cls : ''}`,
                dataset: { x, y },
                title: style ? style.title : '',
            });
            if (style && style.label) cell.dataset.bonusLabel = style.label;

            cell.addEventListener('dragover', onCellDragOver);
            cell.addEventListener('dragleave', e => e.currentTarget.classList.remove('drop-target'));
            cell.addEventListener('drop', onCellDrop);
            cell.addEventListener('click', () => onCellTap(x, y));

            boardEl.append(cell);
        }
    }

    const wrap = el('div', { class: 'board-wrap' },
        el('div', { class: 'board-corner' }), cols, rows, boardEl);
    wrap.style.setProperty('--board-cells', String(size));

    container.replaceChildren(wrap);
    return boardEl;
}

/**
 * Etykieta kolumny: A–Z, potem AA, AB… (dla plansz szerszych niż 26 pól).
 * @param {number} index - Numer kolumny (0-based)
 * @returns {string}
 */
export function columnLabel(index) {
    let out = '';
    let n = index;
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
}

/**
 * Współrzędne w zapisie szachowym, np. `H8`.
 * @param {number} x - Kolumna
 * @param {number} y - Wiersz
 * @returns {string}
 */
export function coordLabel(x, y) {
    return `${columnLabel(x)}${y + 1}`;
}

/**
 * Przenosi kolory trybu do zmiennych CSS.
 * @param {object} variant - Tryb gry z serwera
 */
function applyVariantColors(variant) {
    const map = {
        '--cell-normal': variant.colors.normal,
        '--cell-start': variant.colors.start,
        '--cell-w2': variant.colors.word2,
        '--cell-w3': variant.colors.word3,
        '--cell-w4': variant.colors.word4,
        '--cell-l2': variant.colors.letter2,
        '--cell-l3': variant.colors.letter3,
        '--cell-l4': variant.colors.letter4,
        '--tile-bg': variant.colors.tile,
        '--tile-current-bg': variant.colors.tileCurrent,
        '--tile-text': variant.colors.tileText,
    };
    for (const [key, value] of Object.entries(map)) {
        if (value) document.documentElement.style.setProperty(key, value);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RYSOWANIE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wpisuje literę do pola razem z jej wartością punktową.
 * @param {HTMLElement} cell
 * @param {string} letter
 * @param {boolean} isBlank
 */
function paintLetter(cell, letter, isBlank) {
    cell.replaceChildren(document.createTextNode(letter));
    const points = pointsOf(letter, isBlank);
    if (points > 0) cell.append(el('span', { class: 'letter-pts' }, String(points)));
}

/**
 * Rysuje aktualny stan planszy: litery leżące, klocki układane w tej turze,
 * podpowiedzi i podgląd ruchów przeciwników.
 */
export function renderBoard() {
    const game = store.game;
    if (!game || !boardEl) return;

    const size = game.variant.size;
    const cells = boardEl.children;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const cell = cells[y * size + x];
            cell.classList.remove('has-letter', 'has-current', 'is-blank', 'preview-dot', 'drop-target', 'cell-selected', 'hint-cell');
            cell.replaceChildren();
            cell.draggable = false;
            cell.onclick = null;      // uchwyt dotknięcia dokładamy tylko klockom z tej tury
            cell.ondragstart = null;
            cell.ondragend = null;
            cell.style.cursor = '';
            cell.style.opacity = '';

            const tile = game.board[x][y];
            if (tile.letter) {
                cell.classList.add('has-letter');
                if (tile.isBlank) cell.classList.add('is-blank');
                paintLetter(cell, tile.letter, tile.isBlank);
            } else if (store.selected) {
                cell.style.cursor = 'pointer';
            }
        }
    }

    // Podgląd tego, co układają inni (bez ujawniania liter).
    for (const [, tiles] of store.previews) {
        for (const t of tiles) {
            const cell = cells[t.y * size + t.x];
            if (cell && !cell.classList.contains('has-letter')) cell.classList.add('preview-dot');
        }
    }

    // Podświetlenie najechanej podpowiedzi.
    if (store.hints?.highlight) {
        for (const t of store.hints.highlight) {
            const cell = cells[t.y * size + t.x];
            if (cell) cell.classList.add('hint-cell');
        }
    }

    // Klocki położone w tej turze — można je przesuwać i cofać.
    for (const placed of store.placed) {
        const cell = cells[placed.y * size + placed.x];
        if (!cell) continue;

        cell.classList.add('has-current');
        if (placed.isBlank) cell.classList.add('is-blank');
        paintLetter(cell, placed.letter, placed.isBlank);

        const sel = store.selected;
        if (sel && sel.from === 'board' && sel.x === placed.x && sel.y === placed.y) {
            cell.classList.add('cell-selected');
        }

        cell.draggable = true;
        cell.style.cursor = 'grab';
        cell.title = 'Przeciągnij, żeby przenieść. Dotknij dwa razy, żeby zabrać z powrotem.';
        cell.ondragstart = (e) => {
            store.drag = { from: 'board', ...placed };
            e.dataTransfer.effectAllowed = 'move';
            cell.style.opacity = '0.5';
        };
        cell.ondragend = () => {
            cell.style.opacity = '1';
            store.drag = null;
            $$('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// UKŁADANIE KLOCKÓW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Czy pole jest wolne (brak litery leżącej i brak klocka z tej tury).
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isCellFree(x, y) {
    const game = store.game;
    if (!game) return false;
    if (game.board[x][y].letter) return false;
    return !store.placed.some(p => p.x === x && p.y === y);
}

/**
 * Kładzie klocek ze stojaka na planszy.
 * @param {number} rackIndex - Indeks litery na stojaku
 * @param {string} letter - Litera (dla blanka: litera wybrana przez gracza)
 * @param {number} x
 * @param {number} y
 * @param {boolean} isBlank
 */
export function placeTile(rackIndex, letter, x, y, isBlank) {
    store.placed.push({ letter: letter.toUpperCase(), x, y, isBlank, rackIndex });
    afterChange();
}

/**
 * Przenosi już położony klocek na inne wolne pole.
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 */
export function movePlaced(fromX, fromY, toX, toY) {
    const tile = store.placed.find(p => p.x === fromX && p.y === fromY);
    if (!tile || !isCellFree(toX, toY)) return;
    tile.x = toX;
    tile.y = toY;
    afterChange();
}

/**
 * Zabiera klocek z planszy z powrotem na stojak.
 * @param {number} x
 * @param {number} y
 */
export function recallTile(x, y) {
    store.placed = store.placed.filter(p => !(p.x === x && p.y === y));
    afterChange();
}

/** Zdejmuje z planszy wszystkie klocki z bieżącej tury. */
export function recallAll() {
    store.placed = [];
    store.selected = null;
    afterChange();
}

/** Powiadamia o zmianie układu i wysyła podgląd przeciwnikom. */
function afterChange() {
    touch('placed');
    sendPreview();
}

// ─────────────────────────────────────────────────────────────────────────────
// ZDARZENIA POLA
// ─────────────────────────────────────────────────────────────────────────────

function onCellDragOver(e) {
    const drag = store.drag;
    if (!drag) return;
    if (drag.from === 'rack' && !canPlay()) return;

    const cell = e.currentTarget;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);

    if (isCellFree(x, y)) {
        e.preventDefault();
        cell.classList.add('drop-target');
        e.dataTransfer.dropEffect = 'move';
    }
}

function onCellDrop(e) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drop-target');

    // Dane przeciąganego klocka zapamiętujemy lokalnie: okno wyboru litery dla
    // blanka jest asynchroniczne, a `dragend` zdąży wyzerować `store.drag`.
    const drag = store.drag;
    if (!drag) return;

    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (!isCellFree(x, y)) return;

    if (drag.from === 'board') {
        movePlaced(drag.x, drag.y, x, y);
        return;
    }
    if (!canPlay()) return;

    dropFromRack(drag, x, y);
}

/**
 * Reakcja na dotknięcie pola (tryb dotykowy: dotknij klocek, dotknij pole).
 * @param {number} x
 * @param {number} y
 */
function onCellTap(x, y) {
    const sel = store.selected;
    if (!sel || !isCellFree(x, y)) return;

    if (sel.from === 'board') {
        store.selected = null;
        movePlaced(sel.x, sel.y, x, y);
        return;
    }
    if (!canPlay()) return;

    store.selected = null;
    dropFromRack(sel, x, y);
}

/**
 * Kładzie klocek ze stojaka — dla blanka najpierw pyta o literę.
 * @param {object} source - `{ rackIndex, letter }`
 * @param {number} x
 * @param {number} y
 */
function dropFromRack(source, x, y) {
    const blankSymbol = store.game.variant.blankSymbol;
    if (source.letter === blankSymbol) {
        showBlankModal(chosen => placeTile(source.rackIndex, chosen, x, y, true));
    } else {
        placeTile(source.rackIndex, source.letter, x, y, false);
    }
}

/**
 * Obsługa dotknięcia klocka leżącego na planszy: pierwszy dotyk zaznacza,
 * drugi zabiera na stojak.
 * @param {object} placed - Klocek z `store.placed`
 */
export function tapPlacedTile(placed) {
    const sel = store.selected;
    if (sel && sel.from === 'board' && sel.x === placed.x && sel.y === placed.y) {
        store.selected = null;
        recallTile(placed.x, placed.y);
    } else {
        store.selected = { from: 'board', ...placed };
        touch('selected');
    }
}

/** Podpina obsługę dotknięć położonych klocków (wywoływane po każdym rysowaniu). */
export function bindPlacedTaps() {
    if (!boardEl || !store.game) return;
    const size = store.game.variant.size;

    for (const placed of store.placed) {
        const cell = boardEl.children[placed.y * size + placed.x];
        if (cell) cell.onclick = () => tapPlacedTile(placed);
    }
}

/** Zeruje pamięć zbudowanej planszy (np. przy zmianie stołu). */
export function resetBoard() {
    boardEl = null;
    builtSignature = '';
}
