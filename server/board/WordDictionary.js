const fs = require('fs');
const readline = require('readline');

class TrieNode {
    constructor() {
        this.children = Object.create(null);
        this.isWord = false;
    }
}

class WordDictionary {
    constructor() {
        this.rootByLength = new Map(); // length -> Trie root
        this.ready = this.load();
    }

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
     * Generuje słowa pasujące do szablonu + liter ze stojaka.
     * Szablon: '.' lub '?' = luka, każda inna litera = stała z planszy (uppercase).
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
     * O(długość słowa) — używane do walidacji pojedynczego słowa.
     * Zakłada uppercase na wejściu (logika gry tak operuje), ale dla bezpieczeństwa normalizuje.
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
     * Zwraca zbiór liter, dla których słowo (prefix + litera + suffix) istnieje w słowniku.
     * Jedno zejście po Trie zamiast N osobnych lookupów (gdzie N = rozmiar alfabetu).
     * Alfabet pochodzi z dzieci węzła Trie -> automatycznie obsługuje polskie znaki.
     * Zakłada, że prefix i suffix są uppercase (tak jest w logice gry).
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
