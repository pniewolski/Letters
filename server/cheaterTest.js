const WordDictionary = require('./WordDictionary');
const BestMoveFinder = require('./BestMoveFinder');


async function main() {
    const dict = new WordDictionary();
    await dict.ready;

    const finder = new BestMoveFinder(dict);

    finder.putLetterOnBoard(1, 1, 'A');
    finder.putLetterOnBoard(2, 1, 'R');
    //finder.putLetterOnBoard(3, 1, 'B');
    finder.putLetterOnBoard(4, 1, 'U');
    finder.putLetterOnBoard(5, 1, 'Z');

    finder.putLetterOnStack("P");
    finder.putLetterOnStack("L");
    finder.putLetterOnStack("B");
    finder.putLetterOnStack("A");
    finder.board.consolePreviewBoard();

    var sol0 = finder.getSolution(0);
    console.log(sol0);

    finder.board.putWord(sol0.word, sol0.x, sol0.y, sol0.horizontal);
    finder.board.consolePreviewBoard();

    //console.log(JSON.stringify(finder.board.tiles, null, 2));
    finder.board.eraseCurrents();

    // var sol1 = finder.getSolution(1);
    // console.log(sol1);
    //
    // finder.board.putWord(sol1.word, sol1.x, sol1.y, sol1.horizontal);
    // finder.board.consolePreviewBoard();
    // finder.board.eraseCurrents();

}

main();
