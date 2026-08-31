/**
 * @class BestMoveFinder
 * @description Wygodna fasada nad {@link Board} i {@link Solver}: pozwala krok
 * po kroku zbudować stan planszy i stojaka, a potem zapytać o najlepsze ruchy.
 * Używana przez solver ze zdjęcia i przez skrypty pomocnicze.
 *
 * @example
 * const WordDictionary = require('./WordDictionary');
 * const BestMoveFinder = require('./BestMoveFinder');
 * const { compileVariant } = require('../variant/compile');
 * const { LITERKI } = require('../variant/presets');
 *
 * const dict = new WordDictionary();
 * await dict.ready;
 *
 * const finder = new BestMoveFinder(dict, compileVariant(LITERKI.definition));
 * finder.putWordOnBoard(7, 7, 'KOT', true);
 * finder.setRack('ALESZY');
 * console.log(finder.getSolution(0));
 */

const Board = require('./Board');
const Solver = require('./Solver');

class BestMoveFinder {
    /**
     * @param {import('./WordDictionary')} dictionary - Załadowany słownik
     * @param {import('../variant/compile').CompiledVariant} variant - Tryb gry
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(dictionary, variant) {
        if (!variant) throw new Error('BestMoveFinder wymaga trybu gry (CompiledVariant).');

        this.dict = dictionary;
        this.variant = variant;
        this.board = new Board(variant);
        this.solver = new Solver(dictionary, variant);
        this.stack = [];
    }

    /**
     * Kładzie pojedynczą literę na planszy.
     * @param {number} x - Kolumna
     * @param {number} y - Wiersz
     * @param {string} letter - Litera
     * @param {boolean} [isBlank=false] - Czy to blank
     * @returns {BestMoveFinder} Ten sam obiekt (do łańcuchowania)
     */
    putLetterOnBoard(x, y, letter, isBlank = false) {
        this.board.putWord(
            [{ letter: letter.toUpperCase(), isBlank, isCurrent: false }],
            x, y, true,
        );
        return this;
    }

    /**
     * Kładzie całe słowo na planszy.
     * @param {number} x - Kolumna początku
     * @param {number} y - Wiersz początku
     * @param {string} word - Słowo (małe litery oznaczają blanki)
     * @param {boolean} [horizontal=true] - Kierunek
     * @returns {BestMoveFinder}
     */
    putWordOnBoard(x, y, word, horizontal = true) {
        const cells = [...word].map(ch => ({
            letter: ch.toUpperCase(),
            isBlank: ch !== ch.toUpperCase(),
            isCurrent: false,
        }));
        this.board.putWord(cells, x, y, horizontal);
        return this;
    }

    /**
     * Dokłada literę do stojaka.
     * @param {string} letter - Litera (`*` = blank)
     * @returns {BestMoveFinder}
     */
    putLetterOnStack(letter) {
        this.stack.push(letter.toUpperCase());
        return this;
    }

    /**
     * Ustawia cały stojak.
     * @param {string|string[]} letters - Litery jako łańcuch albo tablica
     * @returns {BestMoveFinder}
     */
    setRack(letters) {
        this.stack = (typeof letters === 'string' ? [...letters] : letters)
            .map(l => String(l).toUpperCase());
        return this;
    }

    /**
     * Zwraca wszystkie możliwe ruchy, posortowane malejąco wg punktów.
     * @returns {Array<object>}
     */
    getSolutions() {
        return this.solver.solve(this.board, this.stack);
    }

    /**
     * Zwraca ruch o podanym miejscu w rankingu.
     * @param {number} [index=0] - 0 = najlepszy
     * @returns {object|undefined}
     */
    getSolution(index = 0) {
        return this.getSolutions()[index];
    }
}

module.exports = BestMoveFinder;
