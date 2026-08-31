/**
 * @file screens/profile.js
 * @description Profil gracza: statystyki, **skalpy** (bilans z konkretnymi
 * przeciwnikami), historia partii i — dla własnego profilu — ustawienia konta.
 */

import { el, fill, avatar, toast, modal, fmtAgo } from '../ui.js';
import { store, setState } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openAuthModal, logout } from './auth.js';

/**
 * Renderuje profil.
 * @param {HTMLElement} host
 * @param {object} params - `{ name }` — nazwa konta; brak = własny profil
 * @returns {Promise<Function>}
 */
export default async function profileScreen(host, params = {}) {
    const own = !params.name;

    if (own && !store.user) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie jesteś zalogowany'),
            el('p', { class: 'muted' }, 'Zaloguj się, żeby zobaczyć swój profil i statystyki.'),
            el('button', { class: 'btn btn-primary', onclick: () => openAuthModal('login') }, 'Zaloguj się')));
        return () => {};
    }

    fill(host, el('div', { class: 'loading' }, 'Ładowanie profilu...'));

    let data;
    try {
        data = own ? await api.get('/auth/me') : await api.get(`/players/${encodeURIComponent(params.name)}`);
    } catch (err) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie znalazłem takiego gracza'),
            el('p', { class: 'muted' }, err.message)));
        return () => {};
    }

    const { user, stats, scalps, recent } = data;

    fill(host,
        el('div', { class: 'page profile' },

            // ── Nagłówek ─────────────────────────────────────────────────────
            el('section', { class: 'card profile-head' },
                avatar(user, 'lg'),
                el('div', { class: 'profile-id' },
                    el('h1', { class: 'page-title' }, user.displayName),
                    el('p', { class: 'muted' },
                        `@${user.username}`,
                        user.isGuest ? ' · konto gościa' : '',
                        data.online ? ' · online' : '',
                        ` · dołączył ${fmtAgo(user.createdAt)}`),
                    user.bio ? el('p', {}, user.bio) : null,
                ),
                el('div', { class: 'profile-rating' },
                    el('span', { class: 'stat-value' }, String(user.rating)),
                    el('span', { class: 'stat-label' },
                        stats.rankingPlace ? `${stats.rankingPlace}. w rankingu` : 'ranking'),
                ),
                own ? el('div', { class: 'profile-tools' },
                    el('button', { class: 'btn btn-small', onclick: () => openEditProfile(user) }, 'Edytuj profil'),
                    user.isGuest
                        ? el('button', {
                            class: 'btn btn-small btn-primary',
                            onclick: () => openAuthModal('register'),
                        }, 'Załóż pełne konto')
                        : el('button', { class: 'btn btn-small', onclick: openChangePassword }, 'Zmień hasło'),
                    el('button', { class: 'btn btn-small btn-ghost', onclick: logout }, 'Wyloguj'),
                ) : null,
            ),

            user.isGuest && own
                ? el('div', { class: 'notice' },
                    'Grasz jako gość — twoje statystyki żyją tylko w tej sesji przeglądarki. '
                    + 'Załóż konto, żeby je zachować (dorobek zostanie przeniesiony).')
                : null,

            // ── Statystyki ───────────────────────────────────────────────────
            el('section', { class: 'stat-grid' },
                stat(stats.games, 'partii'),
                stat(stats.wins, 'zwycięstw'),
                stat(stats.losses, 'porażek'),
                stat(stats.draws, 'remisów'),
                stat(`${stats.winRate}%`, 'skuteczność'),
                stat(stats.pointsAvg, 'średnio punktów'),
                stat(stats.bestGame, 'rekord partii'),
                stat(stats.bingos, 'premii za stojak'),
                stat(stats.bestStreak, 'najdłuższa seria'),
            ),

            stats.bestWord
                ? el('p', { class: 'best-word' },
                    'Najlepsze słowo: ',
                    el('strong', {}, stats.bestWord),
                    ` za ${stats.bestWordPoints} pkt`)
                : null,

            el('div', { class: 'two-cols' },

                // ── Skalpy ───────────────────────────────────────────────────
                el('section', { class: 'card' },
                    el('h2', { class: 'panel-title' }, '🗡 Skalpy'),
                    el('p', { class: 'muted small' }, 'Bilans starć z konkretnymi przeciwnikami.'),
                    scalps.length === 0
                        ? el('p', { class: 'muted small' }, 'Jeszcze żadnych pojedynków z żywymi graczami.')
                        : el('ul', { class: 'scalp-list' }, scalps.map(s => {
                            const total = s.wins + s.losses + s.draws;
                            const share = total ? Math.round((s.wins / total) * 100) : 0;
                            return el('li', {
                                class: 'scalp-row',
                                onclick: () => navigate(`/gracz/${s.username}`),
                            },
                                avatar(s, 'sm'),
                                el('div', { class: 'scalp-main' },
                                    el('div', { class: 'scalp-name' }, s.displayName,
                                        s.isGuest ? el('span', { class: 'tag tag-guest' }, 'gość') : null),
                                    el('div', { class: 'scalp-bar' },
                                        el('span', { class: 'scalp-bar-fill', style: { width: `${share}%` } })),
                                ),
                                el('div', { class: 'scalp-score' },
                                    el('span', { class: 'up' }, String(s.wins)), ' : ',
                                    el('span', { class: 'down' }, String(s.losses)),
                                    s.draws ? el('span', { class: 'muted small' }, ` (${s.draws} rem.)`) : null,
                                ),
                            );
                        })),
                ),

                // ── Historia ─────────────────────────────────────────────────
                el('section', { class: 'card' },
                    el('h2', { class: 'panel-title' }, '📜 Ostatnie partie'),
                    recent.length === 0
                        ? el('p', { class: 'muted small' }, 'Brak rozegranych partii.')
                        : el('ul', { class: 'plain-list' }, recent.map(g => el('li', { class: 'history-row' },
                            el('span', { class: `result-badge result-${g.result}` },
                                { win: 'W', loss: 'P', draw: 'R' }[g.result] || '?'),
                            el('div', { class: 'history-main' },
                                el('div', {}, g.opponents.map(o => o.name).join(', ') || 'solo'),
                                el('div', { class: 'muted small' },
                                    `${g.variant} · ${g.score} pkt`
                                    + (g.bestWord ? ` · ${g.bestWord} (${g.bestWordPoints})` : '')
                                    + ` · ${fmtAgo(g.finishedAt)}`),
                            ),
                            g.ratingDelta != null
                                ? el('span', { class: `result-delta ${g.ratingDelta >= 0 ? 'up' : 'down'}` },
                                    `${g.ratingDelta >= 0 ? '+' : ''}${g.ratingDelta}`)
                                : null,
                        ))),
                ),
            ),
        ),
    );

    return () => {};
}

/**
 * Kafelek statystyki.
 * @param {number|string} value
 * @param {string} label
 * @returns {HTMLElement}
 */
function stat(value, label) {
    return el('div', { class: 'stat-tile' },
        el('span', { class: 'stat-value' }, String(value ?? 0)),
        el('span', { class: 'stat-label' }, label));
}

/**
 * Okno edycji profilu.
 * @param {object} user
 */
function openEditProfile(user) {
    const display = el('input', { type: 'text', value: user.displayName, maxlength: '24' });
    const avatarInput = el('input', { type: 'text', value: user.avatar || '', maxlength: '4', placeholder: 'np. 🦊' });
    const bio = el('textarea', { rows: '3', maxlength: '200', placeholder: 'Kilka słów o sobie' }, user.bio || '');
    const error = el('p', { class: 'form-error' });

    modal({
        title: 'Edycja profilu',
        body: el('div', { class: 'form' },
            el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Nazwa widoczna dla innych'), display),
            el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Awatar (emoji)'), avatarInput),
            el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'O mnie'), bio),
            error),
        actions: [
            { label: 'Anuluj' },
            {
                label: 'Zapisz', kind: 'primary',
                onClick: async () => {
                    try {
                        const res = await api.patch('/profile', {
                            displayName: display.value.trim(),
                            avatar: avatarInput.value.trim(),
                            bio: bio.value.trim(),
                        });
                        setState({ user: res.user });
                        toast('Profil zapisany.', 'ok');
                        navigate('/profil');
                        location.reload();
                    } catch (err) {
                        error.textContent = err.message;
                        return false;
                    }
                },
            },
        ],
    });
}

/** Okno zmiany hasła. */
function openChangePassword() {
    const oldPassword = el('input', { type: 'password', placeholder: 'Obecne hasło', autocomplete: 'current-password' });
    const newPassword = el('input', { type: 'password', placeholder: 'Nowe hasło', autocomplete: 'new-password' });
    const error = el('p', { class: 'form-error' });

    modal({
        title: 'Zmiana hasła',
        body: el('div', { class: 'form' }, oldPassword, newPassword, error),
        actions: [
            { label: 'Anuluj' },
            {
                label: 'Zmień', kind: 'primary',
                onClick: async () => {
                    try {
                        await api.post('/profile/password', {
                            oldPassword: oldPassword.value,
                            newPassword: newPassword.value,
                        });
                        toast('Hasło zmienione.', 'ok');
                    } catch (err) {
                        error.textContent = err.message;
                        return false;
                    }
                },
            },
        ],
    });
}
