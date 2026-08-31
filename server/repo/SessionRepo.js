/**
 * @class SessionRepo
 * @description Sesje logowania. Token trafia do przeglądarki i wraca przy
 * każdym żądaniu REST oraz przy nawiązaniu połączenia WebSocket.
 *
 * Sesje kont żyją długo (30 dni), sesje gości krótko (1 dzień) — zgodnie
 * z zasadą, że gość ma tyle, ile zapamięta jego sesja.
 *
 * @example
 * const sessions = new SessionRepo(db);
 * const token = await sessions.create(userId, { guest: false });
 * const found = await sessions.resolve(token); // => { user, token } albo null
 */

const { randomToken } = require('../auth/password');

/** Czas życia sesji w milisekundach. */
const TTL = {
    account: 30 * 24 * 60 * 60 * 1000,
    guest: 24 * 60 * 60 * 1000,
};

class SessionRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Tworzy nową sesję.
     * @param {number} userId - Identyfikator konta
     * @param {object} [options]
     * @param {boolean} [options.guest=false] - Czy to sesja gościa (krótszy czas życia)
     * @returns {Promise<{token: string, expiresAt: number}>}
     */
    async create(userId, { guest = false } = {}) {
        const now = Date.now();
        const token = randomToken(32);
        const expiresAt = now + (guest ? TTL.guest : TTL.account);

        await this.db.insert('sessions', {
            token,
            user_id: userId,
            created_at: now,
            last_seen_at: now,
            expires_at: expiresAt,
        });
        return { token, expiresAt };
    }

    /**
     * Odczytuje sesję razem z kontem i odświeża znacznik aktywności.
     * @param {string} token - Token sesji
     * @returns {Promise<{user: object, token: string, expiresAt: number}|null>}
     *   `null`, gdy token jest nieznany albo wygasł
     */
    async resolve(token) {
        if (!token || typeof token !== 'string' || token.length > 128) return null;

        const row = await this.db.get(
            `SELECT s.token, s.expires_at, u.*
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`,
            [token],
        );
        if (!row) return null;

        const now = Date.now();
        if (row.expires_at < now) {
            await this.destroy(token);
            return null;
        }

        // Odświeżamy „ostatnio widziany" najwyżej raz na minutę, żeby nie
        // zasypywać bazy zapisami przy każdym ruchu w grze.
        if (now - (row.last_seen_at || 0) > 60_000) {
            await this.db.run(
                'UPDATE sessions SET last_seen_at = ? WHERE token = ?', [now, token],
            );
            await this.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [now, row.id]);
        }

        const { token: _t, expires_at: expiresAt, ...user } = row;
        return { user, token, expiresAt };
    }

    /**
     * Usuwa sesję (wylogowanie).
     * @param {string} token
     * @returns {Promise<void>}
     */
    async destroy(token) {
        await this.db.delete('sessions', { token });
    }

    /**
     * Usuwa wszystkie sesje konta.
     * @param {number} userId
     * @returns {Promise<void>}
     */
    async destroyAllFor(userId) {
        await this.db.delete('sessions', { user_id: userId });
    }

    /**
     * Kasuje wygasłe sesje.
     * @returns {Promise<number>} Liczba usuniętych wpisów
     */
    async purgeExpired() {
        const r = await this.db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
        return r.changes;
    }
}

module.exports = SessionRepo;
module.exports.TTL = TTL;
