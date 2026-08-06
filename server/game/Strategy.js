const fs = require('fs');

/**
 * Rozmiar planszy (15x15).
 * @constant {number}
 */
const SIZE = 15;

/** Samogłoski (z polskimi) — do oceny balansu stojaka. */
const VOWELS = new Set(['A', 'Ą', 'E', 'Ę', 'I', 'O', 'Ó', 'U', 'Y']);

/**
 * @class Strategy
 * @description Klasa strategii AI w grze Scrabble. Decyduje, czy komputer powinien
 * położyć słowo, czy wymienić litery. Jeśli najlepszy ruch daje mniej punktów
 * niż próg (domyślnie 25), AI decyduje o wymianie najmniej użytecznych liter.
 *
 * Użyteczność liter jest konfigurowana w pliku letters.json (sekcja "usefulness"),
 * gdzie wyższa wartość = mniej użyteczna litera (bardziej nadaje się do wymiany).
 *
 * @example
 * const Strategy = require('./Strategy');
 * const strategy = new Strategy();
 *
 * // moves = tablica ruchów posortowana malejąco wg punktów (z Solvera)
 * const bestMove = strategy.getBestMove(moves, board, stack);
 * if (bestMove.replace) {
 *   console.log("Wymiana liter:", bestMove.letters);
 * } else {
 *   console.log("Kładziemy:", bestMove.wordSimple, "za", bestMove.points, "pkt");
 * }
 */
class Strategy {

    /**
     * Tworzy instancję strategii.
     * Ładuje konfigurację użyteczności liter z letters.json.
     * @property {number} pointsThreshold - Próg punktowy poniżej którego AI wymienia litery (domyślnie 25)
     */
    constructor() {
        const lettersJson = fs.readFileSync('letters.json', 'utf-8');
        this.usefulness = JSON.parse(lettersJson).usefulness;

        this.pointsThreshold = 25;

        // Ile najlepszych ruchów (wg surowych punktów) poddajemy ocenie strategicznej.
        // Ograniczone, by nie spowalniać ruchu AI.
        this.candidatePoolSize = 20;

        // Wagi oceny strategicznej.
        this.exposureWeight = 1.0; // jak mocno karać za otwieranie premii przeciwnikowi
        this.leaveWeight = 0.6;    // jak mocno premiować dobry pozostający stojak

        // Kara za odsłonięcie pustego pola premiowego sąsiadującego z naszym słowem.
        // Wyższa dla mnożników słowa (zwłaszcza 3×) niż litery.
        this.premiumWeights = { w3: 6, w2: 3, l3: 2, l2: 1 };

        // Litery uznawane za „balast" (trudne do zagrania) — z sekcji usefulness 4 i 5.
        this.heavyLetters = new Set([
            ...(this.usefulness['4'] || []),
            ...(this.usefulness['5'] || []),
        ]);

        // Ile jednostek balastu na stojaku uzasadnia wymianę przy słabym ruchu.
        this.deadweightThreshold = 2;
    }

    /**
     * Wybiera najlepszy ruch — albo kładzie najlepsze słowo, albo wymienia litery.
     * @param {Array<object>} moves - Tablica dostępnych ruchów (posortowana malejąco wg punktów)
     * @param {Board} board - Aktualna plansza (obecnie nieużywana, zarezerwowana na przyszłość)
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku (do decyzji o wymianie)
     * @returns {object} Wybrany ruch:
     *   - Słowo: obiekt ruchu z Solvera (np. { wordSimple, points, word, x, y, ... })
     *   - Wymiana: { replace: true, letters: string[] }
     */
    getBestMove(moves, board, stack, bagSize = Infinity) {
        if (this.replaceDecision(moves, stack, bagSize)) {
            let replace = this.pickTilesToExchange(stack);
            return {
                replace: true,
                letters: replace
            }
        }
        return this.pickStrategicMove(moves, board, stack);
    }

    /**
     * Spośród kilkunastu najlepszych ruchów (wg punktów) wybiera ten o najlepszym
     * wyniku łącznym, uwzględniając karę za otwieranie premii przeciwnikowi oraz
     * jakość pozostających na stojaku liter. Dzięki temu AI nie podejmuje wyłącznie
     * decyzji lokalnie optymalnych (np. nie otwiera przeciwnikowi drogi do premii
     * przy brzegu planszy dla kilku dodatkowych punktów).
     * @param {Array<object>} moves - Ruchy posortowane malejąco wg punktów
     * @param {Board} board - Aktualna plansza
     * @param {string[]} stack - Stojak gracza
     * @returns {object} Wybrany ruch (obiekt z Solvera)
     */
    pickStrategicMove(moves, board, stack) {
        const n = Math.min(this.candidatePoolSize, moves.length);
        let best = moves[0];
        let bestScore = -Infinity;

        for (let i = 0; i < n; i++) {
            const m = moves[i];
            const exposure = this.computeExposurePenalty(m, board);
            const leave = this.computeLeave(stack, m.usedLetters);
            const score = m.points
                - this.exposureWeight * exposure
                + this.leaveWeight * this.leaveScore(leave);

            if (score > bestScore) {
                bestScore = score;
                best = m;
            }
        }
        return best;
    }

    /**
     * Oblicza karę za „ekspozycję" — odsłonięcie pustych pól premiowych, które po
     * naszym ruchu sąsiadują z nowo położonymi literami i mogą zostać wykorzystane
     * przez przeciwnika (np. droga do 3× słowo przy brzegu planszy).
     * @param {object} move - Ruch z Solvera (musi mieć word, x, y, horizontal)
     * @param {Board} board - Aktualna plansza
     * @returns {number} Sumaryczna kara (0 = ruch niczego nie otwiera)
     */
    computeExposurePenalty(move, board) {
        if (!board || !move || !Array.isArray(move.word)) return 0;

        const tiles = board.getTiles();
        const seen = new Set();
        let penalty = 0;

        for (let i = 0; i < move.word.length; i++) {
            const cell = move.word[i];
            if (!cell || !cell.isCurrent) continue; // liczą się tylko nowo położone litery
            const x = move.horizontal ? move.x + i : move.x;
            const y = move.horizontal ? move.y : move.y + i;

            const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
                if (tiles[nx][ny].letter) continue; // pole zajęte — nie jest „otwarciem"
                const key = nx * SIZE + ny;
                if (seen.has(key)) continue;
                seen.add(key);
                penalty += this.premiumWeight(board.getBonus(nx, ny));
            }
        }
        return penalty;
    }

    /**
     * Zwraca wagę kary za dane pole premiowe (0 dla pola bez premii).
     * @param {{w:number, l:number}} bonus - Mnożniki pola
     * @returns {number}
     */
    premiumWeight(bonus) {
        if (!bonus) return 0;
        if (bonus.w >= 3) return this.premiumWeights.w3;
        if (bonus.w >= 2) return this.premiumWeights.w2;
        if (bonus.l >= 3) return this.premiumWeights.l3;
        if (bonus.l >= 2) return this.premiumWeights.l2;
        return 0;
    }

    /**
     * Zwraca litery pozostające na stojaku po zagraniu ruchu.
     * @param {string[]} stack - Stojak gracza
     * @param {string[]} usedLetters - Litery zużyte przez ruch (blank jako '*')
     * @returns {string[]} Pozostałe litery
     */
    computeLeave(stack, usedLetters) {
        const leave = [...stack];
        for (const l of (usedLetters || [])) {
            const idx = leave.indexOf(l);
            if (idx !== -1) leave.splice(idx, 1);
        }
        return leave;
    }

    /**
     * Ocenia jakość zestawu liter pozostających na stojaku (im wyżej, tym lepiej).
     * Premiuje blanki i zrównoważony stosunek samogłosek do spółgłosek, karze
     * ciężkie litery oraz duplikaty.
     * @param {string[]} leave - Pozostałe litery
     * @returns {number} Wynik jakości (może być ujemny)
     */
    leaveScore(leave) {
        let score = 0;
        let vowels = 0, consonants = 0;
        const counts = {};

        for (const l of leave) {
            counts[l] = (counts[l] || 0) + 1;
            if (l === '*') { score += 3; continue; } // blank jest bardzo cenny
            if (VOWELS.has(l)) vowels++; else consonants++;
            if (this.heavyLetters.has(l)) score -= 2; // ciężkie/trudne litery
        }

        // Kara za brak balansu samogłoski/spółgłoski.
        score -= Math.abs(vowels - consonants);

        // Kara za duplikaty (trzeci i kolejny egzemplarz tej samej litery).
        for (const k in counts) {
            if (k === '*') continue;
            if (counts[k] >= 3) score -= (counts[k] - 2);
        }

        return score;
    }

    /**
     * Wybiera litery do wymiany na podstawie ich użyteczności.
     * Litery o najwyższym wskaźniku nieużyteczności (4-5) są wymieniane w pierwszej kolejności.
     * Wymienia max 5 liter (lub więcej jeśli mają wskaźnik > 3).
     * @param {string[]} stack - Stojak gracza
     * @returns {string[]} Litery do wymiany
     */
    pickTilesToExchange(stack) {
        let replace = [[], [], [], [], [], []];
        let result = [];
        stack.forEach(l => {
            for (const [value, letters] of Object.entries(this.usefulness)) {
                if (letters.includes(l)) {
                    replace[parseInt(value)].push(l);
                }
            }
        });

        let used = 0;
        for (let i=5 ; i>0 ; i--) {
            replace[i].forEach(l => {
                if (used < 5) {
                    result.push(l);
                } else if (i > 3) {
                    result.push(l);
                }
                used++;
            });
        }

        return result;
    }

    /**
     * Liczy „balast" na stojaku: ciężkie litery (usefulness 4-5) oraz nadmiarowe
     * duplikaty. Wysoki wynik oznacza, że stojak warto odświeżyć wymianą.
     * @param {string[]} stack - Stojak gracza
     * @returns {number} Liczba jednostek balastu
     */
    countDeadweight(stack) {
        let dead = 0;
        const counts = {};
        for (const l of stack) {
            counts[l] = (counts[l] || 0) + 1;
            if (this.heavyLetters.has(l)) dead++;
        }
        // Nadmiarowe duplikaty (trzeci i kolejny egzemplarz) też są balastem.
        for (const k in counts) {
            if (k === '*') continue;
            if (counts[k] >= 3) dead += counts[k] - 2;
        }
        return dead;
    }

    /**
     * Decyduje, czy warto wymienić litery zamiast grać najlepszy ruch.
     * Wymiana jest opłacalna tylko wtedy, gdy:
     *  - stojak jest pełny (7 liter),
     *  - w worku jest jeszcze sensowny zapas liter (końcówka gry — nie wymieniamy),
     *  - najlepszy ruch daje mniej niż próg punktowy,
     *  - ORAZ stojak faktycznie zawiera balast (ciężkie/nadmiarowe litery) — inaczej
     *    lepiej zagrać słabszy ruch i utrzymać tempo, zamiast marnować dobre litery.
     * @param {Array<object>} moves - Dostępne ruchy (posortowane malejąco wg punktów)
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {boolean} true jeśli wymiana jest uzasadniona
     */
    replaceDecision(moves, stack, bagSize = Infinity) {
        // Pełny stojak — inaczej wymiana nie ma sensu.
        if (stack.length < 7) {
            return false;
        }
        // Końcówka gry: pusty worek lub za mało liter, by wymiana się opłacała
        // (człowiek ma analogiczny wymóg bag >= 7 w Game.humanMove).
        if (bagSize < 7) {
            return false;
        }
        // Najlepszy ruch jest wystarczająco dobry — gramy.
        if (moves[0].points >= this.pointsThreshold) {
            return false;
        }
        // Słaby ruch: wymieniamy tylko, jeśli stojak jest realnie zablokowany balastem.
        return this.countDeadweight(stack) >= this.deadweightThreshold;
    }
}

module.exports = Strategy;
