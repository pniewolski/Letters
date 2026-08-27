/**
 * @file config.js
 * @description Konfiguracja frontendu pobierana z serwera (/api/config).
 * Tytuł, alfabet (dla blanków), punktacja liter, układ bonusów planszy oraz
 * kolory planszy są definiowane po stronie serwera (config.json, layout.json,
 * letters.json) — front ich NIE duplikuje.
 */

/** Konfiguracja (wypełniana przez loadConfig). */
export const CONFIG = {
    title: 'Scrabble',
    alphabet: '',
    /** Mapa litera -> punkty, np. { A:1, Ź:9, '*':0 } */
    letterPoints: {},
    /** Układ bonusów 15x15: [x][y] = { w, l } */
    boardLayout: [],
    /** Kolory planszy (z config.json). */
    boardColors: {},
    /** Flagi funkcjonalne. */
    flags: { allowHintsVsHuman: false },
};

/**
 * Pobiera konfigurację z serwera i wypełnia obiekt CONFIG.
 * @returns {Promise<object>} Załadowana konfiguracja
 */
export async function loadConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Nie udało się pobrać konfiguracji');
    const data = await res.json();
    Object.assign(CONFIG, data);
    CONFIG.flags = data.flags || {};
    return CONFIG;
}

/**
 * Zwraca liczbę punktów za literę (0 dla nieznanych/blanków).
 * @param {string} letter
 * @returns {number}
 */
export function pointsOf(letter) {
    return CONFIG.letterPoints[letter] || 0;
}

/**
 * Zamienia współrzędne (x = kolumna, y = wiersz, oba 0-based) na etykietę
 * w stylu szachowym: kolumna jako litera A–O, wiersz jako liczba 1–15.
 * @param {number} x - kolumna 0..14
 * @param {number} y - wiersz 0..14
 * @returns {string} np. "A5"
 */
export function coordLabel(x, y) {
    const col = String.fromCharCode(65 + x); // A..O
    return `${col}${y + 1}`;
}

/**
 * Aplikuje konfigurację do DOM: ustawia tytuł oraz kolory planszy
 * (jako zmienne CSS na :root, odczytywane przez style.css).
 */
export function applyConfigToDom() {
    document.title = CONFIG.title;
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = CONFIG.title;

    const c = CONFIG.boardColors || {};
    const root = document.documentElement.style;
    const map = {
        '--cell-normal': c.normal,
        '--cell-center': c.center,
        '--cell-w2': c.wordX2,
        '--cell-w3': c.wordX3,
        '--cell-l2': c.letterX2,
        '--cell-l3': c.letterX3,
        '--tile-bg': c.tile,
        '--tile-current-bg': c.tileCurrent,
        '--tile-text': c.tileText,
    };
    for (const [k, v] of Object.entries(map)) {
        if (v) root.setProperty(k, v);
    }
}

