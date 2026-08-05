const fs = require('fs');
const readline = require('readline');

/**
 * @class TrieBuilder
 * @description Tymczasowy, niskopamięciowy builder Trie dla słów jednej długości.
 * Dzieci węzła przechowywane są jako lista jednokierunkowa na płaskich,
 * rosnących tablicach typowanych (bez milionów małych obiektów/tablic).
 * Metoda {@link TrieBuilder#toCSR} spłaszcza strukturę do zwartego układu CSR.
 * @private
 */
class TrieBuilder {
    constructor() {
        this.nodeCap = 1024;
        this.nodeCount = 1;                 // węzeł 0 = korzeń
        this.head = new Int32Array(this.nodeCap).fill(-1); // node -> pierwsza krawędź (lub -1)
        this.isWordArr = new Uint8Array(this.nodeCap);

        this.edgeCap = 1024;
        this.edgeCount = 0;
        this.eLetter = new Uint8Array(this.edgeCap);
        this.eTarget = new Int32Array(this.edgeCap);
        this.eNext = new Int32Array(this.edgeCap);
    }

    _growNodes() {
        const cap = this.nodeCap * 2;
        const head = new Int32Array(cap).fill(-1);
        head.set(this.head);
        const isw = new Uint8Array(cap);
        isw.set(this.isWordArr);
        this.head = head;
        this.isWordArr = isw;
        this.nodeCap = cap;
    }

    _growEdges() {
        const cap = this.edgeCap * 2;
        const el = new Uint8Array(cap); el.set(this.eLetter);
        const et = new Int32Array(cap); et.set(this.eTarget);
        const en = new Int32Array(cap); en.set(this.eNext);
        this.eLetter = el;
        this.eTarget = et;
        this.eNext = en;
        this.edgeCap = cap;
    }

    /** Zwraca dziecko `node` dla litery `id`, tworząc je jeśli nie istnieje. */
    childOrCreate(node, id) {
        for (let e = this.head[node]; e !== -1; e = this.eNext[e]) {
            if (this.eLetter[e] === id) return this.eTarget[e];
        }
        // utwórz węzeł
        if (this.nodeCount >= this.nodeCap) this._growNodes();
        const child = this.nodeCount++;
        // utwórz krawędź (wstawiana na początek listy)
        if (this.edgeCount >= this.edgeCap) this._growEdges();
        const e = this.edgeCount++;
        this.eLetter[e] = id;
        this.eTarget[e] = child;
        this.eNext[e] = this.head[node];
        this.head[node] = e;
        return child;
    }

    setWord(node) { this.isWordArr[node] = 1; }

    /** Spłaszcza do zwartego CSR i pozwala zwolnić struktury tymczasowe. */
    toCSR() {
        const N = this.nodeCount;
        const E = this.edgeCount;
        const firstEdge = new Int32Array(N + 1);

        // prefix-sumy stopni węzłów
        for (let n = 0; n < N; n++) {
            let c = 0;
            for (let e = this.head[n]; e !== -1; e = this.eNext[e]) c++;
            firstEdge[n + 1] = firstEdge[n] + c;
        }

        const edgeLetter = new Uint8Array(E);
        const edgeTarget = new Int32Array(E);
        for (let n = 0; n < N; n++) {
            let pos = firstEdge[n];
            for (let e = this.head[n]; e !== -1; e = this.eNext[e]) {
                edgeLetter[pos] = this.eLetter[e];
                edgeTarget[pos] = this.eTarget[e];
                pos++;
            }
        }

        const isWord = this.isWordArr.slice(0, N);
        return { firstEdge, edgeLetter, edgeTarget, isWord };
    }
}

/**
 * @class WordDictionary
 * @description Słownik oparty na strukturze Trie, pogrupowany wg długości słów.
 *
 * IMPLEMENTACJA NISKOPAMIĘCIOWA (packed trie / CSR):
 * Zamiast milionów obiektów `TrieNode` (każdy z osobnym słownikiem dzieci),
 * całe Trie każdej długości jest przechowywane w kilku ciągłych tablicach
 * typowanych (TypedArray) w układzie CSR (Compressed Sparse Row):
 *
 *   - firstEdge : Int32Array(N+1) — wskaźnik na pierwszą krawędź danego węzła
 *   - edgeLetter: Uint8Array(E)   — litera (id) krawędzi
 *   - edgeTarget: Int32Array(E)   — węzeł docelowy krawędzi
 *   - isWord    : Uint8Array(N)   — czy węzeł kończy poprawne słowo
 *
 * Litery mapowane są na małe liczby (id) w `letterId` / `idToChar`.
 * Efekt: kilkadziesiąt MB zamiast ~2 GB, przy zachowaniu szybkiego,
 * cache-friendly przechodzenia (dane leżą obok siebie w pamięci).
 *
 * API jest identyczne jak w wersji obiektowej:
 *
 * @example
 * const WordDictionary = require('./WordDictionary');
 * const dict = new WordDictionary();
 * await dict.ready;
 *
 * const words   = dict.search(5, 'K.T.A', ['O','E','S','R']);
 * const exists  = dict.searchDicionarySimple('KOTEK');
 * const allowed = dict.crossCheckLetters('KO', 'EK');
 */
class WordDictionary {
    /**
     * Tworzy instancję WordDictionary i rozpoczyna asynchroniczne ładowanie słownika.
     * Użyj `await dict.ready` aby poczekać na zakończenie ładowania.
     */
    constructor() {
        this.tries = new Map();     // length -> { firstEdge, edgeLetter, edgeTarget, isWord }
        this.letterId = new Map();  // znak -> id (0..A-1)
        this.idToChar = [];         // id -> znak
        this.ready = this.load();
    }

    /**
     * Zwraca id litery, tworząc nowe jeśli nie istnieje (używane podczas budowy).
     * @private
     */
    _internLetter(ch) {
        let id = this.letterId.get(ch);
        if (id === undefined) {
            id = this.idToChar.length;
            if (id > 255) throw new Error('Alfabet > 256 znaków — zwiększ typ edgeLetter do Uint16Array');
            this.letterId.set(ch, id);
            this.idToChar.push(ch);
        }
        return id;
    }

    /**
     * Zwraca węzeł-dziecko dla danej litery (id) lub -1 jeśli brak.
     * Liniowy skan po krawędziach węzła (ich liczba jest mała, <= rozmiar alfabetu).
     * @private
     */
    _child(trie, node, letterId) {
        const { firstEdge, edgeLetter, edgeTarget } = trie;
        const end = firstEdge[node + 1];
        for (let e = firstEdge[node]; e < end; e++) {
            if (edgeLetter[e] === letterId) return edgeTarget[e];
        }
        return -1;
    }

    /**
     * Asynchronicznie ładuje słowa z pliku './slownik.txt'.
     *
     * Budowa strumieniowa i niskopamięciowa: każde słowo jest wstawiane od razu
     * do tymczasowego, płaskiego Trie danej długości (lista sąsiedztwa na
     * rosnących TypedArray). Nie przechowujemy wszystkich słów w pamięci ani
     * milionów małych obiektów — dzięki temu chwilowe (peak) zużycie RAM jest
     * niewielkie. Po wczytaniu każde Trie jest spłaszczane do zwartego CSR,
     * a struktury tymczasowe są zwalniane.
     * @returns {Promise<void>}
     * @private
     */
    async load() {
        const rl = readline.createInterface({
            input: fs.createReadStream('./slownik.txt'),
            crlfDelay: Infinity,
        });

        const builders = new Map(); // length -> TrieBuilder

        for await (const line of rl) {
            const word = line.trim().toUpperCase();
            if (!word) continue;
            const len = word.length;

            let b = builders.get(len);
            if (!b) { b = new TrieBuilder(); builders.set(len, b); }

            let node = 0;
            for (const ch of word) {
                node = b.childOrCreate(node, this._internLetter(ch));
            }
            b.setWord(node);
        }

        for (const [len, b] of builders) {
            this.tries.set(len, b.toCSR());
            builders.set(len, null); // zwolnij strukturę tymczasową tej długości
        }

        console.log('Załadowano słownik (Trie packed)');
    }

    /**
     * Wyszukuje wszystkie słowa o podanej długości pasujące do szablonu,
     * używając tylko dostępnych liter ze stojaka do wypełnienia luk.
     *
     * Szablon: '.' lub '?' = luka do wypełnienia, inna litera = stała z planszy (uppercase).
     * Litera '*' w availableLetters oznacza blank (może zastąpić dowolną literę).
     *
     * @param {number} length - Wymagana długość słowa
     * @param {string} template - Szablon słowa (np. "K..OT")
     * @param {string[]} availableLetters - Litery dostępne na stojaku (np. ['A','B','*'])
     * @returns {string[]} Tablica znalezionych słów (uppercase)
     */
    search(length, template, availableLetters) {
        const trie = this.tries.get(length);
        if (!trie) return [];

        const A = this.idToChar.length;
        const counts = new Int16Array(A);
        let blanks = 0;

        for (const l of availableLetters) {
            if (l === '*') { blanks++; continue; }
            const id = this.letterId.get(l);
            if (id !== undefined) counts[id]++;
        }

        // Prekonwersja szablonu: -1 = luka, -2 = stała litera spoza alfabetu, id = stała.
        const tid = new Array(template.length);
        for (let i = 0; i < template.length; i++) {
            const t = template[i];
            if (t === '.' || t === '?') {
                tid[i] = -1;
            } else {
                const id = this.letterId.get(t);
                tid[i] = (id === undefined) ? -2 : id;
            }
        }

        const results = [];
        this._dfs(trie, 0, tid, 0, counts, blanks, '', results);
        return results;
    }

    /**
     * Rekurencyjne przeszukiwanie spakowanego Trie (DFS).
     * @private
     */
    _dfs(trie, node, tid, idx, counts, blanks, current, results) {
        if (idx === tid.length) {
            if (trie.isWord[node] === 1) results.push(current);
            return;
        }

        const t = tid[idx];

        // stała litera z planszy
        if (t !== -1) {
            if (t === -2) return; // litera spoza alfabetu — brak dopasowania
            const child = this._child(trie, node, t);
            if (child < 0) return;
            this._dfs(trie, child, tid, idx + 1, counts, blanks, current + this.idToChar[t], results);
            return;
        }

        // luka — próbujemy każdej litery dostępnej w Trie
        const { firstEdge, edgeLetter, edgeTarget } = trie;
        const end = firstEdge[node + 1];
        for (let e = firstEdge[node]; e < end; e++) {
            const ch = edgeLetter[e];
            const target = edgeTarget[e];
            if (counts[ch] > 0) {
                counts[ch]--;
                this._dfs(trie, target, tid, idx + 1, counts, blanks, current + this.idToChar[ch], results);
                counts[ch]++;
            } else if (blanks > 0) {
                this._dfs(trie, target, tid, idx + 1, counts, blanks - 1, current + this.idToChar[ch], results);
            }
        }
    }

    /**
     * Sprawdza, czy podane słowo istnieje w słowniku. Złożoność O(n).
     * @param {string} word - Słowo do sprawdzenia (dowolna wielkość liter)
     * @returns {boolean}
     */
    searchDicionarySimple(word) {
        const W = word.toUpperCase();
        const trie = this.tries.get(W.length);
        if (!trie) return false;

        let node = 0;
        for (let i = 0; i < W.length; i++) {
            const id = this.letterId.get(W[i]);
            if (id === undefined) return false;
            node = this._child(trie, node, id);
            if (node < 0) return false;
        }
        return trie.isWord[node] === 1;
    }

    /**
     * Zwraca zbiór liter, które mogą być wstawione między prefix a suffix
     * tworząc poprawne słowo w słowniku (cross-check dla Solvera).
     *
     * @param {string} prefix - Prefiks (uppercase)
     * @param {string} suffix - Suffiks (uppercase)
     * @returns {Set<string>} Zbiór dozwolonych liter (uppercase)
     */
    crossCheckLetters(prefix, suffix) {
        const len = prefix.length + 1 + suffix.length;
        const allowed = new Set();
        const trie = this.tries.get(len);
        if (!trie) return allowed;

        // przejście po prefiksie
        let node = 0;
        for (let i = 0; i < prefix.length; i++) {
            const id = this.letterId.get(prefix[i]);
            if (id === undefined) return allowed;
            node = this._child(trie, node, id);
            if (node < 0) return allowed;
        }

        // id liter suffixu
        const sIds = new Array(suffix.length);
        for (let i = 0; i < suffix.length; i++) {
            sIds[i] = this.letterId.get(suffix[i]);
        }

        // dla każdej możliwej litery sprawdzamy czy domknie się suffixem do słowa
        const { firstEdge, edgeLetter, edgeTarget } = trie;
        const end = firstEdge[node + 1];
        for (let e = firstEdge[node]; e < end; e++) {
            const ch = edgeLetter[e];
            let n = edgeTarget[e];
            let ok = true;
            for (let i = 0; i < sIds.length; i++) {
                const sid = sIds[i];
                if (sid === undefined) { ok = false; break; }
                n = this._child(trie, n, sid);
                if (n < 0) { ok = false; break; }
            }
            if (ok && trie.isWord[n] === 1) allowed.add(this.idToChar[ch]);
        }
        return allowed;
    }
}

module.exports = WordDictionary;
