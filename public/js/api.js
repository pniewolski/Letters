/**
 * @file api.js
 * @description Klient REST portalu. Dokleja token sesji, rozpakowuje odpowiedzi
 * i zamienia błędy serwera na wyjątki z czytelnym komunikatem.
 *
 * @example
 * import { api } from './api.js';
 * const { ranking } = await api.get('/ranking');
 * await api.post('/auth/login', { username: 'ala', password: '...' });
 */

import { getToken } from './store.js';

/**
 * @class ApiError
 * @description Błąd zwrócony przez API — `message` nadaje się do pokazania graczowi.
 */
export class ApiError extends Error {
    /**
     * @param {string} message - Komunikat
     * @param {number} status - Kod HTTP
     * @param {object} [data] - Pełna odpowiedź
     */
    constructor(message, status, data) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data || {};
    }
}

/**
 * Wykonuje żądanie do API.
 * @param {string} method - Metoda HTTP
 * @param {string} path - Ścieżka względem `/api`
 * @param {object} [body] - Ciało żądania (JSON) albo `FormData`
 * @returns {Promise<object>} Odpowiedź serwera
 * @throws {ApiError} Gdy serwer zwróci błąd albo `success: false`
 */
async function request(method, path, body) {
    const token = getToken();
    const isForm = body instanceof FormData;

    const res = await fetch(`/api${path}`, {
        method,
        headers: {
            ...(isForm ? {} : { 'content-type': 'application/json' }),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body == null ? undefined : (isForm ? body : JSON.stringify(body)),
    });

    let data = null;
    try {
        data = await res.json();
    } catch {
        throw new ApiError('Serwer zwrócił odpowiedź, której nie da się odczytać.', res.status);
    }

    if (!res.ok || data.success === false) {
        throw new ApiError(data.error || `Błąd ${res.status}`, res.status, data);
    }
    return data;
}

export const api = {
    /**
     * @param {string} path
     * @param {object} [query] - Parametry zapytania
     * @returns {Promise<object>}
     */
    get(path, query) {
        const qs = query
            ? '?' + new URLSearchParams(
                Object.entries(query).filter(([, v]) => v != null && v !== ''),
            ).toString()
            : '';
        return request('GET', path + qs);
    },

    /** @returns {Promise<object>} */
    post: (path, body) => request('POST', path, body),
    /** @returns {Promise<object>} */
    put: (path, body) => request('PUT', path, body),
    /** @returns {Promise<object>} */
    patch: (path, body) => request('PATCH', path, body),
    /** @returns {Promise<object>} */
    del: (path) => request('DELETE', path),
};
