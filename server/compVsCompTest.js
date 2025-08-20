const WordDictionary = require('./board/WordDictionary');
const Game = require('./game/Game');

async function main() {

    const dict = new WordDictionary();
    await dict.ready;

    const game = new Game(dict);

    game.table.board.putWord([{letter:"A", isBlank:false}], 7, 7, true);

    game.table.board.consolePreviewBoard();
    while(true) {
        game.computerMove(0);
        game.computerMove(1);
    }
}

main();
