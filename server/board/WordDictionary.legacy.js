const fs = require('fs');
const readline = require('readline');

/**
 * WERSJA ARCHIWALNA (obiektowe Trie) — używana wyłącznie w benchmarku
 * do porównania zużycia RAM i szybkości z nową implementacją.
 * Nie używać w produkcji.
 */
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

        console.log('Załadowano słownik (Trie legacy)');
    }

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

        if (t !== '.' && t !== '?') {
            const child = node.children[t];
            if (!child) return;
            this._dfs(child, template, idx + 1, counts, blanks, current + t, results);
            return;
        }

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

    crossCheckLetters(prefix, suffix) {
        const len = prefix.length + 1 + suffix.length;
        const allowed = new Set();
        const root = this.rootByLength.get(len);
        if (!root) return allowed;

        let node = root;
        for (let i = 0; i < prefix.length; i++) {
            node = node.children[prefix[i]];
            if (!node) return allowed;
        }

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

