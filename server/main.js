const WordDictionary = require('./WordDictionary');
const Board = require('./Board');
const Solver = require('./Solver.js');

async function main() {

    const board = new Board();
    board.putWord([{letter:"D", isBlank:false},{letter:"U", isBlank:false},{letter:"P", isBlank:false}], 7, 7, true);
    board.putWord([{letter:null, isBlank:false},{letter:"U", isBlank:false},{letter:"P", isBlank:true},{letter:"A", isBlank:false},{letter:"M", isBlank:false}], 7, 7, false);
    board.putWord([{letter:"K", isBlank:false},{letter:"U", isBlank:false},{letter:null, isBlank:true},{letter:"A", isBlank:false}], 5, 9, true);
    board.consolePreviewBoard();



    const dict = new WordDictionary();
    await dict.ready;


    const solver = new Solver(dict);

    for (let i=0; i<35; i++) {
        let res = solver.solve(board, ['*','I','*','D','A','Z','I']);

        console.log(res[0]);
        console.log(res[1]);
        console.log(res[2]);
        board.putWord(res[0].word, res[0].x, res[0].y, res[0].horizontal);
        board.consolePreviewBoard();
    }


    // const template = 'STER';
    // const letters = ['S', 'T', 'E', 'T', 'Y', 'A', 'R']; // jedna dowolna litera
    // const results = dict.search(4, template, letters);
    // console.log(`Znaleziono ${results.length} słów:`);
    // console.log(results.slice(0, 10));


}

main();
