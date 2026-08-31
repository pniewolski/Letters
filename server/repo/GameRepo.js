/**
 * @class GameRepo
 * @description Zapis rozegranych partii i odczyt historii. Partia trafia do
 * bazy w chwili rozpoczęcia (żeby przetrwała restart) i jest domykana wynikiem
 * po zakończeniu.
 *
 * @example
 * const games = new GameRepo(db, stats);
 * const gameId = await games.start({ tableId, variant, mode, seats, rated, players });
 * await games.finish(gameId, { participants, moves });
 * await games.recentFor(userId);
 */

class GameRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     * @param {import('./StatsRepo')} stats - Repozytorium statystyk
     */
    constructor(db, stats) {
        this.db = db;
        this.stats = stats;
    }

    /**
     * Zapisuje rozpoczętą partię wraz z listą uczestników.
     * @param {object} data
     * @param {number|null} data.tableId - Stół, przy którym gra się toczy
     * @param {object} data.variant - Skompilowany tryb gry
     * @param {string} data.mode - `human` | `computer` | `compcomp`
     * @param {number} data.seats - Liczba miejsc
     * @param {boolean} data.rated - Czy partia jest rankingowa
     * @param {Array<{slot: number, userId: number|null, name: string, isComputer: boolean, isGuest: boolean}>} data.players
     * @returns {Promise<number>} Identyfikator partii
     */
    async start({ tableId, variant, mode, seats, rated, players }) {
        const now = Date.now();

        const gameId = await this.db.insert('games', {
            table_id: tableId ?? null,
            variant_id: variant.meta.id ?? 0,
            variant_name: variant.meta.name,
            mode,
            seats,
            rated: rated ? 1 : 0,
            status: 'playing',
            turns: 0,
            started_at: now,
            finished_at: null,
            moves: null,
        });

        for (const p of players) {
            await this.db.insert('game_participants', {
                game_id: gameId,
                slot: p.slot,
                user_id: p.userId ?? null,
                name: String(p.name || 'Gracz').slice(0, 32),
                is_computer: p.isComputer ? 1 : 0,
                is_guest: p.isGuest ? 1 : 0,
                score: 0,
                place: null,
                result: null,
                rating_before: null,
                rating_after: null,
                best_word: null,
                best_word_points: 0,
                bingos: 0,
            });
        }

        return gameId;
    }

    /**
     * Domyka partię: zapisuje wyniki, log ruchów i przelicza statystyki.
     * @param {number} gameId - Identyfikator partii
     * @param {object} data
     * @param {Array<object>} data.participants - Uczestnicy z wynikami
     * @param {Array<object>} [data.moves] - Log ruchów
     * @param {string} [data.reason] - Powód zakończenia
     * @returns {Promise<Map<number, {before: number, after: number}>>} Zmiany rankingu
     */
    async finish(gameId, { participants, moves = [], reason = 'out' }) {
        const game = await this.db.get('SELECT * FROM games WHERE id = ?', [gameId]);
        if (!game || game.status === 'finished') return new Map();

        const ratingChanges = await this.stats.applyGameResult(
            { id: gameId, rated: !!game.rated }, participants,
        );

        await this.db.transaction(async () => {
            for (const p of participants) {
                await this.db.update('game_participants', {
                    score: p.score,
                    place: p.place,
                    result: p.result,
                    rating_before: p.ratingBefore ?? null,
                    rating_after: p.ratingAfter ?? null,
                    best_word: p.bestWord || null,
                    best_word_points: p.bestWordPoints || 0,
                    bingos: p.bingos || 0,
                }, { game_id: gameId, slot: p.slot });
            }

            await this.db.update('games', {
                status: 'finished',
                turns: moves.length,
                finished_at: Date.now(),
                // Log trzymamy skrótowo — sam przebieg, bez stanu planszy.
                moves: JSON.stringify({
                    reason,
                    moves: moves.map(m => ({
                        n: m.n, s: m.slot, t: m.type, w: m.wordSimple || null,
                        x: m.x ?? null, y: m.y ?? null, h: m.horizontal ?? null,
                        p: m.points || 0, b: m.bingo || false,
                    })),
                }),
            }, { id: gameId });
        });

        return ratingChanges;
    }

    /**
     * Oznacza partię jako porzuconą (np. serwer wystartował po awarii).
     * @param {number} gameId
     * @returns {Promise<void>}
     */
    async abandon(gameId) {
        await this.db.run(
            "UPDATE games SET status = 'abandoned', finished_at = ? WHERE id = ? AND status = 'playing'",
            [Date.now(), gameId],
        );
    }

    /**
     * Sprząta po nieoczekiwanym restarcie: partie zostawione w trakcie
     * nie mają jak się dokończyć, więc zamykamy je zbiorczo.
     * @returns {Promise<number>} Liczba zamkniętych partii
     */
    async abandonOrphans() {
        const r = await this.db.run(
            "UPDATE games SET status = 'abandoned', finished_at = ? WHERE status = 'playing'",
            [Date.now()],
        );
        return r.changes;
    }

    /**
     * Ostatnie partie gracza.
     * @param {number} userId - Identyfikator gracza
     * @param {number} [limit=10] - Ile partii zwrócić
     * @returns {Promise<object[]>} Partie z przeciwnikami i wynikiem
     */
    async recentFor(userId, limit = 10) {
        const rows = await this.db.all(
            `SELECT g.id, g.variant_name, g.mode, g.seats, g.rated, g.finished_at,
                    p.score, p.place, p.result, p.rating_before, p.rating_after,
                    p.best_word, p.best_word_points
             FROM game_participants p JOIN games g ON g.id = p.game_id
             WHERE p.user_id = ? AND g.status = 'finished'
             ORDER BY g.finished_at DESC
             LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10))}`,
            [userId],
        );

        const out = [];
        for (const row of rows) {
            const rivals = await this.db.all(
                `SELECT slot, name, score, place, result, is_computer, user_id
                 FROM game_participants WHERE game_id = ? AND (user_id IS NULL OR user_id <> ?)
                 ORDER BY place ASC`,
                [row.id, userId],
            );
            out.push({
                gameId: row.id,
                variant: row.variant_name,
                mode: row.mode,
                seats: row.seats,
                rated: !!row.rated,
                finishedAt: row.finished_at,
                score: row.score,
                place: row.place,
                result: row.result,
                ratingDelta: row.rating_after != null && row.rating_before != null
                    ? row.rating_after - row.rating_before : null,
                bestWord: row.best_word,
                bestWordPoints: row.best_word_points,
                opponents: rivals.map(r => ({
                    userId: r.user_id,
                    name: r.name,
                    score: r.score,
                    isComputer: !!r.is_computer,
                })),
            });
        }
        return out;
    }

    /**
     * Ostatnie zakończone partie w całym serwisie (strona główna portalu).
     * @param {number} [limit=12]
     * @returns {Promise<object[]>}
     */
    async recentGlobal(limit = 12) {
        const rows = await this.db.all(
            `SELECT id, variant_name, mode, seats, finished_at FROM games
             WHERE status = 'finished'
             ORDER BY finished_at DESC
             LIMIT ${Math.max(1, Math.min(50, Number(limit) || 12))}`,
        );

        const out = [];
        for (const row of rows) {
            const players = await this.db.all(
                `SELECT name, score, place, is_computer, user_id
                 FROM game_participants WHERE game_id = ? ORDER BY place ASC`,
                [row.id],
            );
            out.push({
                gameId: row.id,
                variant: row.variant_name,
                mode: row.mode,
                seats: row.seats,
                finishedAt: row.finished_at,
                players: players.map(p => ({
                    userId: p.user_id,
                    name: p.name,
                    score: p.score,
                    place: p.place,
                    isComputer: !!p.is_computer,
                })),
            });
        }
        return out;
    }

    /**
     * Liczby zbiorcze serwisu — do nagłówka strony głównej.
     * @returns {Promise<{games: number, players: number, variants: number}>}
     */
    async siteStats() {
        return {
            games: Number(await this.db.scalar("SELECT COUNT(*) FROM games WHERE status = 'finished'")) || 0,
            players: Number(await this.db.scalar('SELECT COUNT(*) FROM users WHERE is_guest = 0')) || 0,
            variants: Number(await this.db.scalar('SELECT COUNT(*) FROM variants')) || 0,
        };
    }
}

module.exports = GameRepo;
