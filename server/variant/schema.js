/**
 * @file schema.js
 * @description Definicja i walidacja **trybu gry** (wariantu). To tutaj mieszka
 * wszystko, co wcześniej było zaszyte na sztywno w kodzie: rozmiar planszy,
 * rozmieszczenie premii, zestaw liter wraz z ilościami i punktacją, wielkość
 * stojaka, premia za wyłożenie całego stojaka, reguły końcówki i kolory pól.
 *
 * Każdy zalogowany użytkownik może zbudować własny tryb od zera — serwer
 * przyjmuje go dopiero po przejściu przez {@link normalizeDefinition}, która
 * uzupełnia braki, przycina wartości do bezpiecznych zakresów i zwraca
 * czytelne błędy po polsku.
 *
 * ## Zapis planszy
 * Plansza to tablica łańcuchów — jeden łańcuch na wiersz, jeden znak na pole:
 *
 * | znak | znaczenie          |
 * |------|--------------------|
 * | `.`  | pole zwykłe        |
 * | `@`  | pole startowe      |
 * | `2`  | podwójna wartość słowa |
 * | `3`  | potrójna wartość słowa |
 * | `4`  | poczwórna wartość słowa |
 * | `d`  | podwójna wartość litery |
 * | `t`  | potrójna wartość litery |
 * | `q`  | poczwórna wartość litery |
 *
 * @example
 * const { normalizeDefinition } = require('./schema');
 * const def = normalizeDefinition({
 *   board: { size: 5, grid: ['3...3', '.d.d.', '..@..', '.d.d.', '3...3'] },
 *   tiles: [{ letter: 'A', count: 10, points: 1 }],
 * });
 */

// ─────────────────────────────────────────────────────────────────────────────
// STAŁE I ZAKRESY
// ─────────────────────────────────────────────────────────────────────────────

/** Mapa znaków planszy na mnożniki. */
const CELL_CODES = {
    '.': { w: 1, l: 1, start: false },
    '@': { w: 1, l: 1, start: true },
    '2': { w: 2, l: 1, start: false },
    '3': { w: 3, l: 1, start: false },
    '4': { w: 4, l: 1, start: false },
    'd': { w: 1, l: 2, start: false },
    't': { w: 1, l: 3, start: false },
    'q': { w: 1, l: 4, start: false },
};

/** Znak oznaczający blank (pusty klocek). */
const BLANK = '*';

/** Dopuszczalne zakresy parametrów — chronią serwer przed absurdalnymi trybami. */
const LIMITS = {
    size: { min: 7, max: 21 },
    rackSize: { min: 3, max: 10 },
    tileCount: { min: 20, max: 400 },
    letterCount: { min: 0, max: 99 },
    letterPoints: { min: 0, max: 99 },
    blankCount: { min: 0, max: 20 },
    bingoBonus: { min: 0, max: 500 },
    nameLen: 64,
};

/** Domyślne kolory pól (można nadpisać w trybie). */
const DEFAULT_COLORS = {
    normal: '#2a4a3a',
    start: '#3a3326',
    word2: '#5b2a2a',
    word3: '#7a2b22',
    word4: '#8d2f5a',
    letter2: '#22405c',
    letter3: '#163a52',
    letter4: '#1d5c53',
    tile: '#d4a94a',
    tileCurrent: '#f5d76e',
    tileText: '#1a1a2e',
};

/** Domyślne reguły rozgrywki. */
const DEFAULT_RULES = {
    /** Minimalna liczba liter w worku, by wolno było wymieniać. */
    exchangeMinBag: 7,
    /** Ile kolejnych tur bez punktów kończy partię. */
    maxScorelessTurns: 6,
    /** Czy na koniec odejmować wartość liter pozostałych na stojaku. */
    endgameRackPenalty: true,
    /** Czy gracz, który pierwszy pozbędzie się liter, dostaje sumę cudzych liter. */
    endgameOutBonus: true,
    /** Czy słowa są sprawdzane w słowniku. */
    validateWords: true,
    /** Co się dzieje przy złym słowie: 'loseTurn' (strata tury) lub 'reject' (odrzucenie ruchu). */
    invalidWord: 'loseTurn',
    /** Czy pierwsze słowo musi przechodzić przez pole startowe. */
    firstMoveMustCoverStart: true,
    /** Najkrótsze dopuszczalne słowo. */
    minWordLength: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// POMOCNICZE
// ─────────────────────────────────────────────────────────────────────────────

/** Przycina liczbę do zakresu, z wartością domyślną dla śmieci. */
function clampInt(value, { min, max }, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Zwraca `true` dla poprawnego koloru w zapisie #rgb / #rrggbb. */
function isColor(v) {
    return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

/**
 * @class VariantError
 * @description Błąd walidacji trybu gry — komunikat trafia wprost do użytkownika.
 */
class VariantError extends Error {
    /**
     * @param {string} message - Komunikat po polsku
     * @param {string} [field] - Nazwa pola, którego dotyczy błąd
     */
    constructor(message, field) {
        super(message);
        this.name = 'VariantError';
        this.field = field || null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZACJA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sprawdza i uzupełnia definicję planszy.
 * @param {object} raw - Surowa sekcja `board`
 * @returns {{size: number, grid: string[]}}
 * @throws {VariantError}
 * @private
 */
function normalizeBoard(raw) {
    const board = raw || {};
    const size = clampInt(board.size, LIMITS.size, 15);

    let grid = Array.isArray(board.grid) ? board.grid.map(r => String(r ?? '')) : [];

    // Brak siatki albo zły rozmiar — uzupełniamy pustymi polami zamiast wysypywać się.
    if (grid.length !== size) {
        grid = Array.from({ length: size }, (_, y) => grid[y] ?? '');
    }
    grid = grid.map(row => {
        const chars = [...row];
        while (chars.length < size) chars.push('.');
        return chars.slice(0, size).map(ch => (CELL_CODES[ch] ? ch : '.')).join('');
    });

    // Musi istnieć dokładnie jedno lub więcej pól startowych.
    const starts = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (grid[y][x] === '@') starts.push([x, y]);
        }
    }
    if (starts.length === 0) {
        // Domyślnie startujemy ze środka planszy.
        const c = Math.floor(size / 2);
        const row = [...grid[c]];
        row[c] = '@';
        grid[c] = row.join('');
    }

    return { size, grid };
}

/**
 * Sprawdza i uzupełnia listę klocków.
 * @param {Array<object>} raw - Surowa sekcja `tiles`
 * @returns {Array<{letter: string, count: number, points: number, usefulness: number}>}
 * @throws {VariantError}
 * @private
 */
function normalizeTiles(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new VariantError('Tryb gry musi zawierać przynajmniej jedną literę.', 'tiles');
    }

    const seen = new Map();
    for (const item of raw) {
        if (!item) continue;
        const letter = String(item.letter ?? item.l ?? '').trim().toUpperCase();

        if (letter === BLANK) continue; // blanki opisuje osobna sekcja
        if ([...letter].length !== 1) {
            throw new VariantError(
                `Litera "${letter}" jest nieprawidłowa — każdy klocek to dokładnie jeden znak.`,
                'tiles',
            );
        }
        if (!/\p{L}/u.test(letter)) {
            throw new VariantError(`Znak "${letter}" nie jest literą.`, 'tiles');
        }
        if (seen.has(letter)) {
            throw new VariantError(`Litera "${letter}" występuje w trybie dwa razy.`, 'tiles');
        }

        seen.set(letter, {
            letter,
            count: clampInt(item.count ?? item.n, LIMITS.letterCount, 1),
            points: clampInt(item.points ?? item.p, LIMITS.letterPoints, 1),
            usefulness: clampInt(item.usefulness ?? item.u, { min: 1, max: 5 }, 3),
        });
    }

    const tiles = [...seen.values()].filter(t => t.count > 0);
    if (tiles.length === 0) {
        throw new VariantError('Wszystkie litery mają zerową ilość — worek byłby pusty.', 'tiles');
    }
    tiles.sort((a, b) => a.letter.localeCompare(b.letter, 'pl'));
    return tiles;
}

/**
 * Waliduje i uzupełnia definicję trybu gry.
 *
 * Funkcja jest odporna na niekompletne dane — braki uzupełnia sensownymi
 * wartościami domyślnymi, a rzuca wyjątek tylko wtedy, gdy tryb byłby
 * niegrywalny (np. worek mniejszy niż stojaki graczy).
 *
 * @param {object} raw - Surowa definicja (np. z formularza albo z bazy)
 * @param {object} [options]
 * @param {number} [options.maxSeats=4] - Maksymalna liczba graczy przy stole,
 *   używana do sprawdzenia, czy worek wystarczy na rozdanie
 * @returns {object} Znormalizowana, kompletna definicja
 * @throws {VariantError} Gdy tryb jest niegrywalny
 *
 * @example
 * const def = normalizeDefinition(JSON.parse(row.definition));
 */
function normalizeDefinition(raw, options = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const maxSeats = options.maxSeats || 4;

    const board = normalizeBoard(src.board);
    const tiles = normalizeTiles(src.tiles);

    const rackSize = clampInt(src.rack?.size ?? src.rackSize, LIMITS.rackSize, 7);

    const blankRaw = src.blank || {};
    const blank = {
        count: clampInt(blankRaw.count, LIMITS.blankCount, 0),
        points: clampInt(blankRaw.points, LIMITS.letterPoints, 0),
    };

    const letterTiles = tiles.reduce((sum, t) => sum + t.count, 0);
    const totalTiles = letterTiles + blank.count;

    if (totalTiles < LIMITS.tileCount.min) {
        throw new VariantError(
            `Worek ma tylko ${totalTiles} klocków — minimum to ${LIMITS.tileCount.min}.`,
            'tiles',
        );
    }
    if (totalTiles > LIMITS.tileCount.max) {
        throw new VariantError(
            `Worek ma ${totalTiles} klocków — maksimum to ${LIMITS.tileCount.max}.`,
            'tiles',
        );
    }
    if (totalTiles < rackSize * maxSeats) {
        throw new VariantError(
            `Worek (${totalTiles} klocków) nie wystarczy na rozdanie ${maxSeats} stojaków po ${rackSize} liter.`,
            'tiles',
        );
    }
    if (totalTiles > board.size * board.size) {
        throw new VariantError(
            `Worek (${totalTiles} klocków) jest większy niż plansza (${board.size * board.size} pól).`,
            'tiles',
        );
    }

    const bingoRaw = src.bingo || {};
    const bingo = {
        tiles: clampInt(bingoRaw.tiles, { min: 1, max: rackSize }, rackSize),
        bonus: clampInt(bingoRaw.bonus, LIMITS.bingoBonus, 50),
    };

    const rulesRaw = src.rules || {};
    const rules = {
        exchangeMinBag: clampInt(rulesRaw.exchangeMinBag, { min: 0, max: totalTiles }, Math.min(DEFAULT_RULES.exchangeMinBag, rackSize)),
        maxScorelessTurns: clampInt(rulesRaw.maxScorelessTurns, { min: 2, max: 40 }, DEFAULT_RULES.maxScorelessTurns),
        endgameRackPenalty: rulesRaw.endgameRackPenalty !== false,
        endgameOutBonus: rulesRaw.endgameOutBonus !== false,
        validateWords: rulesRaw.validateWords !== false,
        invalidWord: rulesRaw.invalidWord === 'reject' ? 'reject' : 'loseTurn',
        firstMoveMustCoverStart: rulesRaw.firstMoveMustCoverStart !== false,
        minWordLength: clampInt(rulesRaw.minWordLength, { min: 1, max: 5 }, DEFAULT_RULES.minWordLength),
    };

    const colors = { ...DEFAULT_COLORS };
    for (const [key, value] of Object.entries(src.colors || {})) {
        if (key in DEFAULT_COLORS && isColor(value)) colors[key] = value;
    }

    return {
        board,
        rack: { size: rackSize },
        bingo,
        tiles,
        blank,
        rules,
        colors,
        dictionary: typeof src.dictionary === 'string' ? src.dictionary.slice(0, 16) : 'pl',
    };
}

/**
 * Zamienia nazwę trybu na identyfikator URL-owy.
 * @param {string} name - Nazwa trybu
 * @returns {string} Slug (małe litery, myślniki)
 *
 * @example
 * slugify('Literki Turbo!'); // => 'literki-turbo'
 */
function slugify(name) {
    const map = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ż': 'z', 'ź': 'z' };
    return String(name || '')
        .toLowerCase()
        .replace(/[ąćęłńóśżź]/g, ch => map[ch] || ch)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'tryb';
}

/**
 * Podsumowuje tryb w kilku liczbach — do listy trybów i kart w lobby.
 * @param {object} def - Znormalizowana definicja
 * @returns {{size: number, tiles: number, letters: number, blanks: number, pointSum: number, premiums: number, rackSize: number}}
 */
function summarize(def) {
    const letters = def.tiles.reduce((s, t) => s + t.count, 0);
    const pointSum = def.tiles.reduce((s, t) => s + t.count * t.points, 0);
    let premiums = 0;
    for (const row of def.board.grid) {
        for (const ch of row) if (ch !== '.' && ch !== '@') premiums++;
    }
    return {
        size: def.board.size,
        tiles: letters + def.blank.count,
        letters,
        blanks: def.blank.count,
        pointSum,
        premiums,
        rackSize: def.rack.size,
    };
}

module.exports = {
    CELL_CODES,
    BLANK,
    LIMITS,
    DEFAULT_COLORS,
    DEFAULT_RULES,
    VariantError,
    normalizeDefinition,
    slugify,
    summarize,
};
