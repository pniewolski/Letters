const WordDictionary = require('./WordDictionary');
const Board = require('./Board');
const Solver = require('./Solver.js');

class BestMoveFinder {
    constructor(dictionary) {
        this.dict = dictionary;
        this.board = new Board();
        this.solver = new Solver(this.dict);
        this.stack = [];
    }

    putLetterOnBoard(x, y, letter, isBlank = false) {
        //console.log("board",this.board)
        this.board.putWord([{letter:letter, isBlank:isBlank, isCurrent:false}], x, y, true);
        return this.board.getBoardState();
    }

    putLetterOnStack(letter) {
        this.stack.push(letter);
    }

    getSolution(number) {
        return this.solver.solve(this.board, this.stack)[number];
    }


}

module.exports = BestMoveFinder;
