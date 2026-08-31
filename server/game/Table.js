/**
 * @class Table
 * @description Stan stołu: plansza, worek, stojaki, punkty i numer tury.
 * Obsługuje dowolną liczbę graczy (2–4) i dowolny tryb gry.
 *
 * @example
 * const table = new Table(variant, 3);
 * table.stack[0];        // stojak pierwszego gracza
 * table.currentPlayer(); // czyja tura
 * table.applyMove(0, move);
 */

const Board = require('../board/Board');
const DrawstringBag = require('../board/DrawstringBag');

class Table {
    /**
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @param {number} [playerCount=2] - Liczba graczy przy stole
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(variant, playerCount = 2) {
        if (!variant) throw new Error('Table wymaga trybu gry (CompiledVariant).');

        this.variant = variant;
        this.playerCount = Math.max(2, Math.min(4, playerCount));
        this.board = new Board(variant);
        this.bag = new DrawstringBag(variant);
        this.points = new Array(this.playerCount).fill(0);
        this.stack = Array.from({ length: this.playerCount }, () => []);
        this.currentTurn = 0;

        this.prepareStacks();
    }

    /**
     * Rozdaje początkowe stojaki.
     * @private
     */
    prepareStacks() {
        for (let p = 0; p < this.playerCount; p++) {
            this.stack[p] = this.bag.draw(this.variant.rackSize);
        }
    }

    /**
     * Numer gracza, którego jest tura.
     * @returns {number} Indeks gracza (0-based)
     */
    currentPlayer() {
        return this.currentTurn % this.playerCount;
    }

    /** Przekazuje turę następnemu graczowi. */
    nextTurn() {
        this.currentTurn += 1;
    }

    /**
     * Usuwa podane litery ze stojaka gracza.
     * @param {number} player - Numer gracza
     * @param {string[]} letters - Litery do usunięcia
     * @throws {Error} Gdy litery nie ma na stojaku
     */
    deleteFromStack(player, letters) {
        for (const letter of letters) {
            const index = this.stack[player].indexOf(letter);
            if (index === -1) throw new Error(`Brak litery "${letter}" na stojaku.`);
            this.stack[player].splice(index, 1);
        }
    }

    /**
     * Sprawdza (bez modyfikowania stanu), czy gracz ma wszystkie podane litery.
     * @param {number} player - Numer gracza
     * @param {string[]} letters - Szukane litery
     * @returns {string|null} Brakująca litera albo `null`, gdy wszystko się zgadza
     */
    missingLetter(player, letters) {
        const copy = [...this.stack[player]];
        for (const letter of letters) {
            const idx = copy.indexOf(letter);
            if (idx === -1) return letter;
            copy.splice(idx, 1);
        }
        return null;
    }

    /**
     * Zdejmuje zużyte litery i dobiera nowe z worka do pełnego stojaka.
     * @param {number} player - Numer gracza
     * @param {string[]} letters - Litery zużyte w ruchu
     */
    updateStack(player, letters) {
        this.deleteFromStack(player, letters);
        const missing = this.variant.rackSize - this.stack[player].length;
        if (missing > 0) this.stack[player].push(...this.bag.draw(missing));
    }

    /**
     * Wymienia litery: oddaje stare do worka i losuje nowe.
     * @param {number} player - Numer gracza
     * @param {string[]} letters - Litery do wymiany
     * @returns {string[]} Nowe litery
     * @throws {Error} Gdy gracz nie ma którejś z podanych liter
     */
    replaceLetters(player, letters) {
        if (letters.length > this.bag.getBagSize()) return [];
        this.deleteFromStack(player, letters);
        const fresh = this.bag.replace(letters);
        this.stack[player].push(...fresh);
        return fresh;
    }

    /**
     * Kładzie ruch na planszy, uzupełnia stojak i dolicza punkty.
     * NIE przekazuje tury — robi to {@link Game}, żeby mieć jedno miejsce
     * decydujące o zmianie gracza.
     * @param {number} player - Numer gracza
     * @param {object} move - Ruch z solvera
     */
    applyMove(player, move) {
        this.board.resetCurrents();
        this.board.putWord(move.word, move.x, move.y, move.horizontal);
        this.updateStack(player, move.usedLetters);
        this.points[player] += move.points;
    }

    /**
     * Suma punktów liter pozostałych na stojaku gracza — do rozliczenia końcówki.
     * @param {number} player - Numer gracza
     * @returns {number}
     */
    rackValue(player) {
        return this.stack[player].reduce((sum, letter) => sum + this.variant.pointsOf(letter), 0);
    }

    /**
     * Czy któryś ze stojaków jest pusty (gracz „wyszedł").
     * @returns {number} Numer gracza albo -1
     */
    playerWhoWentOut() {
        for (let p = 0; p < this.playerCount; p++) {
            if (this.stack[p].length === 0) return p;
        }
        return -1;
    }
}

module.exports = Table;
