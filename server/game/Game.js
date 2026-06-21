const Table = require("./Table");
const Solver = require("../board/Solver");
const WordDictionary = require("../board/WordDictionary");
const Strategy = require("./Strategy");

/**
 * @class Game
 * @description Główna klasa logiki gry Scrabble. Zarządza rozgrywką między graczami
 * (komputer vs komputer, człowiek vs komputer). Koordynuje Table (stan gry),
 * Solver (wyszukiwanie ruchów) i Strategy (podejmowanie decyzji przez AI).
 *
 * @example
 * const WordDictionary = require('../board/WordDictionary');
 * const Game = require('./Game');
 *
 * const dict = new WordDictionary();
 * await dict.ready;
 * const game = new Game(dict);
 *
 * // Ruch komputera (gracz 0)
 * game.computerMove(0);
 *
 * // Ruch człowieka (gracz 1) — położenie słowa
 * const result = game.humanMove(1, false, {
 *   tiles: [{letter:'K', x:7, y:7, isBlank:false}, {letter:'O', x:8, y:7, isBlank:false}]
 * });
 *
 * // Wymiana liter (gracz 1)
 * const result2 = game.humanMove(1, true, { letters: ['X', 'Ź'] });
 */
class Game {
    constructor(dictionary) {
        this.dict = dictionary;
        this.solver = new Solver(this.dict);
        this.table = new Table();
        this.strategy = new Strategy();
    }

    /**
     * Ruch komputera. Sam decyduje czy położyć słowo, wymienić litery, czy spasować.
     * Zawsze poprawnie zwiększa licznik tury (currentTurn).
     * @param {number} player - numer gracza (0 lub 1)
     * @returns {{ passed: boolean, replaced: boolean, points: number, wordSimple?: string, letters?: string[] }}
     *   Informacja o wykonanym ruchu (do logu / podglądu):
     *   - położenie słowa: { passed:false, replaced:false, points, wordSimple }
     *   - wymiana liter:   { passed:false, replaced:true, points:0, letters }
     *   - pasowanie:       { passed:true, replaced:false, points:0 }
     */
    computerMove(player) {
        const stack = this.table.stack[player];

        // Wykrycie pierwszego ruchu na podstawie stanu planszy (NIE licznika tur,
        // bo ten rośnie też przy pasach i nieudanych słowach).
        const isFirstMove = this.table.board.isEmpty();
        const avaliableMoves = isFirstMove
            ? this.solver.generateFirstWord(this.table.board, stack)
            : this.solver.solve(this.table.board, stack);

        // Brak jakiegokolwiek możliwego słowa — spróbuj wymienić, inaczej pasuj.
        if (!avaliableMoves || avaliableMoves.length === 0) {
            return this._computerExchangeOrPass(player);
        }

        const move = this.strategy.getBestMove(avaliableMoves, this.table.board, stack);

        // Strategia zdecydowała o wymianie liter.
        if (move.replace) {
            const letters = move.letters || [];
            if (letters.length > 0 && letters.length <= this.table.bag.getBagSize()) {
                this.table.replaceLetters(player, letters);
                this.table.currentTurn += 1; // wymiana też kończy turę!
                return { passed: false, replaced: true, points: 0, letters };
            }
            // Nie da się wymienić (za mało liter w worku) — pas.
            this.table.currentTurn += 1;
            return { passed: true, replaced: false, points: 0 };
        }

        // Położenie słowa — applyMove dodaje punkty i zwiększa currentTurn.
        const before = this.table.points[player];
        this.table.applyMove(player, move);
        const gained = this.table.points[player] - before;
        return { passed: false, replaced: false, points: gained, wordSimple: move.wordSimple };
    }

    /**
     * Pomocnicza: komputer wymienia najmniej użyteczne litery lub pasuje,
     * gdy nie ma żadnego możliwego ruchu. Zawsze zwiększa currentTurn.
     * @param {number} player - numer gracza
     * @returns {{ passed: boolean, replaced: boolean, points: number, letters?: string[] }}
     * @private
     */
    _computerExchangeOrPass(player) {
        const letters = this.strategy.pickTilesToExchange(this.table.stack[player]);
        if (letters.length > 0 && letters.length <= this.table.bag.getBagSize()) {
            this.table.replaceLetters(player, letters);
            this.table.currentTurn += 1;
            return { passed: false, replaced: true, points: 0, letters };
        }
        this.table.currentTurn += 1;
        return { passed: true, replaced: false, points: 0 };
    }

    /**
     * Ruch człowieka.
     * @param {number} player - numer gracza (0 lub 1)
     * @param {boolean} isReplace - czy wymiana liter
     * @param {object} moveData - dane ruchu:
     *   wymiana: { letters: ['A','B'] }
     *   słowo:    { tiles: [{letter, x, y, isBlank}, ...] }
     * @returns {{ success: boolean, errors?: string[], points?: number }}
     */
    humanMove(player, isReplace, moveData) {
        if (isReplace) {
            if (this.table.bag.getBagSize() < 7) {
                return { success: false, errors: ["Za mało liter w worku, aby wymieniać."] };
            }
            const stackCopy = [...this.table.stack[player]];
            for (const letter of moveData.letters) {
                const idx = stackCopy.findIndex(l => l === letter);
                if (idx === -1) {
                    return { success: false, errors: [`Brak litery '${letter}' w stacku.`] };
                }
                stackCopy.splice(idx, 1);
            }
            this.table.replaceLetters(player, moveData.letters);
            this.table.currentTurn += 1;
            return { success: true, points: 0 };
        }

        const placedTiles = moveData.tiles; // [{letter, x, y, isBlank}, ...]
        if (!placedTiles || placedTiles.length === 0) {
            return { success: false, errors: ["Nie postawiono żadnych liter."] };
        }

        const boardTiles = this.table.board.getTiles();
        const isFirstMove = this.table.board.isEmpty();

        // Walidacja: czy pozycje są puste
        for (const t of placedTiles) {
            if (t.x < 0 || t.x > 14 || t.y < 0 || t.y > 14) {
                return { success: false, errors: ["Litera poza planszą."] };
            }
            if (boardTiles[t.x][t.y].letter !== null) {
                return { success: false, errors: [`Pole (${t.x},${t.y}) jest już zajęte.`] };
            }
        }

        // Wyznacz kierunek
        let horizontal;
        if (placedTiles.length === 1) {
            // Jedna litera — sprawdź w którym kierunku są sąsiednie litery
            const t = placedTiles[0];
            const hasHNeighbor =
                (t.x > 0 && boardTiles[t.x - 1][t.y].letter !== null) ||
                (t.x < 14 && boardTiles[t.x + 1][t.y].letter !== null);
            const hasVNeighbor =
                (t.y > 0 && boardTiles[t.x][t.y - 1].letter !== null) ||
                (t.y < 14 && boardTiles[t.x][t.y + 1].letter !== null);
            // Domyślnie poziomo; jeśli tylko pionowy sąsiad — pionowo
            horizontal = hasVNeighbor && !hasHNeighbor ? false : true;
        } else {
            const allSameX = placedTiles.every(t => t.x === placedTiles[0].x);
            const allSameY = placedTiles.every(t => t.y === placedTiles[0].y);
            if (!allSameX && !allSameY) {
                return { success: false, errors: ["Litery muszą być w jednej linii."] };
            }
            horizontal = allSameY; // ten sam wiersz = poziomo
        }

        // Sortuj po pozycji
        placedTiles.sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);

        // Sprawdź ciągłość (mogą być dziury wypełnione istniejącymi literami)
        const line = horizontal ? placedTiles[0].y : placedTiles[0].x;
        const firstPos = horizontal ? placedTiles[0].x : placedTiles[0].y;
        const lastPos = horizontal ? placedTiles[placedTiles.length - 1].x : placedTiles[placedTiles.length - 1].y;

        for (let p = firstPos; p <= lastPos; p++) {
            const cx = horizontal ? p : line;
            const cy = horizontal ? line : p;
            const isPlaced = placedTiles.some(t => t.x === cx && t.y === cy);
            if (!isPlaced && boardTiles[cx][cy].letter === null) {
                return { success: false, errors: ["Litery muszą tworzyć ciągłe słowo (bez przerw)."] };
            }
        }

        // Rozszerz w obie strony o istniejące litery
        let startPos = firstPos;
        while (true) {
            const prev = startPos - 1;
            if (prev < 0) break;
            const cx = horizontal ? prev : line;
            const cy = horizontal ? line : prev;
            if (boardTiles[cx][cy].letter === null) break;
            startPos = prev;
        }

        let endPos = lastPos;
        while (true) {
            const next = endPos + 1;
            if (next > 14) break;
            const cx = horizontal ? next : line;
            const cy = horizontal ? line : next;
            if (boardTiles[cx][cy].letter === null) break;
            endPos = next;
        }

        // Zbuduj pełne słowo
        let wordStr = '';
        for (let p = startPos; p <= endPos; p++) {
            const cx = horizontal ? p : line;
            const cy = horizontal ? line : p;
            const placed = placedTiles.find(t => t.x === cx && t.y === cy);
            if (placed) {
                wordStr += placed.letter.toUpperCase();
            } else {
                wordStr += boardTiles[cx][cy].letter;
            }
        }

        // Walidacja pierwszego ruchu
        if (isFirstMove) {
            let coversCenter = false;
            for (let p = startPos; p <= endPos; p++) {
                const cx = horizontal ? p : line;
                const cy = horizontal ? line : p;
                if (cx === 7 && cy === 7) coversCenter = true;
            }
            if (!coversCenter) {
                return { success: false, errors: ["Pierwszy ruch musi przechodzić przez środek (7,7)."] };
            }
        } else {
            // Sprawdź przyleganie do istniejących liter
            let touchesExisting = false;
            for (let p = startPos; p <= endPos; p++) {
                const cx = horizontal ? p : line;
                const cy = horizontal ? line : p;
                if (boardTiles[cx][cy].letter !== null) { touchesExisting = true; break; }
                const neighbors = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
                for (const [nx, ny] of neighbors) {
                    if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && boardTiles[nx][ny].letter !== null) {
                        touchesExisting = true; break;
                    }
                }
                if (touchesExisting) break;
            }
            if (!touchesExisting) {
                return { success: false, errors: ["Słowo musi przylegać do istniejących liter na planszy."] };
            }
        }

        // checkWord waliduje słownik + liczy punkty
        const startX = horizontal ? startPos : line;
        const startY = horizontal ? line : startPos;

        let result;
        try {
            result = this.solver.checkWord(
                this.table.board,
                this.table.stack[player],
                wordStr,
                horizontal,
                startX,
                startY
            );
        } catch (e) {
            return { success: false, errors: ["Nie masz potrzebnych liter w stacku."] };
        }

        if (!result.success) {
            this.table.currentTurn += 1;
            return { success: true, points: 0, lostTurn: true, wrongWords: result.wrongWords };
        }

        this.table.applyMove(player, result);
        return { success: true, points: result.points, lostTurn: false };
    }
}

module.exports = Game;
