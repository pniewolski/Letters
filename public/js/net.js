/**
 * @file net.js
 * @description Połączenie WebSocket z serwerem: automatyczne wznawianie,
 * uwierzytelnianie tokenem i wywołania w stylu żądanie–odpowiedź.
 *
 * Moduł nie zna logiki gry. Zdarzenia wypycha do zarejestrowanego handlera
 * (robi to `main.js`), dzięki czemu nie powstają zależności cykliczne.
 *
 * @example
 * import { connect, call, send } from './net.js';
 * const res = await call('table:create', { seats: 2 });
 */

import { getToken, setState } from './store.js';

let ws = null;
let handler = () => {};
let reconnectDelay = 1000;
let reconnectTimer = null;
let nextRid = 1;
let closedByUs = false;

/** @type {Map<number, {resolve: Function, reject: Function, timer: number}>} */
const pending = new Map();

/**
 * Rejestruje odbiorcę zdarzeń wypychanych przez serwer.
 * @param {(msg: object) => void} fn
 */
export function onMessage(fn) {
    handler = fn;
}

/**
 * Nawiązuje połączenie (i wznawia je po zerwaniu).
 */
export function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    closedByUs = false;
    setState({ connection: 'connecting' });

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
        reconnectDelay = 1000;
        setState({ connection: 'on' });
        authenticate();
    };

    ws.onclose = () => {
        setState({ connection: 'off' });
        rejectAllPending('Połączenie z serwerem zostało przerwane.');
        if (closedByUs) return;

        // Wykładnicze wydłużanie przerw, ale nie dłużej niż 15 s.
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(15000, Math.round(reconnectDelay * 1.7));
    };

    ws.onerror = () => { /* szczegóły przyjdą w onclose */ };

    ws.onmessage = (event) => {
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
    if (ws) ws.close();
    ws = null;
    setState({ connection: 'off' });
}

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
    ws.send(JSON.stringify({ type, ...payload }));
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
            reject(new Error('Brak połączenia z serwerem.'));
            return;
        }

        const rid = nextRid++;
        const timer = setTimeout(() => {
            pending.delete(rid);
            reject(new Error('Serwer nie odpowiedział na czas.'));
        }, timeoutMs);

        pending.set(rid, { resolve, reject, timer });
        ws.send(JSON.stringify({ type, rid, ...payload }));
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
