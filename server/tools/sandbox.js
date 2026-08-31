/**
 * @file sandbox.js
 * @description Piaskownica solvera: układa przykładową planszę i pokazuje
 * najlepsze zagrania dla podanego stojaka. Miejsce do szybkiego sprawdzania
 * pomysłów bez uruchamiania serwera.
 *
 * ```powershell
 * node server/tools/sandbox.js
 * node server/tools/sandbox.js --rack ALESZYK --variant scr --top 15
 * ```
 */

const WordDictionary = require('../board/WordDictionary');
const BestMoveFinder = require('../board/BestMoveFinder');
const { compileVariant } = require('../variant/compile');
const { PRESETS } = require('../variant/presets');

/**
 * Czyta argumenty wiersza poleceń.
 * @returns {{rack: string, variant: string, top: number}}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = { rack: 'ALESZY*', variant: 'literki', top: 10 };

    for (let i = 0; i < args.length; i++) {
        const key = args[i].replace(/^--/, '');
        if (key === 'top') out.top = Number(args[++i]);
        else if (key in out) out[key] = args[++i];
    }
    return out;
}

/** Uruchamia piaskownicę. */
async function main() {
    const options = parseArgs();
    const preset = PRESETS.find(p => p.slug === options.variant) || PRESETS[0];
    const variant = compileVariant(preset.definition, { slug: preset.slug, name: preset.name });

    console.log('Ładowanie słownika...');
    const dict = new WordDictionary();
    await dict.ready;

    const center = Math.floor(variant.size / 2);
    const finder = new BestMoveFinder(dict, variant);

    // Przykładowy stan planszy — zmieniaj do woli.
    finder.putWordOnBoard(center - 1, center, 'KOT', true);
    finder.putWordOnBoard(center + 1, center, 'OSA', false);
    finder.setRack(options.rack.toUpperCase());

    finder.board.consolePreviewBoard();
    console.log(`Tryb: ${preset.name}. Stojak: ${finder.stack.join(' ')}\n`);

    const started = Date.now();
    const moves = finder.getSolutions();
    console.log(`Znaleziono ${moves.length} ruchów w ${Date.now() - started} ms. Najlepsze:\n`);

    for (const move of moves.slice(0, options.top)) {
        const dir = move.horizontal ? 'poziomo' : 'pionowo';
        const at = `${String.fromCharCode(65 + move.x)}${move.y + 1}`;
        const extra = move.perpendicularWords.length
            ? ` (+ ${move.perpendicularWords.join(', ')})`
            : '';
        console.log(`  ${String(move.points).padStart(4)} pkt  ${move.wordSimple.padEnd(12)} ${at} ${dir}${extra}`);
    }
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
