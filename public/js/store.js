/**
 * @file store.js
 * @description Wspólny stan aplikacji plus prosty mechanizm powiadomień.
 * Ekrany zapisują się na interesujące je klucze i przerysowują się same,
 * kiedy coś się zmieni — bez frameworka i bez zależności cyklicznych.
 *
 * @example
 * import { store, setState, subscribe } from './store.js';
 * subscribe('game', () => renderBoard());
 * setState({ game: newState });
 */

/** Klucz, pod którym trzymamy token sesji. */
const TOKEN_KEY = 'literki.token';

/**
 * Globalny stan aplikacji frontendu.
 * @type {object}
 */
export const store = {
    /** Konfiguracja z `/api/config`. */
    config: { title: 'Literki', flags: {}, aiLevels: [] },
    /** Zalogowane konto (albo `null`). */
    user: null,
    /** Czy trwa jeszcze pierwsze ładowanie. */
    booting: true,
    /** Stan połączenia WebSocket: 'off' | 'connecting' | 'on'. */
    connection: 'off',
    /** Liczba graczy online. */
    online: 0,

    /** Lista stołów w lobby. */
    tables: [],
    /** Stół, przy którym siedzimy. */
    table: null,
    /** Stan trwającej partii. */
    game: null,
    /** Wyniki po zakończeniu partii. */
    results: null,

    // ── Stan lokalny ekranu gry (nie przychodzi z serwera) ──────────────────
    /** Klocki położone w tej turze: `{ letter, x, y, isBlank, rackIndex }`. */
    placed: [],
    /** Wybrany klocek (tryb dotykowy). */
    selected: null,
    /** Dane przeciąganego klocka. */
    drag: null,
    /** Czy jesteśmy w trybie wymiany liter. */
    exchangeMode: false,
    /** Indeksy liter zaznaczonych do wymiany. */
    exchangeSelection: new Set(),
    /** Kolejność liter na stojaku (indeksy w `game.myRack`). */
    rackOrder: null,
    /** Podglądy układane przez innych graczy: slot → klocki. */
    previews: new Map(),
    /** Podpowiedzi z serwera. */
    hints: null,
    /** Log zdarzeń i czatu przy stole. */
    feed: [],
};

/** @type {Map<string, Set<Function>>} klucz → nasłuchujący. */
const listeners = new Map();

/**
 * Zapisuje funkcję na zmiany wskazanych kluczy stanu.
 * @param {string|string[]} keys - Klucz albo lista kluczy (`'*'` = wszystko)
 * @param {Function} fn - Wywoływane po zmianie
 * @returns {() => void} Funkcja odpinająca
 */
export function subscribe(keys, fn) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(fn);
    }
    return () => {
        for (const key of list) listeners.get(key)?.delete(fn);
    };
}

/**
 * Aktualizuje stan i powiadamia zainteresowanych.
 * @param {object} patch - Zmienione klucze
 */
export function setState(patch) {
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
        if (store[key] === value) continue;
        store[key] = value;
        changed.push(key);
    }
    if (changed.length === 0) return;
    notify(changed);
}

/**
 * Wymusza powiadomienie o kluczach zmienionych „w miejscu"
 * (np. po dopisaniu elementu do tablicy).
 * @param {...string} keys
 */
export function touch(...keys) {
    notify(keys);
}

/**
 * Wywołuje nasłuchujących.
 * @param {string[]} keys
 */
function notify(keys) {
    const called = new Set();
    for (const key of [...keys, '*']) {
        for (const fn of listeners.get(key) || []) {
            if (called.has(fn)) continue;
            called.add(fn);
            try { fn(keys); } catch (err) { console.error('[store] Błąd nasłuchującego:', err); }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN SESJI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Odczytuje token sesji.
 *
 * Najpierw sprawdzamy `sessionStorage` — tam trafiają sesje gości, więc
 * zamknięcie karty kończy ich przygodę. Konta trzymamy w `localStorage`.
 *
 * @returns {string|null}
 */
export function getToken() {
    try {
        return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || null;
    } catch {
        return null; // prywatne okno z zablokowanym magazynem
    }
}

/**
 * Zapisuje token sesji.
 * @param {string|null} token - Token albo `null` (wylogowanie)
 * @param {boolean} [guest=false] - Czy to sesja gościa
 */
export function setToken(token, guest = false) {
    try {
        sessionStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY);
        if (!token) return;
        (guest ? sessionStorage : localStorage).setItem(TOKEN_KEY, token);
    } catch {
        // Brak dostępu do magazynu — sesja przetrwa tylko do przeładowania strony.
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAN EKRANU GRY
// ─────────────────────────────────────────────────────────────────────────────

/** Czyści lokalny stan układania (po ruchu, cofnięciu albo zmianie stołu). */
export function clearPlacement() {
    store.placed = [];
    store.selected = null;
    store.drag = null;
    store.exchangeMode = false;
    store.exchangeSelection = new Set();
    store.hints = null;
    touch('placed', 'selected', 'exchangeMode', 'hints');
}

/**
 * Czy możemy teraz układać klocki na planszy.
 * @returns {boolean}
 */
export function canPlay() {
    const g = store.game;
    return !!g
        && !g.finished
        && g.mySlot != null
        && g.currentSlot === g.mySlot
        && !store.exchangeMode;
}

/**
 * Dopisuje wpis do logu zdarzeń przy stole.
 * @param {object} entry - `{ kind, text, name?, at? }`
 */
export function pushFeed(entry) {
    store.feed.push({ at: Date.now(), ...entry });
    if (store.feed.length > 200) store.feed.shift();
    touch('feed');
}
