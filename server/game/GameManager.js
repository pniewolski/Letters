const crypto = require('crypto');
const WordDictionary = require('../board/WordDictionary');
const Game = require('./Game');

class GameManager {
    constructor() {
        this.dict = new WordDictionary();
        this.games = new Map();       // gameId -> gameState
        this.userIndex = new Map();   // userId -> { gameId, slot }
    }

    _generateId() {
        return crypto.randomUUID();
    }

    _resolve(userId) {
        const idx = this.userIndex.get(userId);
        if (!idx) return null;
        const state = this.games.get(idx.gameId);
        if (!state) return null;
        return { gameId: idx.gameId, state, slot: idx.slot };
    }

    _currentSlot(state) {
        return state.game.table.currentTurn % 2;
    }

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

    _doComputerMove(state) {
        const compSlot = 1;
        const before = state.game.table.points[compSlot];
        state.game.computerMove(compSlot);
        const after = state.game.table.points[compSlot];
        state.passCount[compSlot] = 0;
        this._checkGameEnd(state);
        return { points: after - before };
    }

    _guardActive(userId) {
        const r = this._resolve(userId);
        if (!r) return { error: "Nie znaleziono gry dla tego użytkownika." };
        if (!r.state.started) return { error: "Gra jeszcze się nie rozpoczęła." };
        if (r.state.finished) return { error: "Gra jest zakończona." };
        if (this._currentSlot(r.state) !== r.slot) return { error: "Nie twoja kolej." };
        return r;
    }

    // === PUBLICZNE METODY ===

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

    sendChat(userId, message) {
        const r = this._resolve(userId);
        if (!r) return { success: false, error: "Nie znaleziono gry." };

        r.state.chat.push({ slot: r.slot, message, timestamp: Date.now() });
        return { success: true };
    }

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

    getGameState(userId) {
        const r = this._resolve(userId);
        if (!r) return { success: false, error: "Nie znaleziono gry." };
        return { success: true, state: this._buildPublicState(r.state, r.slot) };
    }
}

module.exports = GameManager;
