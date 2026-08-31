/**
 * @file routes.js
 * @description REST API portalu: konta, profile, ranking, tryby gry i solver
 * ze zdjęcia. Rozgrywka idzie WebSocketem — tutaj są rzeczy, które wygodniej
 * pobrać zwykłym żądaniem (i które da się otworzyć wprost w przeglądarce).
 *
 * Uwierzytelnienie: nagłówek `Authorization: Bearer <token>` albo
 * `X-Session-Token`. Token wydają `/api/auth/*`.
 *
 * | metoda | ścieżka | opis |
 * |--------|---------|------|
 * | GET    | `/api/config`            | tytuł, flagi, słowniki pomocnicze |
 * | GET    | `/api/home`              | statystyki serwisu, czołówka, ostatnie partie |
 * | POST   | `/api/auth/register`     | rejestracja |
 * | POST   | `/api/auth/login`        | logowanie |
 * | POST   | `/api/auth/guest`        | gra jako gość |
 * | POST   | `/api/auth/upgrade`      | zamiana konta gościa na pełne |
 * | POST   | `/api/auth/logout`       | wylogowanie |
 * | GET    | `/api/auth/me`           | bieżące konto |
 * | PATCH  | `/api/profile`           | zmiana profilu |
 * | POST   | `/api/profile/password`  | zmiana hasła |
 * | GET    | `/api/ranking`           | ranking |
 * | GET    | `/api/players/:username` | profil publiczny + statystyki + skalpy |
 * | GET    | `/api/players`           | wyszukiwanie graczy |
 * | GET    | `/api/variants`          | lista trybów gry |
 * | POST   | `/api/variants`          | nowy tryb |
 * | GET    | `/api/variants/:id`      | pełna definicja trybu |
 * | PUT    | `/api/variants/:id`      | edycja trybu |
 * | POST   | `/api/variants/:id/copy` | kopia trybu do siebie |
 * | DELETE | `/api/variants/:id`      | usunięcie trybu |
 * | GET    | `/api/friends`           | znajomi i zaproszenia |
 * | POST   | `/api/friends/:id`       | zaproszenie / akceptacja |
 * | DELETE | `/api/friends/:id`       | usunięcie relacji |
 * | POST   | `/api/solve`             | solver ze zdjęcia lub z ręcznie wpisanej planszy |
 */

const express = require('express');
const multer = require('multer');
const { AuthError } = require('../auth/AuthService');
const { VariantError, normalizeDefinition, summarize } = require('../variant/schema');
const { LEVELS } = require('../game/Strategy');
const UserRepo = require('../repo/UserRepo');

/** Upload obrazu do pamięci (bez zapisu na dysk). */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * Buduje router API.
 * @param {object} deps - Zależności aplikacji
 * @returns {import('express').Router}
 */
function createRoutes(deps) {
    const router = express.Router();
    router.use(express.json({ limit: '20mb' }));

    // ── Uwierzytelnienie żądania ─────────────────────────────────────────────

    /**
     * Wyciąga token z nagłówków.
     * @param {import('express').Request} req
     * @returns {string|null}
     */
    function tokenOf(req) {
        const header = req.get('authorization');
        if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
        return req.get('x-session-token') || null;
    }

    /** Middleware: dokleja `req.user` (albo `null`), nie blokuje żądania. */
    async function withUser(req, res, next) {
        try {
            const token = tokenOf(req);
            const session = token ? await deps.auth.resolve(token) : null;
            req.user = session ? session.user : null;
            req.token = token;
            next();
        } catch (err) {
            next(err);
        }
    }

    /** Middleware: wymaga zalogowania. */
    function requireUser(req, res, next) {
        if (!req.user) return res.status(401).json({ success: false, error: 'Musisz być zalogowany.' });
        next();
    }

    /** Middleware: wymaga pełnego konta (nie gościa). */
    function requireAccount(req, res, next) {
        if (!req.user) return res.status(401).json({ success: false, error: 'Musisz być zalogowany.' });
        if (req.user.isGuest) {
            return res.status(403).json({
                success: false,
                error: 'Ta funkcja wymaga konta — załóż je w kilka sekund, dorobek gościa zostanie przeniesiony.',
                needAccount: true,
            });
        }
        next();
    }

    /**
     * Opakowuje handler async, żeby błędy trafiały do obsługi błędów Expressa.
     * @param {Function} fn
     * @returns {Function}
     */
    const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

    router.use(withUser);

    // ─────────────────────────────────────────────────────────────────────────
    // KONFIGURACJA I STRONA GŁÓWNA
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/config', wrap(async (req, res) => {
        res.json({
            title: deps.config.title,
            tagline: deps.config.tagline,
            flags: deps.config.flags,
            aiLevels: Object.entries(LEVELS).map(([level, info]) => ({ level: Number(level), name: info.name })),
            limits: deps.config.limits,
        });
    }));

    router.get('/home', wrap(async (req, res) => {
        const [stats, ranking, recent] = await Promise.all([
            deps.games.siteStats(),
            deps.stats.ranking({ limit: 5 }),
            deps.games.recentGlobal(8),
        ]);
        res.json({
            success: true,
            stats: { ...stats, online: deps.hub ? deps.hub.onlineCount() : 0, tables: deps.tables.tables.size },
            ranking,
            recent,
        });
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // KONTA
    // ─────────────────────────────────────────────────────────────────────────

    router.post('/auth/register', wrap(async (req, res) => {
        const out = await deps.auth.register(req.body || {});
        res.json({ success: true, ...out });
    }));

    router.post('/auth/login', wrap(async (req, res) => {
        const out = await deps.auth.login(req.body || {});
        res.json({ success: true, ...out });
    }));

    router.post('/auth/guest', wrap(async (req, res) => {
        const out = await deps.auth.guest((req.body || {}).name);
        res.json({ success: true, ...out });
    }));

    router.post('/auth/upgrade', requireUser, wrap(async (req, res) => {
        if (!req.user.isGuest) throw new AuthError('To konto już jest pełnoprawne.');
        const out = await deps.auth.upgradeGuest(req.user.id, req.body || {});
        res.json({ success: true, ...out });
    }));

    router.post('/auth/logout', wrap(async (req, res) => {
        await deps.auth.logout(req.token);
        res.json({ success: true });
    }));

    router.get('/auth/me', wrap(async (req, res) => {
        if (!req.user) return res.json({ success: true, user: null });
        const [stats, scalps, recent] = await Promise.all([
            deps.stats.summary(req.user.id),
            deps.stats.scalps(req.user.id, 10),
            deps.games.recentFor(req.user.id, 8),
        ]);
        res.json({ success: true, user: req.user, stats, scalps, recent });
    }));

    router.patch('/profile', requireUser, wrap(async (req, res) => {
        const updated = await deps.users.updateProfile(req.user.id, req.body || {});
        res.json({ success: true, user: UserRepo.toPublic(updated) });
    }));

    router.post('/profile/password', requireAccount, wrap(async (req, res) => {
        const { oldPassword, newPassword } = req.body || {};
        await deps.auth.changePassword(req.user.id, oldPassword, newPassword);
        res.json({ success: true });
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // RANKING I PROFILE
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/ranking', wrap(async (req, res) => {
        const ranking = await deps.stats.ranking({
            limit: Number(req.query.limit) || 50,
            minGames: req.query.minGames != null ? Number(req.query.minGames) : 1,
        });
        res.json({ success: true, ranking });
    }));

    router.get('/players', wrap(async (req, res) => {
        res.json({ success: true, players: await deps.users.search(req.query.q, 15) });
    }));

    router.get('/players/:username', wrap(async (req, res) => {
        const found = await deps.users.findByUsername(req.params.username);
        if (!found) return res.status(404).json({ success: false, error: 'Nie ma takiego gracza.' });

        const [stats, scalps, recent] = await Promise.all([
            deps.stats.summary(found.id),
            deps.stats.scalps(found.id, 15),
            deps.games.recentFor(found.id, 10),
        ]);
        res.json({
            success: true,
            user: UserRepo.toPublic(found),
            online: deps.hub ? deps.hub.isOnline(found.id) : false,
            stats,
            scalps,
            recent,
        });
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // TRYBY GRY
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/variants', wrap(async (req, res) => {
        res.json({ success: true, variants: await deps.variants.listVisible(req.user ? req.user.id : null) });
    }));

    router.get('/variants/:id', wrap(async (req, res) => {
        const row = await deps.variants.findById(Number(req.params.id));
        if (!row) return res.status(404).json({ success: false, error: 'Nie ma takiego trybu gry.' });
        if (!row.is_public && row.owner_id !== (req.user && req.user.id)) {
            return res.status(403).json({ success: false, error: 'Ten tryb jest prywatny.' });
        }
        res.json({ success: true, variant: deps.variants.toFull(row, req.user ? req.user.id : null) });
    }));

    router.post('/variants', requireAccount, wrap(async (req, res) => {
        res.json({ success: true, variant: await deps.variants.create(req.user.id, req.body || {}) });
    }));

    router.put('/variants/:id', requireAccount, wrap(async (req, res) => {
        res.json({
            success: true,
            variant: await deps.variants.update(req.user.id, Number(req.params.id), req.body || {}),
        });
    }));

    router.post('/variants/:id/copy', requireAccount, wrap(async (req, res) => {
        res.json({
            success: true,
            variant: await deps.variants.duplicate(req.user.id, Number(req.params.id), (req.body || {}).name),
        });
    }));

    router.delete('/variants/:id', requireAccount, wrap(async (req, res) => {
        await deps.variants.remove(req.user.id, Number(req.params.id));
        res.json({ success: true });
    }));

    /**
     * Podgląd definicji bez zapisu — edytor sprawdza tu poprawność na żywo.
     * Oprócz walidacji zwraca listę liter, których nie ma w słowniku: taki
     * klocek da się położyć na stojaku, ale nigdy nie wejdzie w żadne słowo.
     */
    router.post('/variants/preview', wrap(async (req, res) => {
        const definition = normalizeDefinition((req.body || {}).definition);

        await deps.dict.ready;
        const unknownLetters = definition.tiles
            .filter(tile => deps.dict.frequencyOf(tile.letter) === 0)
            .map(tile => tile.letter);

        res.json({ success: true, definition, summary: summarize(definition), unknownLetters });
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // ZNAJOMI
    // ─────────────────────────────────────────────────────────────────────────

    router.get('/friends', requireAccount, wrap(async (req, res) => {
        const list = await deps.friends.list(req.user.id);
        const mark = arr => arr.map(f => ({ ...f, online: deps.hub ? deps.hub.isOnline(f.userId) : false }));
        res.json({
            success: true,
            accepted: mark(list.accepted),
            pending: mark(list.pending),
            incoming: mark(list.incoming),
        });
    }));

    router.post('/friends/:id', requireAccount, wrap(async (req, res) => {
        const target = Number(req.params.id);
        const action = (req.body || {}).action === 'accept' ? 'accept' : 'invite';
        const out = action === 'accept'
            ? await deps.friends.accept(req.user.id, target)
            : await deps.friends.invite(req.user.id, target);
        res.json({ success: true, ...out });
    }));

    router.delete('/friends/:id', requireAccount, wrap(async (req, res) => {
        await deps.friends.remove(req.user.id, Number(req.params.id));
        res.json({ success: true });
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // SOLVER ZE ZDJĘCIA
    // ─────────────────────────────────────────────────────────────────────────

    router.post('/solve', upload.single('image'), wrap(async (req, res) => {
        if (deps.config.flags.allowImageSolver === false) {
            return res.status(403).json({ success: false, error: 'Solver ze zdjęcia jest wyłączony.' });
        }
        const ai = deps.imageSolver;
        const body = req.body || {};
        const limit = Math.min(parseInt(body.limit || req.query.limit, 10) || 20, 50);

        // Solver liczy punkty wg konkretnego trybu — domyślnie tryb portalu.
        const variant = body.variantId
            ? await deps.variants.getCompiled(Number(body.variantId))
            : await deps.variants.getDefaultCompiled();
        if (!variant) return res.status(400).json({ success: false, error: 'Nie znaleziono trybu gry.' });

        // ── Tryb ręczny: plansza i litery jako tekst ─────────────────────────
        if (body.manual) {
            const rawBoard = Array.isArray(body.board) ? body.board : [];
            const rawRack = Array.isArray(body.rack) ? body.rack.join('') : String(body.rack || '');

            const norm = ai.normalizeAiData({ board: rawBoard, rack: rawRack.split('') }, variant.alphabet);
            const board = ai.buildBoard(norm.board, variant);

            if (!norm.rack.length) {
                return res.json({
                    success: true, board: norm.board, rack: norm.rack, rackEmpty: true,
                    warning: 'Nie podano liter na stojaku — wpisz swoje litery, żebym policzył ruchy.',
                    moves: [],
                });
            }

            await deps.dict.ready;
            return res.json({
                success: true, board: norm.board, rack: norm.rack, rackEmpty: false,
                moves: ai.solveTopMoves(board, norm.rack, deps.dict, limit),
            });
        }

        // ── Tryb ze zdjęciem ─────────────────────────────────────────────────
        let buffer = null;
        if (req.file && req.file.buffer) {
            buffer = req.file.buffer;
        } else if (body.imageBase64) {
            buffer = Buffer.from(String(body.imageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
        }
        if (!buffer || buffer.length === 0) {
            return res.status(400).json({ success: false, error: 'Brak obrazu — wyślij plik w polu "image".' });
        }

        await deps.dict.ready;
        const result = await ai.solveFromImage(buffer, deps.dict, { variant, limit });
        res.json(result);
    }));

    // ─────────────────────────────────────────────────────────────────────────
    // OBSŁUGA BŁĘDÓW
    // ─────────────────────────────────────────────────────────────────────────

    router.use((err, req, res, next) => {
        if (err instanceof AuthError) {
            return res.status(err.status || 400).json({ success: false, error: err.message });
        }
        if (err instanceof VariantError) {
            return res.status(400).json({ success: false, error: err.message, field: err.field });
        }
        if (err && err.message && err.expected) {
            return res.status(400).json({ success: false, error: err.message });
        }

        console.error('[API] Błąd:', err);
        res.status(500).json({ success: false, error: 'Błąd wewnętrzny serwera.' });
    });

    return router;
}

module.exports = { createRoutes };
