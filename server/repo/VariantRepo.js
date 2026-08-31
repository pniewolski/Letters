/**
 * @class VariantRepo
 * @description Tryby gry w bazie: wbudowane presety, tryby publiczne i prywatne
 * kolekcje graczy. Każdy tryb to jeden wiersz z definicją w JSON-ie — nic
 * o regułach nie jest zaszyte w kodzie serwera.
 *
 * @example
 * const variants = new VariantRepo(db);
 * await variants.seedPresets();
 * const literki = await variants.getCompiledBySlug('literki');
 */

const { normalizeDefinition, slugify, summarize, VariantError } = require('../variant/schema');
const { compileRow, clearVariantCache } = require('../variant/compile');
const { PRESETS, DEFAULT_SLUG } = require('../variant/presets');

/** Ile własnych trybów może mieć jeden gracz. */
const MAX_PER_USER = 20;

class VariantRepo {
    /**
     * @param {import('../db/Database')} db - Połączenie z bazą
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * Zakłada wbudowane tryby, jeśli ich jeszcze nie ma.
     * Istniejących nie nadpisuje — gracze mogą je u siebie modyfikować.
     * @returns {Promise<string[]>} Slugi dodanych trybów
     */
    async seedPresets() {
        const added = [];
        const now = Date.now();

        for (const preset of PRESETS) {
            if (await this.findBySlug(preset.slug)) continue;

            // Presety też przechodzą walidację — pilnuje to spójności definicji.
            const definition = normalizeDefinition(preset.definition);
            await this.db.insert('variants', {
                slug: preset.slug,
                name: preset.name,
                description: preset.description,
                owner_id: null,
                is_system: 1,
                is_public: 1,
                definition: JSON.stringify(definition),
                plays: 0,
                created_at: now,
                updated_at: now,
            });
            added.push(preset.slug);
        }
        return added;
    }

    /**
     * Wiersz trybu po identyfikatorze.
     * @param {number} id
     * @returns {Promise<object|null>}
     */
    findById(id) {
        return this.db.get('SELECT * FROM variants WHERE id = ?', [id]);
    }

    /**
     * Wiersz trybu po slugu.
     * @param {string} slug
     * @returns {Promise<object|null>}
     */
    findBySlug(slug) {
        return this.db.get('SELECT * FROM variants WHERE slug = ?', [String(slug || '').toLowerCase()]);
    }

    /**
     * Skompilowany tryb po identyfikatorze.
     * @param {number} id
     * @returns {Promise<import('../variant/compile').CompiledVariant|null>}
     */
    async getCompiled(id) {
        const row = await this.findById(id);
        return row ? compileRow(row) : null;
    }

    /**
     * Skompilowany tryb po slugu.
     * @param {string} slug
     * @returns {Promise<import('../variant/compile').CompiledVariant|null>}
     */
    async getCompiledBySlug(slug) {
        const row = await this.findBySlug(slug);
        return row ? compileRow(row) : null;
    }

    /**
     * Tryb domyślny — używany, gdy stół nie wskaże żadnego.
     * @returns {Promise<import('../variant/compile').CompiledVariant>}
     * @throws {Error} Gdy w bazie nie ma ani jednego trybu
     */
    async getDefaultCompiled() {
        const row = await this.findBySlug(DEFAULT_SLUG)
            || await this.db.get('SELECT * FROM variants WHERE is_system = 1 ORDER BY id LIMIT 1')
            || await this.db.get('SELECT * FROM variants ORDER BY id LIMIT 1');
        if (!row) throw new Error('W bazie nie ma żadnego trybu gry.');
        return compileRow(row);
    }

    /**
     * Lista trybów widocznych dla gracza: wbudowane, publiczne i własne.
     * @param {number|null} userId - Identyfikator gracza (null = anonim)
     * @returns {Promise<object[]>} Podsumowania trybów
     */
    async listVisible(userId) {
        const rows = await this.db.all(
            `SELECT * FROM variants
             WHERE is_public = 1 OR owner_id = ?
             ORDER BY is_system DESC, plays DESC, name ASC`,
            [userId ?? -1],
        );
        return rows.map(row => this.toSummary(row, userId));
    }

    /**
     * Tryby należące do gracza.
     * @param {number} userId
     * @returns {Promise<object[]>}
     */
    async listOwned(userId) {
        const rows = await this.db.all(
            'SELECT * FROM variants WHERE owner_id = ? ORDER BY updated_at DESC', [userId],
        );
        return rows.map(row => this.toSummary(row, userId));
    }

    /**
     * Tworzy nowy tryb gry.
     * @param {number} userId - Właściciel
     * @param {object} data - `{ name, description, isPublic, definition }`
     * @returns {Promise<object>} Podsumowanie utworzonego trybu
     * @throws {VariantError} Gdy definicja jest niepoprawna albo przekroczono limit
     */
    async create(userId, data) {
        const owned = await this.db.scalar('SELECT COUNT(*) FROM variants WHERE owner_id = ?', [userId]);
        if (Number(owned) >= MAX_PER_USER) {
            throw new VariantError(`Masz już ${MAX_PER_USER} własnych trybów — usuń któryś, żeby dodać nowy.`);
        }

        const definition = normalizeDefinition(data.definition);
        const name = String(data.name || '').trim().slice(0, 64) || 'Mój tryb';
        const slug = await this._uniqueSlug(slugify(name));
        const now = Date.now();

        const id = await this.db.insert('variants', {
            slug,
            name,
            description: String(data.description || '').trim().slice(0, 250),
            owner_id: userId,
            is_system: 0,
            is_public: data.isPublic === false ? 0 : 1,
            definition: JSON.stringify(definition),
            plays: 0,
            created_at: now,
            updated_at: now,
        });

        return this.toSummary(await this.findById(id), userId);
    }

    /**
     * Aktualizuje tryb gracza. Trybów wbudowanych nie da się nadpisać —
     * trzeba je najpierw skopiować.
     * @param {number} userId - Kto edytuje
     * @param {number} id - Identyfikator trybu
     * @param {object} data - Pola do zmiany
     * @returns {Promise<object>} Podsumowanie po zmianie
     * @throws {VariantError} Gdy brak uprawnień albo definicja jest błędna
     */
    async update(userId, id, data) {
        const row = await this.findById(id);
        if (!row) throw new VariantError('Nie znaleziono takiego trybu gry.');
        if (row.is_system) throw new VariantError('Trybu wbudowanego nie można zmienić — skopiuj go do siebie.');
        if (row.owner_id !== userId) throw new VariantError('To nie jest twój tryb gry.');

        const patch = { updated_at: Date.now() };
        if (data.name !== undefined) patch.name = String(data.name).trim().slice(0, 64) || row.name;
        if (data.description !== undefined) patch.description = String(data.description).trim().slice(0, 250);
        if (data.isPublic !== undefined) patch.is_public = data.isPublic ? 1 : 0;
        if (data.definition !== undefined) patch.definition = JSON.stringify(normalizeDefinition(data.definition));

        await this.db.update('variants', patch, { id });
        clearVariantCache();
        return this.toSummary(await this.findById(id), userId);
    }

    /**
     * Kopiuje istniejący tryb do kolekcji gracza (podstawa własnych przeróbek).
     * @param {number} userId - Nowy właściciel
     * @param {number} id - Tryb źródłowy
     * @param {string} [name] - Nazwa kopii
     * @returns {Promise<object>} Podsumowanie kopii
     * @throws {VariantError} Gdy trybu nie ma lub jest prywatny
     */
    async duplicate(userId, id, name) {
        const row = await this.findById(id);
        if (!row) throw new VariantError('Nie znaleziono takiego trybu gry.');
        if (!row.is_public && row.owner_id !== userId) throw new VariantError('Ten tryb jest prywatny.');

        return this.create(userId, {
            name: name || `${row.name} (kopia)`,
            description: row.description,
            isPublic: false,
            definition: JSON.parse(row.definition),
        });
    }

    /**
     * Usuwa tryb gracza.
     * @param {number} userId - Kto usuwa
     * @param {number} id - Identyfikator trybu
     * @returns {Promise<void>}
     * @throws {VariantError} Gdy brak uprawnień
     */
    async remove(userId, id) {
        const row = await this.findById(id);
        if (!row) return;
        if (row.is_system) throw new VariantError('Trybu wbudowanego nie można usunąć.');
        if (row.owner_id !== userId) throw new VariantError('To nie jest twój tryb gry.');

        await this.db.delete('variants', { id });
        clearVariantCache();
    }

    /**
     * Zwiększa licznik rozegranych partii w trybie.
     * @param {number} id
     * @returns {Promise<void>}
     */
    async countPlay(id) {
        await this.db.run('UPDATE variants SET plays = plays + 1 WHERE id = ?', [id]);
    }

    /**
     * Zamienia wiersz na podsumowanie dla interfejsu.
     * @param {object} row - Wiersz z bazy
     * @param {number|null} [userId] - Kto pyta (do flagi `canEdit`)
     * @returns {object}
     */
    toSummary(row, userId = null) {
        const definition = JSON.parse(row.definition);
        return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            description: row.description || '',
            ownerId: row.owner_id,
            isSystem: !!row.is_system,
            isPublic: !!row.is_public,
            plays: row.plays,
            canEdit: !row.is_system && row.owner_id != null && row.owner_id === userId,
            summary: summarize(definition),
            previewGrid: definition.board.grid,
            colors: definition.colors,
            updatedAt: row.updated_at,
        };
    }

    /**
     * Pełna definicja trybu — do edytora i do podglądu planszy.
     * @param {object} row - Wiersz z bazy
     * @param {number|null} [userId]
     * @returns {object}
     */
    toFull(row, userId = null) {
        return { ...this.toSummary(row, userId), definition: JSON.parse(row.definition) };
    }

    /**
     * Znajduje wolny slug, dopisując licznik.
     * @param {string} base - Slug bazowy
     * @returns {Promise<string>}
     * @private
     */
    async _uniqueSlug(base) {
        let slug = base;
        for (let i = 2; i < 200; i++) {
            if (!await this.findBySlug(slug)) return slug;
            slug = `${base}-${i}`;
        }
        return `${base}-${Date.now().toString(36)}`;
    }
}

module.exports = VariantRepo;
module.exports.MAX_PER_USER = MAX_PER_USER;
