/**
 * @file resetDb.js
 * @description Kasuje bazę i zakłada ją od nowa razem z wbudowanymi trybami gry.
 * Przydatne przy pracy nad schematem — **usuwa wszystkie konta i partie**.
 *
 * ```powershell
 * node server/tools/resetDb.js --yes
 * ```
 */

const fs = require('fs');
const readline = require('readline');
const { createDatabase } = require('../db');
const SqliteDriver = require('../db/drivers/SqliteDriver');
const VariantRepo = require('../repo/VariantRepo');

/**
 * Pyta o potwierdzenie, chyba że podano `--yes`.
 * @returns {Promise<boolean>}
 */
async function confirm() {
    if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve =>
        rl.question('To skasuje WSZYSTKIE konta, partie i tryby graczy. Na pewno? (tak/nie) ', resolve));
    rl.close();
    return /^t(ak)?$/i.test(answer.trim());
}

/** Uruchamia reset. */
async function main() {
    if (!await confirm()) {
        console.log('Anulowano.');
        return;
    }

    const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

    if (driver === 'sqlite') {
        const file = SqliteDriver.resolveFile();
        for (const suffix of ['', '-wal', '-shm']) {
            const target = file + suffix;
            if (fs.existsSync(target)) {
                fs.unlinkSync(target);
                console.log(`Usunięto ${target}`);
            }
        }
    } else {
        console.log('Sterownik inny niż SQLite — kasuję zawartość tabel zamiast pliku.');
        const db = await createDatabase({ migrate: false });
        for (const table of ['game_participants', 'games', 'game_tables', 'scalps',
            'friends', 'user_stats', 'sessions', 'variants', 'users', 'schema_migrations']) {
            await db.run(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
        }
        await db.close();
    }

    const db = await createDatabase();
    const seeded = await new VariantRepo(db).seedPresets();
    console.log(`Baza gotowa. Wbudowane tryby: ${seeded.added.join(', ') || 'brak nowych'}.`);
    await db.close();
}

main().catch(err => {
    console.error('Błąd:', err);
    process.exit(1);
});
