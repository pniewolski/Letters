/**
 * @file screens/ranking.js
 * @description Ranking graczy. Pozycję wyznacza ranking Elo aktualizowany po
 * każdej partii rankingowej; partie z komputerem i partie gości go nie ruszają.
 */

import { el, fill, avatar, plural } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { store } from '../store.js';

/**
 * Renderuje ranking.
 * @param {HTMLElement} host
 * @returns {Promise<Function>}
 */
export default async function rankingScreen(host) {
    fill(host, el('div', { class: 'loading' }, 'Ładowanie rankingu...'));

    let ranking = [];
    try {
        ranking = (await api.get('/ranking', { limit: 100 })).ranking;
    } catch (err) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie udało się pobrać rankingu'),
            el('p', { class: 'muted' }, err.message)));
        return () => {};
    }

    fill(host,
        el('div', { class: 'page' },
            el('h1', { class: 'page-title' }, '🏆 Ranking'),
            el('p', { class: 'muted' },
                'Liczą się partie między zarejestrowanymi graczami. '
                + 'Gra z komputerem i partie gości nie wpływają na pozycję.'),

            ranking.length === 0
                ? el('div', { class: 'card empty-state' },
                    el('h2', {}, 'Ranking jest jeszcze pusty'),
                    el('p', { class: 'muted' }, 'Rozegraj pierwszą partię z żywym przeciwnikiem, a pojawisz się tutaj.'),
                    el('button', { class: 'btn btn-primary', onclick: () => navigate('/lobby') }, 'Szukaj przeciwnika'))
                : el('div', { class: 'card table-scroll' },
                    el('table', { class: 'data-table' },
                        el('thead', {}, el('tr', {},
                            el('th', {}, '#'),
                            el('th', {}, 'Gracz'),
                            el('th', { class: 'num' }, 'Ranking'),
                            el('th', { class: 'num' }, 'Partie'),
                            el('th', { class: 'num' }, 'W / R / P'),
                            el('th', { class: 'num' }, 'Skuteczność'),
                            el('th', { class: 'num' }, 'Rekord'),
                            el('th', { class: 'num' }, 'Premie'),
                        )),
                        el('tbody', {}, ranking.map(r => el('tr', {
                            class: store.user && store.user.id === r.userId ? 'row-me' : '',
                            onclick: () => navigate(`/gracz/${r.username}`),
                        },
                            el('td', { class: 'rank-place' }, String(r.place)),
                            el('td', {}, el('div', { class: 'cell-player' },
                                avatar({ avatar: r.avatar, name: r.displayName }, 'sm'),
                                el('span', {}, r.displayName))),
                            el('td', { class: 'num strong' }, String(r.rating)),
                            el('td', { class: 'num' }, String(r.games)),
                            el('td', { class: 'num' }, `${r.wins} / ${r.draws} / ${r.losses}`),
                            el('td', { class: 'num' }, `${r.winRate}%`),
                            el('td', { class: 'num' }, String(r.bestGame)),
                            el('td', { class: 'num' }, String(r.bingos)),
                        ))),
                    )),

            el('p', { class: 'muted tiny' },
                `Notowanych graczy: ${plural(ranking.length, 'osoba', 'osoby', 'osób')}.`),
        ),
    );

    return () => {};
}
