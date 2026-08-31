/**
 * @file presets.js
 * @description Wbudowane tryby gry zakładane przy pierwszym starcie serwera.
 *
 * Oba zestawy — układ premii, ilości klocków i punktacja — są **autorskie**.
 * Rozkład liter wyprowadzono z częstości ich występowania w `slownik.txt`
 * (patrz `server/tools/deriveTiles.js`), a nie przepisano z żadnej istniejącej
 * gry planszowej. Układ premii ma symetrię ośmiokrotną i został wygenerowany
 * z reguł geometrycznych opisanych przy każdym trybie.
 *
 * Presety trafiają do bazy jako zwykłe rekordy tabeli `variants`, więc każdy
 * gracz może je skopiować i przerobić po swojemu — a administrator może je
 * usunąć albo podmienić bez ruszania kodu.
 *
 * @example
 * const { PRESETS } = require('./presets');
 * PRESETS.map(p => p.slug); // => ['literki', 'scr']
 */

// ─────────────────────────────────────────────────────────────────────────────
// LITERKI — tryb domyślny
// ─────────────────────────────────────────────────────────────────────────────
// Plansza „diamentowa": premie leżą na koncentrycznych pierścieniach wokół pola
// startowego. Mnożników słowa jest mało (4 × potrójne w rogach, 8 × podwójne),
// za to dużo mnożników litery — łącznie z poczwórnymi. Efekt: gra jest bardziej
// pozycyjna i mniej zależna od jednego szczęśliwego trafienia w róg.
//
// Klocki: 100 liter + 4 blanki. Trzy najrzadsze litery (Ć, Ń, Ź) występują
// pojedynczo, ale są warte 12 punktów — opłaca się je zaplanować, nie wymienić.

const LITERKI = {
    slug: 'literki',
    name: 'Literki',
    description:
        'Tryb domyślny portalu. Plansza z premiami na pierścieniach, mało mnożników słowa, '
        + 'za to dużo mnożników litery (łącznie z poczwórnymi). Cztery blanki i drogie rzadkie litery.',
    definition: {
        board: {
            size: 15,
            grid: [
                '3.............3',
                '.q..tt.2.tt..q.',
                '..2..d...d..2..',
                '......dtd......',
                '.t..t.....t..t.',
                '.td....d....dt.',
                '...d..d.d..d...',
                '.2.t.d.@.d.t.2.',
                '...d..d.d..d...',
                '.td....d....dt.',
                '.t..t.....t..t.',
                '......dtd......',
                '..2..d...d..2..',
                '.q..tt.2.tt..q.',
                '3.............3',
            ],
        },
        rack: { size: 7 },
        bingo: { tiles: 7, bonus: 45 },
        blank: { count: 4, points: 0 },
        tiles: [
            { letter: 'A', count: 8, points: 1, usefulness: 1 },
            { letter: 'Ą', count: 2, points: 5, usefulness: 4 },
            { letter: 'B', count: 2, points: 3, usefulness: 3 },
            { letter: 'C', count: 4, points: 2, usefulness: 2 },
            { letter: 'Ć', count: 1, points: 12, usefulness: 5 },
            { letter: 'D', count: 2, points: 3, usefulness: 3 },
            { letter: 'E', count: 8, points: 1, usefulness: 1 },
            { letter: 'Ę', count: 2, points: 8, usefulness: 4 },
            { letter: 'F', count: 2, points: 10, usefulness: 4 },
            { letter: 'G', count: 2, points: 5, usefulness: 3 },
            { letter: 'H', count: 2, points: 5, usefulness: 3 },
            { letter: 'I', count: 7, points: 1, usefulness: 1 },
            { letter: 'J', count: 2, points: 3, usefulness: 3 },
            { letter: 'K', count: 3, points: 2, usefulness: 2 },
            { letter: 'L', count: 2, points: 3, usefulness: 2 },
            { letter: 'Ł', count: 2, points: 3, usefulness: 3 },
            { letter: 'M', count: 3, points: 2, usefulness: 2 },
            { letter: 'N', count: 6, points: 1, usefulness: 1 },
            { letter: 'Ń', count: 1, points: 12, usefulness: 5 },
            { letter: 'O', count: 6, points: 1, usefulness: 1 },
            { letter: 'Ó', count: 2, points: 10, usefulness: 4 },
            { letter: 'P', count: 3, points: 3, usefulness: 2 },
            { letter: 'R', count: 4, points: 2, usefulness: 1 },
            { letter: 'S', count: 3, points: 2, usefulness: 1 },
            { letter: 'Ś', count: 2, points: 6, usefulness: 4 },
            { letter: 'T', count: 3, points: 3, usefulness: 2 },
            { letter: 'U', count: 3, points: 3, usefulness: 3 },
            { letter: 'W', count: 4, points: 2, usefulness: 1 },
            { letter: 'Y', count: 3, points: 2, usefulness: 2 },
            { letter: 'Z', count: 3, points: 2, usefulness: 1 },
            { letter: 'Ż', count: 2, points: 8, usefulness: 4 },
            { letter: 'Ź', count: 1, points: 12, usefulness: 5 },
        ],
        rules: {
            exchangeMinBag: 5,
            maxScorelessTurns: 6,
            endgameRackPenalty: true,
            endgameOutBonus: true,
            validateWords: true,
            invalidWord: 'loseTurn',
            firstMoveMustCoverStart: true,
            minWordLength: 2,
        },
        colors: {
            normal: '#24413a',
            start: '#3d3524',
            word2: '#8a4033',
            word3: '#a83f2e',
            word4: '#93325f',
            letter2: '#23506b',
            letter3: '#1a3f63',
            letter4: '#1e6a5c',
            tile: '#e0c07a',
            tileCurrent: '#f7e2a0',
            tileText: '#1d2233',
        },
        dictionary: 'pl',
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCR — tryb klasyczny
// ─────────────────────────────────────────────────────────────────────────────
// Dla graczy, którzy wolą klasyczne tempo: gęstsza siatka mnożników słowa,
// potrójne premie słowa przy krawędziach (nie w rogach) i tańsze rzadkie litery.
// Klocki: 98 liter + 2 blanki, punktacja z częstości występowania liter
// w słowniku — dlatego W i Y są tu tanie, a R, S i Z warte 2 punkty.

const SCR = {
    slug: 'scr',
    name: 'SCR',
    description:
        'Tryb klasyczny: gęsta siatka mnożników, potrójne premie słowa przy krawędziach, '
        + '98 liter i 2 blanki. Szybsza i bardziej punktowa gra niż Literki.',
    definition: {
        board: {
            size: 15,
            grid: [
                '..3.d.....d.3..',
                '.2...t...t...2.',
                '3.2...d.d...2.3',
                '...2...d...2...',
                'd...2.....2...d',
                '.t...t...t...t.',
                '..d...d.d...d..',
                '...d...@...d...',
                '..d...d.d...d..',
                '.t...t...t...t.',
                'd...2.....2...d',
                '...2...d...2...',
                '3.2...d.d...2.3',
                '.2...t...t...2.',
                '..3.d.....d.3..',
            ],
        },
        rack: { size: 7 },
        bingo: { tiles: 7, bonus: 50 },
        blank: { count: 2, points: 0 },
        tiles: [
            { letter: 'A', count: 8, points: 1, usefulness: 1 },
            { letter: 'Ą', count: 2, points: 4, usefulness: 4 },
            { letter: 'B', count: 2, points: 3, usefulness: 3 },
            { letter: 'C', count: 4, points: 2, usefulness: 2 },
            { letter: 'Ć', count: 1, points: 9, usefulness: 5 },
            { letter: 'D', count: 2, points: 3, usefulness: 3 },
            { letter: 'E', count: 7, points: 1, usefulness: 1 },
            { letter: 'Ę', count: 1, points: 6, usefulness: 4 },
            { letter: 'F', count: 1, points: 8, usefulness: 4 },
            { letter: 'G', count: 2, points: 4, usefulness: 3 },
            { letter: 'H', count: 2, points: 4, usefulness: 3 },
            { letter: 'I', count: 8, points: 1, usefulness: 1 },
            { letter: 'J', count: 2, points: 3, usefulness: 3 },
            { letter: 'K', count: 3, points: 2, usefulness: 2 },
            { letter: 'L', count: 2, points: 2, usefulness: 2 },
            { letter: 'Ł', count: 2, points: 3, usefulness: 3 },
            { letter: 'M', count: 3, points: 2, usefulness: 2 },
            { letter: 'N', count: 6, points: 1, usefulness: 1 },
            { letter: 'Ń', count: 1, points: 9, usefulness: 5 },
            { letter: 'O', count: 7, points: 1, usefulness: 1 },
            { letter: 'Ó', count: 1, points: 9, usefulness: 4 },
            { letter: 'P', count: 3, points: 2, usefulness: 2 },
            { letter: 'R', count: 4, points: 2, usefulness: 1 },
            { letter: 'S', count: 3, points: 2, usefulness: 1 },
            { letter: 'Ś', count: 1, points: 5, usefulness: 4 },
            { letter: 'T', count: 3, points: 2, usefulness: 2 },
            { letter: 'U', count: 3, points: 2, usefulness: 3 },
            { letter: 'W', count: 4, points: 1, usefulness: 1 },
            { letter: 'Y', count: 4, points: 1, usefulness: 2 },
            { letter: 'Z', count: 4, points: 2, usefulness: 1 },
            { letter: 'Ż', count: 1, points: 6, usefulness: 4 },
            { letter: 'Ź', count: 1, points: 9, usefulness: 5 },
        ],
        rules: {
            exchangeMinBag: 7,
            maxScorelessTurns: 6,
            endgameRackPenalty: true,
            endgameOutBonus: true,
            validateWords: true,
            invalidWord: 'loseTurn',
            firstMoveMustCoverStart: true,
            minWordLength: 2,
        },
        colors: {
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
        },
        dictionary: 'pl',
    },
};

/** Wbudowane tryby, w kolejności prezentacji. */
const PRESETS = [LITERKI, SCR];

/** Slug trybu używanego, gdy gracz nie wybierze żadnego. */
const DEFAULT_SLUG = 'literki';

module.exports = { PRESETS, DEFAULT_SLUG, LITERKI, SCR };
