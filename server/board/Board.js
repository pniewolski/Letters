const fs = require('fs');

/**
 * @class Board
 * @description Reprezentuje planszę do gry w Scrabble o wymiarach 15x15.
 * Przechowuje stan pól (litery, blanki, bieżące ruchy) oraz mnożniki punktowe
 * i wartości punktowe liter. Ładuje konfigurację z plików JSON (layout.json, letters.json).
 *
 * @example
 * const Board = require('./Board');
 * const board = new Board();
 * board.putWord([{letter:"K", isBlank:false, isCurrent:true}], 7, 7, true);
 * board.consolePreviewBoard();
 */
class Board {
    /**
     * Tworzy nową, pustą planszę 15x15.
     * Automatycznie ładuje mnożniki pól (layout.json) i wartości punktowe liter (letters.json).
     */
    constructor() {
        this.tiles = [];
        for (let i = 0; i < 15; i++) {
            this.tiles[i] = [];
            for (let j = 0; j < 15; j++) {
                this.tiles[i][j] = {
                    letter: null,
                    isBlank: false,
                    isCurrent: false,
                };
            }
        }
        this.getBoardMultiply();
        this.loadPoints();
    }

    /**
     * Ładuje wartości punktowe liter z pliku letters.json.
     * Wynik zapisywany jest w this.points jako obiekt { punkty: [litery] }.
     * @private
     */
    loadPoints() {
        const pointsJson = fs.readFileSync('letters.json', 'utf-8');
        this.points = JSON.parse(pointsJson).points;
    }


    /**
     * Zwraca liczbę punktów za podaną literę.
     * @param {string} litera - Litera (wielkość liter nie ma znaczenia)
     * @returns {number} Liczba punktów za literę (0 jeśli litera nieznana)
     *
     * @example
     * board.getPointsForLetter('A'); // => 1
     * board.getPointsForLetter('Ź'); // => 9
     */
    getPointsForLetter(litera) {
        const literaUpper = litera.toUpperCase();

        for (const [punktyZaLitere, litery] of Object.entries(this.points)) {
            //console.log("punktyZaLitere",punktyZaLitere,"litery",litery);
            // Sprawdź, czy `litery` faktycznie jest tablicą
            if (Array.isArray(litery) && litery.includes(literaUpper)) {
                return parseInt(punktyZaLitere);
            }
        }
        return 0; // nieznana litera lub znak specjalny
    }



    /**
     * Ładuje konfigurację mnożników planszy z pliku layout.json.
     * Mnożniki zapisywane są w this.multiplies jako tablica 15x15 obiektów {w, l}
     * gdzie w = mnożnik słowa, l = mnożnik litery.
     * @private
     */
    getBoardMultiply() {
        const multiJson = fs.readFileSync('layout.json', 'utf-8');
        this.multiplies = JSON.parse(multiJson);
    }

    /**
     * Zwraca obiekt mnożników dla danego pola planszy.
     * @param {number} x - Współrzędna X (kolumna, 0-14)
     * @param {number} y - Współrzędna Y (wiersz, 0-14)
     * @returns {{w: number, l: number}} Obiekt z mnożnikiem słowa (w) i litery (l)
     */
    getBonus(x,y) {
        return this.multiplies[x][y];
    }

    /**
     * Zwraca aktualną tablicę pól planszy.
     * @returns {Array<Array<{letter: string|null, isBlank: boolean, isCurrent: boolean}>>} Tablica 15x15 pól
     */
    getTiles() {
        return this.tiles;
    }

    /**
     * Ustawia tablicę pól planszy (nadpisuje istniejącą).
     * @param {Array<Array<{letter: string|null, isBlank: boolean, isCurrent: boolean}>>} tiles - Nowa tablica pól
     */
    setTiles(tiles) {
        this.tiles = tiles;
    }

    /**
     * Wyświetla aktualny stan planszy w konsoli.
     * Puste pola oznaczone są '-', blanki małymi literami, normalne litery dużymi.
     */
    consolePreviewBoard() {
        let result = "Stan planszy:\n";
        for (let j = 0; j < 15; j++) {
            for (let i = 0; i < 15; i++) {
                if (this.tiles[i][j].letter === null) {
                    result += "-";
                } else {
                    if (this.tiles[i][j].isBlank) {
                        result += this.tiles[i][j].letter.toLowerCase();
                    } else {
                        result += this.tiles[i][j].letter;
                    }
                }
            }
            result += "\n";
        }
        console.log(result);
    }

    
    /**
     * Tworzy głęboką kopię planszy (nowa instancja Board z skopiowanymi polami).
     * @returns {Board} Nowa instancja Board z identycznym stanem pól
     *
     * @example
     * const copy = board.cloneBoard();
     * // modyfikacje copy nie wpływają na oryginał
     */
    cloneBoard() {
        let result = new Board();
        let tilesCopy = [];
        for (let i = 0; i < 15; i++) {
            tilesCopy[i] = [];
            for (let j = 0; j < 15; j++) {
                tilesCopy[i][j] = {...this.tiles[i][j]};
            }
        }
        result.setTiles(tilesCopy);
        return result;
    }

    /**
     * Umieszcza słowo na planszy.
     * Litery są wstawiane tylko na puste pola — istniejące litery nie są nadpisywane.
     * @param {Array<{letter: string, isBlank: boolean, isCurrent: boolean}>} word - Tablica obiektów liter do umieszczenia
     * @param {number} x - Współrzędna X (kolumna) początku słowa
     * @param {number} y - Współrzędna Y (wiersz) początku słowa
     * @param {boolean} horizontal - true = słowo poziome, false = słowo pionowe
     *
     * @example
     * board.putWord([
     *   {letter:"S", isBlank:false, isCurrent:true},
     *   {letter:"O", isBlank:false, isCurrent:true},
     *   {letter:"L", isBlank:false, isCurrent:true}
     * ], 5, 7, true);
     */
    putWord(word, x, y, horizontal) {
        for (let i = 0; i < word.length; i++) {
            let currX = x + (horizontal ? i : 0);
            let currY = y + (!horizontal ? i : 0);
            if (this.tiles[currX][currY].letter == null) {
                this.tiles[currX][currY].letter = word[i].letter;
                this.tiles[currX][currY].isCurrent = word[i].isCurrent;
                this.tiles[currX][currY].isBlank = word[i].isBlank;
            }

        }
    }

    /**
     * Resetuje flagę isCurrent dla wszystkich pól planszy.
     * Używane po zatwierdzeniu ruchu — litery przestają być "bieżące".
     */
    resetCurrents() {
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                this.tiles[i][j].isCurrent = false;
            }
        }
    }

    /**
     * Usuwa z planszy wszystkie litery oznaczone jako bieżące (isCurrent = true).
     * Przywraca te pola do stanu pustego. Używane do cofania ruchu.
     */
    eraseCurrents() {
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                if (this.tiles[i][j].isCurrent) {
                    this.tiles[i][j].isCurrent = false;
                    this.tiles[i][j].letter = null;
                    this.tiles[i][j].isBlank = false;
                }

            }
        }
    }

    /**
     * Zwraca aktualny stan planszy (alias dla getTiles).
     * @returns {Array<Array<{letter: string|null, isBlank: boolean, isCurrent: boolean}>>} Tablica 15x15 pól
     */
    getBoardState() {
        return this.tiles;
    }

}

module.exports = Board;
