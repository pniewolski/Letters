/**
 * @file MysqlDriver.js
 * @description Sterownik MySQL/MariaDB. Pakiet `mysql2` jest wymagany dopiero
 * w momencie użycia (opcjonalna zależność), więc domyślna instalacja z SQLite
 * nie ciągnie go za sobą.
 *
 * Włączenie:
 *   npm install mysql2
 *   DB_DRIVER=mysql DB_URL=mysql://user:haslo@host:3306/literki node server/server.js
 *
 * Alternatywnie zamiast `DB_URL`: `DB_HOST`, `DB_PORT`, `DB_USER`,
 * `DB_PASSWORD`, `DB_NAME`.
 */

/**
 * @class MysqlDriver
 * @description Implementacja tego samego interfejsu co {@link SqliteDriver},
 * oparta na puli połączeń `mysql2/promise`.
 */
class MysqlDriver {
    /**
     * @param {object} [options] - Nadpisania konfiguracji połączenia
     */
    constructor(options = {}) {
        this.dialect = 'mysql';
        this.options = options;
    }

    /** Tworzy pulę połączeń. */
    async connect() {
        let mysql;
        try {
            mysql = require('mysql2/promise');
        } catch (e) {
            throw new Error(
                'Sterownik MySQL wymaga pakietu "mysql2". Zainstaluj go: npm install mysql2'
            );
        }

        const url = this.options.url || process.env.DB_URL;
        const base = {
            waitForConnections: true,
            connectionLimit: Number(process.env.DB_POOL || 10),
            charset: 'utf8mb4_unicode_ci',
            timezone: 'Z',
            supportBigNumbers: true,
            bigNumberStrings: false,
        };

        this.pool = url
            ? mysql.createPool({ uri: url, ...base })
            : mysql.createPool({
                host: this.options.host || process.env.DB_HOST || 'localhost',
                port: Number(this.options.port || process.env.DB_PORT || 3306),
                user: this.options.user || process.env.DB_USER || 'root',
                password: this.options.password || process.env.DB_PASSWORD || '',
                database: this.options.database || process.env.DB_NAME || 'literki',
                ...base,
            });

        // Wymuś sensowny tryb SQL (bez cichego obcinania danych).
        const conn = await this.pool.getConnection();
        try {
            await conn.query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
        } finally {
            conn.release();
        }
        return this;
    }

    /** Zwraca połączenie aktywnej transakcji albo pulę. */
    _conn() {
        return this._tx || this.pool;
    }

    /**
     * Wykonuje zapytanie modyfikujące.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<{changes: number, lastId: number|null}>}
     */
    async run(sql, params = []) {
        const [res] = await this._conn().execute(sql, normalizeParams(params));
        return { changes: res.affectedRows || 0, lastId: res.insertId || null };
    }

    /**
     * Zwraca pierwszy pasujący wiersz.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<object|null>}
     */
    async get(sql, params = []) {
        const [rows] = await this._conn().execute(sql, normalizeParams(params));
        return rows[0] || null;
    }

    /**
     * Zwraca wszystkie pasujące wiersze.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<object[]>}
     */
    async all(sql, params = []) {
        const [rows] = await this._conn().execute(sql, normalizeParams(params));
        return rows;
    }

    /**
     * Wykonuje surowy skrypt SQL (instrukcje rozdzielone średnikiem).
     * @param {string} sql
     */
    async exec(sql) {
        for (const stmt of splitStatements(sql)) {
            await this._conn().query(stmt);
        }
    }

    /**
     * Uruchamia funkcję w transakcji. Zagnieżdżenia realizowane są przez
     * SAVEPOINT, tak jak w sterowniku SQLite.
     * @param {() => Promise<*>} fn
     * @returns {Promise<*>}
     */
    async transaction(fn) {
        if (this._tx) {
            const name = `sp_${++this._spCount}`;
            await this._tx.query(`SAVEPOINT ${name}`);
            try {
                const out = await fn();
                await this._tx.query(`RELEASE SAVEPOINT ${name}`);
                return out;
            } catch (err) {
                await this._tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
                throw err;
            }
        }

        const conn = await this.pool.getConnection();
        this._tx = conn;
        this._spCount = 0;
        try {
            await conn.beginTransaction();
            const out = await fn();
            await conn.commit();
            return out;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            this._tx = null;
            conn.release();
        }
    }

    /** Zamyka pulę połączeń. */
    async close() {
        if (this.pool) await this.pool.end();
    }

    /** Krótki opis połączenia do logów (bez hasła). */
    describe() {
        const url = this.options.url || process.env.DB_URL;
        if (url) return `mysql:${String(url).replace(/\/\/[^@]*@/, '//***@')}`;
        return `mysql:${process.env.DB_HOST || 'localhost'}/${process.env.DB_NAME || 'literki'}`;
    }
}

/**
 * Konwertuje wartości JS na typy przyjazne dla `mysql2`.
 * @param {Array<*>} params
 * @returns {Array<*>}
 */
function normalizeParams(params) {
    return (params || []).map(p => {
        if (p === undefined) return null;
        if (typeof p === 'boolean') return p ? 1 : 0;
        if (p !== null && typeof p === 'object' && !(p instanceof Date)) return JSON.stringify(p);
        return p;
    });
}

/**
 * Dzieli skrypt na pojedyncze instrukcje (proste, wystarczające dla migracji —
 * schemat nie zawiera literałów ze średnikami).
 * @param {string} sql
 * @returns {string[]}
 */
function splitStatements(sql) {
    return sql
        .split(/;\s*(?:\r?\n|$)/)
        .map(s => s.trim())
        .filter(Boolean);
}

module.exports = MysqlDriver;
