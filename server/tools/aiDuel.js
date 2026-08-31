/**
 * @file aiDuel.js
 * @description Sadza dwa poziomy komputera naprzeciw siebie i liczy, który
 * wygrywa. Bez tego „poprawiłem strategię" jest tylko przypuszczeniem.
 *
 * ## Dlaczego partie są rozgrywane parami
 *
 * Gra słowna jest bardzo losowa — kto wyciągnie blanka, ten wygrywa serię
 * niezależnie od umiejętności. Dlatego każde losowanie worka rozgrywane jest
 * **dwa razy, ze stronami zamienionymi**: obie strategie dostają dokładnie te
 * same litery w tej samej kolejności. To, co zostaje po odjęciu wyników, jest
 * już różnicą w grze, a nie w szczęściu.
 *
 * Bez tego zabiegu trzeba tysięcy partii, żeby zobaczyć różnicę, którą przy
 * parach widać po stu.
 *
 * ```powershell
 * node server/tools/aiDuel.js --a 3 --b 2 --pairs 100
 * node server/tools/aiDuel.js --a 2 --b 1 --pairs 50 --variant scr
 * ```
 */

const WordDictionary = require('../board/WordDictionary');
const Game = require('../game/Game');
const Strategy = require('../game/Strategy');
const { compileVariant } = require('../variant/compile');
const { PRESETS } = require('../variant/presets');
const { LEVELS } = require('../game/Strategy');

/**
 * Czyta argumenty wiersza poleceń.
 * @returns {{a: number, b: number, pairs: number, variant: string}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = { a: 3, b: 2, pairs: 100, variant: 'literki' };

    for (let i = 0; i < args.length; i++) {
        const key = args[i].replace(/^--/, '');
        if (key === 'variant') out.variant = args[++i];
        // `--games` przyjmujemy jako synonim, żeby stare polecenia działały.
        else if (key === 'games') out.pairs = Math.max(1, Math.round(Number(args[++i]) / 2));
        else if (key in out) out[key] = Number(args[++i]);
    }
    return out;
}

/**
 * Szybki generator pseudolosowy o zadanym ziarnie. Podmieniamy nim `Math.random`
 * na czas partii, żeby obie strony dostały ten sam worek.
 * @param {number} seed
 * @returns {() => number}
 */
function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Rozgrywa jedną partię przy ustalonym losowaniu worka.
 * @param {import('../board/WordDictionary')} dict - Słownik
 * @param {object} variant - Skompilowany tryb gry
 * @param {number} levelSlot0 - Poziom gracza na miejscu 0
 * @param {number} levelSlot1 - Poziom gracza na miejscu 1
 * @param {number} seed - Ziarno losowania
 * @returns {number[]} Wyniki obu graczy
 */
function playGame(dict, variant, levelSlot0, levelSlot1, seed) {
    const realRandom = Math.random;
    Math.random = seededRandom(seed);

    try {
        const game = new Game(dict, variant, { players: 2 });
        const strategies = [
            new Strategy(variant, levelSlot0),
            new Strategy(variant, levelSlot1),
        ];

        let guard = 0;
        while (!game.finished && guard++ < 400) {
            const slot = game.currentPlayer();
            game.strategy = strategies[slot];
            game.computerMove(slot);
        }
        return [...game.table.points];
    } finally {
        Math.random = realRandom;
    }
}

/** Uruchamia pojedynek. */
async function main() {
    const options = parseArgs();
    const preset = PRESETS.find(p => p.slug === options.variant) || PRESETS[0];
    const variant = compileVariant(preset.definition, { slug: preset.slug, name: preset.name });

    const nameA = LEVELS[options.a]?.name || `poziom ${options.a}`;
    const nameB = LEVELS[options.b]?.name || `poziom ${options.b}`;

    console.log(`Pojedynek: ${nameA} (${options.a}) kontra ${nameB} (${options.b})`);
    console.log(`Tryb: ${preset.name}, par: ${options.pairs} (czyli ${options.pairs * 2} partii)\n`);
    console.log('Ładowanie słownika...');

    const dict = new WordDictionary();
    await dict.ready;

    const margins = [];
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let sumA = 0;
    let sumB = 0;
    const started = Date.now();

    for (let i = 0; i < options.pairs; i++) {
        const seed = 1000 + i * 7919;

        // To samo losowanie, raz z jednej strony, raz z drugiej.
        const first = playGame(dict, variant, options.a, options.b, seed);
        const second = playGame(dict, variant, options.b, options.a, seed);

        const scoreA = first[0] + second[1];
        const scoreB = first[1] + second[0];

        sumA += scoreA;
        sumB += scoreB;
        margins.push(scoreA - scoreB);

        if (scoreA > scoreB) wins++;
        else if (scoreB > scoreA) losses++;
        else draws++;

        process.stdout.write(`\r  rozegrano ${i + 1}/${options.pairs} par  (${wins}:${losses})   `);
    }

    const pairs = options.pairs;
    const mean = margins.reduce((a, b) => a + b, 0) / pairs;
    const sd = Math.sqrt(margins.reduce((a, m) => a + (m - mean) ** 2, 0) / Math.max(1, pairs - 1));
    const ci = 1.96 * sd / Math.sqrt(pairs);

    console.log('\n');
    console.log(`${nameA}: ${wins} par wygranych   ${nameB}: ${losses}   remisy: ${draws}`);
    console.log(`Średni wynik w parze: ${(sumA / pairs).toFixed(1)} — ${(sumB / pairs).toFixed(1)}`);
    console.log(`Różnica: ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} ±${ci.toFixed(1)} pkt na parę`);
    console.log(`Czas: ${((Date.now() - started) / 1000).toFixed(1)} s`);

    if (mean - ci > 0) {
        console.log(`\nWniosek: ${nameA} gra wyraźnie lepiej.`);
    } else if (mean + ci < 0) {
        console.log(`\nWniosek: ${nameB} gra wyraźnie lepiej.`);
    } else {
        console.log('\nWniosek: różnica mieści się w losowości — dołóż par albo popraw strategię.');
    }
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
