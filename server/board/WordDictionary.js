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
            const len = word.length;

            if (!this.rootByLength.has(len)) {
                this.rootByLength.set(len, new TrieNode());
            }

            let node = this.rootByLength.get(len);
            for (const ch of word) {
                if (!node.children[ch]) {
                    node.children[ch] = new TrieNode();
                }
                node = node.children[ch];
            }
            node.isWord = true;
        }

        console.log('Załadowano słownik (Trie)');
    }

    /**
     * Generuje słowa pasujące do template + liter
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

        this._dfs(
            root,
            template.toUpperCase(),
            0,
            counts,
            blanks,
            '',
            results
        );

        return results;
    }

    _dfs(node, template, idx, counts, blanks, current, results) {
        if (idx === template.length) {
            if (node.isWord) results.push(current);
            return;
        }

        const t = template[idx];

        // 🔒 stała litera z planszy
        if (t !== '.' && t !== '?') {
            const child = node.children[t];
            if (!child) return;
            this._dfs(child, template, idx + 1, counts, blanks, current + t, results);
            return;
        }

        // 🔓 luka — próbujemy liter
        for (const ch in node.children) {

            if (counts[ch] > 0) {
                counts[ch]--;
                this._dfs(
                    node.children[ch],
                    template,
                    idx + 1,
                    counts,
                    blanks,
                    current + ch,
                    results
                );
                counts[ch]++;
            }
            else if (blanks > 0) {
                this._dfs(
                    node.children[ch],
                    template,
                    idx + 1,
                    counts,
                    blanks - 1,
                    current + ch,
                    results
                );
            }
        }
    }

    /**
     * O(1) — używane w isWordValid
     */
    searchDicionarySimple(word) {
        const root = this.rootByLength.get(word.length);
        if (!root) return false;

        let node = root;
        for (const ch of word.toUpperCase()) {
            node = node.children[ch];
            if (!node) return false;
        }
        return node.isWord;
    }
}

module.exports = WordDictionary;
