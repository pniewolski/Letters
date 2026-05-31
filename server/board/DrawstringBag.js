const fs = require('fs');

/**
 * @class DrawstringBag
 * @description Reprezentuje worek (sakiewkę) z literami w grze Scrabble.
 * Przechowuje pulę dostępnych liter zgodnie z konfiguracją z pliku letters.json.
 * Umożliwia losowanie, wymianę i pobieranie konkretnych liter.
 *
 * @example
 * const DrawstringBag = require('./DrawstringBag');
 * const bag = new DrawstringBag();
 * const letters = bag.draw(7); // losuje 7 liter
 * console.log(bag.getBagSize()); // ile liter zostało w worku
 */
class DrawstringBag {

    /**
     * Tworzy nowy worek wypełniony literami zgodnie z konfiguracją z letters.json.
     * Każda litera występuje w ilości określonej w sekcji "quantities" pliku JSON.
     */
    constructor() {
        this.lettersBag = [];
        this.loadQuantities();
    }
    /**
     * Ładuje ilości liter z pliku letters.json i wypełnia worek.
     * @private
     */
    loadQuantities() {
        const pointsJson = fs.readFileSync('letters.json', 'utf-8');
        const quantities = JSON.parse(pointsJson).quantities;

        for (const [quantity, letters] of Object.entries(quantities)) {
            letters.forEach(l => {
                for (let i = 0; i < Number(quantity); i++) {
                    this.lettersBag.push(l);
                }
            });

        }
    }

    /**
     * Losuje podaną liczbę liter z worka (bez zwracania).
     * @param {number} number - Liczba liter do wylosowania
     * @returns {string[]} Tablica wylosowanych liter
     * @throws {Error} Jeśli worek jest pusty ("Próba losowania z pustego worka!")
     *
     * @example
     * const drawn = bag.draw(3); // => ['A', 'K', 'Ż']
     */
    draw(number) {
        let result = [];
        for (let i = 0; i < number; i++) {
            if (this.lettersBag.length > 0) {
                const randomIndex = Math.floor(Math.random() * this.lettersBag.length); // Losowy indeks
                const letter = this.lettersBag.splice(randomIndex, 1)[0]; // Usuwamy i przechowujemy element
                result.push(letter);
            } else {
                throw new Error("Próba losowania z pustego worka!");
            }

        }
        return result;
    }

    /**
     * Wymienia litery — losuje nowe i zwraca stare do worka.
     * Najpierw losuje nowe litery, potem wkłada oddawane litery z powrotem.
     * @param {string[]} letters - Tablica liter do oddania
     * @returns {string[]} Tablica nowo wylosowanych liter (tej samej długości)
     *
     * @example
     * const newLetters = bag.replace(['X', 'Ź']); // oddaje X i Ź, dostaje 2 nowe
     */
    replace(letters) {
        let result = this.draw(letters.length);
        letters.forEach(letter => this.lettersBag.push(letter));
        return result;
    }

    /**
     * Pobiera konkretną literę z worka (jeśli istnieje).
     * @param {string} letter - Litera do pobrania
     * @returns {string} Pobrana litera
     * @throws {Error} Jeśli litery nie ma w worku ("Brak szukanej litery w worku")
     */
    getSpecificLetter(letter) {
        const index = this.lettersBag.findIndex(l => l === letter);
        if (index == -1) {
            throw new Error("Brak szukanej litery w worku");
        }
        const result = this.lettersBag.splice(index, 1)[0]; // Usuwamy i przechowujemy element
        return result;
    }

    /**
     * Zwraca liczbę liter pozostałych w worku.
     * @returns {number} Liczba liter w worku
     */
    getBagSize() {
        return this.lettersBag.length;
    }
}

module.exports = DrawstringBag;
