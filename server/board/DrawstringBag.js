/**
 * @class DrawstringBag
 * @description Worek z klockami. Zawartość wynika z trybu gry — ilości liter
 * i liczba blanków pochodzą z `CompiledVariant`, nie z pliku na dysku.
 *
 * @example
 * const bag = new DrawstringBag(variant);
 * const rack = bag.draw(7);       // losuje 7 klocków
 * bag.getBagSize();               // ile zostało
 */
class DrawstringBag {
    /**
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(variant) {
        if (!variant) throw new Error('DrawstringBag wymaga trybu gry (CompiledVariant).');
        this.variant = variant;
        this.lettersBag = variant.bagComposition();
    }

    /**
     * Losuje klocki z worka (bez zwracania). Gdy w worku jest mniej klocków
     * niż zamówiono, zwraca tyle, ile zostało — zamiast rzucać wyjątkiem,
     * bo to normalna sytuacja w końcówce partii.
     * @param {number} number - Ile klocków wylosować
     * @returns {string[]} Wylosowane klocki
     *
     * @example
     * bag.draw(3); // => ['A', 'K', 'Ż']
     */
    draw(number) {
        const result = [];
        const wanted = Math.max(0, Math.min(number, this.lettersBag.length));
        for (let i = 0; i < wanted; i++) {
            const idx = Math.floor(Math.random() * this.lettersBag.length);
            result.push(this.lettersBag.splice(idx, 1)[0]);
        }
        return result;
    }

    /**
     * Wymienia klocki: najpierw losuje nowe, dopiero potem wrzuca stare
     * do worka (żeby gracz nie mógł dostać z powrotem tych samych).
     * @param {string[]} letters - Klocki oddawane do worka
     * @returns {string[]} Nowe klocki (tyle, ile udało się wylosować)
     *
     * @example
     * bag.replace(['X', 'Ź']); // oddaje dwa klocki, dostaje dwa nowe
     */
    replace(letters) {
        const result = this.draw(letters.length);
        this.lettersBag.push(...letters);
        return result;
    }

    /**
     * Wyjmuje z worka konkretny klocek (używane przy odtwarzaniu stanu partii).
     * @param {string} letter - Szukany klocek
     * @returns {string} Wyjęty klocek
     * @throws {Error} Gdy takiego klocka nie ma w worku
     */
    getSpecificLetter(letter) {
        const index = this.lettersBag.indexOf(letter);
        if (index === -1) throw new Error(`Brak klocka "${letter}" w worku.`);
        return this.lettersBag.splice(index, 1)[0];
    }

    /**
     * Wrzuca klocki z powrotem do worka.
     * @param {string[]} letters - Klocki do zwrotu
     */
    putBack(letters) {
        this.lettersBag.push(...letters);
    }

    /**
     * Liczba klocków pozostałych w worku.
     * @returns {number}
     */
    getBagSize() {
        return this.lettersBag.length;
    }

    /**
     * Zwraca kopię zawartości worka — do zapisu stanu partii.
     * @returns {string[]}
     */
    snapshot() {
        return [...this.lettersBag];
    }

    /**
     * Ustawia zawartość worka (odtworzenie zapisanej partii).
     * @param {string[]} letters
     */
    restore(letters) {
        this.lettersBag = [...letters];
    }
}

module.exports = DrawstringBag;
