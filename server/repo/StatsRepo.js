/**
 * @class StatsRepo
 * @description Statystyki graczy, ranking i **skalpy** — czyli bilans starć
 * z konkretnymi przeciwnikami („kogo ilekroć pokonałem").
 *
 * Statystyki trzymamy zdenormalizowane (`user_stats`, `scalps`), bo są czytane
 * dużo częściej niż zapisywane, a profil ma się otwierać natychmiast.
 * Źródłem prawdy pozostają tabele `games` i `game_participants`.
 *
 * @example
 * const stats = new StatsRepo(db);
 * await stats.applyGameResult(gameId, participants);
 * await stats.profile(userId);   // statystyki + skalpy + ostatnie partie
 */

/** Współczynnik zmiany rankingu Elo. */
const ELO_K = 24;

/** Ranking startowy nowego konta. */
const ELO_START = 1000;

class StatsRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Oczekiwany wynik gracza A przeciw B wg Elo.
     * @param {number} ratingA
     * @param {number} ratingB
     * @returns {number} Wartość z zakresu 0–1
     */
    static expectedScore(ratingA, ratingB) {
        return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
    }

    /**
     * Liczy nowe rankingi dla wszystkich uczestników.
     * Przy więcej niż dwóch graczach każdy porównywany jest z każdym,
     * a zmiany są uśredniane — dzięki temu stoły 3- i 4-osobowe nie rozdmuchują
     * rankingu bardziej niż pojedynki.
     *
     * @param {Array<{userId: number, rating: number, place: number}>} players - Uczestnicy z miejscami
     * @returns {Map<number, number>} userId → nowy ranking
     */
    static computeElo(players) {
        const rated = players.filter(p => p.userId != null);
        const out = new Map();
        if (rated.length < 2) return out;

        for (const player of rated) {
            let delta = 0;
            for (const rival of rated) {
                if (rival === player) continue;
                const actual = player.place < rival.place ? 1 : (player.place === rival.place ? 0.5 : 0);
                delta += ELO_K * (actual - StatsRepo.expectedScore(player.rating, rival.rating));
            }
            delta /= (rated.length - 1);
            out.set(player.userId, Math.max(100, Math.round(player.rating + delta)));
        }
        return out;
    }

    /**
     * Nanosi wynik zakończonej partii: statystyki, skalpy i ranking.
     * Goście liczą się do skalpów przeciwnika, ale sami nie wpływają na ranking.
     *
     * @param {object} game - Dane partii `{ id, rated }`
     * @param {Array<object>} participants - Uczestnicy z wynikami:
     *   `{ slot, userId, isComputer, isGuest, score, place, result, bestWord, bestWordPoints, bingos }`
     * @returns {Promise<Map<number, {before: number, after: number}>>} Zmiany rankingu
     */
    async applyGameResult(game, participants) {
        const now = Date.now();
        const humans = participants.filter(p => p.userId != null);

        // ── Ranking (tylko partie rankingowe między zarejestrowanymi kontami) ─
        const ratedPlayers = participants.filter(p => p.userId != null && !p.isGuest && !p.isComputer);
        let newRatings = new Map();

        if (game.rated && ratedPlayers.length >= 2) {
            const withRating = [];
            for (const p of ratedPlayers) {
                const rating = Number(await this.db.scalar('SELECT rating FROM users WHERE id = ?', [p.userId])) || ELO_START;
                withRating.push({ userId: p.userId, rating, place: p.place });
                p.ratingBefore = rating;
            }
            newRatings = StatsRepo.computeElo(withRating);
        }

        const changes = new Map();

        await this.db.transaction(async () => {
            for (const p of humans) {
                const isWin = p.result === 'win';
                const isDraw = p.result === 'draw';

                // ── Statystyki zbiorcze ─────────────────────────────────────
                const current = await this.db.get('SELECT * FROM user_stats WHERE user_id = ?', [p.userId]);
                const prev = current || {
                    games: 0, wins: 0, losses: 0, draws: 0, points_total: 0, points_best: 0,
                    best_word: null, best_word_points: 0, bingos: 0, streak: 0, best_streak: 0,
                };

                const streak = isWin ? (prev.streak > 0 ? prev.streak + 1 : 1) : (isDraw ? 0 : Math.min(0, prev.streak) - 1);
                const betterWord = (p.bestWordPoints || 0) > (prev.best_word_points || 0);

                await this.db.upsert('user_stats', ['user_id'], {
                    user_id: p.userId,
                    games: prev.games + 1,
                    wins: prev.wins + (isWin ? 1 : 0),
                    losses: prev.losses + (!isWin && !isDraw ? 1 : 0),
                    draws: prev.draws + (isDraw ? 1 : 0),
                    points_total: Number(prev.points_total) + p.score,
                    points_best: Math.max(prev.points_best, p.score),
                    best_word: betterWord ? p.bestWord : prev.best_word,
                    best_word_points: betterWord ? p.bestWordPoints : prev.best_word_points,
                    bingos: prev.bingos + (p.bingos || 0),
                    streak,
                    best_streak: Math.max(prev.best_streak, streak),
                    updated_at: now,
                });

                // ── Skalpy: bilans z każdym przeciwnikiem osobno ─────────────
                for (const rival of humans) {
                    if (rival.userId === p.userId) continue;
                    const won = p.place < rival.place;
                    const tied = p.place === rival.place;

                    await this.db.upsert('scalps', ['user_id', 'opponent_id'], {
                        user_id: p.userId,
                        opponent_id: rival.userId,
                        wins: won ? 1 : 0,
                        losses: !won && !tied ? 1 : 0,
                        draws: tied ? 1 : 0,
                        last_at: now,
                    }, {
                        wins: { raw: `scalps.wins + ${won ? 1 : 0}` },
                        losses: { raw: `scalps.losses + ${!won && !tied ? 1 : 0}` },
                        draws: { raw: `scalps.draws + ${tied ? 1 : 0}` },
                        last_at: now,
                    });
                }

                // ── Ranking ─────────────────────────────────────────────────
                const after = newRatings.get(p.userId);
                if (after != null) {
                    await this.db.run('UPDATE users SET rating = ? WHERE id = ?', [after, p.userId]);
                    p.ratingAfter = after;
                    changes.set(p.userId, { before: p.ratingBefore, after });
                }
            }
        });

        return changes;
    }

    /**
     * Ranking graczy.
     * @param {object} [options]
     * @param {number} [options.limit=50] - Ile pozycji zwrócić
     * @param {number} [options.minGames=1] - Minimalna liczba rozegranych partii
     * @returns {Promise<object[]>} Lista pozycji rankingu
     */
    async ranking({ limit = 50, minGames = 1 } = {}) {
        const rows = await this.db.all(
            `SELECT u.id, u.username, u.display_name, u.avatar, u.rating,
                    s.games, s.wins, s.losses, s.draws, s.points_best, s.bingos, s.best_streak
             FROM users u JOIN user_stats s ON s.user_id = u.id
             WHERE u.is_guest = 0 AND s.games >= ?
             ORDER BY u.rating DESC, s.wins DESC, s.games ASC
             LIMIT ${Math.max(1, Math.min(200, Number(limit) || 50))}`,
            [Math.max(0, Number(minGames) || 0)],
        );

        return rows.map((row, i) => ({
            place: i + 1,
            userId: row.id,
            username: row.username,
            displayName: row.display_name,
            avatar: row.avatar,
            rating: row.rating,
            games: row.games,
            wins: row.wins,
            losses: row.losses,
            draws: row.draws,
            winRate: row.games ? Math.round((row.wins / row.games) * 100) : 0,
            bestGame: row.points_best,
            bingos: row.bingos,
            bestStreak: row.best_streak,
        }));
    }

    /**
     * Skalpy gracza — bilans z każdym przeciwnikiem.
     * @param {number} userId - Identyfikator gracza
     * @param {number} [limit=20] - Ile pozycji zwrócić
     * @returns {Promise<object[]>} Posortowane malejąco wg liczby zwycięstw
     */
    async scalps(userId, limit = 20) {
        const rows = await this.db.all(
            `SELECT sc.opponent_id, sc.wins, sc.losses, sc.draws, sc.last_at,
                    u.username, u.display_name, u.avatar, u.rating, u.is_guest
             FROM scalps sc JOIN users u ON u.id = sc.opponent_id
             WHERE sc.user_id = ?
             ORDER BY sc.wins DESC, sc.last_at DESC
             LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}`,
            [userId],
        );

        return rows.map(row => ({
            userId: row.opponent_id,
            username: row.username,
            displayName: row.display_name,
            avatar: row.avatar,
            rating: row.rating,
            isGuest: !!row.is_guest,
            wins: row.wins,
            losses: row.losses,
            draws: row.draws,
            lastAt: row.last_at,
        }));
    }

    /**
     * Statystyki zbiorcze gracza.
     * @param {number} userId
     * @returns {Promise<object>} Statystyki (zerowe, gdy gracz nic nie rozegrał)
     */
    async summary(userId) {
        const row = await this.db.get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
        const place = await this.db.scalar(
            `SELECT COUNT(*) + 1 FROM users u JOIN user_stats s ON s.user_id = u.id
             WHERE u.is_guest = 0 AND s.games >= 1 AND u.rating > (SELECT rating FROM users WHERE id = ?)`,
            [userId],
        );

        return {
            games: row?.games || 0,
            wins: row?.wins || 0,
            losses: row?.losses || 0,
            draws: row?.draws || 0,
            winRate: row?.games ? Math.round((row.wins / row.games) * 100) : 0,
            pointsTotal: Number(row?.points_total || 0),
            pointsAvg: row?.games ? Math.round(Number(row.points_total) / row.games) : 0,
            bestGame: row?.points_best || 0,
            bestWord: row?.best_word || null,
            bestWordPoints: row?.best_word_points || 0,
            bingos: row?.bingos || 0,
            streak: row?.streak || 0,
            bestStreak: row?.best_streak || 0,
            rankingPlace: Number(place) || null,
        };
    }
}

module.exports = StatsRepo;
module.exports.ELO_K = ELO_K;
module.exports.ELO_START = ELO_START;
