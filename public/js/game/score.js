/**
 * @file score.js
 * @description Wycena układanego ruchu — ile punktów da słowo, zanim gracz je
 * zatwierdzi.
 *
 * Liczy tak samo jak serwer (`Game.humanMove` + `Solver.prepareSingleResult`):
 * słowo główne z literami dookoła, słowa prostopadłe, premie pól tylko pod
 * nowymi klockami i premia za wyłożenie stojaka. Słownika **nie** sprawdza —
 * to zostaje tajemnicą do zatwierdzenia. Ostateczny wynik zawsze podaje serwer.
 */

import { store } from '../store.js';
import { pointsOf, bonusAt } from './board.js';

/**
 * Wycenia klocki położone w tej turze.
 * @returns {{points: number, words: string[], bingo: boolean}|{error: string}|null}
 *   `null`, gdy nic nie leży; `{ error }`, gdy układ łamie reguły ruchu.
 *
 * @example
 * const quote = quoteMove();
 * if (quote && !quote.error) console.log(`${quote.points} pkt`);
 */
export function quoteMove() {
    const game = store.game;
    const tiles = store.placed;
    if (!game || tiles.length === 0) return null;

    const variant = game.variant;
    const size = variant.size;
    const rules = variant.rules || {};

    const letterAt = (x, y) => {
        if (x < 0 || y < 0 || x >= size || y >= size) return null;
        const placed = tiles.find(t => t.x === x && t.y === y);
        if (placed) return { letter: placed.letter, isBlank: placed.isBlank, current: true };
        const lying = game.board[x][y];
        return lying.letter ? { letter: lying.letter, isBlank: lying.isBlank, current: false } : null;
    };
    const lyingAt = (x, y) => x >= 0 && y >= 0 && x < size && y < size && !!game.board[x][y].letter;

    // ── Kierunek ─────────────────────────────────────────────────────────────
    const sameX = tiles.every(t => t.x === tiles[0].x);
    const sameY = tiles.every(t => t.y === tiles[0].y);
    if (!sameX && !sameY) return { error: 'Litery muszą leżeć w jednej linii.' };

    let horizontal = sameY;
    if (tiles.length === 1) {
        // Jak na serwerze: kierunek, w którym powstaje dłuższe słowo.
        const run = (dx, dy) => {
            let len = 1;
            for (const sign of [1, -1]) {
                for (let i = 1; lyingAt(tiles[0].x + dx * i * sign, tiles[0].y + dy * i * sign); i++) len++;
            }
            return len;
        };
        horizontal = run(1, 0) >= run(0, 1);
    }

    const pos = t => (horizontal ? t.x : t.y);
    const line = horizontal ? tiles[0].y : tiles[0].x;
    const cellOf = p => (horizontal ? [p, line] : [line, p]);

    // ── Ciągłość i rozszerzenie o litery leżące obok ─────────────────────────
    let start = Math.min(...tiles.map(pos));
    let end = Math.max(...tiles.map(pos));
    for (let p = start; p <= end; p++) {
        if (!letterAt(...cellOf(p))) return { error: 'Słowo musi być ciągłe — bez przerw.' };
    }
    while (start > 0 && lyingAt(...cellOf(start - 1))) start--;
    while (end < size - 1 && lyingAt(...cellOf(end + 1))) end++;

    if (end - start + 1 < (rules.minWordLength || 1)) {
        return { error: `Słowo musi mieć co najmniej ${rules.minWordLength} liter.` };
    }

    // ── Pierwszy ruch: pole startowe. Kolejne: styk z literami na planszy ────
    const firstMove = !game.board.some(col => col.some(t => t.letter));
    if (firstMove) {
        const coversStart = tiles.some(t => bonusAt(t.x, t.y).start);
        if (rules.firstMoveMustCoverStart !== false && !coversStart) {
            return { error: 'Pierwsze słowo musi przechodzić przez pole startowe.' };
        }
    } else {
        let touches = false;
        for (let p = start; p <= end && !touches; p++) {
            const [cx, cy] = cellOf(p);
            touches = lyingAt(cx, cy) || lyingAt(cx - 1, cy) || lyingAt(cx + 1, cy)
                || lyingAt(cx, cy - 1) || lyingAt(cx, cy + 1);
        }
        if (!touches) return { error: 'Słowo musi stykać się z literami leżącymi na planszy.' };
    }

    // ── Punkty ───────────────────────────────────────────────────────────────
    const value = t => pointsOf(t.letter, t.isBlank);

    let word = '';
    let base = 0;
    let wordMul = 1;
    let extra = 0;
    const words = [];

    for (let p = start; p <= end; p++) {
        const [x, y] = cellOf(p);
        const t = letterAt(x, y);
        word += t.letter;

        if (!t.current) { base += value(t); continue; }

        const bonus = bonusAt(x, y);
        wordMul *= bonus.w;
        base += value(t) * bonus.l;

        // Słowo prostopadłe przez nowy klocek.
        const [dx, dy] = horizontal ? [0, 1] : [1, 0];
        let cross = t.letter;
        let crossPts = value(t) * bonus.l;
        for (let j = 1; lyingAt(x + dx * j, y + dy * j); j++) {
            const n = game.board[x + dx * j][y + dy * j];
            cross += n.letter;
            crossPts += value(n);
        }
        for (let j = 1; lyingAt(x - dx * j, y - dy * j); j++) {
            const n = game.board[x - dx * j][y - dy * j];
            cross = n.letter + cross;
            crossPts += value(n);
        }
        if (cross.length > 1) {
            extra += crossPts * bonus.w;
            words.push(cross);
        }
    }

    const bingo = tiles.length >= (variant.bingo?.tiles ?? Infinity);
    const points = base * wordMul + extra + (bingo ? variant.bingo.bonus : 0);
    return { points, words: [word, ...words], bingo };
}
