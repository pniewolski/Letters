/**
 * @file compile.js
 * @description Kompilacja definicji trybu gry do struktur, z których korzysta
 * silnik (plansza, worek, solver, strategia).
 *
 * Kompilat jest **niezmienny i współdzielony** przez wszystkie partie w danym
 * trybie — dzięki temu utworzenie planszy nie czyta już plików z dysku ani nie
 * przelicza mnożników (to była zauważalna kula u nogi poprzedniej wersji, gdzie
 * każda instancja `Board` parsowała dwa pliki JSON).
 *
 * @example
 * const { compileVariant } = require('./compile');
 * const v = compileVariant(definition, { id: 3, slug: 'literki', name: 'Literki' });
 * v.bonusAt(7, 7);          // => { w: 1, l: 1 }
 * v.pointsOf('Ź');          // => 12
 * v.bagComposition();       // => ['A','A',...,'*','*']
 */

const { CELL_CODES, BLANK, normalizeDefinition, summarize } = require('./schema');

/**
 * @class CompiledVariant
 * @description Gotowy do użycia opis trybu gry. Instancje są traktowane jako
 * tylko do odczytu — nie modyfikuj ich w trakcie partii.
 */
class CompiledVariant {
    /**
     * @param {object} definition - Znormalizowana definicja (patrz `schema.js`)
     * @param {object} [meta] - Metadane rekordu z bazy: { id, slug, name, description, isSystem, ownerId, updatedAt }
     */
    constructor(definition, meta = {}) {
        /** @type {object} Pełna, znormalizowana definicja. */
        this.definition = definition;

        /** @type {object} Metadane trybu (identyfikator, nazwa, właściciel). */
        this.meta = {
            id: meta.id ?? null,
            slug: meta.slug ?? 'custom',
            name: meta.name ?? 'Tryb własny',
            description: meta.description ?? '',
            isSystem: !!meta.isSystem,
            ownerId: meta.ownerId ?? null,
            updatedAt: meta.updatedAt ?? 0,
        };

        const { board, rack, bingo, tiles, blank, rules, colors } = definition;

        /** @type {number} Bok planszy. */
        this.size = board.size;
        /** @type {string[]} Siatka pól (wiersze). */
        this.grid = board.grid;
        /** @type {number} Liczba liter na stojaku. */
        this.rackSize = rack.size;
        /** @type {{tiles: number, bonus: number}} Premia za wyłożenie stojaka. */
        this.bingo = bingo;
        /** @type {object} Reguły rozgrywki. */
        this.rules = rules;
        /** @type {object} Kolory pól. */
        this.colors = colors;
        /** @type {string} Znak blanka. */
        this.blankSymbol = BLANK;
        /** @type {number} Liczba blanków w worku. */
        this.blankCount = blank.count;

        // ── Mnożniki pól: płaskie tablice indeksowane y * size + x ──────────
        const cells = this.size * this.size;
        /** @type {Uint8Array} Mnożnik słowa dla pola. */
        this.wordMul = new Uint8Array(cells);
        /** @type {Uint8Array} Mnożnik litery dla pola. */
        this.letterMul = new Uint8Array(cells);
        /** @type {Uint8Array} Czy pole jest startowe (1/0). */
        this.startMask = new Uint8Array(cells);
        /** @type {Array<[number, number]>} Współrzędne pól startowych. */
        this.startCells = [];

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const code = CELL_CODES[board.grid[y][x]] || CELL_CODES['.'];
                const i = y * this.size + x;
                this.wordMul[i] = code.w;
                this.letterMul[i] = code.l;
                if (code.start) {
                    this.startMask[i] = 1;
                    this.startCells.push([x, y]);
                }
            }
        }

        // ── Litery ──────────────────────────────────────────────────────────
        /** @type {Object<string, number>} Punkty za literę (blank = punkty blanka). */
        this.letterPoints = Object.create(null);
        /** @type {Object<string, number>} Ilość klocków danej litery. */
        this.letterCounts = Object.create(null);
        /** @type {Object<string, number>} Heurystyka użyteczności dla AI (5 = najgorsza). */
        this.usefulness = Object.create(null);

        for (const t of tiles) {
            this.letterPoints[t.letter] = t.points;
            this.letterCounts[t.letter] = t.count;
            this.usefulness[t.letter] = t.usefulness;
        }
        this.letterPoints[BLANK] = blank.points;
        this.letterCounts[BLANK] = blank.count;
        this.usefulness[BLANK] = 1; // blanka nigdy nie wymieniamy chętnie

        /** @type {string} Alfabet trybu (do wyboru litery dla blanka). */
        this.alphabet = tiles.map(t => t.letter).join('');

        /** @type {object} Podsumowanie liczbowe trybu. */
        this.summary = summarize(definition);

        Object.freeze(this.meta);
        Object.freeze(this.rules);
        Object.freeze(this.bingo);
    }

    /**
     * Zwraca mnożniki pola.
     * @param {number} x - Kolumna (0-based)
     * @param {number} y - Wiersz (0-based)
     * @returns {{w: number, l: number}} Mnożnik słowa i litery
     */
    bonusAt(x, y) {
        const i = y * this.size + x;
        return { w: this.wordMul[i], l: this.letterMul[i] };
    }

    /**
     * Czy pole jest polem startowym (pierwsze słowo musi je pokryć).
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    isStart(x, y) {
        return this.startMask[y * this.size + x] === 1;
    }

    /**
     * Punkty za literę.
     * @param {string} letter - Litera (wielkość liter bez znaczenia)
     * @returns {number} Punkty, 0 dla nieznanych znaków
     */
    pointsOf(letter) {
        if (!letter) return 0;
        return this.letterPoints[letter.toUpperCase()] || 0;
    }

    /**
     * Buduje pełną zawartość worka (świeża tablica przy każdym wywołaniu).
     * @returns {string[]} Wszystkie klocki trybu
     */
    bagComposition() {
        const out = [];
        for (const [letter, count] of Object.entries(this.letterCounts)) {
            for (let i = 0; i < count; i++) out.push(letter);
        }
        return out;
    }

    /**
     * Postać przesyłana do przeglądarki — front nie duplikuje żadnych reguł,
     * tylko odczytuje to, co przyśle serwer.
     * @returns {object} Publiczny opis trybu
     */
    toClient() {
        return {
            id: this.meta.id,
            slug: this.meta.slug,
            name: this.meta.name,
            description: this.meta.description,
            isSystem: this.meta.isSystem,
            ownerId: this.meta.ownerId,
            size: this.size,
            grid: this.grid,
            rackSize: this.rackSize,
            bingo: this.bingo,
            rules: this.rules,
            colors: this.colors,
            alphabet: this.alphabet,
            blankSymbol: this.blankSymbol,
            letterPoints: { ...this.letterPoints },
            letterCounts: { ...this.letterCounts },
            summary: this.summary,
        };
    }
}

/** Pamięć podręczna kompilatów: klucz → CompiledVariant. */
const cache = new Map();

/**
 * Kompiluje definicję trybu (z pamięcią podręczną po id + dacie modyfikacji).
 * @param {object} definition - Definicja surowa lub znormalizowana
 * @param {object} [meta] - Metadane rekordu z bazy
 * @returns {CompiledVariant}
 * @throws {import('./schema').VariantError} Gdy definicja jest niegrywalna
 */
function compileVariant(definition, meta = {}) {
    const key = meta.id != null ? `${meta.id}:${meta.updatedAt || 0}` : null;
    if (key && cache.has(key)) return cache.get(key);

    const compiled = new CompiledVariant(normalizeDefinition(definition), meta);
    if (key) {
        cache.set(key, compiled);
        // Nie pozwalamy pamięci podręcznej rosnąć w nieskończoność.
        if (cache.size > 200) cache.delete(cache.keys().next().value);
    }
    return compiled;
}

/**
 * Kompiluje wiersz tabeli `variants`.
 * @param {object} row - Wiersz z bazy
 * @returns {CompiledVariant}
 */
function compileRow(row) {
    return compileVariant(JSON.parse(row.definition), {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        isSystem: !!row.is_system,
        ownerId: row.owner_id,
        updatedAt: row.updated_at,
    });
}

/** Czyści pamięć podręczną kompilatów (po edycji trybu). */
function clearVariantCache() {
    cache.clear();
}

module.exports = { CompiledVariant, compileVariant, compileRow, clearVariantCache };
