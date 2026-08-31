/**
 * @file router.js
 * @description Prosty router oparty na kotwicy adresu (`#/lobby`). Każdy ekran
 * to funkcja `(host, params) => cleanup`, a router pilnuje, żeby poprzedni
 * ekran posprzątał po sobie nasłuchy przed narysowaniem następnego.
 *
 * @example
 * registerRoutes({ '/lobby': lobbyScreen, '/gracz/:name': profileScreen });
 * navigate('/lobby');
 */

import { el, fill } from './ui.js';

/** @type {Array<{pattern: string, parts: string[], screen: Function}>} */
const routes = [];

/** @type {Function|null} Sprzątanie po bieżącym ekranie. */
let cleanup = null;

/** @type {HTMLElement|null} */
let host = null;

/** @type {string} Aktualna ścieżka. */
let currentPath = '';

/**
 * Rejestruje trasy.
 * @param {Object<string, Function>} map - Mapa wzorzec → ekran
 *   (segment zaczynający się od `:` to parametr)
 */
export function registerRoutes(map) {
    for (const [pattern, screen] of Object.entries(map)) {
        routes.push({ pattern, parts: pattern.split('/').filter(Boolean), screen });
    }
}

/**
 * Uruchamia router.
 * @param {HTMLElement} container - Element, w którym rysują się ekrany
 * @param {string} [fallback='/'] - Trasa domyślna
 */
export function startRouter(container, fallback = '/') {
    host = container;
    window.addEventListener('hashchange', () => render(fallback));
    render(fallback);
}

/**
 * Przechodzi do wskazanej ścieżki.
 * @param {string} path - Np. `/lobby`
 * @param {boolean} [replace=false] - Czy podmienić wpis w historii
 */
export function navigate(path, replace = false) {
    const target = `#${path.startsWith('/') ? path : '/' + path}`;
    if (location.hash === target) { render(); return; }
    if (replace) location.replace(target);
    else location.hash = target;
}

/**
 * Ścieżka wyświetlana w tej chwili.
 * @returns {string}
 */
export function currentRoute() {
    return currentPath;
}

/** Przerysowuje bieżący ekran od zera. */
export function refresh() {
    render();
}

/**
 * Dopasowuje ścieżkę do zarejestrowanych tras.
 * @param {string} path
 * @returns {{screen: Function, params: object}|null}
 */
function match(path) {
    const parts = path.split('/').filter(Boolean);

    for (const route of routes) {
        if (route.parts.length !== parts.length) continue;

        const params = {};
        let hit = true;
        for (let i = 0; i < route.parts.length; i++) {
            const expected = route.parts[i];
            if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(parts[i]);
            else if (expected !== parts[i]) { hit = false; break; }
        }
        if (hit) return { screen: route.screen, params };
    }
    return null;
}

/**
 * Rysuje ekran pasujący do adresu.
 * @param {string} [fallback='/']
 */
async function render(fallback = '/') {
    if (!host) return;

    const path = (location.hash || '#' + fallback).slice(1) || fallback;
    currentPath = path;

    if (cleanup) {
        try { cleanup(); } catch (err) { console.error('[router] Błąd sprzątania:', err); }
        cleanup = null;
    }

    const found = match(path) || match(fallback);
    if (!found) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie ma takiej strony'),
            el('p', { class: 'muted' }, path),
        ));
        return;
    }

    document.body.dataset.route = path.split('/')[1] || 'home';
    window.scrollTo(0, 0);

    try {
        const result = await found.screen(host, found.params);
        cleanup = typeof result === 'function' ? result : null;
    } catch (err) {
        console.error('[router] Błąd ekranu:', err);
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Coś się posypało'),
            el('p', { class: 'muted' }, err.message),
        ));
    }
}
