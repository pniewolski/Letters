const fs = require('fs');

class DrawstringBag {

    constructor() {
        this.lettersBag = [];
        this.loadQuantities();
    }
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

    replace(letters) {
        let result = this.draw(letters.length);
        letters.forEach(letter => this.lettersBag.push(letter));
        return result;
    }

    getSpecificLetter(letter) {
        const index = this.lettersBag.findIndex(l => l === letter);
        if (index == -1) {
            throw new Error("Brak szukanej litery w worku");
        }
        const result = this.lettersBag.splice(index, 1)[0]; // Usuwamy i przechowujemy element
        return result;
    }

    getBagSize() {
        return this.lettersBag.length;
    }
}

module.exports = DrawstringBag;
