/**
 * @file handlers.js
 * @description Akcje, które klient może wywołać przez WebSocket.
 *
 * Każdy handler dostaje `(ctx, payload)` i zwraca obiekt, który trafi do
 * klienta jako `{ type: "<akcja>:response", success: true, ...zwrot }`.
 * Rzucony wyjątek zamienia się w odpowiedź z `success: false` i komunikatem —
 * dlatego walidacje piszemy jako `fail('...')`, a nie jako ręczne zwrotki.
 *
 * Handler z `requiresAuth = false` można wywołać przed zalogowaniem.
 *
 * @example
 * // klient
 * ws.send(JSON.stringify({ type: 'table:create', rid: 7, seats: 2 }));
 * // serwer
 * // { type: 'table:create:response', rid: 7, success: true, table: {...} }
 */

/**
 * Tworzy błąd z komunikatem przeznaczonym dla gracza.
 * @param {string} message - Treść po polsku
 * @returns {Error} Błąd oznaczony jako spodziewany (nie trafia do logu)
 */
function fail(message) {
    const err = new Error(message);
    err.expected = true;
    return err;
}

/** Wygodny skrót: rzuca `fail`, gdy warunek nie jest spełniony. */
function require_(condition, message) {
    if (!condition) throw fail(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESJA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Przypisuje połączenie do konta na podstawie tokenu sesji. Jeśli gracz siedział
 * przy stole, od razu dostaje z powrotem stan stołu i partii — dzięki temu
 * odświeżenie strony nie wyrzuca z gry.
 *
 * Klient: `{ type: 'auth', token }`
 */
async function auth(ctx, payload) {
    const session = await ctx.deps.auth.resolve(payload.token);
    require_(session, 'Sesja wygasła — zaloguj się ponownie.');

    ctx.hub.attachUser(ctx, session.user, payload.token);

    const table = ctx.deps.tables.markConnected(session.user.id);
    ctx.hub.broadcastLobby();

    return {
        user: session.user,
        table: table ? table.toDetail(session.user.id) : null,
        game: table ? table.toGameState(session.user.id) : null,
        tables: ctx.deps.tables.listTables(session.user.id),
        online: ctx.hub.onlineCount(),
    };
}
auth.requiresAuth = false;

/** Odświeżenie stanu bez żadnych zmian — klient używa tego po reconnectcie. */
async function sync(ctx) {
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    return {
        user: ctx.user,
        table: table ? table.toDetail(ctx.user.id) : null,
        game: table ? table.toGameState(ctx.user.id) : null,
        tables: ctx.deps.tables.listTables(ctx.user.id),
        online: ctx.hub.onlineCount(),
    };
}

/** Odpowiedź na puls klienta. */
async function ping() {
    return { at: Date.now() };
}
ping.requiresAuth = false;

// ─────────────────────────────────────────────────────────────────────────────
// LOBBY I STOŁY
// ─────────────────────────────────────────────────────────────────────────────

/** Zwraca listę stołów. Klient: `{ type: 'lobby' }` */
async function lobby(ctx) {
    return {
        tables: ctx.deps.tables.listTables(ctx.user ? ctx.user.id : null),
        online: ctx.hub.onlineCount(),
    };
}
lobby.requiresAuth = false;

/**
 * Zakłada stół.
 * Klient: `{ type: 'table:create', name, variantId, seats, computerSeats, aiLevel, isPrivate, password, rated, turnSeconds }`
 */
async function tableCreate(ctx, payload) {
    const table = await ctx.deps.tables.create(ctx.user, payload);
    return {
        table: table.toDetail(ctx.user.id),
        game: table.toGameState(ctx.user.id),
    };
}

/**
 * Dołącza do stołu.
 * Klient: `{ type: 'table:join', tableId, password?, slot?, asSpectator? }`
 */
async function tableJoin(ctx, payload) {
    require_(payload.tableId != null, 'Nie wskazano stołu.');
    const table = await ctx.deps.tables.join(ctx.user, payload.tableId, payload);
    return {
        table: table.toDetail(ctx.user.id),
        game: table.toGameState(ctx.user.id),
    };
}

/** Dołącza do stołu po krótkim kodzie. Klient: `{ type: 'table:joinCode', code, password? }` */
async function tableJoinCode(ctx, payload) {
    const code = String(payload.code || '').trim().toUpperCase();
    require_(code, 'Podaj kod stołu.');

    const found = [...ctx.deps.tables.tables.values()].find(t => t.code === code);
    require_(found, 'Nie ma stołu o takim kodzie.');

    const table = await ctx.deps.tables.join(ctx.user, found.id, payload);
    return { table: table.toDetail(ctx.user.id), game: table.toGameState(ctx.user.id) };
}

/** Wstaje od stołu (w trakcie partii oznacza poddanie się). */
async function tableLeave(ctx) {
    ctx.deps.tables.leave(ctx.user.id);
    return { tables: ctx.deps.tables.listTables(ctx.user.id) };
}

/** Rozpoczyna partię, obsadzając wolne miejsca komputerami. */
async function tableStart(ctx) {
    const table = await ctx.deps.tables.startNow(ctx.user.id);
    return { table: table.toDetail(ctx.user.id), game: table.toGameState(ctx.user.id) };
}

/** Ustawia stół na rewanż. */
async function tableRematch(ctx) {
    const table = await ctx.deps.tables.rematch(ctx.user.id);
    return { table: table.toDetail(ctx.user.id), game: table.toGameState(ctx.user.id) };
}

/** Wiadomość na czacie stołu. Klient: `{ type: 'table:chat', message }` */
async function tableChat(ctx, payload) {
    ctx.deps.tables.chat(ctx.user.id, ctx.user.displayName, payload.message);
    return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// ROZGRYWKA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kładzie litery na planszy.
 * Klient: `{ type: 'game:move', tiles: [{ letter, x, y, isBlank }] }`
 */
async function gameMove(ctx, payload) {
    const result = await ctx.deps.tables.move(ctx.user.id, payload.tiles);
    if (!result.success) throw fail(result.error);

    const table = ctx.deps.tables.tableOf(ctx.user.id);
    return {
        lostTurn: !!result.lostTurn,
        wrongWords: result.wrongWords || null,
        points: result.points || 0,
        state: table ? table.toGameState(ctx.user.id) : null,
    };
}

/** Wymienia litery. Klient: `{ type: 'game:exchange', letters: ['A','Ź'] }` */
async function gameExchange(ctx, payload) {
    const result = await ctx.deps.tables.exchange(ctx.user.id, payload.letters);
    if (!result.success) throw fail(result.error);

    const table = ctx.deps.tables.tableOf(ctx.user.id);
    return { state: table ? table.toGameState(ctx.user.id) : null };
}

/** Pasuje. */
async function gamePass(ctx) {
    await ctx.deps.tables.pass(ctx.user.id);
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    return { state: table ? table.toGameState(ctx.user.id) : null };
}

/** Poddaje partię. */
async function gameResign(ctx) {
    await ctx.deps.tables.resign(ctx.user.id);
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    return { state: table ? table.toGameState(ctx.user.id) : null };
}

/**
 * Zwraca podpowiedzi. Przy stole z samymi ludźmi działa tylko wtedy,
 * gdy pozwala na to konfiguracja serwera.
 * Klient: `{ type: 'game:hint', count }`
 */
async function gameHint(ctx, payload) {
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    require_(table, 'Nie siedzisz przy żadnym stole.');
    require_(
        table.mode !== 'human' || ctx.deps.config.flags.allowHintsVsHuman,
        'Podpowiedzi są wyłączone w grze z żywym przeciwnikiem.',
    );

    return { hints: ctx.deps.tables.hints(ctx.user.id, payload.count || 5) };
}

/** Zwraca aktualny stan partii. */
async function gameState(ctx) {
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    require_(table, 'Nie siedzisz przy żadnym stole.');
    return { state: table.toGameState(ctx.user.id) };
}

/**
 * Podgląd na żywo — pokazuje przeciwnikom, gdzie układamy klocki,
 * ale **bez ujawniania liter**. Wysyłane bardzo często, więc bez odpowiedzi.
 * Klient: `{ type: 'game:preview', tiles: [{ x, y, isBlank }] }`
 */
async function gamePreview(ctx, payload) {
    const table = ctx.deps.tables.tableOf(ctx.user.id);
    if (!table || !table.game || table.game.finished) return null;

    const seat = table.seatOf(ctx.user.id);
    if (!seat) return null;

    const tiles = (payload.tiles || []).slice(0, 16).map(t => ({
        x: Number(t.x), y: Number(t.y), isBlank: !!t.isBlank,
    }));

    for (const userId of ctx.hub.audienceOf(table)) {
        if (userId === ctx.user.id) continue;
        ctx.hub.sendToUser(userId, { type: 'preview', tableId: table.id, slot: seat.slot, tiles });
    }
    return null;
}

module.exports = {
    auth,
    sync,
    ping,
    lobby,
    'table:create': tableCreate,
    'table:join': tableJoin,
    'table:joinCode': tableJoinCode,
    'table:leave': tableLeave,
    'table:start': tableStart,
    'table:rematch': tableRematch,
    'table:chat': tableChat,
    'game:move': gameMove,
    'game:exchange': gameExchange,
    'game:pass': gamePass,
    'game:resign': gameResign,
    'game:hint': gameHint,
    'game:state': gameState,
    'game:preview': gamePreview,
};
