/**
 * @class FriendRepo
 * @description Znajomi — żeby dało się grać nie tylko z obcymi. Relacja jest
 * dwustronna: zaproszenie tworzy wiersz `pending` u nadawcy i `incoming`
 * u odbiorcy, a akceptacja zamienia oba na `accepted`.
 *
 * @example
 * const friends = new FriendRepo(db);
 * await friends.invite(1, 2);
 * await friends.accept(2, 1);
 * await friends.list(1);
 */

/** Dozwolone stany relacji. */
const STATUS = { PENDING: 'pending', INCOMING: 'incoming', ACCEPTED: 'accepted' };

/**
 * Tworzy błąd z komunikatem przeznaczonym dla gracza.
 * @param {string} message - Treść po polsku
 * @returns {Error} Błąd oznaczony jako spodziewany (API odda go z kodem 400)
 */
function friendError(message) {
    const err = new Error(message);
    err.expected = true;
    return err;
}

class FriendRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Wysyła zaproszenie do znajomych.
     * @param {number} userId - Kto zaprasza
     * @param {number} friendId - Kogo zaprasza
     * @returns {Promise<{status: string}>}
     * @throws {Error} Gdy gracz zaprasza sam siebie albo konto nie istnieje
     */
    async invite(userId, friendId) {
        if (!Number.isInteger(friendId)) throw friendError('Nie znaleziono takiego gracza.');
        if (userId === friendId) throw friendError('Nie możesz zaprosić samego siebie.');

        const target = await this.db.get('SELECT id, is_guest FROM users WHERE id = ?', [friendId]);
        if (!target) throw friendError('Nie znaleziono takiego gracza.');
        if (target.is_guest) throw friendError('Nie można dodać gościa do znajomych — najpierw musi założyć konto.');

        const existing = await this.db.get(
            'SELECT status FROM friends WHERE user_id = ? AND friend_id = ?', [userId, friendId],
        );
        if (existing?.status === STATUS.ACCEPTED) return { status: STATUS.ACCEPTED };

        // Jeśli druga strona już nas zaprosiła — od razu akceptujemy.
        if (existing?.status === STATUS.INCOMING) return this.accept(userId, friendId);

        const now = Date.now();
        await this.db.upsert('friends', ['user_id', 'friend_id'],
            { user_id: userId, friend_id: friendId, status: STATUS.PENDING, created_at: now },
            { status: STATUS.PENDING });
        await this.db.upsert('friends', ['user_id', 'friend_id'],
            { user_id: friendId, friend_id: userId, status: STATUS.INCOMING, created_at: now },
            { status: STATUS.INCOMING });

        return { status: STATUS.PENDING };
    }

    /**
     * Przyjmuje zaproszenie. Przyjąć można tylko to, co faktycznie przyszło —
     * bez tego każdy mógłby wpisać się komuś do znajomych samą akceptacją.
     * @param {number} userId - Kto przyjmuje
     * @param {number} friendId - Od kogo było zaproszenie
     * @returns {Promise<{status: string}>}
     * @throws {Error} Gdy nie ma zaproszenia od tego gracza
     */
    async accept(userId, friendId) {
        const existing = Number.isInteger(friendId)
            ? await this.db.get(
                'SELECT status FROM friends WHERE user_id = ? AND friend_id = ?', [userId, friendId],
            )
            : null;
        if (existing?.status === STATUS.ACCEPTED) return { status: STATUS.ACCEPTED };
        if (existing?.status !== STATUS.INCOMING) throw friendError('Nie masz zaproszenia od tego gracza.');

        await this.db.update('friends', { status: STATUS.ACCEPTED }, { user_id: userId, friend_id: friendId });
        await this.db.update('friends', { status: STATUS.ACCEPTED }, { user_id: friendId, friend_id: userId });
        return { status: STATUS.ACCEPTED };
    }

    /**
     * Usuwa relację w obie strony (odrzucenie zaproszenia lub usunięcie znajomego).
     * @param {number} userId
     * @param {number} friendId
     * @returns {Promise<void>}
     */
    async remove(userId, friendId) {
        await this.db.delete('friends', { user_id: userId, friend_id: friendId });
        await this.db.delete('friends', { user_id: friendId, friend_id: userId });
    }

    /**
     * Lista znajomych i zaproszeń.
     * @param {number} userId - Identyfikator gracza
     * @returns {Promise<{accepted: object[], pending: object[], incoming: object[]}>}
     */
    async list(userId) {
        const rows = await this.db.all(
            `SELECT f.status, u.id, u.username, u.display_name, u.avatar, u.rating, u.last_seen_at
             FROM friends f JOIN users u ON u.id = f.friend_id
             WHERE f.user_id = ?
             ORDER BY u.last_seen_at DESC`,
            [userId],
        );

        const shape = row => ({
            userId: row.id,
            username: row.username,
            displayName: row.display_name,
            avatar: row.avatar,
            rating: row.rating,
            lastSeenAt: row.last_seen_at,
        });

        return {
            accepted: rows.filter(r => r.status === STATUS.ACCEPTED).map(shape),
            pending: rows.filter(r => r.status === STATUS.PENDING).map(shape),
            incoming: rows.filter(r => r.status === STATUS.INCOMING).map(shape),
        };
    }

    /**
     * Identyfikatory zaakceptowanych znajomych — do filtrowania lobby.
     * @param {number} userId
     * @returns {Promise<Set<number>>}
     */
    async friendIds(userId) {
        const rows = await this.db.all(
            'SELECT friend_id FROM friends WHERE user_id = ? AND status = ?', [userId, STATUS.ACCEPTED],
        );
        return new Set(rows.map(r => r.friend_id));
    }
}

module.exports = FriendRepo;
module.exports.STATUS = STATUS;
