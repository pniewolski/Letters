const fs = require('fs');
const readline = require('readline');

class WordDictionary {
  constructor() {
    this.wordsByLength = new Map();
    this.ready = this.load();
  }

  async load() {
    const filePath = './slownik.txt';
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const word = line.trim();
      const len = word.length;
      if (!this.wordsByLength.has(len)) {
        this.wordsByLength.set(len, []);
      }
      this.wordsByLength.get(len).push(word);
    }

    console.log(`Załadowano słownik z pliku "${filePath}".`);
  }

  /**
   * Zbuduj regex ograniczający luki tylko do dostępnych liter
   */
  buildRegex(template, availableLetters) {
    const hasBlank = availableLetters.includes('*');

    const pattern = [...template].map(char => {
      if (char === '.' || char === '?') {
        if (hasBlank) {
          return `[A-Z]`; // dowolna litera, bo blank może ją uzupełnić
        } else {
          const pool = availableLetters
              .filter(c => c !== '*')
              .map(c => c.toUpperCase())
              .join('');
          return `[${pool}]`;
        }
      } else {
        return char.toUpperCase();
      }
    }).join('');

    return new RegExp(`^${pattern}$`, 'i');
  }


  /**
   * Sprawdza, czy dane słowo da się złożyć z dostępnych liter (uwzględniając blanki)
   */
  canConstructWord(word, template, availableLetters) {
    const letters = [...availableLetters.map(c => c.toUpperCase())]; // kopia
    for (let i = 0; i < word.length; i++) {
      const expected = template[i];
      const actual = word[i].toUpperCase();

      if (expected !== '.' && expected !== '?' && expected.toUpperCase() !== actual) {
        return false;
      }

      if (expected === '.' || expected === '?') {
        const idx = letters.indexOf(actual);
        if (idx !== -1) {
          letters.splice(idx, 1);
        } else {
          const blankIdx = letters.indexOf('*');
          if (blankIdx !== -1) {
            letters.splice(blankIdx, 1); // użyj blanka
          } else {
            return false; // brak liter
          }
        }
      }
    }

    return true;
  }

  /**
   * Szuka słów pasujących do wzorca i możliwych do ułożenia z liter
   * @param {number} length - długość słowa
   * @param {string} template - wzorzec, np. '..AR..'
   * @param {string[]} availableLetters - litery na stosiku, np. ['A','R','S','E','T','*']
   * @returns {string[]} - pasujące słowa
   */
  search(length, template, availableLetters) {
    const list = this.wordsByLength.get(length);
    if (!list) return [];

    const regex = this.buildRegex(template, availableLetters);

    return list.filter(word => {
      if (!regex.test(word)) return false;
      return this.canConstructWord(word, template, availableLetters);
    });
  }

  searchDicionarySimple(word) {
    const list = this.wordsByLength.get(word.length);
    return list ? list.includes(word.toLowerCase()) : false;

  }
}

module.exports = WordDictionary;
