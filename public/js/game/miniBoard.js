/**
 * @file miniBoard.js
 * @description Miniaturka planszy — kolorowa siatka bez liter, używana na
 * kartach trybów gry i w podglądzie edytora. Rysuje dowolny rozmiar planszy.
 */

import { el } from '../ui.js';

/** Znak pola → klasa CSS miniaturki. */
const MINI_CLASS = {
    '2': 'm-w2', '3': 'm-w3', '4': 'm-w4',
    'd': 'm-l2', 't': 'm-l3', 'q': 'm-l4',
    '@': 'm-start',
};

/**
 * Buduje miniaturkę planszy.
 * @param {string[]|null} grid - Siatka trybu (wiersze); `null` = pusta plansza
 * @param {number} size - Bok planszy
 * @param {object} [options]
 * @param {object} [options.colors] - Kolory trybu (nadpisują domyślne)
 * @returns {HTMLElement}
 *
 * @example
 * miniBoard(['3..d', '.2..', '..@.', 'd..3'], 4);
 */
export function miniBoard(grid, size, options = {}) {
    const wrap = el('div', { class: 'mini-board' });
    wrap.style.setProperty('--mini-cells', String(size));

    if (options.colors) {
        const map = {
            '--m-normal': options.colors.normal,
            '--m-start': options.colors.start,
            '--m-w2': options.colors.word2,
            '--m-w3': options.colors.word3,
            '--m-w4': options.colors.word4,
            '--m-l2': options.colors.letter2,
            '--m-l3': options.colors.letter3,
            '--m-l4': options.colors.letter4,
        };
        for (const [key, value] of Object.entries(map)) {
            if (value) wrap.style.setProperty(key, value);
        }
    }

    for (let y = 0; y < size; y++) {
        const row = grid && grid[y] ? grid[y] : '';
        for (let x = 0; x < size; x++) {
            const code = row[x] || '.';
            wrap.append(el('span', { class: `mini-cell ${MINI_CLASS[code] || ''}` }));
        }
    }
    return wrap;
}
