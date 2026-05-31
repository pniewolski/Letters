const crypto = require('crypto');
const WordDictionary = require('../board/WordDictionary');
const Game = require('./Game');

/**
 * @class GameManager
 * @description Menedżer gier — zarządza wieloma równoległymi rozgrywkami Scrabble.
 * Obsługuje tworzenie gier (z komputerem lub innym graczem), dołączanie,
 * wykonywanie ruchów, pasowanie, wymianę liter, chat i sprawdzanie stanu gry.
 *
 * Każdy gracz identyfikowany jest przez unikalny userId (UUID).
 * Każda gra identyfikowana jest przez gameId (UUID).
 *
 * Typy gier:
 * - 'computer' — gracz vs komputer (komputer gra automatycznie po ruchu gracza)
 * - 'human' — gracz vs gracz (wymaga dołączenia drugiego gracza)
 *
 * @example
 * const GameManager = require('./GameManager');
 * const gm = new GameManager();
 *
 * // Gra z komputerem
 * const { gameId, userId, state } = await gm.createGameWithComputer();
 * const result = gm.makeMove(userId, [{letter:'K', x:7, y:7, isBlank:false}]);
 *
 * // Gra z człowiekiem
 * const { gameId, userId: user1 } = await gm.createGameWithHuman();
 * const { userId: user2 } = gm.joinGame(gameId);
 * gm.makeMove(user1, [{letter:'K', x:7, y:7, isBlank:false}]);
 */
class GameManager {
    /**
     * Tworzy menedżer gier. Inicjalizuje słownik (ładowany asynchronicznie).
     */
    constructor() {
        this.dict = new WordDictionary();
        this.games = new Map();       // gameId -> gameState
        this.userIndex = new Map();   // userId -> { gameId, slot }
    }

    /**
     * Generuje unikalny identyfikator UUID.
     * @returns {string} UUID
     * @private
     */
    _generateId() {
        return crypto.randomUUID();
    }

    /**
     * Rozwiązuje userId na obiekt stanu gry.
     * @param {string} userId - Identyfikator użytkownika
     * @returns {{gameId: string, state: object, slot: number}|null} Dane gry lub null
     * @private
     */
    _resolve(userId) {
        const idx = this.userIndex.get(userId);
        if (!idx) return null;
        const state = this.games.get(idx.gameId);
        if (!state) return null;
        return { gameId: idx.gameId, state, slot: idx.slot };
    }

    /**
     * Zwraca numer slota aktualnego gracza (czyja kolej).
     * @param {object} state - Stan gry
     * @returns {number} 0 lub 1
     * @private
     */
    _currentSlot(state) {
        return state.game.table.currentTurn % 2;
    }

    /**
     * Buduje publiczny stan gry widoczny dla gracza (ukrywa stojak przeciwnika).
     * @param {object} state - Wewnętrzny stan gry
     * @param {number} slot - Slot gracza (0 lub 1)
     * @returns {object} Stan publiczny:
     *   { board, myStack, myPoints, opponentPoints, bagSize, myTurn, finished, opponentConnected, chat }
     * @private
     */
    _buildPublicState(state, slot) {
        const opponentSlot = slot === 0 ? 1 : 0;
        return {
            board: state.game.table.board.getBoardState(),
            myStack: state.game.table.stack[slot],
            myPoints: state.game.table.points[slot],
            opponentPoints: state.game.table.points[opponentSlot],
            bagSize: state.game.table.bag.getBagSize(),
            myTurn: this._currentSlot(state) === slot,
            finished: state.finished,
            opponentConnected: state.type === 'computer' || state.players.length === 2,
            chat: state.chat,
        };
    }

    /**
     * Sprawdza warunki zakończenia gry (2x pass obu graczy lub pusty worek + stojak).
     * @param {object} state - Stan gry
     * @returns {boolean} true jeśli gra się zakończyła
     * @private
     */
    _checkGameEnd(state) {
        const table = state.game.table;
        if (state.passCount[0] >= 2 && state.passCount[1] >= 2) {
            state.finished = true;
            return true;
        }
        if (table.bag.getBagSize() === 0) {
            if (table.stack[0].length === 0 || table.stack[1].length === 0) {
                state.finished = true;
                return true;
            }
        }
        return false;
    }

    /**
     * Wykonuje ruch komputera i zwraca zdobyte punkty.
     * @param {object} state - Stan gry
     * @returns {{points: number}} Punkty zdobyte przez komputer
     * @private
     */
    _doComputerMove(state) {
        const compSlot = 1;
        const before = state.game.table.points[compSlot];
        state.game.computerMove(compSlot);
        const after = state.game.table.points[compSlot];
        state.passCount[compSlot] = 0;
        this._checkGameEnd(state);
        return { points: after - before };
    }

    /**
     * Waliduje czy użytkownik może wykonać ruch (gra aktywna, jego kolej).
     * @param {string} userId - Identyfikator użytkownika
     * @returns {object} Obiekt rozwiązany lub { error: string }
     * @private
     */
    _guardActive(userId) {
        const r = this._resolve(userId);
        if (!r) return { error: "Nie znaleziono gry dla tego użytkownika." };
        if (!r.state.started) return { error: "Gra jeszcze się nie rozpoczęła." };
        if (r.state.finished) return { error: "Gra jest zakończona." };
        if (this._currentSlot(r.state) !== r.slot) return { error: "Nie twoja kolej." };
        return r;
    }

    // === PUBLICZNE METODY ===

    /**
     * Tworzy nową grę przeciwko komputerowi.
     * @param {number} [difficulty=1] - Poziom trudności (zarezerwowany na przyszłość)
     * @returns {Promise<{success: boolean, gameId: string, userId: string, state: object}>}
     *
     * @example
     * const { gameId, userId, state } = await gm.createGameWithComputer();
     */
    async createGameWithComputer(difficulty = 1) {
        await this.dict.ready;

        const gameId = this._generateId();
        const userId = this._generateId();
        const game = new Game(this.dict);

        const state = {
            game, type: 'computer', difficulty,
            players: [{ userId, slot: 0 }],
            started: true, finished: false,
            chat: [], passCount: [0, 0],
        };

        this.games.set(gameId, state);
        this.userIndex.set(userId, { gameId, slot: 0 });

        return { success: true, gameId, userId, state: this._buildPublicState(state, 0) };
    }

    /**
     * Tworzy nową grę dla dwóch ludzkich graczy (oczekuje na dołączenie drugiego).
     * @returns {Promise<{success: boolean, gameId: string, userId: string}>}
     *
     * @example
     * const { gameId, userId } = await gm.createGameWithHuman();
     * // Przekaż gameId drugiemu graczowi aby mógł dołączyć
     */
    async createGameWithHuman() {
        await this.dict.ready;

        const gameId = this._generateId();
        const userId = this._generateId();
        const game = new Game(this.dict);

        const state = {
            game, type: 'human', difficulty: null,
            players: [{ userId, slot: 0 }],
            started: false, finished: false,
            chat: [], passCount: [0, 0],
        };

        this.games.set(gameId, state);
        this.userIndex.set(userId, { gameId, slot: 0 });

        return { success: true, gameId, userId };
    }

    /**
     * Dołącza drugiego gracza do istniejącej gry (human vs human).
     * @param {string} gameId - Identyfikator gry
     * @returns {{success: boolean, userId?: string, state?: object, error?: string}}
     */
    joinGame(gameId) {
        const state = this.games.get(gameId);
        if (!state) return { success: false, error: "Gra nie istnieje." };
        if (state.type !== 'human') return { success: false, error: "Nie można dołączyć do gry z komputerem." };
        if (state.players.length >= 2) return { success: false, error: "Gra jest już pełna." };
        if (state.finished) return { success: false, error: "Gra jest zakończona." };

        const userId = this._generateId();
        state.players.push({ userId, slot: 1 });
        state.started = true;
        this.userIndex.set(userId, { gameId, slot: 1 });

        return { success: true, userId, state: this._buildPublicState(state, 1) };
    }

    /**
     * Kończy grę i usuwa graczy z indeksu.
     * @param {string} userId - Identyfikator dowolnego gracza w grze
     * @returns {{success: boolean, message?: string, error?: string}}
     */
    leaveGame(userId) {
        const r = this._resolve(userId);
        if (!r) return { success: false, error: "Nie znaleziono gry." };

        r.state.finished = true;
        // Usuń obu graczy z indeksu
        for (const p of r.state.players) {
            this.userIndex.delete(p.userId);
        }

        return { success: true, message: "Gra zakończona." };
    }

    /**
     * Wysyła wiadomość na czacie gry.
     * @param {string} userId - Identyfikator nadawcy
     * @param {string} message - Treść wiadomości
     * @returns {{success: boolean, error?: string}}
     */
    sendChat(userId, message) {
        const r = this._resolve(userId);
        if (!r) return { success: false, error: "Nie znaleziono gry." };

        r.state.chat.push({ slot: r.slot, message, timestamp: Date.now() });
        return { success: true };
    }

    /**
     * Wykonuje ruch gracza (położenie liter na planszy).
     * W grze z komputerem automatycznie wykonuje odpowiedź komputera.
     * @param {string} userId - Identyfikator gracza
     * @param {Array<{letter: string, x: number, y: number, isBlank: boolean}>} tiles - Kładzione litery
     * @returns {object} Wynik:
     *   - Sukces: { success: true, lostTurn: boolean, points?: number, computerMove?: object, state }
     *   - Błąd: { success: false, error: string }
     */
    makeMove(userId, tiles) {
        const r = this._guardActive(userId);
        if (r.error) return { success: false, error: r.error };

        const result = r.state.game.humanMove(r.slot, false, { tiles });
        if (!result.success) return { success: false, error: result.errors.join('; ') };

        r.state.passCount[r.slot] = 0;
        let computerMove = null;

        if (result.lostTurn) {
            this._checkGameEnd(r.state);
            if (r.state.type === 'computer' && !r.state.finished) {
                computerMove = this._doComputerMove(r.state);
            }
            return {
                success: true, lostTurn: true,
                wrongWords: result.wrongWords,
                computerMove,
                state: this._buildPublicState(r.state, r.slot),
            };
        }

        this._checkGameEnd(r.state);
        if (r.state.type === 'computer' && !r.state.finished) {
            computerMove = this._doComputerMove(r.state);
        }

        return {
            success: true, lostTurn: false,
            points: result.points, computerMove,
            state: this._buildPublicState(r.state, r.slot),
        };
    }

    /**
     * Wymienia litery gracza. W grze z komputerem automatycznie wykonuje odpowiedź komputera.
     * @param {string} userId - Identyfikator gracza
     * @param {string[]} letters - Litery do wymiany
     * @returns {object} Wynik:
     *   - Sukces: { success: true, computerMove?: object, state }
     *   - Błąd: { success: false, error: string }
     */
    replaceLetters(userId, letters) {
        const r = this._guardActive(userId);
        if (r.error) return { success: false, error: r.error };

        const result = r.state.game.humanMove(r.slot, true, { letters });
        if (!result.success) return { success: false, error: result.errors.join('; ') };

        r.state.passCount[r.slot] = 0;
        let computerMove = null;
        if (r.state.type === 'computer' && !r.state.finished) {
            computerMove = this._doComputerMove(r.state);
        }

        return {
            success: true, computerMove,
            state: this._buildPublicState(r.state, r.slot),
        };
    }

    /**
     * Pasuje (pomija turę). W grze z komputerem automatycznie wykonuje odpowiedź komputera.
     * Dwa pasowania z rzędu obu graczy kończą grę.
     * @param {string} userId - Identyfikator gracza
     * @returns {object} Wynik:
     *   - Sukces: { success: true, computerMove?: object, state }
     *   - Błąd: { success: false, error: string }
     */
    pass(userId) {
        const r = this._guardActive(userId);
        if (r.error) return { success: false, error: r.error };

        r.state.game.table.currentTurn += 1;
        r.state.passCount[r.slot] += 1;
        this._checkGameEnd(r.state);

        let computerMove = null;
        if (r.state.type === 'computer' && !r.state.finished) {
            computerMove = this._doComputerMove(r.state);
        }

        return {
            success: true, computerMove,
            state: this._buildPublicState(r.state, r.slot),
        };
    }

    /**
     * Zwraca aktualny publiczny stan gry dla gracza.
     * @param {string} userId - Identyfikator gracza
     * @returns {{success: boolean, state?: object, error?: string}}
     */
    getGameState(userId) {
        const r = this._resolve(userId);
        if (!r) return { success: false, error: "Nie znaleziono gry." };
        return { success: true, state: this._buildPublicState(r.state, r.slot) };
    }
}

module.exports = GameManager;
