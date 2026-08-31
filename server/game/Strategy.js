/**
 * @class Strategy
 * @description Mózg komputerowego przeciwnika.
 *
 * Samo „zagraj najwięcej punktów" to za mało: w grze słownej liczy się też,
 * **co zostaje na stojaku** i **jak wygląda końcówka**. Te dwie rzeczy ważymy
 * obok surowych punktów.
 *
 * ## Co składa się na ocenę zagrania
 *
 * | składnik | co mierzy |
 * |----------|-----------|
 * | punkty | ile daje samo zagranie |
 * | reszta stojaka | czy zostają litery, którymi da się grać dalej |
 * | obrót klockami | przy kończącym się worku warto grać więcej liter naraz |
 * | końcówka | przy pustym worku liczy się wyjście z liter, nie punkty za ruch |
 *
 * Żadna waga nie jest wpisana na sztywno w punktach — wszystkie skalują się
 * wartościami z trybu gry (średnia wartość klocka, wielkość stojaka). Dzięki
 * temu AI gra sensownie także na planszach ułożonych przez graczy i z zestawami
 * klocków, których autor nigdy nie widział.
 *
 * ## Poziomy trudności
 *
 * | poziom | nazwa | zachowanie |
 * |--------|-------|------------|
 * | 1 | Łatwy | celowo sięga po słabsze zagrania z listy |
 * | 2 | Średni | gra po prostu najwięcej punktów — tak, jak liczy większość ludzi |
 * | 3 | Trudny | dokłada ocenę reszty stojaka i grę pod końcówkę |
 *
 * ## Czego tu nie ma i dlaczego
 *
 * Wagi i pomysły sprawdzano narzędziem `npm run ai:duel`, które rozgrywa
 * **pary** partii na tym samym losowaniu worka z zamienionymi stronami — bez
 * tego szczęście przy dobieraniu liter zagłusza każdą różnicę umiejętności.
 *
 * Zmierzone i **zostawione**:
 * - ocena reszty stojaka: +32 pkt na partię wobec samych punktów (300 partii),
 * - cała drabinka: Trudny bije Średniego o +45 pkt (Literki) i +28 pkt (SCR)
 *   na 800 partiach, Średni bije Łatwego o ponad 700 pkt.
 *
 * Zmierzone i **odrzucone** — każde z nich brzmi mądrze, ale nie wygrywa partii:
 * - wycena pojedynczych liter (przez częstość w słowniku, przez punktację,
 *   przez „użyteczność" z trybu gry): od −29 pkt do zera,
 * - kara za otwieranie przeciwnikowi pól premiowych: +0,7 ±8,9 pkt na 1000 partii,
 * - zamykanie planszy przy prowadzeniu: −0,7 ±6,3 pkt na 1000 partii,
 * - symulacja odpowiedzi przeciwnika (jeden ruch w przód, losowanie jego
 *   stojaka z liter niewidzianych): −0,6 i +10,5 pkt przy 15-krotnie wyższym
 *   koszcie ruchu. Przy jednym ruchu w przód najlepsza odpowiedź przeciwnika
 *   zależy głównie od jego liter, a nie od tego, które z naszych zagrań
 *   wybierzemy — więc składnik jest prawie stały i wnosi głównie szum.
 *   Zrobienie tego porządnie (dwa ruchy w przód, setki losowań) kosztowałoby
 *   sekundy na ruch, co przy wielu stołach naraz jest nie do przyjęcia.
 *
 * Jeśli wracasz do któregoś z tych pomysłów — najpierw pomiar, potem kod.
 *
 * @example
 * const strategy = new Strategy(variant, 3);
 * const move = strategy.getBestMove(moves, board, stack, { bagSize: 30 });
 * if (move.replace) console.log('Wymiana:', move.letters);
 * else console.log('Kładę', move.wordSimple, 'za', move.points, 'pkt');
 */

/** Samogłoski (z polskimi) — do oceny balansu stojaka. */
const VOWELS = new Set(['A', 'Ą', 'E', 'Ę', 'I', 'O', 'Ó', 'U', 'Y']);

/**
 * Profile poziomów trudności.
 * - `poolSize` — ile najlepszych punktowo zagrań poddajemy ocenie,
 * - `skill` — 1 = gra najlepszy wybór, mniej = celowo sięga niżej,
 * - `leave` — czy ocenia resztę stojaka i końcówkę.
 */
const LEVELS = {
    1: { name: 'Łatwy', poolSize: 40, skill: 0.35, leave: false },
    2: { name: 'Średni', poolSize: 8, skill: 1, leave: false },
    3: { name: 'Trudny', poolSize: 24, skill: 1, leave: true },
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

        // Kopia, nie referencja: `LEVELS` jest współdzielone przez wszystkie
        // partie w procesie, więc podmiana pola w profilu jednego stołu
        // przestawiłaby poziom trudności wszystkim naraz.
        this.profile = { ...LEVELS[this.level] };

        /** Użyteczność liter z trybu gry: 1 = bardzo przydatna, 5 = balast. */
        this.usefulness = variant.usefulness;

        this._prepareScales();
        this._prepareLeaveValues();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRZYGOTOWANIE WAG
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wylicza skale zależne od trybu gry. Bez tego wagi dobrane pod jeden
     * zestaw klocków rozjeżdżałyby się na planszach z 12-punktowymi literami.
     * @private
     */
    _prepareScales() {
        const letters = Object.entries(this.variant.letterCounts)
            .filter(([letter]) => letter !== this.variant.blankSymbol);

        const tiles = letters.reduce((sum, [, count]) => sum + count, 0) || 1;
        const points = letters.reduce(
            (sum, [letter, count]) => sum + count * this.variant.pointsOf(letter), 0,
        );

        /** Średnia wartość klocka w tym trybie. */
        this.avgTilePoints = points / tiles;
        /** Orientacyjna wartość przyzwoitego zagrania — punkt odniesienia dla kar. */
        this.typicalPlay = Math.max(8, this.avgTilePoints * this.variant.rackSize * 0.9);
        /** Poniżej tylu punktów prostsze poziomy rozważają wymianę zamiast zagrania. */
        this.exchangeThreshold = Math.round(this.typicalPlay * 0.7);

        /** Wagi składników oceny (patrz opis klasy — dobrane pomiarem). */
        this.weights = {
            leave: 1.0,
            tileTurnover: 0.4,
        };
    }

    /**
     * Przygotowuje ocenę pojedynczych liter na stojaku.
     *
     * Świadomie **niewiele tu jest** — wycena każdej litery z osobna nie
     * przeszła pomiaru (patrz opis klasy). Liczy się struktura stojaka:
     * blank, balans samogłosek i brak duplikatów.
     * @private
     */
    _prepareLeaveValues() {
        /** @type {Object<string, number>} Litera → wartość na stojaku. */
        this.leaveValue = Object.create(null);

        // Blank jest wart tyle, co porządne zagranie — nie wolno go marnować.
        this.leaveValue[this.variant.blankSymbol] = 8;

        /** Litery uznawane za balast (użyteczność 4–5 wg trybu gry). */
        this.heavyLetters = new Set(
            Object.entries(this.usefulness)
                .filter(([letter, value]) => value >= 4 && letter !== this.variant.blankSymbol)
                .map(([letter]) => letter),
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WYBÓR RUCHU
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wybiera ruch: zagranie słowa albo wymianę liter.
     * @param {Array<object>} moves - Ruchy posortowane malejąco wg punktów
     * @param {import('../board/Board')} board - Aktualna plansza
     * @param {string[]} stack - Stojak gracza
     * @param {object|number} [context] - `{ bagSize }`; dla wygody przyjmuje
     *   też samą liczbę liter w worku
     * @returns {object|null} Ruch z solvera albo `{ replace: true, letters: string[] }`
     */
    getBestMove(moves, board, stack, context = {}) {
        const ctx = typeof context === 'number' ? { bagSize: context } : (context || {});
        const bagSize = ctx.bagSize ?? Infinity;

        if (this.replaceDecision(moves, stack, bagSize)) {
            return { replace: true, letters: this.pickTilesToExchange(stack, bagSize) };
        }
        return this.pickStrategicMove(moves, board, stack, bagSize);
    }

    /**
     * Ocenia kandydatów i wybiera najlepszego zgodnie z poziomem trudności.
     * @param {Array<object>} moves - Ruchy posortowane malejąco wg punktów
     * @param {import('../board/Board')} board - Plansza
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {object|null} Wybrany ruch
     */
    pickStrategicMove(moves, board, stack, bagSize = Infinity) {
        if (!moves || moves.length === 0) return null;

        // Łatwy poziom celowo nie gra najlepszego zagrania — sięga po ruch
        // z okolic wskazanego percentyla listy, żeby dać człowiekowi szansę.
        if (this.profile.skill < 1) {
            const pool = moves.slice(0, Math.max(1, Math.min(this.profile.poolSize, moves.length)));
            const idx = Math.min(pool.length - 1, Math.floor(pool.length * (1 - this.profile.skill)));
            return pool[idx];
        }

        // Bez oceny stojaka nie ma czego ważyć — najlepszy punktowo wygrywa.
        if (!this.profile.leave) return moves[0];

        const candidates = this._shortlist(moves);
        if (candidates.length === 1) return candidates[0];

        let best = candidates[0];
        let bestScore = -Infinity;

        for (const move of candidates) {
            const score = this._scoreMove(move, stack, bagSize);
            if (score > bestScore) {
                bestScore = score;
                best = move;
            }
        }
        return best;
    }

    /**
     * Wybiera zagrania warte oceny. Bierzemy najlepsze punktowo, ale usuwamy
     * powtórzenia tego samego słowa w tym samym miejscu — inaczej lista potrafi
     * być zapchana wariantami jednego pomysłu.
     * @param {Array<object>} moves
     * @returns {Array<object>}
     * @private
     */
    _shortlist(moves) {
        const seen = new Set();
        const out = [];

        for (const move of moves) {
            const key = `${move.wordSimple}|${move.x}|${move.y}|${move.horizontal}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(move);
            if (out.length >= this.profile.poolSize) break;
        }
        return out;
    }

    /**
     * Ocena zagrania: punkty plus to, co zostaje na stojaku.
     * @param {object} move - Ruch z solvera
     * @param {string[]} stack - Stojak gracza
     * @param {number} bagSize - Liczba liter w worku
     * @returns {number}
     * @private
     */
    _scoreMove(move, stack, bagSize) {
        const leave = this.computeLeave(stack, move.usedLetters);
        let score = move.points + this.weights.leave * this.leaveScore(leave, bagSize);

        // Końcówka: kto pierwszy wyjdzie z liter, ten zgarnia resztę. Warto
        // więc zwiększać obrót klockami, gdy worek się kończy.
        if (bagSize > 0 && bagSize < this.variant.rackSize * 2) {
            score += this.weights.tileTurnover * (move.usedLetters?.length || 0);
        }

        return score;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // OCENA RESZTY STOJAKA
    // ─────────────────────────────────────────────────────────────────────────

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
     *
     * Przy pełnym worku liczy się grywalność i balans. Przy pustym reguły się
     * odwracają: każda litera zostająca w ręku to punkty w plecy, a wyjście
     * z liter zgarnia resztę od przeciwników.
     *
     * @param {string[]} leave - Reszta stojaka
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {number} Ocena (może być ujemna)
     */
    leaveScore(leave, bagSize = Infinity) {
        // ── Końcówka: liczy się wyjście z liter, nie ich jakość ─────────────
        if (bagSize === 0) {
            if (leave.length === 0) {
                // Wyjście zdejmuje nasze punkty karne i dokłada cudze.
                return this.variant.rules.endgameOutBonus ? this.typicalPlay : this.avgTilePoints * 3;
            }
            const stuck = leave.reduce((sum, letter) => sum + this.variant.pointsOf(letter), 0);
            return -2 * stuck - leave.length;
        }

        let score = 0;
        let vowels = 0;
        let consonants = 0;
        const counts = {};

        for (const letter of leave) {
            counts[letter] = (counts[letter] || 0) + 1;
            score += this.leaveValue[letter] ?? 0;
            if (letter === this.variant.blankSymbol) continue;
            if (VOWELS.has(letter)) vowels++; else consonants++;
        }

        // Stojak bez samogłosek albo bez spółgłosek jest praktycznie nie do zagrania.
        const total = vowels + consonants;
        if (total >= 3) {
            if (vowels === 0 || consonants === 0) score -= 8;
            else score -= 1.5 * Math.max(0, Math.abs(vowels - consonants) - 1);
        }

        // Duplikaty rzadko dają się zagrać razem.
        for (const [letter, count] of Object.entries(counts)) {
            if (letter === this.variant.blankSymbol) continue;
            if (count >= 2) score -= 1.5 * (count - 1);
        }

        return score;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WYMIANA LITER
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wybiera litery do wymiany, przeszukując **wszystkie podzbiory stojaka**
     * i zostawiając ten, który daje najlepszą resztę. Stojak ma kilka liter,
     * więc pełny przegląd jest tani, a wynik dużo lepszy niż odsiewanie
     * balastu po kolei.
     *
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Ile liter da się wymienić
     * @returns {string[]} Litery do wymiany (może być pusta tablica)
     */
    pickTilesToExchange(stack, bagSize = Infinity) {
        const maxExchange = Math.min(stack.length, bagSize === Infinity ? stack.length : bagSize);
        if (maxExchange <= 0) return [];

        // Pełny przegląd tylko dla rozsądnych stojaków; przy większych
        // wracamy do prostego odsiewania balastu.
        if (stack.length > 12) return this._exchangeByUsefulness(stack, maxExchange);

        let best = { letters: [], score: -Infinity };

        for (let mask = 1; mask < (1 << stack.length); mask++) {
            const out = [];
            const keep = [];
            for (let i = 0; i < stack.length; i++) {
                if (mask & (1 << i)) out.push(stack[i]);
                else keep.push(stack[i]);
            }
            if (out.length > maxExchange) continue;

            // Nowe litery też coś wnoszą — im więcej wymieniamy, tym większa
            // szansa na poprawę, ale i tym więcej oddajemy w ciemno.
            const score = this.leaveScore(keep) + out.length * 0.4;
            if (score > best.score) best = { letters: out, score };
        }

        return best.letters;
    }

    /**
     * Zapasowy wybór liter do wymiany — po prostu największy balast.
     * @param {string[]} stack
     * @param {number} maxExchange
     * @returns {string[]}
     * @private
     */
    _exchangeByUsefulness(stack, maxExchange) {
        return stack
            .filter(letter => letter !== this.variant.blankSymbol)
            .sort((a, b) => (this.usefulness[b] || 3) - (this.usefulness[a] || 3))
            .slice(0, maxExchange);
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
     *
     * Porównujemy wartość najlepszego zagrania (punkty plus to, co po nim
     * zostaje) z wartością samej poprawy stojaka. Wymiana kosztuje całą turę,
     * więc musi się naprawdę opłacać.
     *
     * @param {Array<object>} moves - Dostępne ruchy (posortowane malejąco)
     * @param {string[]} stack - Stojak gracza
     * @param {number} [bagSize=Infinity] - Liczba liter w worku
     * @returns {boolean}
     */
    replaceDecision(moves, stack, bagSize = Infinity) {
        if (bagSize < this.variant.rules.exchangeMinBag) return false;
        if (bagSize <= 0) return false;

        // Bez żadnego ruchu wymiana jest jedyną sensowną opcją.
        if (!moves || moves.length === 0) return true;

        // Prostsze poziomy nie kombinują ze stojakiem.
        if (!this.profile.leave) {
            return stack.length >= this.variant.rackSize
                && moves[0].points < this.exchangeThreshold
                && this.countDeadweight(stack) >= 2;
        }

        const best = moves[0];
        const playValue = best.points
            + this.weights.leave * this.leaveScore(this.computeLeave(stack, best.usedLetters), bagSize);

        const exchanged = this.pickTilesToExchange(stack, bagSize);
        if (exchanged.length === 0) return false;

        const keep = this.computeLeave(stack, exchanged);
        const exchangeValue = this.weights.leave * this.leaveScore(keep, bagSize);

        // Zagranie musi być wyraźnie gorsze — inaczej lepiej utrzymać tempo.
        return playValue < exchangeValue - this.avgTilePoints;
    }
}

module.exports = Strategy;
module.exports.LEVELS = LEVELS;
