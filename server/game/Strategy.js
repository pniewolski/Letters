class Strategy {

    getBestMove(moves, board, stack) {
        if (Math.random()<0.1) {
            let replace = [];
            stack.forEach(l => {
                if (Math.random()<0.5) replace.push(l);
            });
            return {
                replace: true,
                letters: replace
            }
        }
        return moves[0];
    }
}

module.exports = Strategy;
