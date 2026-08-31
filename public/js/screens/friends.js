/**
 * @file screens/friends.js
 * @description Znajomi: lista, zaproszenia i wyszukiwarka graczy. Dzięki temu
 * da się grać nie tylko z przypadkowymi ludźmi z lobby, ale i „ze swoimi".
 */

import { el, fill, toast, avatar, fmtAgo, plural } from '../ui.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openAuthModal } from './auth.js';

/**
 * Renderuje ekran znajomych.
 * @param {HTMLElement} host
 * @returns {Promise<Function>}
 */
export default async function friendsScreen(host) {
    if (!store.user || store.user.isGuest) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Lista znajomych wymaga konta'),
            el('p', { class: 'muted' }, 'Gość nie ma gdzie zapisać znajomych — jego sesja znika po zamknięciu karty.'),
            el('button', {
                class: 'btn btn-primary',
                onclick: () => openAuthModal(store.user ? 'register' : 'login'),
            }, store.user ? 'Załóż pełne konto' : 'Zaloguj się')));
        return () => {};
    }

    const listEl = el('div', { class: 'friends-lists' });
    const resultsEl = el('div', { class: 'search-results' });

    const searchInput = el('input', {
        type: 'search', placeholder: 'Szukaj gracza po nazwie...', maxlength: '32',
        oninput: () => scheduleSearch(),
    });

    fill(host,
        el('div', { class: 'page' },
            el('h1', { class: 'page-title' }, '👥 Znajomi'),
            el('p', { class: 'muted' },
                'Dodaj graczy, z którymi lubisz grać. Zaproszenie musi zostać przyjęte przez drugą stronę.'),
            el('div', { class: 'card' },
                el('h2', { class: 'panel-title' }, 'Znajdź gracza'),
                searchInput,
                resultsEl),
            listEl,
        ),
    );

    let searchTimer = null;

    /** Wyszukiwanie z opóźnieniem, żeby nie pytać serwera przy każdej literze. */
    function scheduleSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(runSearch, 300);
    }

    /** Pobiera i pokazuje wyniki wyszukiwania. */
    async function runSearch() {
        const query = searchInput.value.trim();
        if (query.length < 2) { resultsEl.replaceChildren(); return; }

        try {
            const { players } = await api.get('/players', { q: query });
            const found = players.filter(p => p.id !== store.user.id);

            fill(resultsEl, found.length === 0
                ? el('p', { class: 'muted small' }, 'Nikogo takiego nie znalazłem.')
                : el('ul', { class: 'plain-list' }, found.map(p => el('li', { class: 'friend-row' },
                    avatar({ avatar: p.avatar, name: p.display_name }, 'sm'),
                    el('div', { class: 'friend-main' },
                        el('div', {}, p.display_name),
                        el('div', { class: 'muted small' }, `@${p.username} · ranking ${p.rating}`)),
                    el('button', {
                        class: 'btn btn-small btn-primary',
                        onclick: async () => {
                            try {
                                await api.post(`/friends/${p.id}`, { action: 'invite' });
                                toast('Zaproszenie wysłane.', 'ok');
                                reload();
                            } catch (err) { toast(err.message, 'error'); }
                        },
                    }, 'Zaproś'),
                ))));
        } catch (err) {
            fill(resultsEl, el('p', { class: 'form-error' }, err.message));
        }
    }

    /**
     * Wiersz znajomego z akcjami.
     * @param {object} f
     * @param {'accepted'|'pending'|'incoming'} kind
     * @returns {HTMLElement}
     */
    function friendRow(f, kind) {
        return el('li', { class: 'friend-row' },
            avatar(f, 'sm'),
            el('div', { class: 'friend-main', onclick: () => navigate(`/gracz/${f.username}`) },
                el('div', {}, f.displayName,
                    f.online ? el('span', { class: 'dot-online', title: 'online' }) : null),
                el('div', { class: 'muted small' },
                    `ranking ${f.rating} · ostatnio ${fmtAgo(f.lastSeenAt)}`)),

            kind === 'incoming'
                ? el('button', {
                    class: 'btn btn-small btn-primary',
                    onclick: async () => {
                        try {
                            await api.post(`/friends/${f.userId}`, { action: 'accept' });
                            toast('Dodano do znajomych.', 'ok');
                            reload();
                        } catch (err) { toast(err.message, 'error'); }
                    },
                }, 'Przyjmij')
                : null,

            el('button', {
                class: 'btn btn-small btn-ghost',
                title: kind === 'accepted' ? 'Usuń ze znajomych' : 'Anuluj',
                onclick: async () => {
                    try {
                        await api.del(`/friends/${f.userId}`);
                        reload();
                    } catch (err) { toast(err.message, 'error'); }
                },
            }, '✕'),
        );
    }

    /** Pobiera i rysuje listy znajomych. */
    async function reload() {
        try {
            const data = await api.get('/friends');
            fill(listEl,
                block('Znajomi', data.accepted, 'accepted',
                    'Nikogo tu jeszcze nie ma — wyszukaj graczy powyżej.'),
                data.incoming.length ? block('Zaproszenia do ciebie', data.incoming, 'incoming') : null,
                data.pending.length ? block('Wysłane zaproszenia', data.pending, 'pending') : null,
            );
        } catch (err) {
            fill(listEl, el('p', { class: 'form-error' }, err.message));
        }
    }

    /**
     * Sekcja listy.
     * @param {string} title
     * @param {Array<object>} items
     * @param {string} kind
     * @param {string} [emptyText]
     * @returns {HTMLElement}
     */
    function block(title, items, kind, emptyText) {
        return el('section', { class: 'card' },
            el('h2', { class: 'panel-title' }, `${title} (${items.length})`),
            items.length === 0
                ? el('p', { class: 'muted small' }, emptyText || 'Pusto.')
                : el('ul', { class: 'plain-list' }, items.map(f => friendRow(f, kind))),
            kind === 'accepted' && items.length
                ? el('p', { class: 'muted tiny' },
                    `${plural(items.filter(f => f.online).length, 'osoba jest', 'osoby są', 'osób jest')} teraz online.`)
                : null,
        );
    }

    reload();
    return () => clearTimeout(searchTimer);
}
