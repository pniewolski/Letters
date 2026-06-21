/**
 * @file livePreview.js
 * @description Podgląd na żywo — pokazuje gdzie przeciwnik układa klocki PRZED
 * zatwierdzeniem ruchu. Serwer NIE ujawnia liter, jedynie pozycje pól.
 */

import { dom, $$ } from './dom.js';
import { state } from './state.js';
import { wsSend } from './net.js';

/** Wysyła bieżące ułożenie liter do przeciwnika (tylko pozycje na serwerze). */
export function sendLivePreview() {
    const tiles = state.placedTiles.map(p => ({
        letter: p.letter, x: p.x, y: p.y, isBlank: p.isBlank,
    }));
    wsSend({ type: 'livePreview', tiles });
}

/**
 * Pokazuje na planszy pola, na których przeciwnik aktualnie układa klocki.
 * @param {Array<{x:number,y:number}>} tiles
 */
export function showLivePreview(tiles) {
    clearLivePreview();
    if (!tiles || tiles.length === 0) {
        dom.livePreviewInfo.classList.add('hidden');
        return;
    }
    dom.livePreviewInfo.classList.remove('hidden');
    dom.liveDots.textContent = `${tiles.length} klock(i) na planszy`;

    const cells = dom.board.children;
    for (const t of tiles) {
        const idx = t.y * 15 + t.x;
        if (cells[idx]) cells[idx].classList.add('live-preview-dot');
    }
}

/** Czyści oznaczenia podglądu na żywo. */
export function clearLivePreview() {
    $$('.cell.live-preview-dot').forEach(c => c.classList.remove('live-preview-dot'));
    dom.livePreviewInfo.classList.add('hidden');
}

