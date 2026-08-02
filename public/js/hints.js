/**
 * @file hints.js
 * @description Podpowiedzi (najlepsze ruchy). Dostępne w grze z komputerem,
 * a w grze z człowiekiem zależnie od flagi CONFIG.flags.allowHintsVsHuman.
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { wsSend } from './net.js';
import { coordLabel } from './config.js';

/** Prosi serwer o podpowiedzi. */
export function requestHint() {
    wsSend({ type: 'hint', count: 5 });
}

/**
 * Renderuje listę podpowiedzi. Kliknięcie pozycji od razu wykonuje dany ruch.
 * @param {Array<object>} hints
 */
export function showHints(hints) {
    dom.hintBox.classList.remove('hidden');
    dom.hintList.innerHTML = '';

    if (!hints || hints.length === 0) {
        dom.hintList.innerHTML = '<li>Brak dostępnych ruchów</li>';
        return;
    }

    hints.forEach((h) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="hint-pts">${h.points}</span> ${h.wordSimple} (${coordLabel(h.x, h.y)} ${h.horizontal ? '→' : '↓'})`;
        li.onclick = () => applyHint(h);
        dom.hintList.appendChild(li);
    });
}

/**
 * Wykonuje podpowiedziany ruch — buduje litery do dołożenia (pomijając pola
 * już zajęte) i wysyła makeMove.
 * @param {object} hint
 */
export function applyHint(hint) {
    state.placedTiles = [];
    const board = state.gameState.board;
    const myStack = state.gameState.myStack || [];

    const tiles = [];
    for (let i = 0; i < hint.wordSimple.length; i++) {
        const x = hint.horizontal ? hint.x + i : hint.x;
        const y = hint.horizontal ? hint.y : hint.y + i;
        if (!board[x][y].letter) {
            const letter = hint.wordSimple[i];
            const isBlank = hint.usedLetters?.includes('*') && !myStack.includes(letter);
            tiles.push({ letter, x, y, isBlank: !!isBlank });
        }
    }

    wsSend({ type: 'makeMove', tiles });
    dom.hintBox.classList.add('hidden');
}

