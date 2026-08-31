/**
 * @file playConsole.js
 * @description Partia w konsoli: człowiek kontra komputer, bez przeglądarki.
 * Najprostszy sposób, żeby sprawdzić reguły własnego trybu gry.
 *
 * ```powershell
 * node server/tools/playConsole.js
 * node server/tools/playConsole.js --variant scr --level 3
 * ```
 *
 * Komendy w trakcie gry:
 * | komenda | znaczenie |
 * |---------|-----------|
 * | `H8 KOT`  | połóż słowo od pola H8 poziomo |
 * | `H8 KOT v`| połóż słowo pionowo |
 * | `w AEI`   | wymień litery A, E, I |
 * | `p`       | pas |
 * | `?`       | pokaż podpowiedzi |
 * | `q`       | zakończ |
 */

const readline = require('readline');
const WordDictionary = require('../board/WordDictionary');
const Game = require('../game/Game');
const { compileVariant } = require('../variant/compile');
const { PRESETS } = require('../variant/presets');

/**
 * Czyta argumenty wiersza poleceń.
 * @returns {{variant: string, level: number}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = { variant: 'literki', level: 2 };
    for (let i = 0; i < args.length; i++) {
        const key = args[i].replace(/^--/, '');
        if (key === 'level') out.level = Number(args[++i]);
        else if (key === 'variant') out.variant = args[++i];
    }
    return out;
}

/**
 * Zamienia zapis pola (`H8`) na współrzędne.
 * @param {string} text - Etykieta pola
 * @param {number} size - Bok planszy
 * @returns {{x: number, y: number}|null}
 */
function parseCoord(text, size) {
    const match = /^([A-Za-z]+)(\d+)$/.exec(String(text).trim());
    if (!match) return null;

    let x = 0;
    for (const ch of match[1].toUpperCase()) x = x * 26 + (ch.charCodeAt(0) - 64);
    x -= 1;
    const y = Number(match[2]) - 1;

    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return { x, y };
}

/** Uruchamia partię w konsoli. */
async function main() {
    const options = parseArgs();
    const preset = PRESETS.find(p => p.slug === options.variant) || PRESETS[0];
    const variant = compileVariant(preset.definition, { slug: preset.slug, name: preset.name });

    console.log('Ładowanie słownika...');
    const dict = new WordDictionary();
    await dict.ready;

    const game = new Game(dict, variant, { players: 2, aiLevel: options.level });
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(resolve => rl.question(q, resolve));

    console.log(`\nTryb: ${preset.name}. Grasz jako gracz 1, komputer jako gracz 2.`);
    console.log('Komendy: "H8 KOT" (poziomo), "H8 KOT v" (pionowo), "w AEI", "p", "?", "q".\n');

    while (!game.finished) {
        // ── Ruch komputera ──────────────────────────────────────────────────
        if (game.currentPlayer() === 1) {
            const move = game.computerMove(1);
            const what = move.type === 'word'
                ? `${move.wordSimple} za ${move.points} pkt`
                : (move.type === 'exchange' ? `wymiana ${move.letters.length} liter` : 'pas');
            console.log(`\nKomputer: ${what}`);
            continue;
        }

        // ── Ruch człowieka ──────────────────────────────────────────────────
        game.table.board.consolePreviewBoard();
        console.log(`Twój stojak: ${game.table.stack[0].join(' ')}`);
        console.log(`Wynik: ty ${game.table.points[0]} — komputer ${game.table.points[1]}`
            + ` · worek: ${game.table.bag.getBagSize()}\n`);

        const input = (await ask('Ruch: ')).trim();
        if (!input) continue;

        if (input === 'q') break;

        if (input === 'p') {
            game.pass(0);
            continue;
        }

        if (input === '?') {
            for (const hint of game.hints(0, 8)) {
                console.log(`  ${String(hint.points).padStart(4)} pkt  ${hint.wordSimple} `
                    + `(${String.fromCharCode(65 + hint.x)}${hint.y + 1} ${hint.horizontal ? 'poziomo' : 'pionowo'})`);
            }
            continue;
        }

        if (input.startsWith('w ')) {
            const result = game.exchange(0, [...input.slice(2).toUpperCase().replace(/\s/g, '')]);
            console.log(result.success ? 'Wymieniono.' : `Nie mogę: ${result.error}`);
            continue;
        }

        const [coordText, wordText, dirText] = input.split(/\s+/);
        const coord = parseCoord(coordText, variant.size);
        if (!coord || !wordText) {
            console.log('Nie rozumiem. Przykład: "H8 KOT" albo "H8 KOT v".');
            continue;
        }

        const horizontal = !dirText || dirText.toLowerCase().startsWith('h') || dirText === '-';
        const word = wordText.toUpperCase();
        const boardTiles = game.table.board.getTiles();

        // Zamieniamy słowo na listę klocków, pomijając pola już zajęte.
        const tiles = [];
        for (let i = 0; i < word.length; i++) {
            const x = horizontal ? coord.x + i : coord.x;
            const y = horizontal ? coord.y : coord.y + i;
            if (x >= variant.size || y >= variant.size) break;
            if (boardTiles[x][y].letter) continue;
            tiles.push({ letter: word[i], x, y, isBlank: false });
        }

        const result = game.humanMove(0, { tiles });
        if (!result.success) console.log(`Nie mogę: ${result.error}`);
        else if (result.lostTurn) console.log(`Nie znam słowa: ${result.wrongWords.join(', ')}. Tracisz turę.`);
        else console.log(`Zagrane za ${result.points} pkt.`);
    }

    // ── Koniec ──────────────────────────────────────────────────────────────
    if (!game.finished) game.finish('abandoned');
    game.table.board.consolePreviewBoard();

    console.log('\n── Koniec partii ──');
    for (const r of game.results()) {
        console.log(`  ${r.slot === 0 ? 'Ty' : 'Komputer'}: ${r.score} pkt — ${r.result}`);
    }
    rl.close();
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
