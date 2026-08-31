/**
 * @file server.js
 * @description Punkt wejścia portalu Literki.
 *
 * Składa całość do kupy:
 * - baza danych (SQLite domyślnie, MySQL po zmianie `DB_DRIVER`) + migracje,
 * - repozytoria i usługa kont,
 * - słownik (jedna instancja na cały proces — budowa Trie jest kosztowna),
 * - menedżer stołów,
 * - Express (statyki + REST) oraz WebSocket na tym samym porcie.
 *
 * Zmienne środowiskowe:
 * | zmienna | domyślnie | znaczenie |
 * |---------|-----------|-----------|
 * | `PORT`      | 8080     | port HTTP i WebSocket |
 * | `DATA_DIR`  | `server/data` | katalog na plik bazy (na Northflank podłącz wolumen) |
 * | `DB_DRIVER` | `sqlite` | `sqlite` albo `mysql` |
 * | `DB_FILE`   | —        | pełna ścieżka pliku bazy (zamiast `DATA_DIR`) |
 * | `DB_URL`    | —        | adres MySQL, np. `mysql://user:hasło@host/literki` |
 * | `DICT_FILE` | `server/slownik.txt` | plik słownika |
 *
 * @example
 * // uruchomienie lokalne
 * // npm start   →   http://localhost:8080
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { createDatabase } = require('./db');
const { LIMITS } = require('./variant/schema');
const WordDictionary = require('./board/WordDictionary');

const UserRepo = require('./repo/UserRepo');
const SessionRepo = require('./repo/SessionRepo');
const VariantRepo = require('./repo/VariantRepo');
const StatsRepo = require('./repo/StatsRepo');
const GameRepo = require('./repo/GameRepo');
const FriendRepo = require('./repo/FriendRepo');
const AuthService = require('./auth/AuthService');
const TableManager = require('./lobby/TableManager');
const Hub = require('./ws/Hub');
const { createRoutes } = require('./app/routes');
const imageSolver = require('./ai/imageSolver');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Jak często sprzątać wygasłe sesje i porzucone konta gości. */
const HOUSEKEEPING_MS = 30 * 60 * 1000;

/**
 * Wczytuje konfigurację aplikacji (tytuł, flagi). Reguły gry NIE są tu
 * trzymane — mieszkają w trybach gry w bazie.
 * @returns {object}
 */
function loadAppConfig() {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    return {
        title: raw.title || 'Literki',
        tagline: raw.tagline || '',
        flags: raw.flags || {},
        limits: {
            boardSize: LIMITS.size,
            rackSize: LIMITS.rackSize,
            tileCount: LIMITS.tileCount,
            letterCount: LIMITS.letterCount,
            letterPoints: LIMITS.letterPoints,
        },
    };
}

/**
 * Buduje wszystkie zależności aplikacji.
 * @returns {Promise<object>} Kontener zależności
 */
async function buildDeps() {
    const config = loadAppConfig();
    const db = await createDatabase();

    const users = new UserRepo(db);
    const sessions = new SessionRepo(db);
    const variants = new VariantRepo(db);
    const stats = new StatsRepo(db);
    const games = new GameRepo(db, stats);
    const friends = new FriendRepo(db);
    const auth = new AuthService(users, sessions);

    const seeded = await variants.seedPresets();
    if (seeded.added.length) console.log(`[Tryby] Dodano wbudowane tryby gry: ${seeded.added.join(', ')}`);
    if (seeded.updated.length) console.log(`[Tryby] Zaktualizowano wbudowane tryby gry: ${seeded.updated.join(', ')}`);

    // Po nieoczekiwanym restarcie nie ma jak dokończyć partii w toku.
    const orphans = await games.abandonOrphans();
    if (orphans) console.log(`[Partie] Zamknięto ${orphans} partii przerwanych restartem.`);
    await db.run("UPDATE game_tables SET status = 'closed' WHERE status IN ('waiting', 'playing')");

    console.log('[Słownik] Ładowanie...');
    const started = Date.now();
    const dict = new WordDictionary();
    await dict.ready;
    console.log(`[Słownik] Gotowy w ${Date.now() - started} ms.`);

    const tables = new TableManager({ dict, db, variants, games });

    return {
        config, db, dict,
        users, sessions, variants, stats, games, friends,
        auth, tables, imageSolver,
        hub: null, // uzupełniane po utworzeniu huba
    };
}

/**
 * Uruchamia serwer.
 * @returns {Promise<void>}
 */
async function start() {
    const deps = await buildDeps();

    const app = express();
    app.disable('x-powered-by');
    app.use('/api', createRoutes(deps));
    app.use(express.static(PUBLIC_DIR, {
        maxAge: '1h',
        setHeaders(res, filePath) {
            // Statyki mogą leżeć w cache, ale HTML musi być świeży po deployu.
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
    }));

    // Prosty status dla monitoringu hostingu.
    app.get('/healthz', (req, res) => res.json({
        ok: true,
        tables: deps.tables.tables.size,
        online: deps.hub ? deps.hub.onlineCount() : 0,
        uptime: Math.round(process.uptime()),
    }));

    // Portal jest aplikacją jednostronicową — nieznane ścieżki serwują index.html.
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.set('Cache-Control', 'no-cache');
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });

    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ server: httpServer, maxPayload: 256 * 1024 });

    const hub = new Hub({ wss, deps });
    deps.hub = hub;
    hub.start();

    // ── Sprzątanie w tle ────────────────────────────────────────────────────
    const housekeeping = setInterval(async () => {
        try {
            const expired = await deps.sessions.purgeExpired();
            const guests = await deps.users.purgeStaleGuests();
            if (expired || guests) {
                console.log(`[Porządki] Sesje: ${expired}, konta gości: ${guests}.`);
            }
        } catch (err) {
            console.error('[Porządki] Błąd:', err.message);
        }
    }, HOUSEKEEPING_MS);
    housekeeping.unref?.();

    httpServer.listen(PORT, () => {
        console.log(`[Serwer] ${deps.config.title} działa na http://localhost:${PORT}`);
        console.log(`[Serwer] WebSocket na tym samym porcie (ws://localhost:${PORT}).`);
    });

    // ── Zamykanie ───────────────────────────────────────────────────────────
    const shutdown = async (signal) => {
        console.log(`[Serwer] Otrzymano ${signal} — zamykam...`);
        clearInterval(housekeeping);
        hub.stop();
        deps.tables.shutdown();
        for (const client of wss.clients) client.close(1001, 'Serwer się wyłącza.');
        httpServer.close(() => {
            deps.db.close().finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(0), 5000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => {
    console.error('[Serwer] Nie udało się wystartować:', err);
    process.exit(1);
});
