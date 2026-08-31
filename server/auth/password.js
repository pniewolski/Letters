/**
 * @file password.js
 * @description Hashowanie haseł algorytmem scrypt z modułu `node:crypto` —
 * bez zależności zewnętrznych. Hash zapisujemy w jednym polu tekstowym razem
 * z parametrami, więc w przyszłości można je podnieść bez migracji bazy.
 *
 * Format: `scrypt$N$r$p$sólBase64$hashBase64`
 *
 * @example
 * const hash = await hashPassword('tajne');
 * await verifyPassword('tajne', hash); // => true
 */

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

/** Parametry scrypt — kompromis między bezpieczeństwem a czasem logowania. */
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

/** Minimalna i maksymalna długość hasła. */
const PASSWORD_LIMITS = { min: 6, max: 128 };

/**
 * Hashuje hasło.
 * @param {string} password - Hasło jawne
 * @returns {Promise<string>} Hash w formacie `scrypt$N$r$p$sól$hash`
 * @throws {Error} Gdy hasło jest za krótkie lub za długie
 */
async function hashPassword(password) {
    const pass = String(password || '');
    if (pass.length < PASSWORD_LIMITS.min) {
        throw new Error(`Hasło musi mieć co najmniej ${PASSWORD_LIMITS.min} znaków.`);
    }
    if (pass.length > PASSWORD_LIMITS.max) {
        throw new Error(`Hasło może mieć najwyżej ${PASSWORD_LIMITS.max} znaków.`);
    }

    const salt = crypto.randomBytes(16);
    const key = await scrypt(pass, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p });
    return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Sprawdza hasło względem zapisanego hasha. Porównanie jest odporne na atak
 * czasowy, a nieznany format hasha zwraca `false` zamiast rzucać wyjątkiem.
 * @param {string} password - Hasło jawne
 * @param {string} stored - Zapisany hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
    if (!password || !stored) return false;

    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, N, r, p, saltB64, hashB64] = parts;
    try {
        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');
        const key = await scrypt(String(password), salt, expected.length, {
            N: Number(N), r: Number(r), p: Number(p),
        });
        return crypto.timingSafeEqual(key, expected);
    } catch {
        return false;
    }
}

/**
 * Generuje kryptograficznie losowy token (np. identyfikator sesji).
 * @param {number} [bytes=32] - Liczba losowych bajtów
 * @returns {string} Token szesnastkowy
 */
function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Generuje krótki, czytelny kod (np. do dołączania do stołu).
 * Pomija znaki mylące się wzrokowo (0/O, 1/I).
 * @param {number} [length=6] - Długość kodu
 * @returns {string} Kod wielkimi literami
 */
function randomCode(length = 6) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

module.exports = { hashPassword, verifyPassword, randomToken, randomCode, PASSWORD_LIMITS };
