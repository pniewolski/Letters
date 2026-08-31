/**
 * @file screens/home.js
 * @description Strona główna portalu: zaproszenie do gry, liczby serwisu,
 * czołówka rankingu i ostatnio rozegrane partie.
 */

import { el, fill, avatar, fmtAgo, plural, toast } from '../ui.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openAuthModal, playAsGuest } from './auth.js';

/**
 * Renderuje stronę główną.
 * @param {HTMLElement} host
 * @returns {Promise<Function>} Funkcja sprzątająca
 */
export default async function homeScreen(host) {
    fill(host, el('div', { class: 'loading' }, 'Ładowanie...'));

    let data;
    try {
        data = await api.get('/home');
    } catch (err) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie udało się pobrać danych'),
            el('p', { class: 'muted' }, err.message)));
        return () => {};
    }

    const { stats, ranking, recent } = data;

    fill(host,
        el('div', { class: 'home' },

            // ── Zaproszenie ──────────────────────────────────────────────────
            el('section', { class: 'hero' },
                el('h1', { class: 'hero-title' }, store.config.title),
                el('p', { class: 'hero-tagline' }, store.config.tagline
                    || 'Układaj słowa, zbieraj skalpy, twórz własne tryby gry.'),

                el('div', { class: 'hero-actions' },
                    el('button', {
                        class: 'btn btn-primary btn-big',
                        onclick: () => navigate('/lobby'),
                    }, '🎲 Do stołów'),

                    store.user
                        ? el('button', {
                            class: 'btn btn-big',
                            onclick: () => navigate('/tryby'),
                        }, '🧩 Tryby gry')
                        : el('button', {
                            class: 'btn btn-big',
                            onclick: () => openAuthModal('register'),
                        }, '✨ Załóż konto'),

                    !store.user
                        ? el('button', {
                            class: 'btn btn-ghost btn-big',
                            onclick: async () => {
                                try { await playAsGuest(); navigate('/lobby'); }
                                catch (err) { toast(err.message, 'error'); }
                            },
                        }, 'Graj jako gość')
                        : null,
                ),

                el('div', { class: 'hero-stats' },
                    statTile(stats.online, 'online'),
                    statTile(stats.tables, 'otwartych stołów'),
                    statTile(stats.games, 'rozegranych partii'),
                    statTile(stats.players, 'graczy z kontem'),
                    statTile(stats.variants, 'trybów gry'),
                ),
            ),

            // ── Czym to jest ─────────────────────────────────────────────────
            el('section', { class: 'features' },
                feature('🪑', 'Stoły jak w klubie',
                    'Zakładasz stół, ustawiasz zasady i czekasz na chętnych — albo zapraszasz znajomych kodem.'),
                feature('🧩', 'Własne tryby gry',
                    'Sam decydujesz o rozmiarze planszy, rozmieszczeniu premii, zestawie liter i punktacji.'),
                feature('🏆', 'Ranking i skalpy',
                    'Każda partia liczy się do rankingu, a portal pamięta twój bilans z każdym przeciwnikiem.'),
                feature('🤖', 'Komputer na trzech poziomach',
                    'Nie masz z kim zagrać? Usiądź naprzeciw komputera albo obejrzyj, jak gra sam ze sobą.'),
            ),

            // ── Ranking i ostatnie partie ────────────────────────────────────
            el('div', { class: 'two-cols' },
                el('section', { class: 'card' },
                    el('div', { class: 'panel-title-row' },
                        el('h2', { class: 'panel-title' }, '🏆 Czołówka'),
                        el('button', { class: 'btn btn-ghost btn-tiny', onclick: () => navigate('/ranking') }, 'Pełny ranking'),
                    ),
                    ranking.length === 0
                        ? el('p', { class: 'muted small' }, 'Jeszcze nikt nie rozegrał partii. Bądź pierwszy.')
                        : el('ol', { class: 'rank-list' }, ranking.map(r => el('li', {
                            class: 'rank-row',
                            onclick: () => navigate(`/gracz/${r.username}`),
                        },
                            el('span', { class: 'rank-place' }, String(r.place)),
                            avatar({ avatar: r.avatar, name: r.displayName }, 'sm'),
                            el('span', { class: 'rank-name' }, r.displayName),
                            el('span', { class: 'rank-rating' }, String(r.rating)),
                        ))),
                ),

                el('section', { class: 'card' },
                    el('h2', { class: 'panel-title' }, '⏱ Ostatnie partie'),
                    recent.length === 0
                        ? el('p', { class: 'muted small' }, 'Historia jest jeszcze pusta.')
                        : el('ul', { class: 'plain-list' }, recent.map(g => el('li', { class: 'recent-row' },
                            el('div', { class: 'recent-players' },
                                g.players.map(p => `${p.name} ${p.score}`).join('  ·  ')),
                            el('div', { class: 'muted small' },
                                `${g.variant} · ${plural(g.seats, 'gracz', 'graczy', 'graczy')} · ${fmtAgo(g.finishedAt)}`),
                        ))),
                ),
            ),
        ),
    );

    return () => {};
}

/**
 * Kafelek z liczbą.
 * @param {number} value
 * @param {string} label
 * @returns {HTMLElement}
 */
function statTile(value, label) {
    return el('div', { class: 'stat-tile' },
        el('span', { class: 'stat-value' }, String(value ?? 0)),
        el('span', { class: 'stat-label' }, label));
}

/**
 * Kafelek opisujący funkcję portalu.
 * @param {string} icon
 * @param {string} title
 * @param {string} text
 * @returns {HTMLElement}
 */
function feature(icon, title, text) {
    return el('div', { class: 'feature' },
        el('span', { class: 'feature-icon' }, icon),
        el('h3', {}, title),
        el('p', { class: 'muted small' }, text));
}
