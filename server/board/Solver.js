const Board = require('./Board');
const WordDictionary = require('./WordDictionary');

/**
 * Rozmiar planszy (15x15).
 * @constant {number}
 */
const SIZE = 15;

/**
 * @class Solver
 * @description Silnik rozwiązujący (solver) gry Scrabble. Znajduje wszystkie możliwe
 * ruchy dla danego stanu planszy i zestawu liter na stojaku, posortowane wg punktów.
 *
 * Algorytm:
 * 1. Buduje szablon (template) dla każdej linii planszy (15 wierszy + 15 kolumn).
 * 2. Wyznacza "anchory" — puste pola sąsiadujące z istniejącymi literami.
 * 3. Dla każdego anchora generuje możliwe zakresy umieszczenia słowa.
 * 4. Filtruje przez cross-checks (dozwolone litery prostopadłe).
 * 5. Wyszukuje kandydatów w WordDictionary i oblicza punkty.
 *
 * @example
 * const Solver = require('./Solver');
 * const WordDictionary = require('./WordDictionary');
 * const Board = require('./Board');
 *
 * const dict = new WordDictionary();
 * await dict.ready;
 * const solver = new Solver(dict);
 * const board = new Board();
 *
 * // Pierwszy ruch
 * const moves = solver.generateFirstWord(board, ['K','O','T','E','L','A','S']);
 * console.log(moves[0]); // najlepszy ruch
 *
 * // Kolejne ruchy
 * board.putWord(moves[0].word, moves[0].x, moves[0].y, moves[0].horizontal);
 * const nextMoves = solver.solve(board, ['P','I','Z','D','A','R','*']);
 * console.log(nextMoves[0]); // najlepszy następny ruch
 */
class Solver {
    /**
     * Tworzy instancję Solvera.
     * @param {WordDictionary} dictionary - Załadowany słownik
     */
    constructor(dictionary) {
        this.dict = dictionary;
    }

    /**
     * Główna metoda rozwiązująca — znajduje wszystkie możliwe ruchy.
     * Automatycznie wykrywa czy plansza jest pusta (pierwszy ruch) i deleguje odpowiednio.
     * @param {Board} board - Aktualna plansza
     * @param {string[]} letters - Litery na stojaku gracza (np. ['A','B','*'])
     * @returns {Array<object>} Tablica ruchów posortowana malejąco wg punktów.
     *   Każdy ruch: { success, wordSimple, word, x, y, horizontal, points, usedLetters, perpendicularWords }
     */
    solve(board, letters) {
        const results = [];
        // cache planszy raz na całe wywołanie
        this._tiles = board.getTiles();
        this._board = board;

        // pre-kompilacja punktów dla liter w stojaku (mała pomoc)
        const rackSize = letters.length;

        // Czy plansza jest pusta?
        const empty = this._isBoardEmpty();
        if (empty) {
            const r = this.generateFirstWord(board, letters);
            this._tiles = null; this._board = null;
            return r;
        }

        for (let i = 0; i < SIZE; i++) {
            results.push(...this.checkLine(board, letters, i, true, rackSize));
            results.push(...this.checkLine(board, letters, i, false, rackSize));
        }

        this._tiles = null;
        this._board = null;
        return results.sort((a, b) => b.points - a.points);
    }

    /**
     * Sprawdza czy plansza jest całkowicie pusta.
     * @returns {boolean} true jeśli brak jakiejkolwiek litery na planszy
     * @private
     */
    _isBoardEmpty() {
        const t = this._tiles;
        for (let x = 0; x < SIZE; x++)
            for (let y = 0; y < SIZE; y++)
                if (t[x][y].letter) return false;
        return true;
    }

    /**
     * Analizuje pojedynczą linię planszy (wiersz lub kolumnę) i zwraca możliwe ruchy.
     * @param {Board} board - Plansza
     * @param {string[]} letters - Litery na stojaku
     * @param {number} line - Numer linii (0-14)
     * @param {boolean} horizontal - true = analizuj wiersz, false = kolumnę
     * @param {number} [rackSize] - Rozmiar stojaka (optymalizacja)
     * @returns {Array<object>} Tablica znalezionych ruchów dla tej linii
     * @private
     */
    checkLine(board, letters, line, horizontal, rackSize = letters.length) {
        const result = [];
        const tiles = this._tiles || board.getTiles();
        const template = this._buildTemplateFast(tiles, line, horizontal);

        // Wyznacz anchory: pozycje, gdzie pole jest puste i ma sąsiada (na linii lub prostopadle)
        const anchors = this._findAnchors(tiles, template, line, horizontal);
        if (anchors.length === 0) return result;

        // Pre-kompiluj cross-checks: dla każdej pustej komórki na linii zbiór dozwolonych liter
        // (i dodatkowy punkt dla słowa prostopadłego). Używane zamiast isWordValid.
        const crossChecks = this._buildCrossChecks(tiles, line, horizontal);

        // Iteracja: dla każdego anchora szukamy zakresów (shift,len) tak,
        // aby zakres OBEJMOWAŁ ten anchor i był prawidłowo "zamknięty" pustymi sąsiadami.
        const seen = new Set(); // unika powielania (shift,len) z różnych anchorów

        for (const a of anchors) {
            // Maksymalna długość: do końca planszy
            const maxLen = Math.min(SIZE, SIZE - 0);
            for (let len = 2; len <= SIZE; len++) {
                // shift musi być taki, że [shift, shift+len) zawiera a
                const shiftMin = Math.max(0, a - len + 1);
                const shiftMax = Math.min(SIZE - len, a);
                for (let shift = shiftMin; shift <= shiftMax; shift++) {
                    const key = shift * 32 + len;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    if (!this.isValidPlacement(template, shift, len)) continue;

                    const subtemplate = template.slice(shift, shift + len);

                    // Liczba pustych miejsc do wypełnienia z stojaka:
                    let emptyCount = 0;
                    for (let i = 0; i < len; i++) if (subtemplate.charCodeAt(i) === 46) emptyCount++;
                    if (emptyCount === 0) continue;          // musi coś dołożyć
                    if (emptyCount > rackSize) continue;     // brak liter w stojaku

                    // Pre-filtr przez cross-checks: szybkie odrzucenie szablonów,
                    // dla których jakaś pusta pozycja ma puste cross-check.
                    let crossOk = true;
                    for (let i = 0; i < len && crossOk; i++) {
                        if (subtemplate.charCodeAt(i) === 46) {
                            const cc = crossChecks[shift + i];
                            if (cc && cc.allowed && cc.allowed.size === 0) crossOk = false;
                        }
                    }
                    if (!crossOk) continue;

                    const candidates = this.dict.search(len, subtemplate, letters);
                    if (!candidates || candidates.length === 0) continue;

                    for (const word of candidates) {
                        if (!this._passesCrossChecks(word, subtemplate, shift, crossChecks)) continue;
                        result.push(
                            this.prepareSingleResult(board, [...letters], word, horizontal, line, shift)
                        );
                    }
                }
            }
        }

        return result;
    }

    /**
     * Buduje szablon linii (string 15 znaków) — litery z planszy + '.' dla pustych pól.
     * @param {Array} tiles - Tablica pól planszy (board.getTiles())
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {string} Szablon np. "...KOT...A....."
     * @private
     */
    _buildTemplateFast(tiles, line, horizontal) {
        let s = '';
        if (horizontal) {
            for (let i = 0; i < SIZE; i++) {
                const l = tiles[i][line].letter;
                s += l ? l : '.';
            }
        } else {
            for (let i = 0; i < SIZE; i++) {
                const l = tiles[line][i].letter;
                s += l ? l : '.';
            }
        }
        return s;
    }

    /**
     * Wyznacza pozycje "anchorów" — puste pola sąsiadujące z istniejącymi literami.
     * Anchor to miejsce, w którym nowe słowo musi się "zaczepić" o istniejące litery.
     * @param {Array} tiles - Pola planszy
     * @param {string} template - Szablon linii
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {number[]} Tablica indeksów anchorów na linii
     * @private
     */
    _findAnchors(tiles, template, line, horizontal) {
        const out = [];
        for (let i = 0; i < SIZE; i++) {
            if (template.charCodeAt(i) !== 46) continue; // tylko puste
            // sąsiad na tej samej linii
            const left = i > 0 && template.charCodeAt(i - 1) !== 46;
            const right = i < SIZE - 1 && template.charCodeAt(i + 1) !== 46;
            // sąsiad prostopadły
            let perp = false;
            if (horizontal) {
                if ((line > 0 && tiles[i][line - 1].letter) ||
                    (line < SIZE - 1 && tiles[i][line + 1].letter)) perp = true;
            } else {
                if ((line > 0 && tiles[line - 1][i].letter) ||
                    (line < SIZE - 1 && tiles[line + 1][i].letter)) perp = true;
            }
            if (left || right || perp) out.push(i);
        }
        return out;
    }

    /**
     * Buduje cross-checks dla każdej pozycji na linii.
     * Cross-check = zbiór liter dozwolonych na danym polu, aby nie tworzyć
     * niepoprawnych słów prostopadłych.
     * @param {Array} tiles - Pola planszy
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {Array<{allowed: Set<string>|null}|null>} Tablica 15 elementów.
     *   null = pole zajęte, {allowed: null} = brak ograniczenia, {allowed: Set} = dozwolone litery
     * @private
     */
    _buildCrossChecks(tiles, line, horizontal) {
        const arr = new Array(SIZE);
        for (let i = 0; i < SIZE; i++) {
            const tile = horizontal ? tiles[i][line] : tiles[line][i];
            if (tile.letter) { arr[i] = null; continue; }

            let prefix = '', suffix = '';
            if (horizontal) {
                for (let j = line - 1; j >= 0; j--) {
                    const t = tiles[i][j];
                    if (!t.letter) break;
                    prefix = t.letter + prefix;
                }
                for (let j = line + 1; j < SIZE; j++) {
                    const t = tiles[i][j];
                    if (!t.letter) break;
                    suffix += t.letter;
                }
            } else {
                for (let j = line - 1; j >= 0; j--) {
                    const t = tiles[j][i];
                    if (!t.letter) break;
                    prefix = t.letter + prefix;
                }
                for (let j = line + 1; j < SIZE; j++) {
                    const t = tiles[j][i];
                    if (!t.letter) break;
                    suffix += t.letter;
                }
            }

            arr[i] = (prefix.length === 0 && suffix.length === 0)
                ? { allowed: null }
                : { allowed: this.dict.crossCheckLetters(prefix, suffix) };
        }
        return arr;
    }

    /**
     * Sprawdza czy słowo-kandydat przechodzi cross-checks na wszystkich pustych pozycjach.
     * @param {string} word - Słowo kandydat
     * @param {string} subtemplate - Fragment szablonu dla tego słowa
     * @param {number} shift - Przesunięcie (pozycja startowa) słowa na linii
     * @param {Array} crossChecks - Tablica cross-checks
     * @returns {boolean} true jeśli słowo spełnia wszystkie cross-checks
     * @private
     */
    _passesCrossChecks(word, subtemplate, shift, crossChecks) {
        for (let i = 0; i < word.length; i++) {
            if (subtemplate.charCodeAt(i) !== 46) continue;
            const cc = crossChecks[shift + i];
            if (!cc || cc.allowed == null) continue;
            if (!cc.allowed.has(word[i])) return false;
        }
        return true;
    }

    /**
     * Generuje możliwe pierwsze ruchy (plansza pusta).
     * Pierwszy ruch musi przechodzić przez środek planszy (7,7).
     * @param {Board} board - Pusta plansza
     * @param {string[]} letters - Litery na stojaku (max 7)
     * @returns {Array<object>} Ruchy posortowane malejąco wg punktów
     */
    generateFirstWord(board, letters) {
        const template = ".".repeat(SIZE);
        const horizontal = true;
        const line = 7; // środek planszy 15x15 to indeks 7
        const result = [];

        for (let len = 2; len <= 7; len++) {
            for (let shift = 0; shift <= SIZE - len; shift++) {
                // słowo musi przechodzić przez środek (7,7)
                if (shift > 7 || shift + len <= 7) continue;
                const subtemplate = template.slice(shift, shift + len);
                const candidates = this.dict.search(len, subtemplate, letters);
                for (const word of candidates) {
                    result.push(
                        this.prepareSingleResult(board, [...letters], word, horizontal, line, shift)
                    );
                }
            }
        }
        return result.sort((a, b) => b.points - a.points);
    }

    /**
     * Buduje szablon linii (wersja publiczna dla kompatybilności wstecznej).
     * @param {Board} board - Plansza
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {string} Szablon linii
     * @deprecated Użyj _buildTemplateFast zamiast tego
     */
    buildTemplate(board, line, horizontal) {
        return this._buildTemplateFast(board.getTiles(), line, horizontal);
    }

    /**
     * Sprawdza czy umieszczenie słowa w danym zakresie jest poprawne
     * (nie styka się bezpośrednio z literami poza zakresem).
     * @param {string} template - Szablon linii
     * @param {number} shift - Pozycja startowa
     * @param {number} len - Długość słowa
     * @returns {boolean} true jeśli umieszczenie jest izolowane od sąsiednich liter poza zakresem
     */
    isValidPlacement(template, shift, len) {
        if (shift > 0 && template.charCodeAt(shift - 1) !== 46) return false;
        if (shift + len < SIZE && template.charCodeAt(shift + len) !== 46) return false;
        return true;
    }

    /**
     * Sprawdza czy w podanym zakresie istnieje sąsiadująca litera w kierunku prostopadłym.
     * @param {Board} board - Plansza
     * @param {number} line - Numer linii
     * @param {number} shift - Pozycja startowa
     * @param {number} len - Długość zakresu
     * @param {boolean} horizontal - Kierunek
     * @returns {boolean} true jeśli istnieje sąsiad prostopadły
     */
    hasAdjacentLetter(board, line, shift, len, horizontal) {
        const tiles = this._tiles || board.getTiles();
        for (let i = shift; i < shift + len; i++) {
            if (horizontal) {
                if ((line > 0 && tiles[i][line - 1].letter) ||
                    (line < SIZE - 1 && tiles[i][line + 1].letter)) return true;
            } else {
                if ((line > 0 && tiles[line - 1][i].letter) ||
                    (line < SIZE - 1 && tiles[line + 1][i].letter)) return true;
            }
        }
        return false;
    }

    /**
     * Waliduje słowo pod kątem poprawności tworzonych słów prostopadłych.
     * @param {Board} board - Plansza
     * @param {string} word - Słowo do walidacji
     * @param {number} line - Numer linii
     * @param {number} shift - Pozycja startowa
     * @param {boolean} horizontal - Kierunek
     * @returns {boolean} true jeśli wszystkie słowa prostopadłe są poprawne
     * @deprecated Użyj cross-checks zamiast tego (szybsza metoda)
     */
    isWordValid(board, word, line, shift, horizontal) {
        // pozostawione dla kompatybilności – używaj cross-checks zamiast tego
        const tiles = this._tiles || board.getTiles();
        for (let i = 0; i < word.length; i++) {
            const x = horizontal ? i + shift : line;
            const y = horizontal ? line : i + shift;
            if (tiles[x][y].letter) continue;

            let candidate = word[i];
            for (let j = (horizontal ? y : x) + 1; j < SIZE; j++) {
                const t = horizontal ? tiles[x][j] : tiles[j][y];
                if (!t.letter) break;
                candidate += t.letter;
            }
            for (let j = (horizontal ? y : x) - 1; j >= 0; j--) {
                const t = horizontal ? tiles[x][j] : tiles[j][y];
                if (!t.letter) break;
                candidate = t.letter + candidate;
            }
            if (candidate.length > 1 && !this.dict.searchDicionarySimple(candidate)) return false;
        }
        return true;
    }

    /**
     * Sprawdza poprawność słowa podanego przez gracza i oblicza punkty.
     * Używane do walidacji ruchów ludzkich graczy.
     * @param {Board} board - Plansza
     * @param {string[]} letters - Litery na stojaku gracza
     * @param {string} word - Pełne słowo (z literami już na planszy)
     * @param {boolean} horizontal - Kierunek
     * @param {number} x - Współrzędna X początku
     * @param {number} y - Współrzędna Y początku
     * @returns {object} Wynik: { success: true, word, points, ... } lub { success: false, wrongWords }
     */
    checkWord(board, letters, word, horizontal, x, y) {
        return this.prepareSingleResult(
            board, [...letters], word, horizontal,
            horizontal ? y : x,
            horizontal ? x : y,
            true
        );
    }

    /**
     * Przygotowuje kompletny wynik dla pojedynczego ruchu — oblicza punkty,
     * zużyte litery, słowa prostopadłe, bonus za 7 liter (+50 pkt).
     * @param {Board} board - Plansza
     * @param {string[]} letters - Kopia liter na stojaku
     * @param {string} word - Słowo do umieszczenia (uppercase)
     * @param {boolean} horizontal - Kierunek
     * @param {number} line - Numer linii
     * @param {number} shift - Pozycja startowa na linii
     * @param {boolean} [withChecking=false] - Czy walidować słowa w słowniku
     * @returns {object} Obiekt ruchu:
     *   { success, replace, wordSimple, perpendicularWords, word, x, y, horizontal, points, usedLetters }
     *   lub przy withChecking=true i błędach: { success: false, wrongWords }
     */
    prepareSingleResult(board, letters, word, horizontal, line, shift, withChecking = false) {
        const tiles = this._tiles || board.getTiles();
        const wordLen = word.length;
        const resultWord = new Array(wordLen);
        let additPoints = 0, basePoints = 0, wordMultiply = 1;
        const perpendicularWords = [];
        const usedLetters = [];

        // Mapa licznika liter w stojaku — szybsze niż indexOf
        const rack = new Map();
        for (const l of letters) rack.set(l, (rack.get(l) || 0) + 1);

        for (let idx = 0; idx < wordLen; idx++) {
            const letter = word[idx].toUpperCase();
            const x = horizontal ? shift + idx : line;
            const y = horizontal ? line : shift + idx;
            const tile = tiles[x][y];
            const isCurrent = !tile.letter;

            let letterPoints = 0, letterMultiplier = 1, currentWordMul = 1;

            if (isCurrent) {
                const bonus = board.getBonus(x, y);
                currentWordMul = bonus.w;
                wordMultiply *= currentWordMul;
                letterMultiplier = bonus.l;

                const cnt = rack.get(letter) || 0;
                if (cnt > 0) {
                    rack.set(letter, cnt - 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: false };
                    letterPoints = board.getPointsForLetter(letter);
                    usedLetters.push(letter);
                } else {
                    const blanks = rack.get('*') || 0;
                    if (blanks === 0) throw new Error("cant find letter");
                    rack.set('*', blanks - 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: true };
                    usedLetters.push('*');
                }

                const perp = this.calculatePerpendicular(
                    board, x, y, letter,
                    letterPoints, letterMultiplier,
                    currentWordMul, horizontal
                );
                additPoints += perp.points;
                if (perp.word) perpendicularWords.push(perp.word);
            } else {
                resultWord[idx] = { letter, isCurrent: false, isBlank: tile.isBlank };
                letterPoints = tile.isBlank ? 0 : board.getPointsForLetter(letter);
            }

            basePoints += letterPoints * letterMultiplier;
        }

        basePoints = basePoints * wordMultiply + additPoints;
        if (usedLetters.length === 7) basePoints += 50;

        if (withChecking) {
            const wrongWords = [];
            if (!this.dict.searchDicionarySimple(word)) wrongWords.push(word);
            for (const pw of perpendicularWords) {
                if (!this.dict.searchDicionarySimple(pw)) wrongWords.push(pw);
            }
            if (wrongWords.length > 0) return { success: false, wrongWords };
        }

        return {
            success: true,
            replace: false,
            wordSimple: word,
            perpendicularWords,
            word: resultWord,
            x: horizontal ? shift : line,
            y: horizontal ? line : shift,
            horizontal,
            points: basePoints,
            usedLetters
        };
    }

    /**
     * Oblicza punkty za słowo prostopadłe tworzone przez umieszczenie litery na danym polu.
     * @param {Board} board - Plansza
     * @param {number} x - Współrzędna X umieszczanej litery
     * @param {number} y - Współrzędna Y umieszczanej litery
     * @param {string} letter - Umieszczana litera
     * @param {number} letterPoints - Punkty za literę
     * @param {number} letterMultiplier - Mnożnik litery (z bonusu pola)
     * @param {number} currentWordMul - Mnożnik słowa (z bonusu pola)
     * @param {boolean} horizontal - Kierunek głównego słowa
     * @returns {{word: string|null, points: number}} Słowo prostopadłe i jego punkty (null jeśli brak)
     */
    calculatePerpendicular(board, x, y, letter, letterPoints, letterMultiplier, currentWordMul, horizontal) {
        const tiles = this._tiles || board.getTiles();
        const dx = horizontal ? 0 : 1;
        const dy = horizontal ? 1 : 0;
        let startWord = letter;
        let extraPoints = letterPoints * letterMultiplier;

        for (let j = 1; j < SIZE; j++) {
            const nx = x + dx * j, ny = y + dy * j;
            if (nx >= SIZE || ny >= SIZE) break;
            const t = tiles[nx][ny];
            if (!t.letter) break;
            startWord += t.letter;
            if (!t.isBlank) extraPoints += board.getPointsForLetter(t.letter);
        }
        for (let j = 1; j < SIZE; j++) {
            const nx = x - dx * j, ny = y - dy * j;
            if (nx < 0 || ny < 0) break;
            const t = tiles[nx][ny];
            if (!t.letter) break;
            startWord = t.letter + startWord;
            if (!t.isBlank) extraPoints += board.getPointsForLetter(t.letter);
        }

        if (startWord.length === 1) return { word: null, points: 0 };
        return { word: startWord, points: extraPoints * currentWordMul };
    }
}

module.exports = Solver;
