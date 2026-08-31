/**
 * @file net.js
 * @description Połączenie WebSocket z serwerem: wznawianie, wykrywanie
 * martwych łączy, uwierzytelnianie tokenem i wywołania żądanie–odpowiedź.
 *
 * Moduł nie zna logiki gry. Zdarzenia wypycha do zarejestrowanego handlera
 * (robi to `main.js`), dzięki czemu nie powstają zależności cykliczne.
 *
 * ## Dlaczego to nie jest zwykłe `new WebSocket`
 *
 * Na telefonie zminimalizowanie przeglądarki zamraża stronę. Po powrocie
 * gniazdo potrafi mieć `readyState === OPEN`, choć od dawna nic już przez nie
 * nie przechodzi — system operacyjny zerwał je po cichu i zdarzenie `close`
 * nigdy nie przyszło. Samo sprawdzanie `readyState` daje wtedy fałszywe
 * poczucie bezpieczeństwa i połączenie nie wraca już nigdy.
 *
 * Dlatego pilnujemy łącza na trzy sposoby:
 * 1. **Cisza w eterze** — liczymy czas od ostatniej wiadomości od serwera.
 *    Po {@link PING_AFTER_MS} pytamy `ping`, po {@link SILENCE_LIMIT_MS}
 *    uznajemy gniazdo za martwe i łączymy się od nowa.
 * 2. **Powrót do karty** — `visibilitychange`, `pageshow` i `online`
 *    natychmiast weryfikują łącze i zerują odczekiwanie między próbami.
 * 3. **Twarde zerwanie** — przed ponownym połączeniem odpinamy uchwyty
 *    starego gniazda, żeby jego spóźniony `close` nie planował kolejnych prób.
 *
 * @example
 * import { connect, call, send } from './net.js';
 * const res = await call('table:create', { seats: 2 });
 */

import { getToken, setState } from './store.js';

/** Po tylu milisekundach ciszy pytamy serwer, czy jeszcze tam jest. */
const PING_AFTER_MS = 15000;

/** Po tylu milisekundach ciszy uznajemy gniazdo za martwe. */
const SILENCE_LIMIT_MS = 35000;

/** Jak często sprawdzamy stan łącza. */
const WATCHDOG_MS = 5000;

/** Najkrótsza i najdłuższa przerwa między próbami połączenia. */
const RETRY = { min: 1000, max: 15000 };

let ws = null;
let handler = () => {};
let reconnectDelay = RETRY.min;
let reconnectTimer = null;
let watchdogTimer = null;
let nextRid = 1;
let closedByUs = false;
let started = false;

/** Kiedy ostatnio przyszła jakakolwiek wiadomość od serwera. */
let lastServerMessageAt = 0;

/** @type {Map<number, {resolve: Function, reject: Function, timer: number}>} */
const pending = new Map();

/**
 * Rejestruje odbiorcę zdarzeń wypychanych przez serwer.
 * @param {(msg: object) => void} fn
 */
export function onMessage(fn) {
    handler = fn;
}

// ─────────────────────────────────────────────────────────────────────────────
// POŁĄCZENIE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nawiązuje połączenie (i wznawia je po zerwaniu).
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Zerwij istniejące gniazdo i połącz
 *   od nowa, nawet jeśli wygląda na otwarte
 */
export function connect({ force = false } = {}) {
    if (!started) { started = true; installLifecycleHooks(); }

    if (ws && !force
        && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    clearTimeout(reconnectTimer);
    if (ws) discardSocket();

    closedByUs = false;
    setState({ connection: 'connecting' });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}`);
    ws = socket;
    lastServerMessageAt = Date.now();

    socket.onopen = () => {
        if (ws !== socket) return;              // zdążyliśmy otworzyć nowsze
        reconnectDelay = RETRY.min;
        lastServerMessageAt = Date.now();
        setState({ connection: 'on' });
        startWatchdog();
        authenticate();
    };

    socket.onclose = () => {
        if (ws !== socket) return;              // zamknięcie porzuconego gniazda
        ws = null;
        setState({ connection: 'off' });
        rejectAllPending('Połączenie z serwerem zostało przerwane.');
        if (!closedByUs) scheduleReconnect();
    };

    socket.onerror = () => { /* szczegóły przyjdą w onclose */ };

    socket.onmessage = (event) => {
        if (ws !== socket) return;
        lastServerMessageAt = Date.now();

        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            console.error('[WS] Nieczytelna wiadomość:', event.data);
            return;
        }

        // Odpowiedź na konkretne żądanie?
        if (msg.rid != null && pending.has(msg.rid)) {
            const entry = pending.get(msg.rid);
            pending.delete(msg.rid);
            clearTimeout(entry.timer);
            entry.resolve(msg);
            return;
        }

        handler(msg);
    };
}

/** Zamyka połączenie na życzenie (wylogowanie). */
export function disconnect() {
    closedByUs = true;
    clearTimeout(reconnectTimer);
    stopWatchdog();
    if (ws) discardSocket();
    setState({ connection: 'off' });
}

/**
 * Wymusza natychmiastowe odtworzenie połączenia.
 * @param {string} [reason] - Powód (trafia do konsoli, pomaga w diagnozie)
 */
export function reconnectNow(reason = 'wymuszone') {
    console.warn(`[WS] Odtwarzam połączenie: ${reason}`);
    reconnectDelay = RETRY.min;
    connect({ force: true });
}

/**
 * Odpina uchwyty i zamyka gniazdo. Bez odpięcia spóźniony `close` starego
 * gniazda zaplanowałby kolejną próbę i zrobiłby się wyścig dwóch połączeń.
 */
function discardSocket() {
    const socket = ws;
    ws = null;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try { socket.close(); } catch { /* już zamknięte */ }
}

/** Planuje kolejną próbę połączenia z rosnącą przerwą. */
function scheduleReconnect() {
    clearTimeout(reconnectTimer);

    // Odrobina losowości, żeby po awarii serwera wszyscy nie wrócili naraz.
    const jitter = Math.round(reconnectDelay * 0.2 * Math.random());
    reconnectTimer = setTimeout(() => connect(), reconnectDelay + jitter);
    reconnectDelay = Math.min(RETRY.max, Math.round(reconnectDelay * 1.7));
}

// ─────────────────────────────────────────────────────────────────────────────
// CZUWAK
// ─────────────────────────────────────────────────────────────────────────────

/** Uruchamia cykliczne sprawdzanie, czy łącze jeszcze żyje. */
function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(checkAlive, WATCHDOG_MS);
}

/** Zatrzymuje czuwaka. */
function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
}

/**
 * Sprawdza, czy od serwera cokolwiek przychodzi. Zbyt długa cisza oznacza
 * gniazdo-widmo — takie, które wygląda na otwarte, ale nic już nie przenosi.
 */
function checkAlive() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const silence = Date.now() - lastServerMessageAt;
    if (silence > SILENCE_LIMIT_MS) {
        reconnectNow(`${Math.round(silence / 1000)} s ciszy od serwera`);
        return;
    }
    if (silence > PING_AFTER_MS) send('ping');
}

/**
 * Podpina zdarzenia cyklu życia strony. Wywoływane raz, przy pierwszym
 * `connect()`.
 */
function installLifecycleHooks() {
    // Powrót do karty: odczekiwanie zerujemy, bo użytkownik patrzy i czeka.
    const wakeUp = () => {
        if (document.visibilityState === 'hidden') return;
        reconnectDelay = RETRY.min;

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connect();
            return;
        }

        // Gniazdo wygląda na otwarte — sprawdźmy, czy naprawdę żyje.
        const before = lastServerMessageAt;
        send('ping');
        setTimeout(() => {
            if (lastServerMessageAt === before) reconnectNow('brak odpowiedzi po powrocie do karty');
        }, 4000);
    };

    document.addEventListener('visibilitychange', wakeUp);
    window.addEventListener('pageshow', wakeUp);
    window.addEventListener('focus', wakeUp);
    window.addEventListener('online', () => reconnectNow('sieć wróciła'));

    // Utrata sieci nie zawsze zamyka gniazdo — nie czekajmy na czuwaka.
    window.addEventListener('offline', () => setState({ connection: 'off' }));
}

// ─────────────────────────────────────────────────────────────────────────────
// WYSYŁANIE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wysyła token sesji — serwer przypisuje połączenie do konta i odsyła
 * stan stołu, przy którym siedzieliśmy.
 * @returns {Promise<void>}
 */
export async function authenticate() {
    const token = getToken();
    if (!token) return;

    try {
        const res = await call('auth', { token });
        handler({ ...res, type: 'auth:restored' });
    } catch (err) {
        console.warn('[WS] Nie udało się przywrócić sesji:', err.message);
    }
}

/**
 * Wysyła wiadomość bez oczekiwania na odpowiedź.
 * @param {string} type - Nazwa akcji
 * @param {object} [payload] - Dane
 */
export function send(type, payload = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify({ type, ...payload }));
    } catch (err) {
        reconnectNow('gniazdo odmówiło wysyłki');
    }
}

/**
 * Wysyła akcję i czeka na odpowiedź serwera.
 * @param {string} type - Nazwa akcji
 * @param {object} [payload] - Dane
 * @param {number} [timeoutMs=20000] - Po jakim czasie się poddać
 * @returns {Promise<object>} Odpowiedź (`success` mówi, czy się udało)
 * @throws {Error} Gdy nie ma połączenia albo minął czas oczekiwania
 */
export function call(type, payload = {}, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            connect();
            reject(new Error('Brak połączenia z serwerem — próbuję je odtworzyć.'));
            return;
        }

        const rid = nextRid++;
        const timer = setTimeout(() => {
            pending.delete(rid);
            // Brak odpowiedzi to podejrzenie martwego gniazda, nie tylko zguba.
            checkAlive();
            reject(new Error('Serwer nie odpowiedział na czas.'));
        }, timeoutMs);

        pending.set(rid, { resolve, reject, timer });

        try {
            ws.send(JSON.stringify({ type, rid, ...payload }));
        } catch (err) {
            pending.delete(rid);
            clearTimeout(timer);
            reconnectNow('gniazdo odmówiło wysyłki');
            reject(new Error('Nie udało się wysłać żądania.'));
        }
    });
}

/**
 * Odrzuca wszystkie oczekujące żądania (po zerwaniu połączenia).
 * @param {string} reason
 */
function rejectAllPending(reason) {
    for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(reason));
    }
    pending.clear();
}
