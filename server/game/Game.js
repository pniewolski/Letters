const Table = require("./Table");
const Solver = require("../board/Solver");
const WordDictionary = require("../board/WordDictionary");
const Strategy = require("./Strategy");

class Game {
    constructor(dictionary) {
        this.dict = dictionary;
        this.solver = new Solver(this.dict);
        this.table = new Table();
        this.strategy = new Strategy();
    }

    computerMove(player) {
        let avaliableMoves = null;
        if (this.table.currentTurn === 0) {
            console.log("first move");
            avaliableMoves = this.solver.generateFirstWord(this.table.board, this.table.stack[player]);
        } else {
            avaliableMoves = this.solver.solve(this.table.board, this.table.stack[player]);
        }
        let move = this.strategy.getBestMove(avaliableMoves, this.table.board, this.table.stack[player]);
        if (move.replace) {
            console.log("replace");
            //this.table.updateStack(player,move.letters)
        } else {
            //console.log("move",move);
            this.table.applyMove(player, move);
        }

        this.table.board.consolePreviewBoard();
        console.log(this.table.points);
        console.log(this.table.bag.lettersBag);
    }

}

module.exports = Game;
