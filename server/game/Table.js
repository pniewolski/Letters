const Board = require("../board/Board");
const DrawstringBag = require("../board/DrawstringBag");

/**
 * @class Table
 * @description Reprezentuje "stół" gry — przechowuje kompletny stan rozgrywki:
 * planszę, worek z literami, stojaki graczy, punkty i numer tury.
 * Odpowiada za zarządzanie stojakami (dobieranie, wymianę, usuwanie liter)
 * oraz aplikowanie ruchów na planszę.
 *
 * @example
 * const Table = require('./Table');
 * const table = new Table();
 *
 * console.log(table.stack[0]); // stojak gracza 0 (7 liter)
 * console.log(table.stack[1]); // stojak gracza 1 (7 liter)
 * console.log(table.points);   // [0, 0]
 *
 * // Aplikowanie ruchu
 * table.applyMove(0, { word: [...], x: 7, y: 7, horizontal: true, usedLetters: ['K','O','T'], points: 10 });
 */
class Table {
    /**
     * Tworzy nowy stół gry. Inicjalizuje planszę, worek, stojaki (po 7 liter)
     * i ustawia punkty na 0.
     */
    constructor() {
        this.board = new Board();
        this.bag = new DrawstringBag();
        this.points = [0,0];
        this.stack = [[],[]];
        this.playerTurn = 0;
        this.currentTurn = 0;

        this.prepareStacks();
    }

    /**
     * Inicjalizuje stojaki obu graczy, losując po 7 liter z worka.
     * @private
     */
    prepareStacks() {
        this.stack[0] = this.bag.draw(7);
        this.stack[1] = this.bag.draw(7);
        console.log("Stacky zainicjowane",this.stack);
    }

    /**
     * Usuwa podane litery ze stojaka gracza.
     * @param {number} player - Numer gracza (0 lub 1)
     * @param {string[]} letters - Litery do usunięcia
     * @throws {Error} Jeśli litera nie istnieje na stojaku ("Brak szukanej litery w stacku")
     */
    deleteFromStack(player,letters) {
        letters.forEach(letter => {
            const index = this.stack[player].findIndex(l => l === letter);
            if (index == -1) {
                throw new Error("Brak szukanej litery w stacku");
            }
            this.stack[player].splice(index, 1)[0]; // Usuwamy i przechowujemy element
        });
    }

    /**
     * Usuwa zużyte litery ze stojaka i dobiera nowe z worka (do max 7).
     * Jeśli w worku jest mniej liter niż potrzeba, dobiera tyle ile jest.
     * @param {number} player - Numer gracza (0 lub 1)
     * @param {string[]} letters - Litery zużyte w ruchu (do usunięcia ze stojaka)
     */
    updateStack(player, letters) {
        this.deleteFromStack(player,letters);
        let len = letters.length;
        if (len > this.bag.getBagSize()) {
            len = this.bag.getBagSize();
        }
        if (len === 0) {
            return;
        }
        let newLetters = this.bag.draw(len);
        this.stack[player].push(...newLetters);
    }

    /**
     * Wymienia litery — oddaje stare do worka i losuje nowe.
     * Jeśli w worku jest mniej liter niż chce wymienić, operacja nie jest wykonywana.
     * @param {number} player - Numer gracza (0 lub 1)
     * @param {string[]} letters - Litery do wymiany
     */
    replaceLetters(player, letters) {
        const len = letters.length;
        if (len>this.bag.getBagSize()) {
            return [];
        }
        let newLetters = this.bag.replace(letters);
        this.deleteFromStack(player,letters);
        this.stack[player].push(...newLetters);
    }

    /**
     * Aplikuje ruch na planszę: umieszcza słowo, aktualizuje stojak i dodaje punkty.
     * Inkrementuje numer tury.
     * @param {number} player - Numer gracza (0 lub 1)
     * @param {object} move - Obiekt ruchu z Solvera:
     *   { word: Array<{letter, isCurrent, isBlank}>, x: number, y: number,
     *     horizontal: boolean, usedLetters: string[], points: number }
     */
    applyMove(player, move) {
        this.board.putWord(move.word, move.x, move.y, move.horizontal);
        this.updateStack(player, move.usedLetters);
        this.currentTurn += 1;
        this.points[player] += move.points;
    }
}

module.exports = Table;
