/**
 * @file net.js
 * @description Warstwa komunikacji WebSocket. Nie zna logiki gry — przyjmuje
 * handler wiadomości przez setMessageHandler (rejestrowany w main.js), dzięki
 * czemu nie powstają zależności cykliczne.
 */

let ws = null;
let messageHandler = () => {};

/**
 * Rejestruje funkcję obsługującą przychodzące wiadomości.
 * @param {(msg: object) => void} fn
 */
export function setMessageHandler(fn) {
    messageHandler = fn;
}

/**
 * Nawiązuje połączenie WebSocket z serwerem (z automatycznym ponawianiem).
 */
export function connectWs() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => console.log('[WS] Connected');
    ws.onclose = () => {
        console.log('[WS] Disconnected');
        setTimeout(connectWs, 2000);
    };
    ws.onerror = (e) => console.error('[WS] Error', e);
    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); }
        catch (err) { console.error('[WS] Bad JSON', err); return; }
        messageHandler(msg);
    };
}

/**
 * Wysyła obiekt jako JSON do serwera (jeśli połączenie otwarte).
 * @param {object} data
 */
export function wsSend(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

