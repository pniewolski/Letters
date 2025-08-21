const Board = require("../board/Board");
const DrawstringBag = require("../board/DrawstringBag");

class Table {
    constructor() {
        this.board = new Board();
        this.bag = new DrawstringBag();
        this.points = [0,0];
        this.stack = [[],[]];
        this.playerTurn = 0;
        this.currentTurn = 0;

        this.prepareStacks();
    }

    prepareStacks() {
        this.stack[0] = this.bag.draw(7);
        this.stack[1] = this.bag.draw(7);
        console.log("Stacky zainicjowane",this.stack);
    }

    deleteFromStack(player,letters) {
        letters.forEach(letter => {
            const index = this.stack[player].findIndex(l => l === letter);
            if (index == -1) {
                throw new Error("Brak szukanej litery w stacku");
            }
            this.stack[player].splice(index, 1)[0]; // Usuwamy i przechowujemy element
        });
    }

    //podajemy użyte litery, zabierane są ze stacka i losowane nowe
    updateStack(player, letters) {
        this.deleteFromStack(player,letters);
        let len = letters.length;
        if (len > this.bag.getBagSize()) {
            len = this.bag.getBagSize();
        }
        if (len === 0) {
            return;
        }
        let newLetters = this.bag.draw(len);
        this.stack[player].push(...newLetters);
    }

    replaceLetters(player, letters) {
        const len = letters.length;
        if (len>this.bag.getBagSize()) {
            return [];
        }
        let newLetters = this.bag.replace(letters);
        this.deleteFromStack(player,letters);
        this.stack[player].push(...newLetters);
    }

    applyMove(player, move) {
        this.board.putWord(move.word, move.x, move.y, move.horizontal);
        this.updateStack(player, move.usedLetters);
        this.currentTurn += 1;
        this.points[player] += move.points;
    }
}

module.exports = Table;
