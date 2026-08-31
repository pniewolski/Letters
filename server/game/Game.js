/**
 * @class Game
 * @description Logika pojedynczej partii: tury, ruchy ludzi i komputera,
 * warunki końca gry oraz rozliczenie końcówki. Obsługuje 2–4 graczy i dowolny
 * tryb gry (`CompiledVariant`).
 *
 * Klasa nie wie nic o sieci, kontach ani bazie — to czysta logika, którą można
 * uruchomić w skrypcie testowym.
 *
 * @example
 * const game = new Game(dict, variant, { players: 2, aiLevel: 3 });
 * game.humanMove(0, { tiles: [{ letter: 'K', x: 7, y: 7 }, { letter: 'O', x: 8, y: 7 }] });
 * game.computerMove(1);
 * if (game.finished) console.log(game.results());
 */

const Table = require('./Table');
const Solver = require('../board/Solver');
const Strategy = require('./Strategy');

class Game {
    /**
     * @param {import('../board/WordDictionary')} dictionary - Załadowany słownik
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @param {object} [options]
     * @param {number} [options.players=2] - Liczba graczy (2–4)
     * @param {number} [options.aiLevel=2] - Poziom komputera (1–3)
     */
    constructor(dictionary, variant, options = {}) {
        this.dict = dictionary;
        this.variant = variant;
        this.playerCount = Math.max(2, Math.min(4, options.players || 2));

        this.solver = new Solver(dictionary, variant);
        this.strategy = new Strategy(variant, options.aiLevel || 2);
        this.table = new Table(variant, this.playerCount);

        /** @type {boolean} Czy partia jest rozliczona. */
        this.finished = false;
        /** @type {string|null} Powód zakończenia: 'out' | 'passes' | 'resign' | 'abandoned' */
        this.endReason = null;
        /** @type {number} Ile kolejnych tur minęło bez zdobycia punktów. */
        this.scorelessTurns = 0;
        /** @type {Array<object>} Log ruchów (do podglądu i zapisu w bazie). */
        this.moves = [];
        /** @type {Set<number>} Gracze, którzy poddali partię. */
        this.resigned = new Set();
        /** @type {number} Znacznik czasu rozpoczęcia. */
        this.startedAt = Date.now();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POMOCNICZE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Numer gracza, którego jest tura (pomija tych, którzy się poddali).
     * @returns {number}
     */
    currentPlayer() {
        return this.table.currentPlayer();
    }

    /**
     * Zapisuje ruch w logu i przekazuje turę dalej.
     * @param {object} entry - Wpis ruchu
     * @param {object} [options]
     * @param {boolean} [options.consumesTurn=true] - Czy wpis zużywa turę.
     *   Poddanie się poza swoją kolejką nie zużywa — inaczej zabrałoby ruch
     *   graczowi, który akurat był na posterunku.
     * @returns {object} Ten sam wpis (dla wygody wywołującego)
     * @private
     */
    _record(entry, { consumesTurn = true } = {}) {
        const full = { n: this.moves.length + 1, at: Date.now(), ...entry };
        this.moves.push(full);

        if (consumesTurn) {
            if (full.points > 0) this.scorelessTurns = 0;
            else this.scorelessTurns += 1;
            this.table.nextTurn();
        }

        this._skipResigned();
        this._checkEnd();
        return full;
    }

    /**
     * Przewija turę przez graczy, którzy się poddali.
     * @private
     */
    _skipResigned() {
        if (this.resigned.size === 0 || this.resigned.size >= this.playerCount) return;
        let guard = 0;
        while (this.resigned.has(this.table.currentPlayer()) && guard++ < this.playerCount) {
            this.table.nextTurn();
        }
    }

    /**
     * Sprawdza warunki końca partii i — jeśli trzeba — rozlicza końcówkę.
     * @returns {boolean} Czy partia się zakończyła
     * @private
     */
    _checkEnd() {
        if (this.finished) return true;

        // Zostaje tylko jeden niepoddany gracz.
        if (this.playerCount - this.resigned.size <= 1) {
            return this._finalize('resign');
        }

        // Ktoś wyszedł z liter, a worek jest pusty.
        if (this.table.bag.getBagSize() === 0 && this.table.playerWhoWentOut() !== -1) {
            return this._finalize('out');
        }

        // Zbyt wiele tur bez punktów.
        if (this.scorelessTurns >= this.variant.rules.maxScorelessTurns) {
            return this._finalize('passes');
        }

        return false;
    }

    /**
     * Rozlicza końcówkę: odejmuje wartość liter zostających na stojakach,
     * a graczowi, który wyszedł, dopisuje sumę cudzych liter.
     * @param {string} reason - Powód zakończenia
     * @returns {boolean} Zawsze `true`
     * @private
     */
    _finalize(reason) {
        if (this.finished) return true;

        const rules = this.variant.rules;
        const wentOut = reason === 'out' ? this.table.playerWhoWentOut() : -1;

        /** @type {Array<{slot: number, rack: string[], rackValue: number, adjustment: number}>} */
        this.endgame = [];
        let collected = 0;

        for (let p = 0; p < this.playerCount; p++) {
            const rackValue = this.table.rackValue(p);
            let adjustment = 0;

            if (rules.endgameRackPenalty && p !== wentOut) {
                adjustment = -rackValue;
                collected += rackValue;
            }

            this.endgame.push({ slot: p, rack: [...this.table.stack[p]], rackValue, adjustment });
        }

        if (wentOut !== -1 && rules.endgameOutBonus) {
            this.endgame[wentOut].adjustment += collected;
        }

        for (const e of this.endgame) {
            this.table.points[e.slot] += e.adjustment;
        }

        this.finished = true;
        this.endReason = reason;
        this.finishedAt = Date.now();
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RUCH KOMPUTERA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wykonuje ruch komputera: kładzie słowo, wymienia litery albo pasuje.
     * @param {number} player - Numer gracza sterowanego przez komputer
     * @returns {object} Wpis ruchu: `{ type, points, wordSimple?, letters?, ... }`
     */
    computerMove(player) {
        const stack = this.table.stack[player];
        const moves = this.solver.solve(this.table.board, stack);

        if (!moves || moves.length === 0) {
            return this._computerExchangeOrPass(player);
        }

        const move = this.strategy.getBestMove(moves, this.table.board, stack, {
            bagSize: this.table.bag.getBagSize(),
        });

        if (!move) return this._computerExchangeOrPass(player);

        if (move.replace) {
            return this._computerExchangeOrPass(player, move.letters);
        }

        this.table.applyMove(player, move);
        return this._record({
            slot: player,
            type: 'word',
            wordSimple: move.wordSimple,
            x: move.x,
            y: move.y,
            horizontal: move.horizontal,
            points: move.points,
            bingo: !!move.isBingo,
            tiles: move.usedLetters.length,
        });
    }

    /**
     * Komputer wymienia najmniej przydatne litery albo pasuje.
     * @param {number} player - Numer gracza
     * @param {string[]} [preferred] - Litery wskazane przez strategię
     * @returns {object} Wpis ruchu
     * @private
     */
    _computerExchangeOrPass(player, preferred) {
        const bagSize = this.table.bag.getBagSize();
        const letters = (preferred && preferred.length
            ? preferred
            : this.strategy.pickTilesToExchange(this.table.stack[player], bagSize)
        ).slice(0, bagSize);

        if (letters.length > 0 && bagSize >= this.variant.rules.exchangeMinBag) {
            this.table.replaceLetters(player, letters);
            return this._record({ slot: player, type: 'exchange', points: 0, letters });
        }
        return this._record({ slot: player, type: 'pass', points: 0 });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RUCHY CZŁOWIEKA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Pasowanie.
     * @param {number} player - Numer gracza
     * @returns {{success: boolean, move?: object}}
     */
    pass(player) {
        return { success: true, move: this._record({ slot: player, type: 'pass', points: 0 }) };
    }

    /**
     * Poddanie partii. Można się poddać w dowolnym momencie — także wtedy,
     * gdy trwa cudza tura; wtedy kolejka nie przesuwa się nikomu.
     * @param {number} player - Numer gracza
     * @returns {{success: boolean, move?: object}}
     */
    resign(player) {
        const wasTheirTurn = this.table.currentPlayer() === player;
        this.resigned.add(player);

        const move = this._record(
            { slot: player, type: 'resign', points: 0 },
            { consumesTurn: wasTheirTurn },
        );
        return { success: true, move };
    }

    /**
     * Wymiana liter.
     * @param {number} player - Numer gracza
     * @param {string[]} letters - Litery do wymiany
     * @returns {{success: boolean, error?: string, move?: object}}
     */
    exchange(player, letters) {
        const list = Array.isArray(letters) ? letters.map(l => String(l).toUpperCase()) : [];

        if (list.length === 0) {
            return { success: false, error: 'Nie wskazano liter do wymiany.' };
        }
        if (this.table.bag.getBagSize() < this.variant.rules.exchangeMinBag) {
            return {
                success: false,
                error: `Za mało liter w worku — wymiana wymaga co najmniej ${this.variant.rules.exchangeMinBag}.`,
            };
        }
        if (list.length > this.table.bag.getBagSize()) {
            return { success: false, error: 'W worku jest mniej liter, niż chcesz wymienić.' };
        }

        const missing = this.table.missingLetter(player, list);
        if (missing) return { success: false, error: `Nie masz litery "${missing}" na stojaku.` };

        this.table.replaceLetters(player, list);
        return { success: true, move: this._record({ slot: player, type: 'exchange', points: 0, letters: list }) };
    }

    /**
     * Ruch człowieka — położenie liter na planszy.
     *
     * @param {number} player - Numer gracza
     * @param {object} moveData
     * @param {Array<{letter: string, x: number, y: number, isBlank: boolean}>} moveData.tiles - Kładzione litery
     * @returns {{success: boolean, error?: string, lostTurn?: boolean, wrongWords?: string[], move?: object}}
     *   `lostTurn` oznacza, że ruch był formalnie poprawny, ale słowa nie ma
     *   w słowniku — zgodnie z regułą trybu gracz traci turę.
     */
    humanMove(player, moveData) {
        const size = this.table.board.size;
        const rules = this.variant.rules;
        const tiles = Array.isArray(moveData && moveData.tiles) ? [...moveData.tiles] : [];

        if (tiles.length === 0) {
            return { success: false, error: 'Nie położono żadnej litery.' };
        }
        if (tiles.length > this.table.stack[player].length) {
            return { success: false, error: 'Położono więcej liter, niż masz na stojaku.' };
        }

        const boardTiles = this.table.board.getTiles();
        const isFirstMove = this.table.board.isEmpty();

        // ── Pola muszą być w planszy, puste i niepowtórzone ──────────────────
        const occupied = new Set();
        for (const t of tiles) {
            if (!Number.isInteger(t.x) || !Number.isInteger(t.y)
                || t.x < 0 || t.y < 0 || t.x >= size || t.y >= size) {
                return { success: false, error: 'Litera poza planszą.' };
            }
            const key = t.y * size + t.x;
            if (occupied.has(key)) {
                return { success: false, error: 'Dwie litery na tym samym polu.' };
            }
            occupied.add(key);
            if (boardTiles[t.x][t.y].letter !== null) {
                return { success: false, error: `Pole (${t.x + 1}, ${t.y + 1}) jest już zajęte.` };
            }
        }

        // ── Gracz musi mieć te litery na stojaku ─────────────────────────────
        const needed = tiles.map(t => (t.isBlank ? this.variant.blankSymbol : String(t.letter || '').toUpperCase()));
        const missing = this.table.missingLetter(player, needed);
        if (missing) {
            return {
                success: false,
                error: missing === this.variant.blankSymbol
                    ? 'Nie masz tylu blanków na stojaku.'
                    : `Nie masz litery "${missing}" na stojaku.`,
            };
        }

        // ── Kierunek ─────────────────────────────────────────────────────────
        const sameX = tiles.every(t => t.x === tiles[0].x);
        const sameY = tiles.every(t => t.y === tiles[0].y);
        if (!sameX && !sameY) {
            return { success: false, error: 'Litery muszą leżeć w jednej linii.' };
        }

        let horizontal;
        if (tiles.length === 1) {
            horizontal = this._resolveSingleTileOrientation(tiles[0], boardTiles, size);
        } else {
            horizontal = sameY;
        }

        tiles.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));

        // ── Ciągłość (dziury mogą wypełniać litery już leżące) ───────────────
        const line = horizontal ? tiles[0].y : tiles[0].x;
        const firstPos = horizontal ? tiles[0].x : tiles[0].y;
        const lastPos = horizontal ? tiles[tiles.length - 1].x : tiles[tiles.length - 1].y;

        for (let p = firstPos; p <= lastPos; p++) {
            const cx = horizontal ? p : line;
            const cy = horizontal ? line : p;
            const placed = occupied.has(cy * size + cx);
            if (!placed && boardTiles[cx][cy].letter === null) {
                return { success: false, error: 'Słowo musi być ciągłe — bez przerw.' };
            }
        }

        // ── Rozszerzenie o litery leżące obok ────────────────────────────────
        let startPos = firstPos;
        while (startPos > 0) {
            const cx = horizontal ? startPos - 1 : line;
            const cy = horizontal ? line : startPos - 1;
            if (boardTiles[cx][cy].letter === null) break;
            startPos--;
        }

        let endPos = lastPos;
        while (endPos < size - 1) {
            const cx = horizontal ? endPos + 1 : line;
            const cy = horizontal ? line : endPos + 1;
            if (boardTiles[cx][cy].letter === null) break;
            endPos++;
        }

        // ── Złóż pełne słowo ─────────────────────────────────────────────────
        let wordStr = '';
        let coversStart = false;
        for (let p = startPos; p <= endPos; p++) {
            const cx = horizontal ? p : line;
            const cy = horizontal ? line : p;
            const placed = tiles.find(t => t.x === cx && t.y === cy);
            wordStr += placed ? String(placed.letter).toUpperCase() : boardTiles[cx][cy].letter;
            if (this.table.board.isStart(cx, cy)) coversStart = true;
        }

        if (wordStr.length < rules.minWordLength) {
            return { success: false, error: `Słowo musi mieć co najmniej ${rules.minWordLength} liter.` };
        }

        // ── Pierwszy ruch: pole startowe. Kolejne: styk z literami na planszy ─
        if (isFirstMove) {
            if (rules.firstMoveMustCoverStart && !coversStart) {
                return { success: false, error: 'Pierwsze słowo musi przechodzić przez pole startowe.' };
            }
        } else if (!this._touchesExisting(tiles, boardTiles, size, startPos, endPos, line, horizontal)) {
            return { success: false, error: 'Słowo musi stykać się z literami leżącymi na planszy.' };
        }

        // ── Punkty i walidacja słownikowa ────────────────────────────────────
        const blankCells = new Set(
            tiles.filter(t => t.isBlank).map(t => t.y * size + t.x),
        );

        const startX = horizontal ? startPos : line;
        const startY = horizontal ? line : startPos;

        let result;
        try {
            result = this.solver.checkWord(
                this.table.board, this.table.stack[player],
                wordStr, horizontal, startX, startY, blankCells,
            );
        } catch (err) {
            return { success: false, error: 'Nie masz na stojaku liter potrzebnych do tego słowa.' };
        }

        if (!result.success) {
            if (rules.invalidWord === 'reject') {
                return {
                    success: false,
                    error: `Nie znam słowa: ${result.wrongWords.join(', ')}.`,
                    wrongWords: result.wrongWords,
                };
            }
            const move = this._record({
                slot: player, type: 'invalid', points: 0, wrongWords: result.wrongWords,
            });
            return { success: true, lostTurn: true, wrongWords: result.wrongWords, move };
        }

        this.table.applyMove(player, result);
        const move = this._record({
            slot: player,
            type: 'word',
            wordSimple: result.wordSimple,
            x: result.x,
            y: result.y,
            horizontal: result.horizontal,
            points: result.points,
            bingo: !!result.isBingo,
            tiles: result.usedLetters.length,
        });

        return { success: true, lostTurn: false, points: result.points, move };
    }

    /**
     * Dla pojedynczego klocka wybiera kierunek, w którym powstaje dłuższe słowo.
     * @param {{x: number, y: number}} tile - Położony klocek
     * @param {Array<Array<object>>} boardTiles - Pola planszy
     * @param {number} size - Bok planszy
     * @returns {boolean} `true` = poziomo
     * @private
     */
    _resolveSingleTileOrientation(tile, boardTiles, size) {
        const run = (dx, dy) => {
            let len = 1;
            for (let i = 1; ; i++) {
                const x = tile.x + dx * i;
                const y = tile.y + dy * i;
                if (x < 0 || y < 0 || x >= size || y >= size || !boardTiles[x][y].letter) break;
                len++;
            }
            for (let i = 1; ; i++) {
                const x = tile.x - dx * i;
                const y = tile.y - dy * i;
                if (x < 0 || y < 0 || x >= size || y >= size || !boardTiles[x][y].letter) break;
                len++;
            }
            return len;
        };

        const hLen = run(1, 0);
        const vLen = run(0, 1);
        return hLen >= vLen;
    }

    /**
     * Czy słowo styka się z literami już leżącymi na planszy.
     * @param {Array<object>} tiles - Kładzione litery
     * @param {Array<Array<object>>} boardTiles - Pola planszy
     * @param {number} size - Bok planszy
     * @param {number} startPos - Początek słowa w linii
     * @param {number} endPos - Koniec słowa w linii
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {boolean}
     * @private
     */
    _touchesExisting(tiles, boardTiles, size, startPos, endPos, line, horizontal) {
        for (let p = startPos; p <= endPos; p++) {
            const cx = horizontal ? p : line;
            const cy = horizontal ? line : p;
            if (boardTiles[cx][cy].letter !== null) return true;

            for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
                if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                if (boardTiles[nx][ny].letter !== null) return true;
            }
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PODPOWIEDZI I WYNIKI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Zwraca najlepsze zagrania dla gracza.
     * @param {number} player - Numer gracza
     * @param {number} [count=5] - Ile podpowiedzi zwrócić
     * @returns {Array<object>} Lista podpowiedzi z punktami i pozycją
     */
    hints(player, count = 5) {
        const moves = this.solver.solve(this.table.board, this.table.stack[player]);
        return moves.slice(0, count).map(m => ({
            wordSimple: m.wordSimple,
            x: m.x,
            y: m.y,
            horizontal: m.horizontal,
            points: m.points,
            // Front nie musi zgadywać, gdzie stanie blank — dostaje gotowe klocki.
            tiles: m.word
                .map((cell, i) => ({
                    letter: cell.letter,
                    x: m.horizontal ? m.x + i : m.x,
                    y: m.horizontal ? m.y : m.y + i,
                    isBlank: cell.isBlank,
                    isCurrent: cell.isCurrent,
                }))
                .filter(c => c.isCurrent),
        }));
    }

    /**
     * Kończy partię z zewnątrz (np. gdy wszyscy opuścili stół).
     * @param {string} [reason='abandoned'] - Powód zakończenia
     */
    finish(reason = 'abandoned') {
        this._finalize(reason);
    }

    /**
     * Wyniki końcowe z miejscami dla każdego gracza.
     *
     * Kolejność: najpierw gracze, którzy dotrwali do końca (wg punktów malejąco),
     * potem ci, którzy się poddali. Równe wyniki dzielą to samo miejsce, a jeśli
     * miejsce pierwsze jest dzielone, wszyscy z niego mają remis.
     *
     * @returns {Array<{slot: number, score: number, place: number, result: 'win'|'loss'|'draw'}>}
     */
    results() {
        const rows = this.table.points.map((score, slot) => ({
            slot,
            score,
            resigned: this.resigned.has(slot),
        }));

        // Poddanie przesuwa na koniec stawki niezależnie od punktów.
        const ordered = [...rows].sort((a, b) => (a.resigned - b.resigned) || (b.score - a.score));

        let place = 0;
        let previous = null;
        for (const [index, row] of ordered.entries()) {
            const sameAsPrevious = previous
                && previous.resigned === row.resigned
                && previous.score === row.score;
            if (!sameAsPrevious) place = index + 1;
            row.place = place;
            previous = row;
        }

        const firstPlaceCount = ordered.filter(r => r.place === 1).length;

        return rows.map(r => ({
            slot: r.slot,
            score: r.score,
            place: r.place,
            result: r.place !== 1 ? 'loss' : (firstPlaceCount > 1 ? 'draw' : 'win'),
        }));
    }

    /**
     * Statystyki gracza z tej partii — najlepsze słowo i liczba premii za stojak.
     * @param {number} slot - Numer gracza
     * @returns {{bestWord: string|null, bestWordPoints: number, bingos: number}}
     */
    playerHighlights(slot) {
        let bestWord = null;
        let bestWordPoints = 0;
        let bingos = 0;

        for (const move of this.moves) {
            if (move.slot !== slot || move.type !== 'word') continue;
            if (move.bingo) bingos++;
            if (move.points > bestWordPoints) {
                bestWordPoints = move.points;
                bestWord = move.wordSimple;
            }
        }
        return { bestWord, bestWordPoints, bingos };
    }
}

module.exports = Game;
