/**
 * @file index.js
 * @description Fabryka połączenia z bazą. Sterownik wybiera zmienna
 * środowiskowa `DB_DRIVER` (`sqlite` — domyślnie, albo `mysql`).
 *
 * @example
 * const { createDatabase } = require('./db');
 * const db = await createDatabase();   // otwiera bazę i wykonuje migracje
 */

const Database = require('./Database');

/** Dostępne sterowniki (ładowane leniwie — MySQL wymaga pakietu mysql2). */
const DRIVERS = {
    sqlite: () => require('./drivers/SqliteDriver'),
    mysql: () => require('./drivers/MysqlDriver'),
};

/**
 * Tworzy i inicjalizuje bazę danych (połączenie + migracje).
 * @param {object} [options] - Opcje przekazywane do sterownika
 * @param {'sqlite'|'mysql'} [options.driver] - Wymuszenie sterownika
 * @param {boolean} [options.migrate=true] - Czy uruchomić migracje
 * @returns {Promise<Database>}
 * @throws {Error} Gdy wskazany sterownik nie istnieje
 */
async function createDatabase(options = {}) {
    const name = (options.driver || process.env.DB_DRIVER || 'sqlite').toLowerCase();
    const load = DRIVERS[name];
    if (!load) {
        throw new Error(`Nieznany sterownik bazy: "${name}". Dostępne: ${Object.keys(DRIVERS).join(', ')}`);
    }

    const Driver = load();
    const driver = new Driver(options);
    await driver.connect();

    const db = new Database(driver);
    if (options.migrate !== false) {
        const applied = await db.migrate();
        if (applied.length) console.log(`[DB] Zastosowano migracje: ${applied.join(', ')}`);
    }
    console.log(`[DB] Połączono (${db.describe()})`);
    return db;
}

module.exports = { createDatabase, Database };
