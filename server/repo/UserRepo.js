/**
 * @class UserRepo
 * @description Dostęp do kont graczy — zarejestrowanych i gości.
 *
 * Goście też mają wiersz w `users` (z flagą `is_guest`), dzięki czemu partie,
 * statystyki i skalpy odwołują się do jednego typu identyfikatora. Konto gościa
 * żyje tylko tak długo, jak jego sesja — sprzątaczka usuwa nieużywane.
 *
 * @example
 * const users = new UserRepo(db);
 * const user = await users.createAccount({ username: 'ala', displayName: 'Ala', passwordHash });
 * await users.findByUsername('ala');
 */

const { randomCode } = require('../auth/password');

/** Dozwolone znaki nazwy konta. */
const USERNAME_RE = /^[a-z0-9_.-]{3,20}$/;

/** Ile dni bez aktywności przeżywa konto gościa. */
const GUEST_TTL_DAYS = 14;

class UserRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Sprawdza poprawność nazwy konta.
     * @param {string} username - Proponowana nazwa
     * @returns {string|null} Komunikat błędu albo `null`, gdy nazwa jest w porządku
     */
    static validateUsername(username) {
        const name = String(username || '').trim().toLowerCase();
        if (!USERNAME_RE.test(name)) {
            return 'Nazwa konta może mieć 3–20 znaków: małe litery, cyfry, kropka, myślnik lub podkreślenie.';
        }
        if (name.startsWith('gosc') || name.startsWith('gość')) {
            return 'Nazwa zaczynająca się od „gosc" jest zarezerwowana dla gości.';
        }
        return null;
    }

    /**
     * Normalizuje nazwę wyświetlaną.
     * @param {string} name - Surowa nazwa
     * @param {string} fallback - Wartość zastępcza
     * @returns {string}
     */
    static cleanDisplayName(name, fallback) {
        const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
        return clean || fallback;
    }

    /**
     * Tworzy konto zarejestrowane.
     * @param {object} data
     * @param {string} data.username - Login (zostanie zamieniony na małe litery)
     * @param {string} data.displayName - Nazwa wyświetlana
     * @param {string} data.passwordHash - Hash hasła
     * @param {string} [data.email] - Adres e-mail (opcjonalny)
     * @returns {Promise<object>} Utworzone konto
     * @throws {Error} Gdy nazwa jest zajęta lub nieprawidłowa
     */
    async createAccount({ username, displayName, passwordHash, email }) {
        const name = String(username).trim().toLowerCase();
        const invalid = UserRepo.validateUsername(name);
        if (invalid) throw new Error(invalid);

        if (await this.findByUsername(name)) {
            throw new Error('Konto o tej nazwie już istnieje.');
        }

        const now = Date.now();
        const id = await this.db.insert('users', {
            username: name,
            display_name: UserRepo.cleanDisplayName(displayName, name),
            email: email ? String(email).trim().slice(0, 190) : null,
            password_hash: passwordHash,
            is_guest: 0,
            avatar: null,
            bio: null,
            rating: 1000,
            created_at: now,
            last_seen_at: now,
        });

        await this.db.upsert('user_stats', ['user_id'], { user_id: id, updated_at: now });
        return this.findById(id);
    }

    /**
     * Tworzy konto gościa z unikalną nazwą.
     * @param {string} [displayName] - Proponowana nazwa wyświetlana
     * @returns {Promise<object>} Utworzone konto gościa
     */
    async createGuest(displayName) {
        const now = Date.now();

        // Nazwa techniczna musi być unikalna — kilka prób z losowym sufiksem.
        for (let attempt = 0; attempt < 8; attempt++) {
            const username = `gosc-${randomCode(6).toLowerCase()}`;
            if (await this.findByUsername(username)) continue;

            const id = await this.db.insert('users', {
                username,
                display_name: UserRepo.cleanDisplayName(displayName, `Gość ${username.slice(-4).toUpperCase()}`),
                email: null,
                password_hash: null,
                is_guest: 1,
                avatar: null,
                bio: null,
                rating: 1000,
                created_at: now,
                last_seen_at: now,
            });
            return this.findById(id);
        }
        throw new Error('Nie udało się utworzyć konta gościa — spróbuj ponownie.');
    }

    /**
     * Wyszukuje konto po identyfikatorze.
     * @param {number} id
     * @returns {Promise<object|null>}
     */
    findById(id) {
        return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
    }

    /**
     * Wyszukuje konto po nazwie (bez rozróżniania wielkości liter).
     * @param {string} username
     * @returns {Promise<object|null>}
     */
    findByUsername(username) {
        return this.db.get('SELECT * FROM users WHERE username = ?', [String(username || '').trim().toLowerCase()]);
    }

    /**
     * Odnotowuje aktywność konta.
     * @param {number} id
     * @returns {Promise<void>}
     */
    async touch(id) {
        await this.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [Date.now(), id]);
    }

    /**
     * Aktualizuje profil (nazwa wyświetlana, awatar, opis).
     * @param {number} id - Identyfikator konta
     * @param {object} data - Pola do zmiany
     * @returns {Promise<object|null>} Zaktualizowane konto
     */
    async updateProfile(id, data) {
        const patch = {};
        if (data.displayName !== undefined) {
            patch.display_name = UserRepo.cleanDisplayName(data.displayName, 'Gracz');
        }
        if (data.avatar !== undefined) {
            patch.avatar = data.avatar ? String(data.avatar).slice(0, 8) : null;
        }
        if (data.bio !== undefined) {
            patch.bio = data.bio ? String(data.bio).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
        }
        if (Object.keys(patch).length) await this.db.update('users', patch, { id });
        return this.findById(id);
    }

    /**
     * Zmienia hash hasła.
     * @param {number} id
     * @param {string} passwordHash
     * @returns {Promise<void>}
     */
    async setPassword(id, passwordHash) {
        await this.db.update('users', { password_hash: passwordHash }, { id });
    }

    /**
     * Zamienia gościa w pełne konto — dorobek z sesji zostaje przy graczu.
     * @param {number} id - Identyfikator konta gościa
     * @param {object} data - `{ username, password_hash, displayName }`
     * @returns {Promise<object>} Konto po konwersji
     * @throws {Error} Gdy nazwa jest zajęta albo konto nie jest gościem
     */
    async upgradeGuest(id, { username, passwordHash, displayName }) {
        const user = await this.findById(id);
        if (!user) throw new Error('Nie znaleziono konta.');
        if (!user.is_guest) throw new Error('To konto nie jest kontem gościa.');

        const name = String(username).trim().toLowerCase();
        const invalid = UserRepo.validateUsername(name);
        if (invalid) throw new Error(invalid);
        if (await this.findByUsername(name)) throw new Error('Konto o tej nazwie już istnieje.');

        await this.db.update('users', {
            username: name,
            display_name: UserRepo.cleanDisplayName(displayName, user.display_name),
            password_hash: passwordHash,
            is_guest: 0,
        }, { id });

        await this.db.upsert('user_stats', ['user_id'], { user_id: id, updated_at: Date.now() }, {});
        return this.findById(id);
    }

    /**
     * Wyszukiwanie graczy po fragmencie nazwy (do zapraszania znajomych).
     * @param {string} query - Fragment nazwy
     * @param {number} [limit=15] - Ile wyników zwrócić
     * @returns {Promise<object[]>}
     */
    search(query, limit = 15) {
        const q = `%${String(query || '').trim().toLowerCase().slice(0, 32)}%`;
        return this.db.all(
            `SELECT id, username, display_name, avatar, rating FROM users
             WHERE is_guest = 0 AND (username LIKE ? OR LOWER(display_name) LIKE ?)
             ORDER BY rating DESC LIMIT ${Number(limit) || 15}`,
            [q, q],
        );
    }

    /**
     * Usuwa nieaktywne konta gości razem z ich śladami.
     * Wywoływane cyklicznie przez serwer.
     * @param {number} [days=GUEST_TTL_DAYS] - Po ilu dniach bezczynności usuwać
     * @returns {Promise<number>} Liczba usuniętych kont
     */
    async purgeStaleGuests(days = GUEST_TTL_DAYS) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const stale = await this.db.all(
            'SELECT id FROM users WHERE is_guest = 1 AND last_seen_at < ? LIMIT 500',
            [cutoff],
        );
        if (stale.length === 0) return 0;

        const ids = stale.map(r => r.id);
        const list = ids.join(',');
        await this.db.transaction(async () => {
            await this.db.run(`DELETE FROM sessions   WHERE user_id IN (${list})`);
            await this.db.run(`DELETE FROM user_stats WHERE user_id IN (${list})`);
            await this.db.run(`DELETE FROM scalps     WHERE user_id IN (${list}) OR opponent_id IN (${list})`);
            await this.db.run(`DELETE FROM friends    WHERE user_id IN (${list}) OR friend_id IN (${list})`);
            await this.db.run(`UPDATE game_participants SET user_id = NULL WHERE user_id IN (${list})`);
            await this.db.run(`DELETE FROM users      WHERE id IN (${list})`);
        });
        return ids.length;
    }

    /**
     * Publiczna postać konta — bez hasha hasła i adresu e-mail.
     * @param {object} row - Wiersz z bazy
     * @returns {object|null}
     */
    static toPublic(row) {
        if (!row) return null;
        return {
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            avatar: row.avatar || null,
            bio: row.bio || null,
            rating: row.rating,
            isGuest: !!row.is_guest,
            createdAt: row.created_at,
        };
    }
}

module.exports = UserRepo;
module.exports.GUEST_TTL_DAYS = GUEST_TTL_DAYS;
