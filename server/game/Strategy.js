/**
 * @class Strategy
 * @description Mózg komputerowego przeciwnika. Decyduje, czy położyć słowo,
 * czy wymienić litery, i który z możliwych ruchów zagrać.
 *
 * Wszystkie dane o literach (punkty, „użyteczność") pochodzą z trybu gry,
 * więc AI gra sensownie także na planszach ułożonych przez użytkowników.
 *
 * Poziomy trudności:
 * | poziom | nazwa    | zachowanie |
 * |--------|----------|------------|
 * | 1      | Łatwy    | gra słabsze zagrania z dolnej części listy, nie planuje stojaka |
 * | 2      | Średni   | wybiera najwięcej punktów spośród kilku najlepszych |
 * | 3      | Trudny   | waży punkty, otwieranie premii przeciwnikowi i jakość reszty stojaka |
 *
 * @example
 * const strategy = new Strategy(variant, 3);
 * const move = strategy.getBestMove(moves, board, stack, bagSize);
 * if (move.replace) console.log('Wymiana:', move.letters);
 * else console.log('Kładę', move.wordSimple, 'za', move.points, 'pkt');
 */

/** Samogłoski (z polskimi) — do oceny balansu stojaka. */
const VOWELS = new Set(['A', 'Ą', 'E', 'Ę', 'I', 'O', 'Ó', 'U', 'Y']);

/** Opisy poziomów trudności — używane w interfejsie. */
const LEVELS = {
    1: { name: 'Łatwy', poolSize: 40, strategic: false, skill: 0.35 },
    2: { name: 'Średni', poolSize: 12, strategic: false, skill: 1 },
    3: { name: 'Trudny', poolSize: 25, strategic: true, skill: 1 },
};

class Strategy {
    /**
     * @param {import('../variant/compile').CompiledVariant} variant - Skompilowany tryb gry
     * @param {number} [level=2] - Poziom trudności (1–3)
     * @throws {Error} Gdy nie podano trybu gry
     */
    constructor(variant, level = 2) {
        if (!variant) throw new Error('Strategy wymaga trybu gry (CompiledVariant).');

        this.variant = variant;
        this.level = LEVELS[level] ? level : 2;
        this.profile = LEVELS[this.level];

        /** Użyteczność liter: 1 = bardzo przydatna, 5 = balast. */
        this.usefulness = variant.usefulness;

        /** Poniżej tylu punktów AI rozważa wymianę zamiast zagrania. */
        this.pointsThreshold = 25;

        /** Wagi oceny strategicznej. */
        this.exposureWeight = 1.0;
        this.leaveWeight = 0.6;

        /** Kara za odsłonięcie pustego pola premiowego przy naszym słowie. */
        this.premiumWeights = { w4: 9, w3: 6, w2: 3, l4: 3, l3: 2, l2: 1 };

        /** Litery uznawane za balast (użyteczność 4–5). */
        this.heavyLetters = new Set(
            Object.entries(this.usefulness)
                .filter(([letter, value]) => value >= 4 && letter !== variant.blankSymbol)
                .map(([letter]) => letter),
        );

        /** Ile jednostek balastu uzasadnia wymianę przy słabym ruchu. */
        this.deadweightThreshold = 2;
    }

    /**
     * Wybiera ruch: zagranie słowa albo wymianę liter.
     * @param {Array<object>} moves - Ruchy posortowane malejąco wg punktów
     * @param {import('../board/Board')} board - Aktualna plansza
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {object} Ruch z solvera albo `{ replace: true, letters: string[] }`
     */
    getBestMove(moves, board, stack, bagSize = Infinity) {
        if (this.replaceDecision(moves, stack, bagSize)) {
            return { replace: true, letters: this.pickTilesToExchange(stack) };
        }
        return this.pickStrategicMove(moves, board, stack);
    }

    /**
     * Wybiera konkretne zagranie z listy kandydatów zgodnie z poziomem trudności.
     * @param {Array<object>} moves - Ruchy posortowane malejąco wg punktów
     * @param {import('../board/Board')} board - Plansza
     * @param {string[]} stack - Stojak gracza
     * @returns {object} Wybrany ruch
     */
    pickStrategicMove(moves, board, stack) {
        if (moves.length === 0) return null;

        // Łatwy poziom celowo nie gra najlepszego zagrania — sięga po ruch
        // z okolic wskazanego percentyla listy, żeby dać człowiekowi szansę.
        if (this.profile.skill < 1) {
            const pool = moves.slice(0, Math.max(1, Math.min(this.profile.poolSize, moves.length)));
            const idx = Math.min(pool.length - 1, Math.floor(pool.length * (1 - this.profile.skill)));
            return pool[idx];
        }

        if (!this.profile.strategic) {
            return moves[0];
        }

        const n = Math.min(this.profile.poolSize, moves.length);
        let best = moves[0];
        let bestScore = -Infinity;

        for (let i = 0; i < n; i++) {
            const move = moves[i];
            const exposure = this.computeExposurePenalty(move, board);
            const leave = this.computeLeave(stack, move.usedLetters);
            const score = move.points
                - this.exposureWeight * exposure
                + this.leaveWeight * this.leaveScore(leave);

            if (score > bestScore) {
                bestScore = score;
                best = move;
            }
        }
        return best;
    }

    /**
     * Kara za odsłonięcie pustych pól premiowych sąsiadujących z naszym słowem —
     * czyli za podanie przeciwnikowi drogi do wysokiej premii.
     * @param {object} move - Ruch z solvera
     * @param {import('../board/Board')} board - Plansza
     * @returns {number} Sumaryczna kara (0 = ruch nic nie otwiera)
     */
    computeExposurePenalty(move, board) {
        if (!board || !move || !Array.isArray(move.word)) return 0;

        const size = board.size;
        const tiles = board.getTiles();
        const seen = new Set();
        let penalty = 0;

        for (let i = 0; i < move.word.length; i++) {
            const cell = move.word[i];
            if (!cell || !cell.isCurrent) continue; // liczą się tylko nowe litery

            const x = move.horizontal ? move.x + i : move.x;
            const y = move.horizontal ? move.y : move.y + i;

            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                if (tiles[nx][ny].letter) continue; // zajęte pole nie jest otwarciem

                const key = nx * size + ny;
                if (seen.has(key)) continue;
                seen.add(key);
                penalty += this.premiumWeight(board.getBonus(nx, ny));
            }
        }
        return penalty;
    }

    /**
     * Waga kary za dane pole premiowe.
     * @param {{w: number, l: number}} bonus - Mnożniki pola
     * @returns {number} 0 dla pola bez premii
     */
    premiumWeight(bonus) {
        if (!bonus) return 0;
        if (bonus.w >= 4) return this.premiumWeights.w4;
        if (bonus.w >= 3) return this.premiumWeights.w3;
        if (bonus.w >= 2) return this.premiumWeights.w2;
        if (bonus.l >= 4) return this.premiumWeights.l4;
        if (bonus.l >= 3) return this.premiumWeights.l3;
        if (bonus.l >= 2) return this.premiumWeights.l2;
        return 0;
    }

    /**
     * Litery pozostające na stojaku po zagraniu ruchu.
     * @param {string[]} stack - Stojak gracza
     * @param {string[]} usedLetters - Litery zużyte przez ruch (blank jako `*`)
     * @returns {string[]} Reszta stojaka
     */
    computeLeave(stack, usedLetters) {
        const leave = [...stack];
        for (const letter of usedLetters || []) {
            const idx = leave.indexOf(letter);
            if (idx !== -1) leave.splice(idx, 1);
        }
        return leave;
    }

    /**
     * Ocenia jakość liter zostających na stojaku (wyżej = lepiej).
     * Premiuje blanki i równowagę samogłosek, karze balast i duplikaty.
     * @param {string[]} leave - Reszta stojaka
     * @returns {number} Ocena (może być ujemna)
     */
    leaveScore(leave) {
        let score = 0;
        let vowels = 0;
        let consonants = 0;
        const counts = {};

        for (const letter of leave) {
            counts[letter] = (counts[letter] || 0) + 1;
            if (letter === this.variant.blankSymbol) { score += 3; continue; }
            if (VOWELS.has(letter)) vowels++; else consonants++;
            if (this.heavyLetters.has(letter)) score -= 2;
        }

        score -= Math.abs(vowels - consonants);

        for (const [letter, count] of Object.entries(counts)) {
            if (letter === this.variant.blankSymbol) continue;
            if (count >= 3) score -= count - 2;
        }

        return score;
    }

    /**
     * Wybiera litery do wymiany: najpierw balast, potem duplikaty.
     * Blanki nigdy nie idą do wymiany.
     * @param {string[]} stack - Stojak gracza
     * @returns {string[]} Litery do wymiany (może być pusta tablica)
     */
    pickTilesToExchange(stack) {
        const blank = this.variant.blankSymbol;
        const candidates = stack
            .filter(letter => letter !== blank)
            .map(letter => ({ letter, weight: this.usefulness[letter] || 3 }))
            .sort((a, b) => b.weight - a.weight);

        const maxExchange = Math.max(1, Math.min(stack.length - 1, this.variant.rackSize - 2));
        const result = [];

        for (const { letter, weight } of candidates) {
            // Balast (4–5) wymieniamy zawsze, resztę tylko do wypełnienia limitu.
            if (weight >= 4 || result.length < maxExchange) result.push(letter);
            if (result.length >= maxExchange) break;
        }
        return result;
    }

    /**
     * Liczy balast na stojaku: ciężkie litery i nadmiarowe duplikaty.
     * @param {string[]} stack - Stojak gracza
     * @returns {number} Liczba jednostek balastu
     */
    countDeadweight(stack) {
        let dead = 0;
        const counts = {};
        for (const letter of stack) {
            counts[letter] = (counts[letter] || 0) + 1;
            if (this.heavyLetters.has(letter)) dead++;
        }
        for (const [letter, count] of Object.entries(counts)) {
            if (letter === this.variant.blankSymbol) continue;
            if (count >= 3) dead += count - 2;
        }
        return dead;
    }

    /**
     * Czy warto wymienić litery zamiast grać najlepszy ruch.
     * Wymiana ma sens tylko przy pełnym stojaku, zapasie w worku, słabym
     * najlepszym ruchu i realnym balaście na stojaku.
     * @param {Array<object>} moves - Dostępne ruchy (posortowane malejąco)
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {boolean}
     */
    replaceDecision(moves, stack, bagSize = Infinity) {
        if (stack.length < this.variant.rackSize) return false;
        if (bagSize < this.variant.rules.exchangeMinBag) return false;
        if (bagSize <= 0) return false;
        if (moves.length > 0 && moves[0].points >= this.pointsThreshold) return false;
        return this.countDeadweight(stack) >= this.deadweightThreshold;
    }
}

module.exports = Strategy;
module.exports.LEVELS = LEVELS;
