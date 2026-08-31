/**
 * @class TableManager
 * @description Serce portalu: rejestr stołów, przebieg partii, ruchy komputera,
 * zegary i zapis wyników do bazy.
 *
 * Menedżer nie wie nic o WebSocketach — zamiast wysyłać wiadomości, **emituje
 * zdarzenia**, które warstwa sieciowa zamienia na komunikaty. Dzięki temu całą
 * logikę lobby da się przetestować bez uruchamiania serwera.
 *
 * Emitowane zdarzenia:
 * | zdarzenie | ładunek | znaczenie |
 * |-----------|---------|-----------|
 * | `lobby`   | —                     | zmieniła się lista stołów |
 * | `table`   | `{ table }`           | zmienił się stan stołu |
 * | `game`    | `{ table }`           | zmienił się stan partii |
 * | `move`    | `{ table, move }`     | ktoś wykonał ruch |
 * | `over`    | `{ table, results }`  | partia się zakończyła |
 * | `chat`    | `{ table, entry }`    | wiadomość na czacie stołu |
 *
 * @example
 * const tables = new TableManager({ dict, db, variants, games });
 * tables.on('lobby', () => broadcastLobby());
 * const table = await tables.create(user, { variantId: 1, seats: 2 });
 */

const { EventEmitter } = require('events');
const GameTable = require('./GameTable');
const { STATUS } = require('./GameTable');
const { randomCode, hashPassword, verifyPassword } = require('../auth/password');

/** Ustawienia czasowe menedżera. */
const TIMING = {
    /** Pauza przed ruchem komputera przy stole z człowiekiem. */
    computerDelayMs: 900,
    /** Tempo symulacji komputer vs komputer. */
    simulationStepMs: 1400,
    /** Po jakim czasie bezczynności zamykamy pusty stół. */
    idleCloseMs: 20 * 60 * 1000,
    /** Jak często sprzątać. */
    sweepMs: 60 * 1000,
    /** Zabezpieczenie przed patologicznie długą symulacją. */
    maxSimulationSteps: 800,
    /**
     * Ile czasu dajemy na powrót, zanim zwolnimy miejsce przy stole, który
     * jeszcze nie wystartował. Na telefonie zminimalizowanie przeglądarki
     * zrywa połączenie — bez tej karencji gracz traciłby miejsce za każdym
     * spojrzeniem na powiadomienie.
     */
    reconnectGraceMs: 90 * 1000,
    /**
     * Po tylu milisekundach nieobecności pasujemy za gracza, żeby partia
     * nie stała w miejscu przez kogoś, komu padł telefon.
     */
    absentPassMs: 150 * 1000,
};

/** Ile stołów może mieć jeden gracz jednocześnie. */
const MAX_TABLES_PER_USER = 3;

class TableManager extends EventEmitter {
    /**
     * @param {object} deps
     * @param {import('../board/WordDictionary')} deps.dict - Załadowany słownik
     * @param {import('../db/Database')} deps.db - Baza danych
     * @param {import('../repo/VariantRepo')} deps.variants - Repozytorium trybów gry
     * @param {import('../repo/GameRepo')} deps.games - Repozytorium partii
     */
    constructor({ dict, db, variants, games }) {
        super();
        this.dict = dict;
        this.db = db;
        this.variants = variants;
        this.games = games;

        /** @type {Map<number, GameTable>} Stoły w pamięci. */
        this.tables = new Map();
        /** @type {Map<number, number>} userId → tableId (gdzie gracz siedzi). */
        this.userTable = new Map();
        /** @type {Map<number, NodeJS.Timeout>} tableId → timer ruchu komputera. */
        this.aiTimers = new Map();
        /** @type {Map<number, NodeJS.Timeout>} tableId → timer limitu czasu na ruch. */
        this.clockTimers = new Map();
        /** @type {Map<number, NodeJS.Timeout>} tableId → timer pasa za nieobecnego. */
        this.absentTimers = new Map();
        /** @type {Map<string, NodeJS.Timeout>} "tableId:userId" → timer zwolnienia miejsca. */
        this.seatTimers = new Map();
        /** @type {Map<number, number>} tableId → licznik kroków symulacji. */
        this.simSteps = new Map();

        this.sweeper = setInterval(() => this.sweep(), TIMING.sweepMs);
        if (this.sweeper.unref) this.sweeper.unref();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TWORZENIE I DOŁĄCZANIE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Zakłada nowy stół.
     * @param {object} user - Zakładający `{ id, displayName, avatar, isGuest }`
     * @param {object} options - Konfiguracja stołu
     * @param {string} [options.name] - Nazwa stołu
     * @param {number} [options.variantId] - Tryb gry (domyślnie tryb domyślny portalu)
     * @param {number} [options.seats=2] - Liczba miejsc (2–4)
     * @param {number} [options.computerSeats=0] - Ile miejsc dla komputera
     * @param {number} [options.aiLevel=2] - Poziom komputera
     * @param {boolean} [options.isPrivate=false] - Ukryj w lobby
     * @param {string} [options.password] - Hasło do stołu
     * @param {boolean} [options.rated=true] - Czy partia jest rankingowa
     * @param {number} [options.turnSeconds=0] - Limit czasu na ruch
     * @returns {Promise<GameTable>}
     * @throws {Error} Gdy przekroczono limit stołów albo tryb gry nie istnieje
     */
    async create(user, options = {}) {
        const owned = [...this.tables.values()].filter(
            t => t.ownerId === user.id && t.status !== STATUS.CLOSED,
        );
        if (owned.length >= MAX_TABLES_PER_USER) {
            throw new Error(`Masz już ${MAX_TABLES_PER_USER} otwarte stoły — zamknij któryś przed założeniem nowego.`);
        }

        const variant = options.variantId
            ? await this.variants.getCompiled(options.variantId)
            : await this.variants.getDefaultCompiled();
        if (!variant) throw new Error('Nie znaleziono wybranego trybu gry.');

        const seats = Math.max(2, Math.min(4, Number(options.seats) || 2));
        const computerSeats = Math.max(0, Math.min(seats, Number(options.computerSeats) || 0));

        // Partie z komputerem nie liczą się do rankingu. Gościom ranking i tak
        // nie przysługuje — pilnuje tego warstwa statystyk, więc tutaj tylko
        // odcinamy stoły z botami.
        const rated = options.rated !== false && computerSeats === 0;

        const passwordHash = options.password
            ? await hashPassword(String(options.password))
            : null;

        const code = await this._uniqueCode();
        const now = Date.now();

        const id = await this.db.insert('game_tables', {
            code,
            name: String(options.name || `Stolik ${user.displayName}`).trim().slice(0, 64),
            owner_id: user.id,
            variant_id: variant.meta.id ?? 0,
            mode: computerSeats === seats ? 'compcomp' : (computerSeats > 0 ? 'computer' : 'human'),
            seats,
            ai_level: Math.max(1, Math.min(3, Number(options.aiLevel) || 2)),
            is_private: options.isPrivate ? 1 : 0,
            password_hash: passwordHash,
            rated: rated ? 1 : 0,
            turn_seconds: Math.max(0, Math.min(3600, Number(options.turnSeconds) || 0)),
            status: STATUS.WAITING,
            created_at: now,
            updated_at: now,
        });

        const table = new GameTable({
            id,
            code,
            name: String(options.name || `Stolik ${user.displayName}`).trim().slice(0, 64),
            ownerId: user.id,
            variant,
            seats,
            computerSeats,
            aiLevel: Number(options.aiLevel) || 2,
            isPrivate: !!options.isPrivate,
            passwordHash,
            rated,
            turnSeconds: Number(options.turnSeconds) || 0,
        });

        this.tables.set(id, table);

        // Zakładający siada przy stole — chyba że sam obsadził wszystkie miejsca
        // komputerami; wtedy zostaje widzem symulacji.
        if (computerSeats < seats) {
            table.sit(-1, {
                userId: user.id,
                name: user.displayName,
                avatar: user.avatar,
                isGuest: user.isGuest,
            });
            this.userTable.set(user.id, id);
        } else {
            table.spectators.add(user.id);
            this.userTable.set(user.id, id);
        }

        this._maybeStart(table);
        this.emit('lobby');
        return table;
    }

    /**
     * Dołącza gracza do stołu — na wolne miejsce albo na widownię.
     * @param {object} user - Gracz
     * @param {number} tableId - Identyfikator stołu
     * @param {object} [options]
     * @param {string} [options.password] - Hasło do stołu
     * @param {number} [options.slot=-1] - Konkretne miejsce (-1 = pierwsze wolne)
     * @param {boolean} [options.asSpectator=false] - Dołącz jako widz
     * @returns {Promise<GameTable>}
     * @throws {Error} Gdy stół nie istnieje, hasło jest złe albo brak miejsc
     */
    async join(user, tableId, options = {}) {
        const table = this.tables.get(Number(tableId));
        if (!table || table.status === STATUS.CLOSED) throw new Error('Ten stół już nie istnieje.');

        // Powrót do stołu, przy którym już siedzimy — bez pytania o hasło.
        const existing = table.seatOf(user.id);
        if (existing) {
            table.setConnected(user.id, true);
            this.userTable.set(user.id, table.id);
            this.emit('table', { table });
            return table;
        }

        if (table.passwordHash && !await verifyPassword(options.password || '', table.passwordHash)) {
            throw new Error('Nieprawidłowe hasło do stołu.');
        }

        // Z innego stołu odchodzimy najpierw.
        const previous = this.userTable.get(user.id);
        if (previous && previous !== table.id) this.leave(user.id);

        const wantsSeat = !options.asSpectator && table.status === STATUS.WAITING;
        if (wantsSeat) {
            const result = table.sit(options.slot ?? -1, {
                userId: user.id,
                name: user.displayName,
                avatar: user.avatar,
                isGuest: user.isGuest,
            });
            if (!result.success && table.firstOpenSeat() !== -1) throw new Error(result.error);
            if (!result.success) table.spectators.add(user.id);
        } else {
            table.spectators.add(user.id);
        }

        this.userTable.set(user.id, table.id);
        this._maybeStart(table);
        this.emit('table', { table });
        this.emit('lobby');
        return table;
    }

    /**
     * Wypisuje gracza ze stołu. W trakcie partii oznacza to poddanie się.
     * @param {number} userId
     * @returns {GameTable|null} Stół, który gracz opuścił
     */
    leave(userId) {
        const tableId = this.userTable.get(userId);
        if (tableId == null) return null;

        const table = this.tables.get(tableId);
        this.userTable.delete(userId);
        if (!table) return null;

        const wasPlaying = table.status === STATUS.PLAYING;
        table.stand(userId);

        if (wasPlaying && table.game && table.game.finished) {
            this._concludeGame(table).catch(err => console.error('[Stoły] Błąd zapisu partii:', err));
        } else if (wasPlaying) {
            this._afterTurn(table);
        }

        if (this._isDeserted(table)) {
            this.close(table.id, 'opuszczony');
        } else {
            this.emit('table', { table });
            this.emit('lobby');
        }
        return table;
    }

    /**
     * Zamyka stół i sprząta po nim.
     * @param {number} tableId
     * @param {string} [reason] - Powód (trafia do logu)
     */
    close(tableId, reason = 'zamknięty') {
        const table = this.tables.get(tableId);
        if (!table) return;

        this._clearTimers(tableId);
        this._clearSeatTimers(tableId);

        if (table.game && !table.game.finished && table.gameId) {
            this.games.abandon(table.gameId).catch(() => {});
        }

        table.status = STATUS.CLOSED;
        for (const seat of table.seats) {
            if (seat.userId != null) this.userTable.delete(seat.userId);
        }
        for (const id of table.spectators) this.userTable.delete(id);

        this.tables.delete(tableId);
        this.db.update('game_tables', { status: STATUS.CLOSED, updated_at: Date.now() }, { id: tableId })
            .catch(() => {});

        this.emit('table', { table, closed: true, reason });
        this.emit('lobby');
    }

    /**
     * Obsadza wolne miejsca komputerami i zaczyna partię (przycisk „Zacznij").
     * @param {number} userId - Kto wydaje polecenie (musi być właścicielem)
     * @returns {Promise<GameTable>}
     * @throws {Error} Gdy gracz nie jest właścicielem albo stół nie czeka na start
     */
    async startNow(userId) {
        const table = this.tableOf(userId);
        if (!table) throw new Error('Nie siedzisz przy żadnym stole.');
        if (table.ownerId !== userId) throw new Error('Tylko zakładający stół może rozpocząć partię.');
        if (table.status !== STATUS.WAITING) throw new Error('Partia już trwa.');

        table.fillOpenSeatsWithComputers();
        // Stół z komputerem przestaje być rankingowy.
        if (table.mode !== 'human') table.rated = false;

        await this._maybeStart(table);
        this.emit('lobby');
        return table;
    }

    /**
     * Ustawia stół na rewanż z tą samą obsadą.
     * @param {number} userId - Kto prosi o rewanż
     * @returns {Promise<GameTable>}
     * @throws {Error}
     */
    async rematch(userId) {
        const table = this.tableOf(userId);
        if (!table) throw new Error('Nie siedzisz przy żadnym stole.');
        if (table.status !== STATUS.FINISHED) throw new Error('Partia jeszcze się nie skończyła.');

        table.resetForRematch();
        await this._maybeStart(table);
        this.emit('table', { table });
        this.emit('lobby');
        return table;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RUCHY
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sprawdza, czy gracz może teraz wykonać ruch.
     * @param {number} userId
     * @returns {{table: GameTable, slot: number}}
     * @throws {Error} Z komunikatem gotowym do pokazania graczowi
     * @private
     */
    _requireTurn(userId) {
        const table = this.tableOf(userId);
        if (!table) throw new Error('Nie siedzisz przy żadnym stole.');
        if (table.status !== STATUS.PLAYING || !table.game) throw new Error('Partia nie jest w toku.');
        if (table.game.finished) throw new Error('Partia już się zakończyła.');

        const seat = table.seatOf(userId);
        if (!seat) throw new Error('Jesteś widzem — nie możesz wykonywać ruchów.');
        if (table.game.currentPlayer() !== seat.slot) throw new Error('To nie twoja kolej.');

        return { table, slot: seat.slot };
    }

    /**
     * Kładzie litery na planszy.
     * @param {number} userId - Gracz
     * @param {Array<object>} tiles - Kładzione klocki
     * @returns {Promise<object>} Wynik ruchu z `Game.humanMove`
     */
    async move(userId, tiles) {
        const { table, slot } = this._requireTurn(userId);
        const result = table.game.humanMove(slot, { tiles });
        if (!result.success) return result;

        this.emit('move', { table, move: result.move });
        await this._afterTurn(table);
        return result;
    }

    /**
     * Wymienia litery.
     * @param {number} userId
     * @param {string[]} letters
     * @returns {Promise<object>}
     */
    async exchange(userId, letters) {
        const { table, slot } = this._requireTurn(userId);
        const result = table.game.exchange(slot, letters);
        if (!result.success) return result;

        this.emit('move', { table, move: result.move });
        await this._afterTurn(table);
        return result;
    }

    /**
     * Pasuje.
     * @param {number} userId
     * @returns {Promise<object>}
     */
    async pass(userId) {
        const { table, slot } = this._requireTurn(userId);
        const result = table.game.pass(slot);

        this.emit('move', { table, move: result.move });
        await this._afterTurn(table);
        return result;
    }

    /**
     * Poddaje partię.
     * @param {number} userId
     * @returns {Promise<object>}
     */
    async resign(userId) {
        const table = this.tableOf(userId);
        if (!table || !table.game || table.status !== STATUS.PLAYING) {
            throw new Error('Nie ma czego poddawać.');
        }
        const seat = table.seatOf(userId);
        if (!seat) throw new Error('Jesteś widzem.');

        const result = table.game.resign(seat.slot);
        seat.resigned = true;

        this.emit('move', { table, move: result.move });
        await this._afterTurn(table);
        return result;
    }

    /**
     * Zwraca podpowiedzi dla gracza.
     * @param {number} userId
     * @param {number} [count=5]
     * @returns {Array<object>}
     * @throws {Error}
     */
    hints(userId, count = 5) {
        const table = this.tableOf(userId);
        if (!table || !table.game) throw new Error('Partia nie jest w toku.');

        const seat = table.seatOf(userId);
        if (!seat) throw new Error('Jesteś widzem — podpowiedzi są dla graczy.');

        return table.game.hints(seat.slot, Math.max(1, Math.min(12, count)));
    }

    /**
     * Dopisuje wiadomość do czatu stołu.
     * @param {number} userId - Nadawca
     * @param {string} name - Nazwa nadawcy
     * @param {string} message - Treść
     * @returns {{table: GameTable, entry: object}}
     * @throws {Error}
     */
    chat(userId, name, message) {
        const table = this.tableOf(userId);
        if (!table) throw new Error('Nie siedzisz przy żadnym stole.');

        const text = String(message || '').trim().slice(0, 400);
        if (!text) throw new Error('Pusta wiadomość.');

        const seat = table.seatOf(userId);
        const entry = {
            userId, name, slot: seat ? seat.slot : null,
            message: text, at: Date.now(),
        };
        table.chat.push(entry);
        if (table.chat.length > 200) table.chat.shift();

        this.emit('chat', { table, entry });
        return { table, entry };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRZEBIEG PARTII
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Startuje partię, jeśli stół jest gotowy.
     * @param {GameTable} table
     * @returns {Promise<boolean>} Czy partia wystartowała
     * @private
     */
    async _maybeStart(table) {
        if (table.status !== STATUS.WAITING || !table.isFull()) return false;

        const started = table.startGame(this.dict);
        if (!started.success) return false;

        try {
            table.gameId = await this.games.start({
                tableId: table.id,
                variant: table.variant,
                mode: table.mode,
                seats: table.seatCount,
                rated: table.rated,
                players: table.seats.map(s => ({
                    slot: s.slot,
                    userId: s.type === 'human' ? s.userId : null,
                    name: s.name,
                    isComputer: s.type === 'computer',
                    isGuest: s.isGuest,
                })),
            });
            if (table.variant.meta.id) await this.variants.countPlay(table.variant.meta.id);
        } catch (err) {
            console.error('[Stoły] Nie udało się zapisać partii:', err);
        }

        await this.db.update('game_tables', { status: STATUS.PLAYING, updated_at: Date.now() }, { id: table.id })
            .catch(() => {});

        this.simSteps.set(table.id, 0);
        this.emit('game', { table });
        this._scheduleNext(table);
        return true;
    }

    /**
     * Sprząta po ruchu: sprawdza koniec partii, przestawia zegar
     * i planuje ruch komputera.
     * @param {GameTable} table
     * @private
     */
    async _afterTurn(table) {
        this._clearTimers(table.id);

        if (table.game && table.game.finished) {
            await this._concludeGame(table);
            return;
        }

        table.markTurnStart();
        this.emit('game', { table });
        this._scheduleNext(table);
    }

    /**
     * Planuje ruch komputera albo pilnowanie limitu czasu człowieka.
     * @param {GameTable} table
     * @private
     */
    _scheduleNext(table) {
        this._clearTimers(table.id);
        if (!table.game || table.game.finished || table.status !== STATUS.PLAYING) return;

        if (table.isComputerTurn()) {
            const delay = table.mode === 'compcomp' ? TIMING.simulationStepMs : TIMING.computerDelayMs;
            const timer = setTimeout(() => this._runComputerTurn(table), delay);
            this.aiTimers.set(table.id, timer);
            return;
        }

        if (table.turnSeconds > 0) {
            const timer = setTimeout(() => this._timeoutTurn(table), table.turnSeconds * 1000 + 250);
            this.clockTimers.set(table.id, timer);
        }

        // Gracz bez połączenia nie może zablokować stołu na zawsze — po dłuższej
        // nieobecności pasujemy za niego. Przy stole z zegarem zajmie się tym
        // limit czasu, o ile jest krótszy.
        const seat = table.seats[table.game.currentPlayer()];
        if (seat && seat.type === 'human' && !seat.connected) {
            const limit = table.turnSeconds > 0
                ? Math.min(TIMING.absentPassMs, table.turnSeconds * 1000)
                : TIMING.absentPassMs;
            const timer = setTimeout(() => this._passForAbsent(table), limit + 250);
            this.absentTimers.set(table.id, timer);
        }
    }

    /**
     * Pasuje za gracza, który stracił połączenie i nie wrócił.
     * @param {GameTable} table
     * @private
     */
    async _passForAbsent(table) {
        this.absentTimers.delete(table.id);
        if (!table.game || table.game.finished || table.status !== STATUS.PLAYING) return;

        const slot = table.game.currentPlayer();
        const seat = table.seats[slot];
        if (!seat || seat.type !== 'human' || seat.connected) return;

        const result = table.game.pass(slot);
        this.emit('move', { table, move: { ...result.move, absent: true } });
        this.emit('chat', {
            table,
            entry: {
                userId: null, name: 'Stół', slot, system: true, at: Date.now(),
                message: `${seat.name} stracił połączenie — pas.`,
            },
        });
        await this._afterTurn(table);
    }

    /**
     * Wykonuje ruch komputera.
     * @param {GameTable} table
     * @private
     */
    async _runComputerTurn(table) {
        this.aiTimers.delete(table.id);
        if (!table.game || table.game.finished || table.status !== STATUS.PLAYING) return;
        if (!table.isComputerTurn()) return;

        const steps = (this.simSteps.get(table.id) || 0) + 1;
        this.simSteps.set(table.id, steps);
        if (steps > TIMING.maxSimulationSteps) {
            table.game.finish('abandoned');
            await this._concludeGame(table);
            return;
        }

        try {
            const move = table.game.computerMove(table.game.currentPlayer());
            this.emit('move', { table, move });
        } catch (err) {
            console.error('[Stoły] Błąd ruchu komputera:', err);
            table.game.finish('abandoned');
        }

        await this._afterTurn(table);
    }

    /**
     * Reakcja na przekroczenie limitu czasu — gracz pasuje automatycznie.
     * @param {GameTable} table
     * @private
     */
    async _timeoutTurn(table) {
        this.clockTimers.delete(table.id);
        if (!table.game || table.game.finished || table.status !== STATUS.PLAYING) return;

        const slot = table.game.currentPlayer();
        const seat = table.seats[slot];
        if (seat.type !== 'human') return;

        const result = table.game.pass(slot);
        this.emit('move', { table, move: { ...result.move, timeout: true } });
        this.emit('chat', {
            table,
            entry: { userId: null, name: 'Zegar', slot, message: `${seat.name} nie zdążył — pas.`, at: Date.now(), system: true },
        });
        await this._afterTurn(table);
    }

    /**
     * Domyka partię: zapisuje wynik, ranking i statystyki.
     * @param {GameTable} table
     * @private
     */
    async _concludeGame(table) {
        this._clearTimers(table.id);
        const results = table.finishGame(table.game?.endReason);

        try {
            if (table.gameId) {
                const changes = await this.games.finish(table.gameId, {
                    participants: results.map(r => ({
                        slot: r.slot,
                        userId: r.isComputer ? null : r.userId,
                        isComputer: r.isComputer,
                        isGuest: r.isGuest,
                        score: r.score,
                        place: r.place,
                        result: r.result,
                        bestWord: r.bestWord,
                        bestWordPoints: r.bestWordPoints,
                        bingos: r.bingos,
                    })),
                    moves: table.game.moves,
                    reason: table.game.endReason || 'out',
                });

                for (const r of results) {
                    const change = changes.get(r.userId);
                    if (change) r.ratingDelta = change.after - change.before;
                }
            }
            await this.db.update('game_tables', { status: STATUS.FINISHED, updated_at: Date.now() }, { id: table.id });
        } catch (err) {
            console.error('[Stoły] Nie udało się zapisać wyniku partii:', err);
        }

        this.emit('game', { table });
        this.emit('over', { table, results });
        this.emit('lobby');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POMOCNICZE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Stół, przy którym siedzi (albo który ogląda) gracz.
     * @param {number} userId
     * @returns {GameTable|null}
     */
    tableOf(userId) {
        const id = this.userTable.get(userId);
        return id == null ? null : (this.tables.get(id) || null);
    }

    /**
     * Lista stołów widocznych w lobby.
     * @param {number|null} [viewerId] - Kto pyta (widzi też swoje prywatne stoły)
     * @returns {object[]} Karty stołów
     */
    listTables(viewerId = null) {
        return [...this.tables.values()]
            .filter(t => t.status !== STATUS.CLOSED)
            .filter(t => !t.isPrivate || t.ownerId === viewerId || t.seatOf(viewerId))
            .sort((a, b) => {
                // Najpierw stoły, do których można dosiąść.
                const aOpen = a.status === STATUS.WAITING && !a.isFull() ? 0 : 1;
                const bOpen = b.status === STATUS.WAITING && !b.isFull() ? 0 : 1;
                return aOpen - bOpen || b.updatedAt - a.updatedAt;
            })
            .map(t => t.toCard());
    }

    /**
     * Odnotowuje rozłączenie gracza — miejsce zostaje, ale świeci się jako offline.
     * @param {number} userId
     */
    markDisconnected(userId) {
        const table = this.tableOf(userId);
        if (!table) return;

        if (table.status === STATUS.WAITING && table.seatOf(userId)) {
            // Przed startem miejsce trzeba w końcu zwolnić, żeby stoły się nie
            // zatykały — ale dopiero po karencji na powrót.
            table.setConnected(userId, false);
            this._scheduleSeatRelease(table, userId);
            this.emit('table', { table });
            this.emit('lobby');
            return;
        }

        table.setConnected(userId, false);
        table.spectators.delete(userId);

        // Gracz, który zniknął w trakcie swojej tury, nie może blokować partii.
        if (table.status === STATUS.PLAYING) this._scheduleNext(table);

        // Bez żywej duszy przy stole nie ma po co dalej liczyć ruchów.
        if (this._isDeserted(table)) {
            this.close(table.id, 'brak graczy');
            return;
        }
        this.emit('table', { table });
    }

    /**
     * Odnotowuje powrót gracza.
     * @param {number} userId
     * @returns {GameTable|null} Stół, do którego wrócił
     */
    markConnected(userId) {
        const table = this.tableOf(userId);
        if (!table) return null;

        this._cancelSeatRelease(table.id, userId);
        table.setConnected(userId, true);

        // Wrócił w swojej turze — kasujemy pas za nieobecnego i wracamy do zegara.
        if (table.status === STATUS.PLAYING) this._scheduleNext(table);

        this.emit('table', { table });
        this.emit('lobby');
        return table;
    }

    /**
     * Planuje zwolnienie miejsca gracza, który stracił połączenie przed startem.
     * @param {GameTable} table
     * @param {number} userId
     * @private
     */
    _scheduleSeatRelease(table, userId) {
        const key = `${table.id}:${userId}`;
        this._cancelSeatRelease(table.id, userId);

        const timer = setTimeout(() => {
            this.seatTimers.delete(key);

            const current = this.tables.get(table.id);
            if (!current) return;

            const seat = current.seatOf(userId);
            if (!seat || seat.connected) return; // zdążył wrócić

            this.leave(userId);
        }, TIMING.reconnectGraceMs);

        this.seatTimers.set(key, timer);
    }

    /**
     * Kasuje zaplanowane zwolnienie miejsca.
     * @param {number} tableId
     * @param {number} userId
     * @private
     */
    _cancelSeatRelease(tableId, userId) {
        const key = `${tableId}:${userId}`;
        const timer = this.seatTimers.get(key);
        if (timer) { clearTimeout(timer); this.seatTimers.delete(key); }
    }

    /**
     * Czy przy stole nie został nikt żywy.
     * @param {GameTable} table
     * @returns {boolean}
     * @private
     */
    _isDeserted(table) {
        const humansConnected = table.seats.some(s => s.type === 'human' && s.connected);
        if (humansConnected || table.spectators.size > 0) return false;

        // Ktoś, komu zerwało połączenie, ma jeszcze karencję na powrót —
        // dopóki trwa, stół nie jest opuszczony.
        const prefix = `${table.id}:`;
        for (const key of this.seatTimers.keys()) {
            if (key.startsWith(prefix)) return false;
        }
        return true;
    }

    /**
     * Kasuje timery stołu.
     * @param {number} tableId
     * @private
     */
    _clearTimers(tableId) {
        for (const map of [this.aiTimers, this.clockTimers, this.absentTimers]) {
            const timer = map.get(tableId);
            if (timer) { clearTimeout(timer); map.delete(tableId); }
        }
    }

    /**
     * Kasuje karencje powrotu wszystkich graczy tego stołu.
     * @param {number} tableId
     * @private
     */
    _clearSeatTimers(tableId) {
        const prefix = `${tableId}:`;
        for (const [key, timer] of [...this.seatTimers]) {
            if (!key.startsWith(prefix)) continue;
            clearTimeout(timer);
            this.seatTimers.delete(key);
        }
    }

    /**
     * Zamyka opuszczone i przeterminowane stoły.
     * @returns {number} Ile stołów zamknięto
     */
    sweep() {
        const now = Date.now();
        let closed = 0;

        for (const table of [...this.tables.values()]) {
            const idle = now - table.updatedAt > TIMING.idleCloseMs;
            if (this._isDeserted(table) && (idle || table.status === STATUS.FINISHED)) {
                this.close(table.id, 'brak graczy');
                closed++;
            } else if (idle && table.status === STATUS.WAITING && table.humanCount() === 0) {
                this.close(table.id, 'bezczynny');
                closed++;
            }
        }
        return closed;
    }

    /**
     * Generuje kod stołu, który nie koliduje z istniejącymi.
     * @returns {Promise<string>}
     * @private
     */
    async _uniqueCode() {
        for (let i = 0; i < 12; i++) {
            const code = randomCode(6);
            const taken = await this.db.get('SELECT id FROM game_tables WHERE code = ?', [code]);
            if (!taken) return code;
        }
        return randomCode(10);
    }

    /** Zatrzymuje wszystkie timery (zamykanie serwera). */
    shutdown() {
        clearInterval(this.sweeper);
        for (const id of [...this.tables.keys()]) {
            this._clearTimers(id);
            this._clearSeatTimers(id);
        }
    }
}

module.exports = TableManager;
module.exports.TIMING = TIMING;
module.exports.MAX_TABLES_PER_USER = MAX_TABLES_PER_USER;
