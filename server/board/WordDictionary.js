const fs = require('fs');
const readline = require('readline');

/**
 * @class TrieNode
 * @description Węzeł drzewa Trie używanego do przechowywania słownika.
 * Każdy węzeł zawiera mapę dzieci (litera -> TrieNode) oraz flagę isWord
 * oznaczającą, czy ścieżka od korzenia do tego węzła tworzy poprawne słowo.
 * @private
 */
class TrieNode {
    constructor() {
        this.children = Object.create(null);
        this.isWord = false;
    }
}

/**
 * @class WordDictionary
 * @description Słownik oparty na strukturze Trie, pogrupowany wg długości słów.
 * Ładuje słowa asynchronicznie z pliku 'slownik.txt'. Oferuje wyszukiwanie
 * słów pasujących do szablonu z uwzględnieniem dostępnych liter ze stojaka,
 * prostą walidację słów oraz cross-check (dozwolone litery prostopadłe).
 *
 * @example
 * const WordDictionary = require('./WordDictionary');
 * const dict = new WordDictionary();
 * await dict.ready; // poczekaj na załadowanie słownika
 *
 * // Wyszukaj słowa 5-literowe pasujące do szablonu "K.T.A" z liter ['O','E','S','R']
 * const words = dict.search(5, 'K.T.A', ['O','E','S','R']);
 *
 * // Sprawdź, czy słowo istnieje w słowniku
 * const exists = dict.searchDicionarySimple('KOTEK'); // true/false
 *
 * // Uzyskaj dozwolone litery między prefiksem a sufiksem
 * const allowed = dict.crossCheckLetters('KO', 'EK'); // Set {'T', ...}
 */
class WordDictionary {
    /**
     * Tworzy instancję WordDictionary i rozpoczyna asynchroniczne ładowanie słownika.
     * Użyj `await dict.ready` aby poczekać na zakończenie ładowania.
     */
    constructor() {
        this.rootByLength = new Map(); // length -> Trie root
        this.ready = this.load();
    }

    /**
     * Asynchronicznie ładuje słowa z pliku './slownik.txt' do struktur Trie.
     * Słowa są grupowane wg długości — każda długość ma osobny korzeń Trie.
     * @returns {Promise<void>}
     * @private
     */
    async load() {
        const rl = readline.createInterface({
            input: fs.createReadStream('./slownik.txt'),
            crlfDelay: Infinity,
        });

        for await (const line of rl) {
            const word = line.trim().toUpperCase();
            if (!word) continue;
            const len = word.length;

            let root = this.rootByLength.get(len);
            if (!root) {
                root = new TrieNode();
                this.rootByLength.set(len, root);
            }

            let node = root;
            for (const ch of word) {
                let next = node.children[ch];
                if (!next) {
                    next = new TrieNode();
                    node.children[ch] = next;
                }
                node = next;
            }
            node.isWord = true;
        }

        console.log('Załadowano słownik (Trie)');
    }

    /**
     * Wyszukuje wszystkie słowa o podanej długości pasujące do szablonu,
     * używając tylko dostępnych liter ze stojaka do wypełnienia luk.
     *
     * Szablon: '.' lub '?' = luka do wypełnienia, inna litera = stała z planszy (uppercase).
     * Litera '*' w availableLetters oznacza blank (może zastąpić dowolną literę).
     *
     * @param {number} length - Wymagana długość słowa
     * @param {string} template - Szablon słowa (np. "K..OT" — K i OT stałe, 2 luki)
     * @param {string[]} availableLetters - Litery dostępne na stojaku (np. ['A','B','*'])
     * @returns {string[]} Tablica znalezionych słów (uppercase)
     *
     * @example
     * dict.search(4, '..OT', ['K','R','S','*']); // => ['KROT', 'SROT', ...]
     */
    search(length, template, availableLetters) {
        const root = this.rootByLength.get(length);
        if (!root) return [];

        const results = [];
        const counts = Object.create(null);
        let blanks = 0;

        for (const l of availableLetters) {
            if (l === '*') blanks++;
            else counts[l] = (counts[l] || 0) + 1;
        }

        this._dfs(root, template, 0, counts, blanks, '', results);
        return results;
    }

    /**
     * Rekurencyjne przeszukiwanie Trie (DFS) z uwzględnieniem szablonu i dostępnych liter.
     * @param {TrieNode} node - Bieżący węzeł Trie
     * @param {string} template - Szablon słowa
     * @param {number} idx - Bieżący indeks w szablonie
     * @param {Object} counts - Mapa dostępnych liter (litera -> ilość)
     * @param {number} blanks - Liczba dostępnych blanków
     * @param {string} current - Dotychczas zbudowane słowo
     * @param {string[]} results - Tablica wynikowa (mutowana)
     * @private
     */
    _dfs(node, template, idx, counts, blanks, current, results) {
        if (idx === template.length) {
            if (node.isWord) results.push(current);
            return;
        }

        const t = template[idx];

        // stała litera z planszy
        if (t !== '.' && t !== '?') {
            const child = node.children[t];
            if (!child) return;
            this._dfs(child, template, idx + 1, counts, blanks, current + t, results);
            return;
        }

        // luka — próbujemy każdej litery dostępnej w Trie
        for (const ch in node.children) {
            if (counts[ch] > 0) {
                counts[ch]--;
                this._dfs(node.children[ch], template, idx + 1, counts, blanks, current + ch, results);
                counts[ch]++;
            } else if (blanks > 0) {
                this._dfs(node.children[ch], template, idx + 1, counts, blanks - 1, current + ch, results);
            }
        }
    }

    /**
     * Sprawdza, czy podane słowo istnieje w słowniku.
     * Złożoność O(n) gdzie n = długość słowa.
     * @param {string} word - Słowo do sprawdzenia (dowolna wielkość liter — normalizowane wewnętrznie)
     * @returns {boolean} true jeśli słowo istnieje w słowniku
     *
     * @example
     * dict.searchDicionarySimple('KOT'); // => true
     * dict.searchDicionarySimple('XYZ'); // => false
     */
    searchDicionarySimple(word) {
        const root = this.rootByLength.get(word.length);
        if (!root) return false;

        const W = word.toUpperCase();
        let node = root;
        for (let i = 0; i < W.length; i++) {
            node = node.children[W[i]];
            if (!node) return false;
        }
        return node.isWord;
    }

    /**
     * Zwraca zbiór liter, które mogą być wstawione między prefix a suffix
     * tworząc poprawne słowo w słowniku.
     *
     * Używane do cross-checks — optymalizacji Solvera eliminującej niepoprawne
     * litery bez konieczności sprawdzania pełnych słów prostopadłych.
     *
     * @param {string} prefix - Prefiks (litery nad/na lewo od sprawdzanego pola), uppercase
     * @param {string} suffix - Suffiks (litery pod/na prawo od sprawdzanego pola), uppercase
     * @returns {Set<string>} Zbiór dozwolonych liter (uppercase)
     *
     * @example
     * // Jakie litery mogą stać między "KO" a "EK"?
     * dict.crossCheckLetters('KO', 'EK'); // => Set { 'T', 'N', ... }
     */
    crossCheckLetters(prefix, suffix) {
        const len = prefix.length + 1 + suffix.length;
        const allowed = new Set();
        const root = this.rootByLength.get(len);
        if (!root) return allowed;

        // przejście po prefiksie
        let node = root;
        for (let i = 0; i < prefix.length; i++) {
            node = node.children[prefix[i]];
            if (!node) return allowed;
        }

        // dla każdej możliwej litery sprawdzamy czy domknie się suffixem do słowa
        for (const ch in node.children) {
            let n = node.children[ch];
            let ok = true;
            for (let i = 0; i < suffix.length; i++) {
                n = n.children[suffix[i]];
                if (!n) { ok = false; break; }
            }
            if (ok && n.isWord) allowed.add(ch);
        }
        return allowed;
    }
}

module.exports = WordDictionary;
