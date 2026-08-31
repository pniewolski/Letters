/**
 * @file ui.js
 * @description Drobne narzędzia do budowania interfejsu bez frameworka:
 * tworzenie elementów, komunikaty, okna modalne i formatowanie.
 *
 * @example
 * import { el, toast } from './ui.js';
 * const card = el('div', { class: 'card' }, el('h2', {}, 'Tytuł'));
 * toast('Zapisano', 'ok');
 */

/** Skrót do `querySelector`. */
export const $ = (sel, root = document) => root.querySelector(sel);
/** Skrót do `querySelectorAll` (zwraca tablicę). */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Tworzy element DOM.
 *
 * Atrybuty zaczynające się od `on` podpinają zdarzenia, `class` ustawia klasy,
 * `dataset` — atrybuty `data-*`, a `html` wstawia gotowy HTML (używaj tylko
 * dla treści, którą sam wygenerowałeś).
 *
 * @param {string} tag - Nazwa znacznika
 * @param {object} [attrs] - Atrybuty i uchwyty zdarzeń
 * @param {...(Node|string|null|Array)} children - Dzieci
 * @returns {HTMLElement}
 *
 * @example
 * el('button', { class: 'btn', onclick: () => alert('hej') }, 'Kliknij')
 */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs || {})) {
        if (value == null || value === false) continue;

        if (key === 'class') node.className = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
    }

    append(node, children);
    return node;
}

/**
 * Dokleja dzieci (płasko, pomijając `null`).
 * @param {HTMLElement} node
 * @param {Array} children
 */
export function append(node, children) {
    for (const child of children.flat(4)) {
        if (child == null || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

/**
 * Czyści zawartość elementu i wstawia nową.
 * @param {HTMLElement} node
 * @param {...(Node|string)} children
 * @returns {HTMLElement} Ten sam element
 */
export function fill(node, ...children) {
    node.replaceChildren();
    append(node, children);
    return node;
}

/**
 * Zabezpiecza tekst przed wstrzyknięciem HTML.
 * @param {string} text
 * @returns {string}
 */
export function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// ─────────────────────────────────────────────────────────────────────────────
// KOMUNIKATY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pokazuje krótki komunikat w rogu ekranu.
 * @param {string} message - Treść
 * @param {'info'|'ok'|'error'} [kind='info'] - Rodzaj (wpływa na kolor)
 * @param {number} [ms=3600] - Jak długo widoczny
 */
export function toast(message, kind = 'info', ms = 3600) {
    let host = $('#toasts');
    if (!host) {
        host = el('div', { id: 'toasts', class: 'toasts' });
        document.body.append(host);
    }

    const node = el('div', { class: `toast toast-${kind}` }, message);
    host.append(node);

    setTimeout(() => {
        node.classList.add('toast-out');
        setTimeout(() => node.remove(), 300);
    }, ms);
}

/**
 * Otwiera okno modalne.
 * @param {object} options
 * @param {string} options.title - Nagłówek
 * @param {Node|string} options.body - Treść
 * @param {Array<{label: string, kind?: string, onClick?: Function, close?: boolean}>} [options.actions] - Przyciski
 * @param {boolean} [options.dismissable=true] - Czy można zamknąć klikiem w tło i Escape
 * @returns {{close: () => void, root: HTMLElement}}
 */
export function modal({ title, body, actions = [], dismissable = true }) {
    const close = () => {
        root.remove();
        document.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => { if (dismissable && e.key === 'Escape') close(); };

    const buttons = actions.map(a => el('button', {
        class: `btn ${a.kind ? 'btn-' + a.kind : ''}`,
        onclick: async () => {
            if (a.onClick) {
                const keepOpen = await a.onClick();
                if (keepOpen === false) return;
            }
            if (a.close !== false) close();
        },
    }, a.label));

    const root = el('div', {
        class: 'modal-backdrop',
        onclick: (e) => { if (dismissable && e.target === root) close(); },
    },
        el('div', { class: 'modal-card', role: 'dialog' },
            el('h3', { class: 'modal-title' }, title),
            el('div', { class: 'modal-body' }, body),
            buttons.length ? el('div', { class: 'modal-actions' }, buttons) : null,
        ),
    );

    document.body.append(root);
    document.addEventListener('keydown', onKey);
    return { close, root };
}

/**
 * Modal z pytaniem tak/nie.
 * @param {string} question - Pytanie
 * @param {object} [options]
 * @param {string} [options.title='Potwierdź'] - Nagłówek
 * @param {string} [options.confirmLabel='Tak'] - Etykieta przycisku potwierdzenia
 * @returns {Promise<boolean>}
 */
export function confirmDialog(question, { title = 'Potwierdź', confirmLabel = 'Tak' } = {}) {
    return new Promise(resolve => {
        modal({
            title,
            body: el('p', {}, question),
            actions: [
                { label: 'Anuluj', onClick: () => resolve(false) },
                { label: confirmLabel, kind: 'primary', onClick: () => resolve(true) },
            ],
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATOWANIE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatuje liczbę sekund jako `M:SS`.
 * @param {number} seconds
 * @returns {string}
 */
export function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Zamienia znacznik czasu na opis w stylu „3 min temu".
 * @param {number} timestamp - Czas w milisekundach
 * @returns {string}
 */
export function fmtAgo(timestamp) {
    if (!timestamp) return '—';
    const diff = Math.max(0, Date.now() - timestamp);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'przed chwilą';
    if (min < 60) return `${min} min temu`;

    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} godz. temu`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} dni temu`;
    return new Date(timestamp).toLocaleDateString('pl-PL');
}

/**
 * Odmienia rzeczownik przez liczbę (polskie formy mnogie).
 * @param {number} n - Liczba
 * @param {string} one - Forma dla 1 („partia")
 * @param {string} few - Forma dla 2–4 („partie")
 * @param {string} many - Forma dla 5+ („partii")
 * @returns {string} Liczba wraz z odmienionym słowem
 *
 * @example
 * plural(1, 'partia', 'partie', 'partii');  // => '1 partia'
 * plural(23, 'partia', 'partie', 'partii'); // => '23 partie'
 */
export function plural(n, one, few, many) {
    const abs = Math.abs(n);
    const last = abs % 10;
    const lastTwo = abs % 100;

    if (abs === 1) return `${n} ${one}`;
    if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/**
 * Inicjały do awatara zastępczego.
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
    return String(name || '?').trim().slice(0, 2).toUpperCase();
}

/**
 * Element awatara gracza.
 * @param {object} user - `{ avatar, displayName|name }`
 * @param {string} [size='md'] - `sm` | `md` | `lg`
 * @returns {HTMLElement}
 */
export function avatar(user, size = 'md') {
    const name = user?.displayName || user?.name || '?';
    return el('span', { class: `avatar avatar-${size}`, title: name },
        user?.avatar || initials(name));
}
