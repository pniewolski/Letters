/**
 * @file SqliteDriver.js
 * @description Sterownik SQLite oparty na wbudowanym module `node:sqlite`
 * (Node >= 22.5, bez flagi od Node 24). Zero zależności zewnętrznych i zero
 * kompilacji natywnej — idealne na hosting bez własnego silnika bazy.
 *
 * Baza to pojedynczy plik; ścieżkę wskazuje `DB_FILE` albo `DATA_DIR`.
 * Na Northflank podłącz wolumen (np. `/data`) i ustaw `DATA_DIR=/data`,
 * inaczej dane znikną przy kolejnym deployu.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Zamienia wartości JS na typy akceptowane przez `node:sqlite`.
 * Boole i `undefined` nie są bindowalne — konwertujemy je jawnie.
 * @param {Array<*>} params
 * @returns {Array<*>}
 */
function normalizeParams(params) {
    return (params || []).map(p => {
        if (p === undefined || p === null) return null;
        if (typeof p === 'boolean') return p ? 1 : 0;
        if (p instanceof Date) return p.getTime();
        if (typeof p === 'object') return JSON.stringify(p);
        return p;
    });
}

/** Zamienia wiersz o prototypie null na zwykły obiekt. */
function plain(row) {
    return row ? { ...row } : row;
}

/**
 * @class SqliteDriver
 * @description Implementacja interfejsu sterownika dla SQLite.
 * Operacje są synchroniczne pod spodem, ale API jest asynchroniczne,
 * aby było wymienne ze sterownikiem MySQL.
 */
class SqliteDriver {
    /**
     * @param {{file?: string, dataDir?: string}} [options]
     */
    constructor(options = {}) {
        this.dialect = 'sqlite';
        this.file = options.file || SqliteDriver.resolveFile(options.dataDir);
        this._depth = 0; // zagnieżdżenie transakcji
    }

    /**
     * Ustala ścieżkę pliku bazy i tworzy katalog, jeśli trzeba.
     * @param {string} [dataDir] - Katalog na dane (domyślnie z DATA_DIR lub ./data)
     * @returns {string} Bezwzględna ścieżka pliku bazy
     */
    static resolveFile(dataDir) {
        if (process.env.DB_FILE) return path.resolve(process.env.DB_FILE);
        const dir = path.resolve(dataDir || process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'literki.db');
    }

    /** Otwiera plik bazy i włącza rozsądne pragma. */
    async connect() {
        this.db = new DatabaseSync(this.file);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA synchronous = NORMAL');
        this.db.exec('PRAGMA foreign_keys = ON');
        this.db.exec('PRAGMA busy_timeout = 5000');
        return this;
    }

    /**
     * Wykonuje zapytanie modyfikujące.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<{changes: number, lastId: number|null}>}
     */
    async run(sql, params = []) {
        const r = this.db.prepare(sql).run(...normalizeParams(params));
        return { changes: Number(r.changes), lastId: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
    }

    /**
     * Zwraca pierwszy pasujący wiersz.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<object|null>}
     */
    async get(sql, params = []) {
        return plain(this.db.prepare(sql).get(...normalizeParams(params))) || null;
    }

    /**
     * Zwraca wszystkie pasujące wiersze.
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<object[]>}
     */
    async all(sql, params = []) {
        return this.db.prepare(sql).all(...normalizeParams(params)).map(plain);
    }

    /**
     * Wykonuje surowy skrypt SQL (może zawierać wiele instrukcji).
     * @param {string} sql
     */
    async exec(sql) {
        this.db.exec(sql);
    }

    /**
     * Uruchamia funkcję w transakcji (obsługuje zagnieżdżenia przez SAVEPOINT).
     * @param {() => Promise<*>} fn
     * @returns {Promise<*>} Wynik `fn`
     */
    async transaction(fn) {
        const nested = this._depth > 0;
        const name = `sp_${this._depth}`;
        this.db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
        this._depth++;
        try {
            const out = await fn();
            this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
            return out;
        } catch (err) {
            this.db.exec(nested ? `ROLLBACK TO ${name}` : 'ROLLBACK');
            throw err;
        } finally {
            this._depth--;
        }
    }

    /** Zamyka połączenie. */
    async close() {
        if (this.db) this.db.close();
    }

    /** Krótki opis połączenia do logów. */
    describe() {
        return `sqlite:${this.file}`;
    }
}

module.exports = SqliteDriver;
