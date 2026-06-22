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
     * @returns {object} Wybrany ruch:
     *   - Słowo: obiekt ruchu z Solvera (np. { wordSimple, points, word, x, y, ... })
     *   - Wymiana: { replace: true, letters: string[] }
     */
    getBestMove(moves, board, stack) {
        if (this.replaceDecision(moves, stack)) {
            let replace = this.pickTilesToExchange(stack);
            console.log("!!!!!!!!!!!!!!!! replace", replace);
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
     * @param {Array<object>} moves - Dostępne ruchy
     * @returns {boolean} true jeśli najlepszy ruch ma za mało punktów
     */
    replaceDecision(moves, stack) {
        if (stack.length < 7) {
            return false;
        }
        if (moves[0].points < this.pointsThreshold) {
            return true;
        } else {
            return false;
        }
    }
}

module.exports = Strategy;
