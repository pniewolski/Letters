/**
 * @class Hub
 * @description Warstwa WebSocket: pilnuje połączeń, przypisuje im konta,
 * rozsyła stan lobby i partii oraz kieruje akcje do handlerów.
 *
 * Jedno konto może mieć kilka otwartych kart przeglądarki — dlatego mapa
 * `byUser` trzyma **zbiór** gniazd, a rozłączenie zgłaszamy dopiero wtedy,
 * gdy zniknie ostatnie z nich.
 *
 * Protokół:
 * - klient wysyła `{ type, rid?, ...dane }`
 * - serwer odpowiada `{ type: "<type>:response", rid, success, ... }`
 * - serwer wysyła też zdarzenia bez pytania (`lobby`, `table`, `game`, `chat`, …)
 *
 * @example
 * const hub = new Hub({ wss, deps });
 * hub.start();
 */

const handlers = require('./handlers');

/** Limit wiadomości na sekundę z jednego połączenia. */
const RATE_LIMIT = { windowMs: 1000, max: 30 };

class Hub {
    /**
     * @param {object} config
     * @param {import('ws').WebSocketServer} config.wss - Serwer WebSocket
     * @param {object} config.deps - Zależności aplikacji (auth, repozytoria, TableManager…)
     */
    constructor({ wss, deps }) {
        this.wss = wss;
        this.deps = deps;

        /** @type {Map<import('ws').WebSocket, object>} Kontekst połączenia. */
        this.contexts = new Map();
        /** @type {Map<number, Set<import('ws').WebSocket>>} userId → gniazda. */
        this.byUser = new Map();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CYKL ŻYCIA
    // ─────────────────────────────────────────────────────────────────────────

    /** Podpina obsługę połączeń i zdarzeń menedżera stołów. */
    start() {
        this.wss.on('connection', ws => this._onConnection(ws));
        this._bindTableEvents();

        // Wykrywanie zerwanych połączeń (np. uśpiony telefon).
        this.heartbeat = setInterval(() => {
            for (const ws of this.wss.clients) {
                if (ws.isAlive === false) { ws.terminate(); continue; }
                ws.isAlive = false;
                try { ws.ping(); } catch { /* gniazdo już zamknięte */ }
            }
        }, 30_000);
        if (this.heartbeat.unref) this.heartbeat.unref();
    }

    /** Zatrzymuje hub. */
    stop() {
        clearInterval(this.heartbeat);
    }

    /**
     * Obsługuje nowe połączenie.
     * @param {import('ws').WebSocket} ws
     * @private
     */
    _onConnection(ws) {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });

        const ctx = { ws, user: null, token: null, hits: [], hub: this, deps: this.deps };
        this.contexts.set(ws, ctx);

        ws.on('message', raw => this._onMessage(ctx, raw));
        ws.on('close', () => this._onClose(ctx));
        ws.on('error', err => console.error('[WS] Błąd gniazda:', err.message));

        this.send(ws, { type: 'hello', serverTime: Date.now() });
    }

    /**
     * Przetwarza wiadomość od klienta.
     * @param {object} ctx - Kontekst połączenia
     * @param {Buffer|string} raw - Surowa treść
     * @private
     */
    async _onMessage(ctx, raw) {
        if (!this._rateLimitOk(ctx)) {
            this.send(ctx.ws, { type: 'error', error: 'Zbyt wiele żądań — zwolnij trochę.' });
            return;
        }

        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            this.send(ctx.ws, { type: 'error', error: 'Niepoprawny format wiadomości.' });
            return;
        }

        const { type, rid, ...payload } = msg || {};
        const handler = handlers[type];
        if (!handler) {
            this.send(ctx.ws, { type: 'error', rid, error: `Nieznana akcja: ${type}` });
            return;
        }

        if (handler.requiresAuth !== false && !ctx.user) {
            this.send(ctx.ws, {
                type: `${type}:response`, rid, success: false,
                error: 'Najpierw się zaloguj lub graj jako gość.', needAuth: true,
            });
            return;
        }

        try {
            const response = await handler(ctx, payload);
            if (response) this.send(ctx.ws, { type: `${type}:response`, rid, success: true, ...response });
        } catch (err) {
            // Błędy logiki (rzucone celowo) mają czytelny komunikat; reszta idzie do logu.
            if (!err.expected) console.error(`[WS] Błąd akcji "${type}":`, err);
            this.send(ctx.ws, {
                type: `${type}:response`, rid, success: false,
                error: err.message || 'Coś poszło nie tak po stronie serwera.',
            });
        }
    }

    /**
     * Sprząta po zamkniętym połączeniu.
     * @param {object} ctx
     * @private
     */
    _onClose(ctx) {
        this.contexts.delete(ctx.ws);
        if (!ctx.user) return;

        const sockets = this.byUser.get(ctx.user.id);
        if (sockets) {
            sockets.delete(ctx.ws);
            if (sockets.size === 0) {
                this.byUser.delete(ctx.user.id);
                // Ostatnia karta zamknięta — dopiero teraz gracz jest offline.
                this.deps.tables.markDisconnected(ctx.user.id);
            }
        }
        this.broadcastLobby();
    }

    /**
     * Prosty limiter częstotliwości.
     * @param {object} ctx
     * @returns {boolean} Czy wiadomość mieści się w limicie
     * @private
     */
    _rateLimitOk(ctx) {
        const now = Date.now();
        ctx.hits = ctx.hits.filter(t => now - t < RATE_LIMIT.windowMs);
        ctx.hits.push(now);
        return ctx.hits.length <= RATE_LIMIT.max;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRZYPISANIE KONTA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Przypisuje konto do połączenia.
     * @param {object} ctx - Kontekst połączenia
     * @param {object} user - Publiczna postać konta
     * @param {string} token - Token sesji
     */
    attachUser(ctx, user, token) {
        // To samo połączenie mogło być już przypisane do innego konta.
        if (ctx.user && ctx.user.id !== user.id) {
            const old = this.byUser.get(ctx.user.id);
            if (old) { old.delete(ctx.ws); if (old.size === 0) this.byUser.delete(ctx.user.id); }
        }

        ctx.user = user;
        ctx.token = token;

        if (!this.byUser.has(user.id)) this.byUser.set(user.id, new Set());
        this.byUser.get(user.id).add(ctx.ws);
    }

    /**
     * Czy gracz ma otwarte jakiekolwiek połączenie.
     * @param {number} userId
     * @returns {boolean}
     */
    isOnline(userId) {
        return this.byUser.has(userId);
    }

    /**
     * Liczba zalogowanych graczy online.
     * @returns {number}
     */
    onlineCount() {
        return this.byUser.size;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WYSYŁANIE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wysyła obiekt do konkretnego gniazda.
     * @param {import('ws').WebSocket} ws
     * @param {object} data
     */
    send(ws, data) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    /**
     * Wysyła obiekt do wszystkich połączeń gracza.
     * @param {number} userId
     * @param {object} data
     */
    sendToUser(userId, data) {
        const sockets = this.byUser.get(userId);
        if (!sockets) return;
        for (const ws of sockets) this.send(ws, data);
    }

    /**
     * Wysyła do wszystkich połączonych.
     * @param {object} data
     */
    broadcast(data) {
        for (const ws of this.wss.clients) this.send(ws, data);
    }

    /**
     * Wszyscy zainteresowani stołem: gracze i widzowie.
     * @param {import('../lobby/GameTable')} table
     * @returns {number[]} Identyfikatory kont
     */
    audienceOf(table) {
        const ids = new Set();
        for (const seat of table.seats) if (seat.userId != null) ids.add(seat.userId);
        for (const id of table.spectators) ids.add(id);
        return [...ids];
    }

    /** Rozsyła aktualną listę stołów wszystkim połączonym. */
    broadcastLobby() {
        const online = this.onlineCount();
        for (const [ws, ctx] of this.contexts) {
            this.send(ws, {
                type: 'lobby',
                tables: this.deps.tables.listTables(ctx.user ? ctx.user.id : null),
                online,
            });
        }
    }

    /**
     * Rozsyła stan stołu jego uczestnikom.
     * @param {import('../lobby/GameTable')} table
     */
    broadcastTable(table) {
        for (const userId of this.audienceOf(table)) {
            this.sendToUser(userId, { type: 'table', table: table.toDetail(userId) });
        }
    }

    /**
     * Rozsyła stan partii jej uczestnikom (każdy widzi tylko swój stojak).
     * @param {import('../lobby/GameTable')} table
     */
    broadcastGame(table) {
        for (const userId of this.audienceOf(table)) {
            const state = table.toGameState(userId);
            if (state) this.sendToUser(userId, { type: 'game', state });
        }
    }

    /**
     * Podpina zdarzenia menedżera stołów pod rozsyłanie.
     * @private
     */
    _bindTableEvents() {
        const tables = this.deps.tables;

        tables.on('lobby', () => this.broadcastLobby());

        tables.on('table', ({ table, closed, reason }) => {
            if (closed) {
                for (const userId of this.audienceOf(table)) {
                    this.sendToUser(userId, { type: 'table:closed', tableId: table.id, reason });
                }
                return;
            }
            this.broadcastTable(table);
        });

        tables.on('game', ({ table }) => this.broadcastGame(table));

        tables.on('move', ({ table, move }) => {
            const seat = table.seats[move.slot];
            for (const userId of this.audienceOf(table)) {
                this.sendToUser(userId, {
                    type: 'game:move',
                    tableId: table.id,
                    move,
                    playerName: seat ? seat.name : null,
                    isComputer: seat ? seat.type === 'computer' : false,
                });
            }
        });

        tables.on('over', ({ table, results }) => {
            for (const userId of this.audienceOf(table)) {
                this.sendToUser(userId, {
                    type: 'game:over',
                    results,
                    state: table.toGameState(userId),
                });
            }
        });

        tables.on('chat', ({ table, entry }) => {
            for (const userId of this.audienceOf(table)) {
                this.sendToUser(userId, { type: 'chat', scope: 'table', tableId: table.id, entry });
            }
        });
    }
}

module.exports = Hub;
