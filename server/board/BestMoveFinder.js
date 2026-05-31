const WordDictionary = require('./WordDictionary');
const Board = require('./Board');
const Solver = require('./Solver.js');

/**
 * @class BestMoveFinder
 * @description Klasa pomocnicza ułatwiająca interakcję z silnikiem gry.
 * Zarządza własną planszą, stojakiem liter i solverem. Pozwala krok po kroku
 * budować stan planszy i stojaka, a następnie uzyskać najlepsze rozwiązanie.
 *
 * @example
 * const WordDictionary = require('./WordDictionary');
 * const BestMoveFinder = require('./BestMoveFinder');
 *
 * const dict = new WordDictionary();
 * await dict.ready;
 *
 * const finder = new BestMoveFinder(dict);
 * finder.putLetterOnBoard(7, 7, 'K');
 * finder.putLetterOnBoard(8, 7, 'O');
 * finder.putLetterOnBoard(9, 7, 'T');
 * finder.putLetterOnStack('A');
 * finder.putLetterOnStack('L');
 * finder.putLetterOnStack('E');
 * const bestMove = finder.getSolution(0); // najlepszy ruch
 */
class BestMoveFinder {
    /**
     * Tworzy instancję BestMoveFinder.
     * @param {WordDictionary} dictionary - Załadowany słownik (instancja WordDictionary)
     */
    constructor(dictionary) {
        this.dict = dictionary;
        this.board = new Board();
        this.solver = new Solver(this.dict);
        this.stack = [];
    }

    /**
     * Umieszcza pojedynczą literę na wewnętrznej planszy.
     * @param {number} x - Współrzędna X (kolumna, 0-14)
     * @param {number} y - Współrzędna Y (wiersz, 0-14)
     * @param {string} letter - Litera do umieszczenia (uppercase)
     * @param {boolean} [isBlank=false] - Czy litera jest blankiem (zastępczą)
     * @returns {Array} Aktualny stan planszy po umieszczeniu litery
     */
    putLetterOnBoard(x, y, letter, isBlank = false) {
        this.board.putWord([{letter:letter, isBlank:isBlank, isCurrent:false}], x, y, true);
        return this.board.getBoardState();
    }

    /**
     * Dodaje literę do wewnętrznego stojaka (rack).
     * @param {string} letter - Litera do dodania ('*' oznacza blank)
     */
    putLetterOnStack(letter) {
        this.stack.push(letter);
    }

    /**
     * Zwraca rozwiązanie o podanym indeksie (posortowane malejąco wg punktów).
     * @param {number} number - Indeks rozwiązania (0 = najlepsze)
     * @returns {object} Obiekt rozwiązania z polami: word, x, y, horizontal, points, usedLetters
     */
    getSolution(number) {
        return this.solver.solve(this.board, this.stack)[number];
    }


}

module.exports = BestMoveFinder;
