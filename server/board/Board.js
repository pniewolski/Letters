/**
 * @class Board
 * @description Plansza do gry — rozmiar, mnożniki pól i punktacja liter
 * pochodzą z **trybu gry** (`CompiledVariant`), a nie z plików na dysku.
 * Dzięki temu każdy stół może mieć własną planszę, a tworzenie planszy jest
 * tanie (żadnego czytania i parsowania JSON-a przy każdej instancji).
 *
 * Pola adresujemy `tiles[x][y]`, gdzie `x` to kolumna, a `y` wiersz.
 *
 * @example
 * const { compileVariant } = require('../variant/compile');
 * const { LITERKI } = require('../variant/presets');
 *
 * const variant = compileVariant(LITERKI.definition);
 * const board = new Board(variant);
 * board.putWord([{ letter: 'K', isBlank: false, isCurrent: true }], 7, 7, true);
 * board.consolePreviewBoard();
 */
class Board {
    /**
     * Tworzy pustą planszę o rozmiarze wynikającym z trybu gry.
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(variant) {
        if (!variant) throw new Error('Board wymaga trybu gry (CompiledVariant).');

        /** @type {import('../variant/compile').CompiledVariant} */
        this.variant = variant;
        /** @type {number} Bok planszy. */
        this.size = variant.size;

        this.tiles = [];
        for (let x = 0; x < this.size; x++) {
            this.tiles[x] = [];
            for (let y = 0; y < this.size; y++) {
                this.tiles[x][y] = { letter: null, isBlank: false, isCurrent: false };
            }
        }

        /** @type {number} Licznik postawionych liter — `isEmpty()` bez przeglądania planszy. */
        this._placed = 0;
    }

    /**
     * Zwraca liczbę punktów za literę wg trybu gry.
     * @param {string} letter - Litera (wielkość liter bez znaczenia)
     * @returns {number} Punkty (0 dla nieznanego znaku)
     *
     * @example
     * board.getPointsForLetter('A'); // => 1
     */
    getPointsForLetter(letter) {
        return this.variant.pointsOf(letter);
    }

    /**
     * Zwraca mnożniki pola.
     * @param {number} x - Kolumna
     * @param {number} y - Wiersz
     * @returns {{w: number, l: number}} Mnożnik słowa i litery
     */
    getBonus(x, y) {
        return this.variant.bonusAt(x, y);
    }

    /**
     * Czy pole jest polem startowym (pierwsze słowo musi je pokryć).
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isStart(x, y) {
        return this.variant.isStart(x, y);
    }

    /**
     * Zwraca tablicę pól planszy.
     * @returns {Array<Array<{letter: string|null, isBlank: boolean, isCurrent: boolean}>>}
     */
    getTiles() {
        return this.tiles;
    }

    /**
     * Podmienia tablicę pól (używane przy klonowaniu i wczytywaniu stanu).
     * @param {Array<Array<object>>} tiles - Nowa tablica pól
     */
    setTiles(tiles) {
        this.tiles = tiles;
        this._placed = 0;
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                if (this.tiles[x][y].letter !== null) this._placed++;
            }
        }
    }

    /**
     * Alias dla {@link Board#getTiles} — postać wysyłana do przeglądarki.
     * @returns {Array<Array<object>>}
     */
    getBoardState() {
        return this.tiles;
    }

    /**
     * Czy na planszy nie ma jeszcze żadnej litery (wykrycie pierwszego ruchu).
     * @returns {boolean}
     */
    isEmpty() {
        return this._placed === 0;
    }

    /**
     * Tworzy głęboką kopię planszy.
     * @returns {Board} Nowa instancja z takim samym stanem pól
     */
    cloneBoard() {
        const copy = new Board(this.variant);
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                copy.tiles[x][y] = { ...this.tiles[x][y] };
            }
        }
        copy._placed = this._placed;
        return copy;
    }

    /**
     * Umieszcza słowo na planszy. Pola już zajęte nie są nadpisywane.
     * @param {Array<{letter: string, isBlank: boolean, isCurrent: boolean}>} word - Litery słowa
     * @param {number} x - Kolumna początku słowa
     * @param {number} y - Wiersz początku słowa
     * @param {boolean} horizontal - `true` = poziomo, `false` = pionowo
     *
     * @example
     * board.putWord([
     *   { letter: 'S', isBlank: false, isCurrent: true },
     *   { letter: 'O', isBlank: false, isCurrent: true },
     *   { letter: 'L', isBlank: false, isCurrent: true },
     * ], 5, 7, true);
     */
    putWord(word, x, y, horizontal) {
        for (let i = 0; i < word.length; i++) {
            const cx = x + (horizontal ? i : 0);
            const cy = y + (horizontal ? 0 : i);
            if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) continue;

            const cell = this.tiles[cx][cy];
            if (cell.letter === null) {
                cell.letter = word[i].letter;
                cell.isCurrent = !!word[i].isCurrent;
                cell.isBlank = !!word[i].isBlank;
                this._placed++;
            }
        }
    }

    /** Zdejmuje oznaczenie „litera z bieżącego ruchu" ze wszystkich pól. */
    resetCurrents() {
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                this.tiles[x][y].isCurrent = false;
            }
        }
    }

    /** Usuwa z planszy litery oznaczone jako bieżące (cofnięcie ruchu). */
    eraseCurrents() {
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                const cell = this.tiles[x][y];
                if (cell.isCurrent) {
                    cell.isCurrent = false;
                    cell.letter = null;
                    cell.isBlank = false;
                    this._placed--;
                }
            }
        }
    }

    /**
     * Wypisuje planszę w konsoli — blanki małymi literami, puste pola kropką.
     * Przydatne przy testach ręcznych w `server/`.
     */
    consolePreviewBoard() {
        let out = 'Stan planszy:\n';
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const cell = this.tiles[x][y];
                if (cell.letter === null) out += '.';
                else out += cell.isBlank ? cell.letter.toLowerCase() : cell.letter;
            }
            out += '\n';
        }
        console.log(out);
    }
}

module.exports = Board;
