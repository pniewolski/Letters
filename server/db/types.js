/**
 * @file types.js
 * @description Mapowanie typów SQL na dialekty. Schemat bazy piszemy RAZ,
 * używając znaczników `{{...}}`, a ten moduł tłumaczy je na SQLite lub MySQL.
 * Dzięki temu przejście na MySQL nie wymaga przepisywania migracji.
 *
 * Dostępne znaczniki:
 *  - `{{PK}}`        klucz główny auto-inkrementowany
 *  - `{{INT}}`       liczba całkowita
 *  - `{{BIGINT}}`    duża liczba całkowita (znaczniki czasu w ms)
 *  - `{{BOOL}}`      wartość logiczna (0/1)
 *  - `{{STR:n}}`     krótki tekst indeksowalny (VARCHAR(n))
 *  - `{{TEXT}}`      długi tekst (JSON, opisy)
 *  - `{{ENGINE}}`    sufiks tabeli (opcje silnika w MySQL, pusty w SQLite)
 *
 * @example
 * translate('CREATE TABLE u(id {{PK}}, name {{STR:64}})', 'mysql');
 * // => 'CREATE TABLE u(id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64))'
 */

/** Słowniki typów dla obsługiwanych dialektów. */
const DIALECTS = {
    sqlite: {
        PK: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        INT: 'INTEGER',
        BIGINT: 'INTEGER',
        BOOL: 'INTEGER',
        TEXT: 'TEXT',
        STR: () => 'TEXT',
        ENGINE: '',
    },
    mysql: {
        PK: 'BIGINT AUTO_INCREMENT PRIMARY KEY',
        INT: 'INT',
        BIGINT: 'BIGINT',
        BOOL: 'TINYINT(1)',
        TEXT: 'MEDIUMTEXT',
        STR: (n) => `VARCHAR(${n})`,
        ENGINE: ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    },
};

/**
 * Tłumaczy SQL ze znacznikami na konkretny dialekt.
 * @param {string} sql - SQL ze znacznikami `{{...}}`
 * @param {'sqlite'|'mysql'} dialect - Docelowy dialekt
 * @returns {string} SQL gotowy do wykonania
 * @throws {Error} Gdy dialekt jest nieznany lub znacznik nieobsługiwany
 */
function translate(sql, dialect) {
    const map = DIALECTS[dialect];
    if (!map) throw new Error(`Nieznany dialekt SQL: ${dialect}`);

    return sql.replace(/\{\{([A-Z]+)(?::(\d+))?\}\}/g, (all, name, arg) => {
        const entry = map[name];
        if (entry === undefined) throw new Error(`Nieznany znacznik typu: ${all}`);
        return typeof entry === 'function' ? entry(Number(arg) || 255) : entry;
    });
}

module.exports = { translate, DIALECTS };
