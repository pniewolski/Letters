/**
 * @class GameTable
 * @description Stół w lobby — czyli to, przy czym siadają gracze. Trzyma
 * konfigurację (tryb gry, liczba miejsc, zegar, prywatność), obsadę miejsc
 * oraz trwającą partię.
 *
 * Miejsce przy stole może być:
 * - `open` — wolne, można usiąść,
 * - `human` — zajęte przez gracza (konto albo gość),
 * - `computer` — obsadzone przez komputer.
 *
 * Tryb stołu wynika z obsady: same komputery to podgląd symulacji, mieszanka
 * to gra z komputerem, sami ludzie to gra sieciowa.
 *
 * @example
 * const table = new GameTable({ id: 1, code: 'AB12CD', name: 'Stolik Ali', variant, seats: 2 });
 * table.sit(0, { userId: 7, name: 'Ala' });
 * table.fillOpenSeatsWithComputers();
 * table.startGame(dict);
 */

const Game = require('../game/Game');

/** Stany stołu. */
const STATUS = { WAITING: 'waiting', PLAYING: 'playing', FINISHED: 'finished', CLOSED: 'closed' };

class GameTable {
    /**
     * @param {object} config
     * @param {number} config.id - Identyfikator stołu w bazie
     * @param {string} config.code - Krótki kod do dołączania
     * @param {string} config.name - Nazwa stołu
     * @param {number|null} config.ownerId - Właściciel (null dla stołów systemowych)
     * @param {import('../variant/compile').CompiledVariant} config.variant - Tryb gry
     * @param {number} [config.seats=2] - Liczba miejsc (2–4)
     * @param {number} [config.computerSeats=0] - Ile miejsc obsadza komputer
     * @param {number} [config.aiLevel=2] - Poziom komputera (1–3)
     * @param {boolean} [config.isPrivate=false] - Czy stół jest ukryty w lobby
     * @param {string|null} [config.passwordHash=null] - Hash hasła do stołu
     * @param {boolean} [config.rated=true] - Czy partia liczy się do rankingu
     * @param {number} [config.turnSeconds=0] - Limit sekund na ruch (0 = bez limitu)
     */
    constructor(config) {
        this.id = config.id;
        this.code = config.code;
        this.name = config.name;
        this.ownerId = config.ownerId ?? null;
        this.variant = config.variant;
        this.seatCount = Math.max(2, Math.min(4, config.seats || 2));
        this.aiLevel = Math.max(1, Math.min(3, config.aiLevel || 2));
        this.isPrivate = !!config.isPrivate;
        this.passwordHash = config.passwordHash || null;
        this.rated = config.rated !== false;
        this.turnSeconds = Math.max(0, Math.min(3600, config.turnSeconds || 0));

        this.status = STATUS.WAITING;
        this.createdAt = Date.now();
        this.updatedAt = this.createdAt;

        /** @type {Array<object>} Miejsca przy stole. */
        this.seats = Array.from({ length: this.seatCount }, (_, slot) => ({
            slot, type: 'open', userId: null, name: null, avatar: null,
            isGuest: false, connected: false, resigned: false,
        }));

        // Miejsca komputerowe obsadzamy od końca, żeby ludzie siadali od slotu 0.
        const computers = Math.max(0, Math.min(this.seatCount, config.computerSeats || 0));
        for (let i = 0; i < computers; i++) {
            this._setComputerSeat(this.seatCount - 1 - i);
        }

        /** @type {Set<number>} Widzowie (identyfikatory kont). */
        this.spectators = new Set();
        /** @type {Array<object>} Czat stołu. */
        this.chat = [];
        /** @type {Game|null} Trwająca partia. */
        this.game = null;
        /** @type {number|null} Identyfikator partii w bazie. */
        this.gameId = null;
        /** @type {number|null} Kiedy zaczęła się bieżąca tura. */
        this.turnStartedAt = null;
        /** @type {number|null} Miejsce, któremu biegnie czas bieżącej tury. */
        this.turnSlot = null;
        /** @type {number[]} Łączny czas namysłu każdego miejsca w tej partii (ms). */
        this.timeUsed = this.seats.map(() => 0);
        /** @type {Array<object>} Wyniki po zakończeniu partii. */
        this.results = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OBSADA MIEJSC
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Obsadza miejsce komputerem.
     * @param {number} slot
     * @private
     */
    _setComputerSeat(slot) {
        const seat = this.seats[slot];
        seat.type = 'computer';
        seat.userId = null;
        seat.name = `Komputer ${slot + 1}`;
        seat.avatar = '🤖';
        seat.isGuest = false;
        seat.connected = true;
    }

    /**
     * Tryb stołu wynikający z obsady.
     * @returns {'human'|'computer'|'compcomp'}
     */
    get mode() {
        const computers = this.seats.filter(s => s.type === 'computer').length;
        if (computers === this.seatCount) return 'compcomp';
        return computers > 0 ? 'computer' : 'human';
    }

    /**
     * Numer pierwszego wolnego miejsca.
     * @returns {number} Slot albo -1
     */
    firstOpenSeat() {
        const seat = this.seats.find(s => s.type === 'open');
        return seat ? seat.slot : -1;
    }

    /**
     * Ilu ludzi siedzi przy stole.
     * @returns {number}
     */
    humanCount() {
        return this.seats.filter(s => s.type === 'human').length;
    }

    /**
     * Czy wszystkie miejsca są obsadzone.
     * @returns {boolean}
     */
    isFull() {
        return this.seats.every(s => s.type !== 'open');
    }

    /**
     * Znajduje miejsce zajmowane przez gracza.
     * @param {number} userId
     * @returns {object|null}
     */
    seatOf(userId) {
        return this.seats.find(s => s.type === 'human' && s.userId === userId) || null;
    }

    /**
     * Sadza gracza przy stole.
     * @param {number} slot - Numer miejsca (-1 = pierwsze wolne)
     * @param {object} user - `{ userId, name, avatar, isGuest }`
     * @returns {{success: boolean, error?: string, seat?: object}}
     */
    sit(slot, user) {
        if (this.status !== STATUS.WAITING) {
            return { success: false, error: 'Partia przy tym stole już się zaczęła.' };
        }
        if (this.seatOf(user.userId)) {
            return { success: false, error: 'Już siedzisz przy tym stole.' };
        }

        const target = slot >= 0 && slot < this.seatCount ? slot : this.firstOpenSeat();
        if (target === -1) return { success: false, error: 'Wszystkie miejsca są zajęte.' };
        if (this.seats[target].type !== 'open') {
            return { success: false, error: 'To miejsce jest już zajęte.' };
        }

        const seat = this.seats[target];
        seat.type = 'human';
        seat.userId = user.userId;
        seat.name = user.name;
        seat.avatar = user.avatar || null;
        seat.isGuest = !!user.isGuest;
        seat.connected = true;
        this.spectators.delete(user.userId);
        this.touch();

        return { success: true, seat };
    }

    /**
     * Zwalnia miejsce gracza (albo usuwa go z widowni).
     * @param {number} userId
     * @returns {{left: boolean, wasPlayer: boolean}}
     */
    stand(userId) {
        const seat = this.seatOf(userId);
        if (!seat) {
            const wasSpectator = this.spectators.delete(userId);
            return { left: wasSpectator, wasPlayer: false };
        }

        if (this.status === STATUS.PLAYING) {
            // W trakcie partii wstanie od stołu to poddanie się.
            seat.resigned = true;
            seat.connected = false;
            if (this.game) this.game.resign(seat.slot);
        } else {
            this.releaseSeat(seat.slot);
        }
        this.touch();
        return { left: true, wasPlayer: true };
    }

    /**
     * Zwalnia miejsce — robi z niego wolne krzesło.
     * @param {number} slot
     */
    releaseSeat(slot) {
        const seat = this.seats[slot];
        if (!seat) return;
        seat.type = 'open';
        seat.userId = null;
        seat.name = null;
        seat.avatar = null;
        seat.isGuest = false;
        seat.connected = false;
        seat.resigned = false;
        this.touch();
    }

    /**
     * Obsadza wszystkie wolne miejsca komputerami — pozwala zacząć grę
     * bez czekania na resztę ludzi.
     * @returns {number} Ile miejsc obsadzono
     */
    fillOpenSeatsWithComputers() {
        let filled = 0;
        for (const seat of this.seats) {
            if (seat.type === 'open') { this._setComputerSeat(seat.slot); filled++; }
        }
        this.touch();
        return filled;
    }

    /**
     * Oznacza, czy gracz jest podłączony.
     * @param {number} userId
     * @param {boolean} connected
     */
    setConnected(userId, connected) {
        const seat = this.seatOf(userId);
        if (seat) { seat.connected = connected; this.touch(); }
    }

    /** Odświeża znacznik ostatniej zmiany. */
    touch() {
        this.updatedAt = Date.now();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARTIA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Rozpoczyna partię.
     * @param {import('../board/WordDictionary')} dict - Załadowany słownik
     * @returns {{success: boolean, error?: string}}
     */
    startGame(dict) {
        if (this.status === STATUS.PLAYING) return { success: false, error: 'Partia już trwa.' };
        if (!this.isFull()) return { success: false, error: 'Nie wszystkie miejsca są obsadzone.' };

        this.game = new Game(dict, this.variant, {
            players: this.seatCount,
            aiLevel: this.aiLevel,
        });
        this.status = STATUS.PLAYING;
        this.results = null;
        this.timeUsed = this.seats.map(() => 0);
        this.turnSlot = this.game.currentPlayer();
        this.turnStartedAt = Date.now();
        this.touch();
        return { success: true };
    }

    /**
     * Czy miejscem, którego jest tura, steruje komputer.
     * @returns {boolean}
     */
    isComputerTurn() {
        if (!this.game || this.game.finished) return false;
        return this.seats[this.game.currentPlayer()].type === 'computer';
    }

    /**
     * Ile milisekund zostało graczowi na bieżący ruch. Limit dotyczy tylko
     * ludzi — komputer rusza się sam, więc w jego turze zegar nie odlicza.
     * @returns {number|null} `null`, gdy stół nie ma limitu czasu albo rusza się komputer
     */
    timeLeftMs() {
        if (!this.turnSeconds || !this.turnStartedAt || this.status !== STATUS.PLAYING) return null;
        if (this.isComputerTurn()) return null;
        return Math.max(0, this.turnSeconds * 1000 - (Date.now() - this.turnStartedAt));
    }

    /**
     * Ile milisekund trwa już bieżąca tura.
     * @returns {number|null} `null`, gdy partia nie trwa
     */
    turnElapsedMs() {
        if (!this.turnStartedAt || this.status !== STATUS.PLAYING) return null;
        return Math.max(0, Date.now() - this.turnStartedAt);
    }

    /**
     * Odnotowuje początek nowej tury: dopisuje zużyty czas poprzedniemu
     * graczowi i zeruje zegar. Jeśli tura nie zmieniła właściciela (np. ktoś
     * poddał partię poza swoją kolejką), zegar biegnie dalej.
     */
    markTurnStart() {
        const current = this.game && !this.game.finished ? this.game.currentPlayer() : null;
        if (current === this.turnSlot && this.turnStartedAt) return;

        this._settleTurnTime();
        this.turnSlot = current;
        this.turnStartedAt = Date.now();
    }

    /**
     * Dopisuje czas trwającej tury do konta gracza, któremu biegł zegar.
     * @private
     */
    _settleTurnTime() {
        if (this.turnSlot == null || !this.turnStartedAt) return;
        this.timeUsed[this.turnSlot] += Math.max(0, Date.now() - this.turnStartedAt);
    }

    /**
     * Domyka partię i wylicza wyniki.
     * @param {string} [reason] - Powód zakończenia
     * @returns {Array<object>} Wyniki graczy
     */
    finishGame(reason) {
        if (!this.game) return [];
        if (!this.game.finished) this.game.finish(reason || 'abandoned');

        this.status = STATUS.FINISHED;
        this._settleTurnTime();
        this.turnStartedAt = null;
        this.turnSlot = null;
        this.results = this.game.results().map(r => {
            const seat = this.seats[r.slot];
            const highlights = this.game.playerHighlights(r.slot);
            return {
                ...r,
                userId: seat.userId,
                name: seat.name,
                isComputer: seat.type === 'computer',
                isGuest: seat.isGuest,
                ...highlights,
            };
        });
        this.touch();
        return this.results;
    }

    /**
     * Przygotowuje stół do kolejnej partii z tą samą obsadą (rewanż).
     */
    resetForRematch() {
        this.game = null;
        this.gameId = null;
        this.results = null;
        this.status = STATUS.WAITING;
        this.turnStartedAt = null;
        this.turnSlot = null;
        this.timeUsed = this.seats.map(() => 0);
        for (const seat of this.seats) seat.resigned = false;
        this.touch();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WIDOKI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ruch w postaci, którą wolno pokazać całemu stołowi. Przy wymianie
     * zostaje sama liczba klocków — to, które litery wróciły do worka,
     * jest wiedzą wyłącznie wymieniającego.
     * @param {object} move - Wpis z logu partii
     * @returns {object}
     */
    static publicMove(move) {
        if (!move || move.type !== 'exchange') return move;
        const { letters, ...rest } = move;
        return { ...rest, count: (letters || []).length };
    }

    /**
     * Karta stołu na liście w lobby.
     * @returns {object}
     */
    toCard() {
        return {
            id: this.id,
            code: this.code,
            name: this.name,
            ownerId: this.ownerId,
            mode: this.mode,
            status: this.status,
            seats: this.seatCount,
            taken: this.seats.filter(s => s.type !== 'open').length,
            hasPassword: !!this.passwordHash,
            isPrivate: this.isPrivate,
            rated: this.rated,
            turnSeconds: this.turnSeconds,
            aiLevel: this.aiLevel,
            spectators: this.spectators.size,
            variant: {
                id: this.variant.meta.id,
                slug: this.variant.meta.slug,
                name: this.variant.meta.name,
                size: this.variant.size,
                rackSize: this.variant.rackSize,
            },
            players: this.seats.map(s => ({
                slot: s.slot,
                type: s.type,
                userId: s.userId,
                name: s.name,
                avatar: s.avatar,
                isGuest: s.isGuest,
                connected: s.connected,
            })),
            createdAt: this.createdAt,
        };
    }

    /**
     * Pełny stan stołu dla siedzącego przy nim gracza lub widza.
     * @param {number|null} viewerId - Kto pyta
     * @returns {object}
     */
    toDetail(viewerId) {
        const seat = viewerId != null ? this.seatOf(viewerId) : null;
        return {
            ...this.toCard(),
            isOwner: viewerId != null && viewerId === this.ownerId,
            mySlot: seat ? seat.slot : null,
            spectating: viewerId != null && this.spectators.has(viewerId),
            chat: this.chat.slice(-60),
        };
    }

    /**
     * Stan partii widziany oczami konkretnej osoby.
     * Stojaki innych graczy są ukryte — poza podglądem symulacji komputerów,
     * gdzie odsłaniamy wszystko, bo nie ma czego chronić.
     *
     * @param {number|null} viewerId - Kto pyta (null = anonimowy widz)
     * @returns {object|null} Stan partii albo `null`, gdy partia nie trwa
     */
    toGameState(viewerId) {
        if (!this.game) return null;

        const seat = viewerId != null ? this.seatOf(viewerId) : null;
        const mySlot = seat ? seat.slot : null;
        const table = this.game.table;
        const revealAll = this.mode === 'compcomp' || this.game.finished;

        return {
            gameId: this.gameId,
            tableId: this.id,
            variant: this.variant.toClient(),
            board: table.board.getBoardState(),
            bagSize: table.bag.getBagSize(),
            currentSlot: this.game.finished ? null : this.game.currentPlayer(),
            finished: this.game.finished,
            endReason: this.game.endReason,
            mySlot,
            myRack: mySlot != null ? [...table.stack[mySlot]] : null,
            turnSeconds: this.turnSeconds,
            // Czasy są podane na moment wysłania — klient dolicza resztę sam.
            timeLeftMs: this.timeLeftMs(),
            turnElapsedMs: this.turnElapsedMs(),
            gameElapsedMs: (this.game.finishedAt || Date.now()) - this.game.startedAt,
            players: this.seats.map(s => ({
                slot: s.slot,
                userId: s.userId,
                name: s.name,
                avatar: s.avatar,
                isComputer: s.type === 'computer',
                isGuest: s.isGuest,
                connected: s.connected,
                resigned: this.game.resigned.has(s.slot),
                score: table.points[s.slot],
                timeUsedMs: this.timeUsed[s.slot],
                rackSize: table.stack[s.slot].length,
                rack: revealAll ? [...table.stack[s.slot]] : null,
            })),
            moves: this.game.moves.slice(-40).map(GameTable.publicMove),
            endgame: this.game.endgame || null,
            results: this.results,
        };
    }
}

module.exports = GameTable;
module.exports.STATUS = STATUS;
