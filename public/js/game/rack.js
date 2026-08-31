/**
 * @file rack.js
 * @description Stojak z literami: przeciąganie na planszę, zmiana kolejności,
 * zaznaczanie liter do wymiany i obsługa dotykowa.
 *
 * Kolejność liter jest wyłącznie sprawą przeglądarki — serwer trzyma stojak
 * po swojemu, a `store.rackOrder` mówi tylko, w jakiej kolejności je pokazujemy.
 */

import { el } from '../ui.js';
import { store, canPlay, touch } from '../store.js';
import { pointsOf } from './board.js';
import { sendPreview } from './preview.js';

/** Sygnatura stojaka — po jej zmianie kolejność ustawiamy od nowa. */
let lastSignature = '';

/**
 * Zwraca kolejność wyświetlania liter (indeksy w `game.myRack`).
 * @returns {number[]}
 */
export function rackOrder() {
    const rack = store.game?.myRack || [];
    const signature = `${rack.length}:${rack.join('')}`;

    if (signature !== lastSignature || !store.rackOrder) {
        lastSignature = signature;
        store.rackOrder = rack.map((_, i) => i);
    }
    return store.rackOrder;
}

/**
 * Przesuwa literę na stojaku (zmiana kolejności wyświetlania).
 * @param {number} fromIndex - Indeks litery w `myRack`
 * @param {number} toIndex - Indeks litery, przed którą ma stanąć
 */
export function reorderRack(fromIndex, toIndex) {
    const order = rackOrder();
    const from = order.indexOf(fromIndex);
    const to = order.indexOf(toIndex);
    if (from === -1 || to === -1 || from === to) return;

    order.splice(to, 0, order.splice(from, 1)[0]);
    touch('rackOrder');
}

/** Ustawia losową kolejność liter — pomaga zobaczyć nowe słowa. */
export function shuffleRack() {
    const order = rackOrder();
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    touch('rackOrder');
}

/**
 * Tworzy element klocka.
 * @param {string} letter - Litera (`*` dla blanka)
 * @param {number} index - Indeks w `myRack`
 * @returns {HTMLElement}
 */
function makeTile(letter, index) {
    const blankSymbol = store.game?.variant?.blankSymbol || '*';
    const isBlank = letter === blankSymbol;

    const tile = el('div', {
        class: `tile ${isBlank ? 'blank-tile' : ''}`,
        dataset: { rackIndex: index, letter },
        title: isBlank ? 'Blank — możesz nim zagrać dowolną literę (0 punktów)' : '',
    }, isBlank ? '★' : letter);

    if (!isBlank) {
        const points = pointsOf(letter);
        if (points > 0) tile.append(el('span', { class: 'tile-pts' }, String(points)));
    }
    return tile;
}

/**
 * Rysuje stojak gracza.
 * @param {HTMLElement} container - Element, w którym ma się pojawić stojak
 */
export function renderRack(container) {
    const game = store.game;
    container.replaceChildren();
    if (!game || !game.myRack) return;

    const order = rackOrder();
    const used = new Set(store.placed.map(p => p.rackIndex));
    const interactive = canPlay();

    for (const index of order) {
        const letter = game.myRack[index];
        if (letter === undefined) continue;      // stojak się skurczył
        if (used.has(index)) {                    // klocek leży już na planszy
            container.append(el('div', { class: 'tile tile-ghost' }));
            continue;
        }

        const tile = makeTile(letter, index);

        if (store.exchangeMode) {
            if (store.exchangeSelection.has(index)) tile.classList.add('selected');
            tile.onclick = () => {
                if (store.exchangeSelection.has(index)) store.exchangeSelection.delete(index);
                else store.exchangeSelection.add(index);
                touch('exchangeMode');
            };
        } else if (interactive) {
            tile.draggable = true;

            tile.addEventListener('dragstart', (e) => {
                store.drag = { from: 'rack', rackIndex: index, letter };
                e.dataTransfer.effectAllowed = 'move';
                tile.style.opacity = '0.5';
            });
            tile.addEventListener('dragend', () => {
                tile.style.opacity = '1';
                store.drag = null;
            });

            // Upuszczenie klocka na inny klocek zmienia ich kolejność.
            tile.addEventListener('dragover', (e) => {
                if (store.drag?.from === 'rack') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
            });
            tile.addEventListener('drop', (e) => {
                if (store.drag?.from !== 'rack') return;
                e.preventDefault();
                e.stopPropagation();
                reorderRack(store.drag.rackIndex, index);
            });

            const sel = store.selected;
            if (sel && sel.from === 'rack' && sel.rackIndex === index) tile.classList.add('tile-selected');

            tile.onclick = () => onTileTap(index, letter);
        } else {
            tile.classList.add('disabled');
        }

        container.append(tile);
    }
}

/**
 * Dotknięcie klocka: zaznacza go, odznacza albo zamienia kolejność
 * z wcześniej zaznaczonym klockiem.
 * @param {number} index
 * @param {string} letter
 */
function onTileTap(index, letter) {
    const sel = store.selected;

    if (sel && sel.from === 'rack' && sel.rackIndex === index) {
        store.selected = null;
    } else if (sel && sel.from === 'rack') {
        reorderRack(sel.rackIndex, index);
        store.selected = null;
    } else {
        store.selected = { from: 'rack', rackIndex: index, letter };
    }
    touch('selected');
}

/**
 * Robi ze stojaka miejsce, na które można upuścić klocek z planszy (cofnięcie).
 * @param {HTMLElement} container - Element stojaka
 */
export function bindRackDropZone(container) {
    container.addEventListener('dragover', (e) => {
        if (store.drag?.from === 'board') {
            e.preventDefault();
            container.classList.add('rack-drop');
        }
    });
    container.addEventListener('dragleave', () => container.classList.remove('rack-drop'));
    container.addEventListener('drop', (e) => {
        container.classList.remove('rack-drop');
        const drag = store.drag;
        if (drag?.from !== 'board') return;
        e.preventDefault();
        store.placed = store.placed.filter(p => !(p.x === drag.x && p.y === drag.y));
        touch('placed');
        sendPreview();
    });

    // Dotykowo: mając zaznaczony klocek z planszy, dotknij stojaka, żeby go cofnąć.
    container.addEventListener('click', (e) => {
        if (e.target.closest('.tile')) return;
        const sel = store.selected;
        if (sel?.from !== 'board') return;

        store.placed = store.placed.filter(p => !(p.x === sel.x && p.y === sel.y));
        store.selected = null;
        touch('placed');
        sendPreview();
    });
}

/**
 * Rysuje stojak innego gracza (widok podglądu symulacji albo koniec partii).
 * @param {HTMLElement} container
 * @param {string[]} letters
 */
export function renderReadonlyRack(container, letters) {
    container.replaceChildren();
    for (const [i, letter] of (letters || []).entries()) {
        const tile = makeTile(letter, i);
        tile.classList.add('disabled');
        container.append(tile);
    }
}
