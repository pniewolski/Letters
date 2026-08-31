/**
 * @file preview.js
 * @description Podgląd na żywo — pokazuje pozostałym graczom, na których polach
 * układamy klocki, zanim zatwierdzimy ruch. Serwer przekazuje dalej wyłącznie
 * współrzędne; litery zostają tajemnicą do momentu zagrania.
 */

import { send } from '../net.js';
import { store, touch } from '../store.js';

let lastSent = '';

/** Wysyła bieżące ułożenie klocków (bez liter). */
export function sendPreview() {
    if (!store.game || store.game.mySlot == null) return;

    const tiles = store.placed.map(p => ({ x: p.x, y: p.y, isBlank: !!p.isBlank }));
    const signature = tiles.map(t => `${t.x},${t.y}`).join(';');

    // Bez zmian nie ma po co zajmować łącza — układanie klocków generuje
    // dużo drobnych zdarzeń.
    if (signature === lastSent) return;
    lastSent = signature;

    send('game:preview', { tiles });
}

/**
 * Zapisuje podgląd otrzymany od innego gracza.
 * @param {number} slot - Numer miejsca nadawcy
 * @param {Array<{x: number, y: number}>} tiles - Zajmowane pola
 */
export function receivePreview(slot, tiles) {
    if (!tiles || tiles.length === 0) store.previews.delete(slot);
    else store.previews.set(slot, tiles);
    touch('previews');
}

/** Czyści wszystkie podglądy (po ruchu albo zmianie stołu). */
export function clearPreviews() {
    if (store.previews.size === 0) return;
    store.previews.clear();
    touch('previews');
}

/** Zeruje pamięć ostatnio wysłanego układu (przy zmianie stołu). */
export function resetPreviewCache() {
    lastSent = '';
}
