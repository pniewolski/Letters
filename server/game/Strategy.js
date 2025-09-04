const fs = require('fs');

class Strategy {

    constructor() {
        const lettersJson = fs.readFileSync('letters.json', 'utf-8');
        this.usefulness = JSON.parse(lettersJson).usefulness;

        this.pointsThreshold = 25;
    }

    getBestMove(moves, board, stack) {
        if (this.replaceDecision(moves)) {
            let replace = this.pickTilesToExchange(stack);
            console.log("!!!!!!!!!!!!!!!! replace", replace);
            return {
                replace: true,
                letters: replace
            }
        }
        return moves[0];
    }

    pickTilesToExchange(stack) {
        let replace = [[], [], [], [], [], []];
        let result = [];
        stack.forEach(l => {
            for (const [value, letters] of Object.entries(this.usefulness)) {
                if (letters.includes(l)) {
                    replace[parseInt(value)].push(l);
                }
            }
        });

        let used = 0;
        for (let i=5 ; i>0 ; i--) {
            replace[i].forEach(l => {
                if (used < 5) {
                    result.push(l);
                } else if (i > 3) {
                    result.push(l);
                }
                used++;
            });
        }

        return result;
    }

    replaceDecision(moves) {
        if (moves[0].points < this.pointsThreshold) {
            return true;
        } else {
            return false;
        }
    }
}

module.exports = Strategy;
