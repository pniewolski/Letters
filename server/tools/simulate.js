/**
 * @file simulate.js
 * @description Rozgrywa partie komputer kontra komputer bez uruchamiania
 * serwera. Przydatne do sprawdzenia, czy własny tryb gry jest grywalny
 * i jak wysokie padają w nim wyniki.
 *
 * Uruchomienie:
 * ```powershell
 * node server/tools/simulate.js                          # 1 partia, tryb Literki
 * node server/tools/simulate.js --variant scr --games 20 # statystyka z 20 partii
 * node server/tools/simulate.js --players 4 --level 3 --show
 * ```
 */

const WordDictionary = require('../board/WordDictionary');
const Game = require('../game/Game');
const { compileVariant } = require('../variant/compile');
const { PRESETS } = require('../variant/presets');

/**
 * Czyta argumenty wiersza poleceń.
 * @returns {object}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = { variant: 'literki', games: 1, players: 2, level: 3, show: false };

    for (let i = 0; i < args.length; i++) {
        const key = args[i].replace(/^--/, '');
        if (key === 'show') { out.show = true; continue; }
        if (key === 'variant') { out.variant = args[++i]; continue; }
        if (key in out) out[key] = Number(args[++i]);
    }
    return out;
}

/** Uruchamia symulację. */
async function main() {
    const options = parseArgs();

    const preset = PRESETS.find(p => p.slug === options.variant);
    if (!preset) {
        console.error(`Nie znam trybu "${options.variant}". Dostępne: ${PRESETS.map(p => p.slug).join(', ')}`);
        process.exit(1);
    }

    const variant = compileVariant(preset.definition, { slug: preset.slug, name: preset.name });

    console.log(`Tryb: ${preset.name} — plansza ${variant.size}×${variant.size}, `
        + `${variant.summary.tiles} klocków, stojak ${variant.rackSize}.`);
    console.log('Ładowanie słownika...');

    const dict = new WordDictionary();
    await dict.ready;

    const scores = [];
    const wordScores = [];
    let bingos = 0;
    let bestWord = { word: null, points: 0 };
    const started = Date.now();

    for (let g = 0; g < options.games; g++) {
        const game = new Game(dict, variant, { players: options.players, aiLevel: options.level });

        let guard = 0;
        while (!game.finished && guard++ < 600) {
            game.computerMove(game.currentPlayer());
        }

        for (const move of game.moves) {
            if (move.type !== 'word') continue;
            wordScores.push(move.points);
            if (move.bingo) bingos++;
            if (move.points > bestWord.points) bestWord = { word: move.wordSimple, points: move.points };
        }
        scores.push(...game.table.points);

        if (options.show || options.games === 1) {
            console.log(`\nPartia ${g + 1}: ${game.moves.length} ruchów, koniec: ${game.endReason}`);
            console.log('Wynik: ' + game.results()
                .map(r => `gracz ${r.slot + 1} = ${r.score} (${r.result})`).join(', '));
            game.table.board.consolePreviewBoard();
        }
    }

    const avg = arr => (arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length));

    console.log(`\n── Podsumowanie z ${options.games} partii (${options.players} graczy, poziom ${options.level}) ──`);
    console.log(`Czas: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    console.log(`Średni wynik gracza: ${avg(scores).toFixed(1)} pkt`);
    console.log(`Najwyższy wynik: ${Math.max(...scores)} pkt`);
    console.log(`Zagranych słów: ${wordScores.length}, średnio ${avg(wordScores).toFixed(1)} pkt za słowo`);
    console.log(`Premii za wyłożenie stojaka: ${bingos}`);
    console.log(`Najlepsze słowo: ${bestWord.word || '—'} (${bestWord.points} pkt)`);
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
