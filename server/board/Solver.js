/**
 * @class Solver
 * @description Silnik szukania ruchów. Znajduje wszystkie zagrania możliwe dla
 * danego stanu planszy i stojaka, posortowane malejąco wg punktów.
 *
 * Rozmiar planszy, punktacja, premia za wyłożenie stojaka i minimalna długość
 * słowa pochodzą z **trybu gry** — solver nie zna żadnych stałych rozgrywki.
 *
 * Algorytm:
 * 1. Dla każdej linii (wiersza i kolumny) buduje szablon: litery z planszy + `.`
 *    w miejscach pustych.
 * 2. Wyznacza „kotwice" — puste pola sąsiadujące z literami już leżącymi.
 * 3. Dla każdej kotwicy sprawdza zakresy (przesunięcie, długość) obejmujące ją
 *    i domknięte pustymi polami.
 * 4. Odsiewa zakresy przez cross-checki (litery dozwolone prostopadle).
 * 5. Dopasowuje kandydatów w {@link WordDictionary} i liczy punkty.
 *
 * @example
 * const solver = new Solver(dict, variant);
 * const moves = solver.solve(board, ['K', 'O', 'T', 'E', 'L', 'A', 'S']);
 * console.log(moves[0]); // najlepsze zagranie
 */
class Solver {
    /**
     * @param {import('./WordDictionary')} dictionary - Załadowany słownik
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(dictionary, variant) {
        if (!variant) throw new Error('Solver wymaga trybu gry (CompiledVariant).');
        this.dict = dictionary;
        this.variant = variant;
        this.size = variant.size;
        this.minLen = Math.max(2, variant.rules.minWordLength);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WYSZUKIWANIE RUCHÓW
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Znajduje wszystkie możliwe ruchy. Sam wykrywa pierwszy ruch (pusta plansza)
     * i deleguje do {@link Solver#generateFirstWord}.
     * @param {import('./Board')} board - Aktualna plansza
     * @param {string[]} letters - Litery na stojaku (blank jako `*`)
     * @returns {Array<object>} Ruchy posortowane malejąco wg punktów
     */
    solve(board, letters) {
        this._tiles = board.getTiles();
        this._board = board;

        if (board.isEmpty()) {
            const first = this.generateFirstWord(board, letters);
            this._tiles = null;
            this._board = null;
            return first;
        }

        const results = [];
        const rackSize = letters.length;
        for (let i = 0; i < this.size; i++) {
            results.push(...this.checkLine(board, letters, i, true, rackSize));
            results.push(...this.checkLine(board, letters, i, false, rackSize));
        }

        this._tiles = null;
        this._board = null;
        return results.sort((a, b) => b.points - a.points);
    }

    /**
     * Analizuje jedną linię planszy i zwraca możliwe ruchy.
     * @param {import('./Board')} board - Plansza
     * @param {string[]} letters - Litery na stojaku
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - `true` = wiersz, `false` = kolumna
     * @param {number} [rackSize] - Rozmiar stojaka (optymalizacja)
     * @returns {Array<object>} Ruchy znalezione w tej linii
     */
    checkLine(board, letters, line, horizontal, rackSize = letters.length) {
        const SIZE = this.size;
        const result = [];
        const tiles = this._tiles || board.getTiles();
        const template = this._buildTemplateFast(tiles, line, horizontal);

        const anchors = this._findAnchors(tiles, template, line, horizontal);
        if (anchors.length === 0) return result;

        // Cross-checki liczone raz na linię: dla każdego pustego pola zbiór liter,
        // które nie zepsują słowa prostopadłego.
        const crossChecks = this._buildCrossChecks(tiles, line, horizontal);

        const seen = new Set(); // ten sam zakres bywa osiągalny z kilku kotwic

        for (const anchor of anchors) {
            for (let len = this.minLen; len <= SIZE; len++) {
                const shiftMin = Math.max(0, anchor - len + 1);
                const shiftMax = Math.min(SIZE - len, anchor);

                for (let shift = shiftMin; shift <= shiftMax; shift++) {
                    const key = shift * (SIZE + 1) + len;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    if (!this.isValidPlacement(template, shift, len)) continue;

                    const subtemplate = template.slice(shift, shift + len);

                    // Ile liter trzeba dołożyć ze stojaka?
                    let emptyCount = 0;
                    for (let i = 0; i < len; i++) if (subtemplate.charCodeAt(i) === 46) emptyCount++;
                    if (emptyCount === 0) continue;      // ruch musi coś dokładać
                    if (emptyCount > rackSize) continue; // za mało liter na stojaku

                    // Szybkie odrzucenie zakresu, w którym jakieś pole nie przyjmie żadnej litery.
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
                            this.prepareSingleResult(board, [...letters], word, horizontal, line, shift),
                        );
                    }
                }
            }
        }

        return result;
    }

    /**
     * Generuje możliwe pierwsze ruchy — słowo musi pokryć pole startowe.
     * Sprawdzane są oba kierunki i wszystkie pola startowe trybu.
     * @param {import('./Board')} board - Pusta plansza
     * @param {string[]} letters - Litery na stojaku
     * @returns {Array<object>} Ruchy posortowane malejąco wg punktów
     */
    generateFirstWord(board, letters) {
        const SIZE = this.size;
        const template = '.'.repeat(SIZE);
        const maxLen = Math.min(SIZE, letters.length);
        const result = [];
        const seen = new Set();

        const starts = board.variant.startCells.length
            ? board.variant.startCells
            : [[Math.floor(SIZE / 2), Math.floor(SIZE / 2)]];

        for (const [sx, sy] of starts) {
            for (const horizontal of [true, false]) {
                const line = horizontal ? sy : sx;
                const mustCover = horizontal ? sx : sy;

                for (let len = this.minLen; len <= maxLen; len++) {
                    const shiftMin = Math.max(0, mustCover - len + 1);
                    const shiftMax = Math.min(SIZE - len, mustCover);

                    for (let shift = shiftMin; shift <= shiftMax; shift++) {
                        const key = `${horizontal ? 'h' : 'v'}${line}:${shift}:${len}`;
                        if (seen.has(key)) continue;
                        seen.add(key);

                        const candidates = this.dict.search(len, template.slice(shift, shift + len), letters);
                        for (const word of candidates) {
                            result.push(
                                this.prepareSingleResult(board, [...letters], word, horizontal, line, shift),
                            );
                        }
                    }
                }
            }
        }

        return result.sort((a, b) => b.points - a.points);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ANALIZA LINII
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Buduje szablon linii: litery z planszy, `.` w miejscach pustych.
     * @param {Array<Array<object>>} tiles - Pola planszy
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {string} Np. `"...KOT...A....."`
     * @private
     */
    _buildTemplateFast(tiles, line, horizontal) {
        let s = '';
        for (let i = 0; i < this.size; i++) {
            const letter = horizontal ? tiles[i][line].letter : tiles[line][i].letter;
            s += letter || '.';
        }
        return s;
    }

    /**
     * Wyznacza kotwice — puste pola sąsiadujące z literami leżącymi na planszy.
     * @param {Array<Array<object>>} tiles - Pola planszy
     * @param {string} template - Szablon linii
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {number[]} Indeksy kotwic w linii
     * @private
     */
    _findAnchors(tiles, template, line, horizontal) {
        const SIZE = this.size;
        const out = [];
        for (let i = 0; i < SIZE; i++) {
            if (template.charCodeAt(i) !== 46) continue; // tylko puste pola

            const left = i > 0 && template.charCodeAt(i - 1) !== 46;
            const right = i < SIZE - 1 && template.charCodeAt(i + 1) !== 46;

            let perp = false;
            if (horizontal) {
                if ((line > 0 && tiles[i][line - 1].letter)
                    || (line < SIZE - 1 && tiles[i][line + 1].letter)) perp = true;
            } else {
                if ((line > 0 && tiles[line - 1][i].letter)
                    || (line < SIZE - 1 && tiles[line + 1][i].letter)) perp = true;
            }

            if (left || right || perp) out.push(i);
        }
        return out;
    }

    /**
     * Buduje cross-checki: dla każdego pustego pola linii zbiór liter, które
     * utworzą poprawne słowo prostopadłe.
     * @param {Array<Array<object>>} tiles - Pola planszy
     * @param {number} line - Numer linii
     * @param {boolean} horizontal - Kierunek
     * @returns {Array<{allowed: Set<string>|null}|null>} `null` = pole zajęte,
     *   `{allowed: null}` = brak ograniczeń, `{allowed: Set}` = dozwolone litery
     * @private
     */
    _buildCrossChecks(tiles, line, horizontal) {
        const SIZE = this.size;
        const arr = new Array(SIZE);

        for (let i = 0; i < SIZE; i++) {
            const tile = horizontal ? tiles[i][line] : tiles[line][i];
            if (tile.letter) { arr[i] = null; continue; }

            let prefix = '';
            let suffix = '';
            for (let j = line - 1; j >= 0; j--) {
                const t = horizontal ? tiles[i][j] : tiles[j][i];
                if (!t.letter) break;
                prefix = t.letter + prefix;
            }
            for (let j = line + 1; j < SIZE; j++) {
                const t = horizontal ? tiles[i][j] : tiles[j][i];
                if (!t.letter) break;
                suffix += t.letter;
            }

            arr[i] = (prefix.length === 0 && suffix.length === 0)
                ? { allowed: null }
                : { allowed: this.dict.crossCheckLetters(prefix, suffix) };
        }
        return arr;
    }

    /**
     * Sprawdza, czy kandydat przechodzi cross-checki na wszystkich dokładanych polach.
     * @param {string} word - Słowo kandydat
     * @param {string} subtemplate - Fragment szablonu pod tym słowem
     * @param {number} shift - Przesunięcie słowa w linii
     * @param {Array} crossChecks - Cross-checki linii
     * @returns {boolean}
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
     * Czy zakres jest domknięty — nie styka się z literami leżącymi poza nim.
     * @param {string} template - Szablon linii
     * @param {number} shift - Pozycja startowa
     * @param {number} len - Długość słowa
     * @returns {boolean}
     */
    isValidPlacement(template, shift, len) {
        if (shift > 0 && template.charCodeAt(shift - 1) !== 46) return false;
        if (shift + len < this.size && template.charCodeAt(shift + len) !== 46) return false;
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUNKTACJA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sprawdza ruch podany przez człowieka i liczy punkty.
     * @param {import('./Board')} board - Plansza
     * @param {string[]} letters - Litery na stojaku gracza
     * @param {string} word - Pełne słowo (razem z literami już na planszy)
     * @param {boolean} horizontal - Kierunek
     * @param {number} x - Kolumna początku słowa
     * @param {number} y - Wiersz początku słowa
     * @param {Set<number>} [blankCells] - Pola (`y * size + x`), na których gracz
     *   położył blanka. Bez tego serwer sam zgadywałby, który klocek jest blankiem,
     *   co przy powtórzonej literze potrafi wybrać wariant na niekorzyść gracza.
     * @returns {object} `{ success: true, points, ... }` albo `{ success: false, wrongWords }`
     */
    checkWord(board, letters, word, horizontal, x, y, blankCells = null) {
        return this.prepareSingleResult(
            board, [...letters], word, horizontal,
            horizontal ? y : x,
            horizontal ? x : y,
            true,
            blankCells,
        );
    }

    /**
     * Buduje kompletny opis ruchu: punkty, zużyte litery, słowa prostopadłe
     * i premię za wyłożenie stojaka.
     * @param {import('./Board')} board - Plansza
     * @param {string[]} letters - Kopia liter ze stojaka
     * @param {string} word - Słowo do ułożenia (wielkimi literami)
     * @param {boolean} horizontal - Kierunek
     * @param {number} line - Numer linii
     * @param {number} shift - Pozycja startowa w linii
     * @param {boolean} [withChecking=false] - Czy sprawdzać słowa w słowniku
     * @param {Set<number>} [blankCells=null] - Pola (`y * size + x`) obsadzone blankiem
     * @returns {object} Opis ruchu albo `{ success: false, wrongWords }`
     * @throws {Error} Gdy na stojaku brakuje litery potrzebnej do ułożenia słowa
     */
    prepareSingleResult(board, letters, word, horizontal, line, shift, withChecking = false, blankCells = null) {
        const tiles = this._tiles || board.getTiles();
        const variant = this.variant;
        const wordLen = word.length;
        const resultWord = new Array(wordLen);

        let additPoints = 0;
        let basePoints = 0;
        let wordMultiply = 1;
        const perpendicularWords = [];
        const usedLetters = [];

        // Licznik liter na stojaku — szybszy niż wielokrotne indexOf.
        const rack = new Map();
        for (const l of letters) rack.set(l, (rack.get(l) || 0) + 1);

        for (let idx = 0; idx < wordLen; idx++) {
            const letter = word[idx].toUpperCase();
            const x = horizontal ? shift + idx : line;
            const y = horizontal ? line : shift + idx;
            const tile = tiles[x][y];
            const isCurrent = !tile.letter;

            let letterPoints = 0;
            let letterMultiplier = 1;
            let currentWordMul = 1;

            if (isCurrent) {
                const bonus = board.getBonus(x, y);
                currentWordMul = bonus.w;
                wordMultiply *= currentWordMul;
                letterMultiplier = bonus.l;

                // Gracz mógł jawnie wskazać, że na tym polu kładzie blanka.
                const declaredBlank = blankCells ? blankCells.has(y * this.size + x) : false;
                const count = declaredBlank ? 0 : (rack.get(letter) || 0);

                if (count > 0) {
                    rack.set(letter, count - 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: false };
                    letterPoints = board.getPointsForLetter(letter);
                    usedLetters.push(letter);
                } else {
                    const blanks = rack.get(variant.blankSymbol) || 0;
                    if (blanks === 0) throw new Error(`Brak litery "${letter}" na stojaku.`);
                    rack.set(variant.blankSymbol, blanks - 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: true };
                    letterPoints = variant.pointsOf(variant.blankSymbol);
                    usedLetters.push(variant.blankSymbol);
                }

                const perp = this.calculatePerpendicular(
                    board, x, y, letter,
                    letterPoints, letterMultiplier, currentWordMul, horizontal,
                );
                additPoints += perp.points;
                if (perp.word) perpendicularWords.push(perp.word);
            } else {
                resultWord[idx] = { letter, isCurrent: false, isBlank: tile.isBlank };
                letterPoints = tile.isBlank ? variant.pointsOf(variant.blankSymbol) : board.getPointsForLetter(letter);
            }

            basePoints += letterPoints * letterMultiplier;
        }

        basePoints = basePoints * wordMultiply + additPoints;

        const isBingo = usedLetters.length >= variant.bingo.tiles;
        if (isBingo) basePoints += variant.bingo.bonus;

        if (withChecking && variant.rules.validateWords) {
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
            usedLetters,
            isBingo,
        };
    }

    /**
     * Liczy punkty za słowo prostopadłe powstałe przez dołożenie litery.
     * @param {import('./Board')} board - Plansza
     * @param {number} x - Kolumna dokładanej litery
     * @param {number} y - Wiersz dokładanej litery
     * @param {string} letter - Dokładana litera
     * @param {number} letterPoints - Punkty za tę literę
     * @param {number} letterMultiplier - Mnożnik litery z pola
     * @param {number} currentWordMul - Mnożnik słowa z pola
     * @param {boolean} horizontal - Kierunek słowa głównego
     * @returns {{word: string|null, points: number}} Słowo prostopadłe i jego punkty
     */
    calculatePerpendicular(board, x, y, letter, letterPoints, letterMultiplier, currentWordMul, horizontal) {
        const SIZE = this.size;
        const tiles = this._tiles || board.getTiles();
        const dx = horizontal ? 0 : 1;
        const dy = horizontal ? 1 : 0;

        let word = letter;
        let extraPoints = letterPoints * letterMultiplier;

        for (let j = 1; j < SIZE; j++) {
            const nx = x + dx * j;
            const ny = y + dy * j;
            if (nx >= SIZE || ny >= SIZE) break;
            const t = tiles[nx][ny];
            if (!t.letter) break;
            word += t.letter;
            if (!t.isBlank) extraPoints += board.getPointsForLetter(t.letter);
        }
        for (let j = 1; j < SIZE; j++) {
            const nx = x - dx * j;
            const ny = y - dy * j;
            if (nx < 0 || ny < 0) break;
            const t = tiles[nx][ny];
            if (!t.letter) break;
            word = t.letter + word;
            if (!t.isBlank) extraPoints += board.getPointsForLetter(t.letter);
        }

        if (word.length === 1) return { word: null, points: 0 };
        return { word, points: extraPoints * currentWordMul };
    }
}

module.exports = Solver;
