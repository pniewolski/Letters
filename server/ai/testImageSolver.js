/**
 * Szybki test offline: buildBoard + solveTopMoves (bez wywołania modelu AI).
 * Uruchom: node server/ai/testImageSolver.js
 */
process.chdir(require('path').join(__dirname, '..'));

const WordDictionary = require('../board/WordDictionary');
const { buildBoard, solveTopMoves, normalizeAiData } = require('./imageSolver');

async function main() {
    const dict = new WordDictionary();
    await dict.ready;

    // Symulacja odpowiedzi modelu: puste pola '.', "KOT" poziomo w środku (wiersz 7)
    const rawRows = [];
    for (let i = 0; i < 15; i++) rawRows.push('.'.repeat(15));
    // wstaw KOT na wierszu 7 (y=7), kolumny 6,7,8
    let row7 = rawRows[7].split('');
    row7[6] = 'K'; row7[7] = 'O'; row7[8] = 'T';
    rawRows[7] = row7.join('');

    const aiData = { board: rawRows, rack: ['A', 'L', 'E', 'S', 'R', 'I', '*'] };
    const norm = normalizeAiData(aiData, 'AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ');

    const board = buildBoard(norm.board);
    board.consolePreviewBoard();

    const moves = solveTopMoves(board, norm.rack, dict, 20);
    console.log(`\nZnaleziono ${moves.length} ruchów:\n`);
    for (const m of moves) console.log('  ' + m.text);
}

main().catch(e => { console.error(e); process.exit(1); });

