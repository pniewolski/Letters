/**
 * @file rack.js
 * @description Renderowanie stojaka z literami: tryb gry (drag&drop, wymiana)
 * oraz tryb widza (obie podstawki, tylko podgląd). Stojak jest też strefą
 * upuszczania — przeciągnięcie klocka z planszy z powrotem cofa go.
 */

import { dom } from './dom.js';
import { state, canInteract } from './state.js';
import { pointsOf } from './config.js';
import { renderGame } from './game.js';
import { sendLivePreview } from './livePreview.js';

/**
 * Tworzy element pojedynczego klocka.
 * @param {string} letter
 * @param {number} index - indeks na stojaku
 * @returns {HTMLElement}
 */
function makeTile(letter, index) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.rackIndex = index;
    tile.dataset.letter = letter;

    if (letter === '*') {
        tile.classList.add('blank-tile');
        tile.textContent = '★';
    } else {
        tile.textContent = letter;
        const pts = pointsOf(letter);
        if (pts > 0) {
            const span = document.createElement('span');
            span.className = 'tile-pts';
            span.textContent = pts;
            tile.appendChild(span);
        }
    }
    return tile;
}

/** Renderuje stojak(i) zależnie od trybu (gra / widz). */
export function renderRack() {
    const g = state.gameState;
    dom.rack.innerHTML = '';
    dom.rack2.innerHTML = '';
    if (!g) return;

    // Tryb widza — pokazujemy obie podstawki, bez interakcji.
    if (g.spectator) {
        renderReadonlyRack(dom.rack, g.racks?.[0] || [], g.currentSlot === 0);
        renderReadonlyRack(dom.rack2, g.racks?.[1] || [], g.currentSlot === 1);
        return;
    }

    if (!g.myStack) return;

    const usedIndices = new Set(state.placedTiles.map(p => p.rackIndex));
    const interactive = canInteract();

    g.myStack.forEach((letter, i) => {
        if (usedIndices.has(i)) return; // klocek jest na planszy

        const tile = makeTile(letter, i);

        if (state.exchangeMode) {
            // Tryb wymiany — klik zaznacza/odznacza.
            tile.draggable = false;
            if (state.selectedForExchange.has(i)) tile.classList.add('selected');
            tile.onclick = () => {
                if (state.selectedForExchange.has(i)) state.selectedForExchange.delete(i);
                else state.selectedForExchange.add(i);
                renderRack();
            };
        } else if (interactive) {
            // Można przeciągać tylko w swojej turze.
            tile.draggable = true;
            tile.addEventListener('dragstart', (e) => onRackTileDragStart(e, i, letter));
            tile.addEventListener('dragend', onRackTileDragEnd);
        } else {
            tile.draggable = false;
            tile.classList.add('disabled');
        }

        dom.rack.appendChild(tile);
    });
}

/**
 * Renderuje podstawkę tylko do podglądu (tryb widza).
 * @param {HTMLElement} container
 * @param {string[]} letters
 * @param {boolean} active - czy ten gracz jest na ruchu (podświetlenie)
 */
function renderReadonlyRack(container, letters, active) {
    container.classList.toggle('active-turn', !!active);
    letters.forEach((letter, i) => {
        const tile = makeTile(letter, i);
        tile.draggable = false;
        container.appendChild(tile);
    });
}

function onRackTileDragStart(e, index, letter) {
    state.drag = { source: 'rack', rackIndex: index, letter };
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function onRackTileDragEnd(e) {
    e.target.style.opacity = '1';
    state.drag = null;
    document.querySelectorAll('.cell.drop-target').forEach(c => c.classList.remove('drop-target'));
}

/**
 * Inicjalizuje stojak jako strefę upuszczania — przeciągnięcie klocka z planszy
 * na stojak cofa go (recall). Wywoływane raz przy starcie.
 */
export function initRackDropZone() {
    dom.rack.addEventListener('dragover', (e) => {
        if (state.drag && state.drag.source === 'board') {
            e.preventDefault();
            dom.rack.classList.add('rack-drop');
        }
    });
    dom.rack.addEventListener('dragleave', () => dom.rack.classList.remove('rack-drop'));
    dom.rack.addEventListener('drop', (e) => {
        dom.rack.classList.remove('rack-drop');
        const d = state.drag;
        if (d && d.source === 'board') {
            e.preventDefault();
            state.placedTiles = state.placedTiles.filter(t => !(t.x === d.x && t.y === d.y));
            renderGame();
            sendLivePreview();
        }
    });
}

