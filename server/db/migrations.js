/**
 * @file migrations.js
 * @description Schemat bazy portalu — jedna definicja dla wszystkich dialektów.
 * Typy zapisane są znacznikami `{{...}}` tłumaczonymi przez `db/types.js`,
 * więc ten sam plik obsługuje SQLite i MySQL.
 *
 * Migracje wykonują się w kolejności i są zapisywane w tabeli
 * `schema_migrations`, więc ponowny start serwera ich nie powtarza.
 *
 * Świadomie NIE używamy kluczy obcych: integralność pilnuje warstwa repozytoriów,
 * a brak FK ułatwia czyszczenie kont gości i migrację między silnikami.
 */

/** @type {Array<{id: string, sql: string[]}>} */
const MIGRATIONS = [
    {
        id: '001-portal',
        sql: [
            // ── Konta ────────────────────────────────────────────────────────
            `CREATE TABLE users (
                id            {{PK}},
                username      {{STR:32}}  NOT NULL,
                display_name  {{STR:32}}  NOT NULL,
                email         {{STR:190}},
                password_hash {{STR:255}},
                is_guest      {{BOOL}}    NOT NULL DEFAULT 0,
                avatar        {{STR:16}},
                bio           {{STR:255}},
                rating        {{INT}}     NOT NULL DEFAULT 1000,
                created_at    {{BIGINT}}  NOT NULL,
                last_seen_at  {{BIGINT}}  NOT NULL
            ){{ENGINE}}`,
            `CREATE UNIQUE INDEX ux_users_username ON users (username)`,
            `CREATE INDEX ix_users_rating ON users (rating)`,
            `CREATE INDEX ix_users_guest_seen ON users (is_guest, last_seen_at)`,

            // ── Sesje (konta i goście) ───────────────────────────────────────
            `CREATE TABLE sessions (
                token        {{STR:64}} NOT NULL PRIMARY KEY,
                user_id      {{BIGINT}} NOT NULL,
                created_at   {{BIGINT}} NOT NULL,
                last_seen_at {{BIGINT}} NOT NULL,
                expires_at   {{BIGINT}} NOT NULL
            ){{ENGINE}}`,
            `CREATE INDEX ix_sessions_user ON sessions (user_id)`,
            `CREATE INDEX ix_sessions_expires ON sessions (expires_at)`,

            // ── Tryby gry (warianty) ─────────────────────────────────────────
            `CREATE TABLE variants (
                id          {{PK}},
                slug        {{STR:48}} NOT NULL,
                name        {{STR:64}} NOT NULL,
                description {{STR:255}},
                owner_id    {{BIGINT}},
                is_system   {{BOOL}}   NOT NULL DEFAULT 0,
                is_public   {{BOOL}}   NOT NULL DEFAULT 1,
                definition  {{TEXT}}   NOT NULL,
                plays       {{INT}}    NOT NULL DEFAULT 0,
                created_at  {{BIGINT}} NOT NULL,
                updated_at  {{BIGINT}} NOT NULL
            ){{ENGINE}}`,
            `CREATE UNIQUE INDEX ux_variants_slug ON variants (slug)`,
            `CREATE INDEX ix_variants_owner ON variants (owner_id)`,

            // ── Stoły ────────────────────────────────────────────────────────
            `CREATE TABLE game_tables (
                id            {{PK}},
                code          {{STR:12}} NOT NULL,
                name          {{STR:64}} NOT NULL,
                owner_id      {{BIGINT}},
                variant_id    {{BIGINT}} NOT NULL,
                mode          {{STR:16}} NOT NULL,
                seats         {{INT}}    NOT NULL DEFAULT 2,
                ai_level      {{INT}}    NOT NULL DEFAULT 2,
                is_private    {{BOOL}}   NOT NULL DEFAULT 0,
                password_hash {{STR:255}},
                rated         {{BOOL}}   NOT NULL DEFAULT 1,
                turn_seconds  {{INT}}    NOT NULL DEFAULT 0,
                status        {{STR:16}} NOT NULL,
                created_at    {{BIGINT}} NOT NULL,
                updated_at    {{BIGINT}} NOT NULL
            ){{ENGINE}}`,
            `CREATE UNIQUE INDEX ux_tables_code ON game_tables (code)`,
            `CREATE INDEX ix_tables_status ON game_tables (status, updated_at)`,

            // ── Partie ───────────────────────────────────────────────────────
            `CREATE TABLE games (
                id           {{PK}},
                table_id     {{BIGINT}},
                variant_id   {{BIGINT}} NOT NULL,
                variant_name {{STR:64}} NOT NULL,
                mode         {{STR:16}} NOT NULL,
                seats        {{INT}}    NOT NULL,
                rated        {{BOOL}}   NOT NULL DEFAULT 1,
                status       {{STR:16}} NOT NULL,
                turns        {{INT}}    NOT NULL DEFAULT 0,
                started_at   {{BIGINT}} NOT NULL,
                finished_at  {{BIGINT}},
                moves        {{TEXT}}
            ){{ENGINE}}`,
            `CREATE INDEX ix_games_finished ON games (finished_at)`,

            `CREATE TABLE game_participants (
                game_id          {{BIGINT}} NOT NULL,
                slot             {{INT}}    NOT NULL,
                user_id          {{BIGINT}},
                name             {{STR:32}} NOT NULL,
                is_computer      {{BOOL}}   NOT NULL DEFAULT 0,
                is_guest         {{BOOL}}   NOT NULL DEFAULT 0,
                score            {{INT}}    NOT NULL DEFAULT 0,
                place            {{INT}},
                result           {{STR:8}},
                rating_before    {{INT}},
                rating_after     {{INT}},
                best_word        {{STR:32}},
                best_word_points {{INT}}    NOT NULL DEFAULT 0,
                bingos           {{INT}}    NOT NULL DEFAULT 0,
                PRIMARY KEY (game_id, slot)
            ){{ENGINE}}`,
            `CREATE INDEX ix_participants_user ON game_participants (user_id)`,

            // ── Statystyki i skalpy ──────────────────────────────────────────
            `CREATE TABLE user_stats (
                user_id          {{BIGINT}} NOT NULL PRIMARY KEY,
                games            {{INT}}    NOT NULL DEFAULT 0,
                wins             {{INT}}    NOT NULL DEFAULT 0,
                losses           {{INT}}    NOT NULL DEFAULT 0,
                draws            {{INT}}    NOT NULL DEFAULT 0,
                points_total     {{BIGINT}} NOT NULL DEFAULT 0,
                points_best      {{INT}}    NOT NULL DEFAULT 0,
                best_word        {{STR:32}},
                best_word_points {{INT}}    NOT NULL DEFAULT 0,
                bingos           {{INT}}    NOT NULL DEFAULT 0,
                streak           {{INT}}    NOT NULL DEFAULT 0,
                best_streak      {{INT}}    NOT NULL DEFAULT 0,
                updated_at       {{BIGINT}} NOT NULL DEFAULT 0
            ){{ENGINE}}`,

            `CREATE TABLE scalps (
                user_id     {{BIGINT}} NOT NULL,
                opponent_id {{BIGINT}} NOT NULL,
                wins        {{INT}}    NOT NULL DEFAULT 0,
                losses      {{INT}}    NOT NULL DEFAULT 0,
                draws       {{INT}}    NOT NULL DEFAULT 0,
                last_at     {{BIGINT}} NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, opponent_id)
            ){{ENGINE}}`,

            `CREATE TABLE friends (
                user_id    {{BIGINT}} NOT NULL,
                friend_id  {{BIGINT}} NOT NULL,
                status     {{STR:16}} NOT NULL,
                created_at {{BIGINT}} NOT NULL,
                PRIMARY KEY (user_id, friend_id)
            ){{ENGINE}}`,
        ],
    },
];

module.exports = MIGRATIONS;
