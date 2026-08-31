/**
 * @class AuthService
 * @description Rejestracja, logowanie, konta gości i awans gościa na pełne
 * konto. Spina {@link UserRepo}, {@link SessionRepo} i hashowanie haseł.
 *
 * Gość dostaje pełnoprawne konto techniczne, ale z krótką sesją — kiedy sesja
 * wygaśnie albo przeglądarka ją zgubi, dorobek przepada. To świadoma decyzja:
 * „gość ma tyle, ile zapamięta jego sesja".
 *
 * @example
 * const auth = new AuthService(users, sessions);
 * const { user, token } = await auth.register({ username: 'ala', password: 'sekret1' });
 * const me = await auth.resolve(token);
 */

const { hashPassword, verifyPassword, PASSWORD_LIMITS } = require('./password');
const UserRepo = require('../repo/UserRepo');

/**
 * @class AuthError
 * @description Błąd uwierzytelnienia z komunikatem gotowym do pokazania graczowi.
 */
class AuthError extends Error {
    /**
     * @param {string} message - Komunikat po polsku
     * @param {number} [status=400] - Kod HTTP
     */
    constructor(message, status = 400) {
        super(message);
        this.name = 'AuthError';
        this.status = status;
    }
}

class AuthService {
    /**
     * @param {UserRepo} users - Repozytorium kont
     * @param {import('../repo/SessionRepo')} sessions - Repozytorium sesji
     */
    constructor(users, sessions) {
        this.users = users;
        this.sessions = sessions;
    }

    /**
     * Zakłada konto i od razu loguje.
     * @param {object} data
     * @param {string} data.username - Login
     * @param {string} data.password - Hasło jawne
     * @param {string} [data.displayName] - Nazwa wyświetlana
     * @param {string} [data.email] - Adres e-mail
     * @returns {Promise<{user: object, token: string, expiresAt: number}>}
     * @throws {AuthError} Gdy dane są niepoprawne albo nazwa zajęta
     */
    async register({ username, password, displayName, email }) {
        const nameError = UserRepo.validateUsername(username);
        if (nameError) throw new AuthError(nameError);
        if (String(password || '').length < PASSWORD_LIMITS.min) {
            throw new AuthError(`Hasło musi mieć co najmniej ${PASSWORD_LIMITS.min} znaków.`);
        }

        let user;
        try {
            user = await this.users.createAccount({
                username,
                displayName: displayName || username,
                passwordHash: await hashPassword(password),
                email,
            });
        } catch (err) {
            throw new AuthError(err.message);
        }

        const session = await this.sessions.create(user.id, { guest: false });
        return { user: UserRepo.toPublic(user), ...session };
    }

    /**
     * Loguje na istniejące konto.
     * @param {object} data
     * @param {string} data.username - Login
     * @param {string} data.password - Hasło jawne
     * @returns {Promise<{user: object, token: string, expiresAt: number}>}
     * @throws {AuthError} Gdy dane logowania są błędne
     */
    async login({ username, password }) {
        const user = await this.users.findByUsername(username);

        // Ten sam komunikat dla złej nazwy i złego hasła — nie zdradzamy,
        // które konta istnieją.
        const invalid = new AuthError('Nieprawidłowa nazwa konta lub hasło.', 401);
        if (!user || user.is_guest || !user.password_hash) throw invalid;
        if (!await verifyPassword(password, user.password_hash)) throw invalid;

        await this.users.touch(user.id);
        const session = await this.sessions.create(user.id, { guest: false });
        return { user: UserRepo.toPublic(user), ...session };
    }

    /**
     * Tworzy konto gościa (bez hasła) i sesję o krótkim czasie życia.
     * @param {string} [displayName] - Proponowana nazwa
     * @returns {Promise<{user: object, token: string, expiresAt: number}>}
     */
    async guest(displayName) {
        const user = await this.users.createGuest(displayName);
        const session = await this.sessions.create(user.id, { guest: true });
        return { user: UserRepo.toPublic(user), ...session };
    }

    /**
     * Zamienia konto gościa w pełne konto — statystyki zebrane jako gość zostają.
     * @param {number} userId - Konto gościa
     * @param {object} data - `{ username, password, displayName }`
     * @returns {Promise<{user: object, token: string, expiresAt: number}>}
     * @throws {AuthError}
     */
    async upgradeGuest(userId, { username, password, displayName }) {
        const nameError = UserRepo.validateUsername(username);
        if (nameError) throw new AuthError(nameError);
        if (String(password || '').length < PASSWORD_LIMITS.min) {
            throw new AuthError(`Hasło musi mieć co najmniej ${PASSWORD_LIMITS.min} znaków.`);
        }

        let user;
        try {
            user = await this.users.upgradeGuest(userId, {
                username,
                passwordHash: await hashPassword(password),
                displayName,
            });
        } catch (err) {
            throw new AuthError(err.message);
        }

        // Stara sesja gościa wygasa szybko — wydajemy nową, długą.
        await this.sessions.destroyAllFor(userId);
        const session = await this.sessions.create(user.id, { guest: false });
        return { user: UserRepo.toPublic(user), ...session };
    }

    /**
     * Zmienia hasło po sprawdzeniu obecnego.
     * @param {number} userId
     * @param {string} oldPassword
     * @param {string} newPassword
     * @returns {Promise<void>}
     * @throws {AuthError}
     */
    async changePassword(userId, oldPassword, newPassword) {
        const user = await this.users.findById(userId);
        if (!user || !user.password_hash) throw new AuthError('To konto nie ma hasła.');
        if (!await verifyPassword(oldPassword, user.password_hash)) {
            throw new AuthError('Obecne hasło jest nieprawidłowe.', 401);
        }
        if (String(newPassword || '').length < PASSWORD_LIMITS.min) {
            throw new AuthError(`Nowe hasło musi mieć co najmniej ${PASSWORD_LIMITS.min} znaków.`);
        }
        await this.users.setPassword(userId, await hashPassword(newPassword));
    }

    /**
     * Rozwiązuje token sesji na konto.
     * @param {string} token
     * @returns {Promise<{user: object, raw: object}|null>} `null`, gdy sesja jest nieważna
     */
    async resolve(token) {
        const found = await this.sessions.resolve(token);
        if (!found) return null;
        return { user: UserRepo.toPublic(found.user), raw: found.user };
    }

    /**
     * Kończy sesję.
     * @param {string} token
     * @returns {Promise<void>}
     */
    async logout(token) {
        if (token) await this.sessions.destroy(token);
    }
}

module.exports = AuthService;
module.exports.AuthError = AuthError;
