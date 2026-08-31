/**
 * @file Database.js
 * @description Fasada nad sterownikiem bazy. Repozytoria korzystają wyłącznie
 * z tego API, dzięki czemu zmiana silnika (SQLite → MySQL) nie dotyka logiki.
 *
 * Zapytania piszemy z placeholderami `?` (wspólne dla obu dialektów),
 * a niezgodne składniowo konstrukcje (UPSERT) opakowują metody pomocnicze
 * tej klasy.
 *
 * @example
 * const db = await createDatabase();
 * await db.insert('users', { username: 'ala', display_name: 'Ala', created_at: Date.now() });
 * const u = await db.get('SELECT * FROM users WHERE username = ?', ['ala']);
 */

const { translate } = require('./types');
const MIGRATIONS = require('./migrations');

/**
 * @class Database
 * @description Cienka warstwa nad sterownikiem: migracje, CRUD i UPSERT
 * niezależne od dialektu.
 */
class Database {
    /**
     * @param {object} driver - Instancja sterownika (SqliteDriver | MysqlDriver)
     */
    constructor(driver) {
        this.driver = driver;
        this.dialect = driver.dialect;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PODSTAWOWE OPERACJE
    // ─────────────────────────────────────────────────────────────────────────

    /** @see SqliteDriver#run */
    run(sql, params) { return this.driver.run(sql, params); }
    /** @see SqliteDriver#get */
    get(sql, params) { return this.driver.get(sql, params); }
    /** @see SqliteDriver#all */
    all(sql, params) { return this.driver.all(sql, params); }
    /** @see SqliteDriver#exec */
    exec(sql) { return this.driver.exec(sql); }
    /** @see SqliteDriver#transaction */
    transaction(fn) { return this.driver.transaction(fn); }
    /** Zamyka połączenie z bazą. */
    close() { return this.driver.close(); }
    /** Opis połączenia do logów. */
    describe() { return this.driver.describe(); }

    /**
     * Zwraca pojedynczą wartość skalarną (pierwsza kolumna pierwszego wiersza).
     * @param {string} sql
     * @param {Array<*>} [params]
     * @returns {Promise<*>}
     */
    async scalar(sql, params) {
        const row = await this.get(sql, params);
        return row ? Object.values(row)[0] : null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CUKIER CRUD
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wstawia wiersz zbudowany z obiektu.
     * @param {string} table - Nazwa tabeli
     * @param {object} data - Mapa kolumna → wartość
     * @returns {Promise<number|null>} Identyfikator nowego wiersza
     */
    async insert(table, data) {
        const cols = Object.keys(data);
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
        const r = await this.run(sql, cols.map(c => data[c]));
        return r.lastId;
    }

    /**
     * Aktualizuje wiersze pasujące do warunku.
     * @param {string} table - Nazwa tabeli
     * @param {object} data - Kolumny do zmiany
     * @param {object} where - Warunek (AND po kolumnach)
     * @returns {Promise<number>} Liczba zmienionych wierszy
     */
    async update(table, data, where) {
        const set = Object.keys(data);
        const cond = Object.keys(where);
        const sql = `UPDATE ${table} SET ${set.map(c => c + ' = ?').join(', ')}`
            + ` WHERE ${cond.map(c => c + ' = ?').join(' AND ')}`;
        const r = await this.run(sql, [...set.map(c => data[c]), ...cond.map(c => where[c])]);
        return r.changes;
    }

    /**
     * Usuwa wiersze pasujące do warunku.
     * @param {string} table
     * @param {object} where
     * @returns {Promise<number>} Liczba usuniętych wierszy
     */
    async delete(table, where) {
        const cond = Object.keys(where);
        const sql = `DELETE FROM ${table} WHERE ${cond.map(c => c + ' = ?').join(' AND ')}`;
        const r = await this.run(sql, cond.map(c => where[c]));
        return r.changes;
    }

    /**
     * INSERT z obsługą konfliktu klucza. Składnia różni się między silnikami,
     * więc generujemy ją tutaj.
     * @param {string} table - Nazwa tabeli
     * @param {string[]} keys - Kolumny klucza (głównego lub unikalnego)
     * @param {object} data - Pełny zestaw kolumn do wstawienia
     * @param {object} [onUpdate] - Kolumny do nadpisania przy konflikcie;
     *   wartością może być surowy fragment SQL w postaci { raw: 'wins + 1' }
     * @returns {Promise<void>}
     *
     * @example
     * await db.upsert('scalps', ['user_id', 'opponent_id'],
     *     { user_id: 1, opponent_id: 2, wins: 1, last_at: Date.now() },
     *     { wins: { raw: 'scalps.wins + 1' }, last_at: Date.now() });
     */
    async upsert(table, keys, data, onUpdate = null) {
        const cols = Object.keys(data);
        const params = cols.map(c => data[c]);
        let sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;

        const upd = onUpdate || Object.fromEntries(
            cols.filter(c => !keys.includes(c)).map(c => [c, data[c]])
        );

        const parts = [];
        for (const [col, val] of Object.entries(upd)) {
            if (val && typeof val === 'object' && 'raw' in val) {
                parts.push(`${col} = ${this._rawRef(table, val.raw)}`);
            } else {
                parts.push(`${col} = ?`);
                params.push(val);
            }
        }

        if (parts.length === 0) {
            // Brak kolumn do aktualizacji — wystarczy zignorować konflikt.
            sql += this.dialect === 'mysql'
                ? ` ON DUPLICATE KEY UPDATE ${keys[0]} = ${keys[0]}`
                : ` ON CONFLICT (${keys.join(', ')}) DO NOTHING`;
        } else {
            sql += this.dialect === 'mysql'
                ? ` ON DUPLICATE KEY UPDATE ${parts.join(', ')}`
                : ` ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${parts.join(', ')}`;
        }

        await this.run(sql, params);
    }

    /**
     * MySQL nie pozwala odwołać się do nazwy tabeli w ON DUPLICATE KEY UPDATE
     * tak jak SQLite — usuwamy prefiks tabeli z surowego fragmentu SQL.
     * @param {string} table
     * @param {string} raw
     * @returns {string}
     * @private
     */
    _rawRef(table, raw) {
        return this.dialect === 'mysql'
            ? raw.split(table + '.').join('')
            : raw;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MIGRACJE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Zakłada schemat i doprowadza go do aktualnej wersji.
     * Bezpieczna do wywołania przy każdym starcie serwera.
     * @returns {Promise<string[]>} Identyfikatory zastosowanych migracji
     */
    async migrate() {
        await this.exec(translate(
            'CREATE TABLE IF NOT EXISTS schema_migrations ('
            + ' id {{STR:64}} NOT NULL PRIMARY KEY,'
            + ' applied_at {{BIGINT}} NOT NULL'
            + '){{ENGINE}}',
            this.dialect,
        ));

        const done = new Set((await this.all('SELECT id FROM schema_migrations')).map(r => r.id));
        const applied = [];

        for (const m of MIGRATIONS) {
            if (done.has(m.id)) continue;
            await this.transaction(async () => {
                for (const stmt of m.sql) {
                    await this.exec(translate(stmt, this.dialect));
                }
                await this.run(
                    'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
                    [m.id, Date.now()],
                );
            });
            applied.push(m.id);
        }
        return applied;
    }
}

module.exports = Database;
