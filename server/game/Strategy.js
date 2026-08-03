const fs = require('fs');

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
        return moves[0];
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
     * Decyduje, czy warto wymienić litery zamiast grać najlepszy ruch.
     * Wymiana jest opłacalna tylko wtedy, gdy:
     *  - stojak jest pełny (7 liter),
     *  - w worku jest jeszcze sensowny zapas liter (końcówka gry — nie wymieniamy),
     *  - najlepszy ruch daje mniej niż próg punktowy.
     * @param {Array<object>} moves - Dostępne ruchy (posortowane malejąco wg punktów)
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {boolean} true jeśli najlepszy ruch ma za mało punktów i wymiana jest możliwa
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
        // Najlepszy ruch jest słaby — wymieniamy nieużyteczne litery.
        return moves[0].points < this.pointsThreshold;
    }
}

module.exports = Strategy;
