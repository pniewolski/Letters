const WordDictionary = require('./board/WordDictionary');
const Board = require('./board/Board');
const Solver = require('./board/Solver.js');

function now() {
    return process.hrtime.bigint();
}

function elapsedMs(start) {
    return Number(process.hrtime.bigint() - start) / 1_000_000;
}

async function runTest(solver, board, letters, runs = 1) {
    let result;
    const start = now();

    for (let i = 0; i < runs; i++) {
        result = solver.generateFirstWord(board, letters);
    }

    const time = elapsedMs(start);

    console.log(`Litery: ${letters.join(' ')}`);
    console.log(`Powtórzeń: ${runs}`);
    console.log(`Czas całkowity: ${time.toFixed(2)} ms`);
    console.log(`Średnio: ${(time / runs).toFixed(2)} ms`);
    console.log(`Najlepsze słowo:`, result?.[0].wordSimple);
    console.log('-------------------------------');
}

async function main() {

    const board = new Board();

    // przykładowe ustawienia planszy (możesz włączać)
    // board.putWord(
    //     [{letter:"D", isBlank:false},{letter:"U", isBlank:false},{letter:"P", isBlank:false}],
    //     7, 7, true
    // );

    board.consolePreviewBoard();

    const dict = new WordDictionary();
    await dict.ready;

    const solver = new Solver(dict);

    // 🔠 zestawy liter do testów
    const tests = [
        ['P','I','Z','D','K','A','U'],
        ['A','E','N','R','T','O','S'],
        ['K','L','M','A','P','I','E'],
        ['Z','Y','C','H','A','N','E'],
        ['B','L','A','N','K','*','*'],
        ['S','T','R','U','C','T','Y'],
    ];

    // 🧊 cold start
    console.log('=== COLD START ===');
    await runTest(solver, board, tests[0], 1);

    // 🔥 realne testy
    console.log('=== PERFORMANCE TESTS ===');
    for (const letters of tests) {
        await runTest(solver, board, letters, 20);
    }
}

main();
