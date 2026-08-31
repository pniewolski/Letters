/**
 * @file testImageSolver.js
 * @description Szybki test offline solvera ze zdjęcia: `buildBoard`
 * + `solveTopMoves`, bez wywoływania modelu AI (i bez kosztów).
 *
 * ```powershell
 * node server/ai/testImageSolver.js
 * ```
 */

const WordDictionary = require('../board/WordDictionary');
const { buildBoard, solveTopMoves, normalizeAiData } = require('./imageSolver');
const { compileVariant } = require('../variant/compile');
const { LITERKI } = require('../variant/presets');

/** Uruchamia test. */
async function main() {
    const variant = compileVariant(LITERKI.definition, { slug: 'literki', name: 'Literki' });

    const dict = new WordDictionary();
    await dict.ready;

    // Udawana odpowiedź modelu: puste pola i słowo KOT w środku planszy.
    const rows = Array.from({ length: variant.size }, () => '.'.repeat(variant.size));
    const middle = [...rows[7]];
    middle[6] = 'K';
    middle[7] = 'O';
    middle[8] = 'T';
    rows[7] = middle.join('');

    const norm = normalizeAiData(
        { board: rows, rack: ['A', 'L', 'E', 'S', 'R', 'I', '*'] },
        variant.alphabet,
    );

    const board = buildBoard(norm.board, variant);
    board.consolePreviewBoard();

    const moves = solveTopMoves(board, norm.rack, dict, 20);
    console.log(`\nStojak: ${norm.rack.join(' ')}`);
    console.log(`Znaleziono ${moves.length} ruchów (tryb ${variant.meta.name}):\n`);
    for (const move of moves) console.log('  ' + move.text);
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
