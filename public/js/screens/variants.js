/**
 * @file screens/variants.js
 * @description Lista trybów gry: wbudowane, publiczne i własne. Stąd tryb można
 * podejrzeć, skopiować do siebie, przerobić albo od razu założyć na nim stół.
 */

import { el, fill, toast, confirmDialog, plural } from '../ui.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openAuthModal } from './auth.js';
import { openCreateTable } from './lobby.js';
import { miniBoard } from '../game/miniBoard.js';

/**
 * Renderuje listę trybów gry.
 * @param {HTMLElement} host
 * @returns {Promise<Function>}
 */
export default async function variantsScreen(host) {
    fill(host, el('div', { class: 'loading' }, 'Ładowanie trybów...'));

    let variants = [];
    try {
        variants = (await api.get('/variants')).variants;
    } catch (err) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Nie udało się pobrać trybów'),
            el('p', { class: 'muted' }, err.message)));
        return () => {};
    }

    const mine = variants.filter(v => v.canEdit);
    const system = variants.filter(v => v.isSystem);
    const others = variants.filter(v => !v.isSystem && !v.canEdit);

    /** Odświeża ekran po zmianie. */
    const reload = () => variantsScreen(host);

    /**
     * Karta trybu gry.
     * @param {object} v
     * @returns {HTMLElement}
     */
    function card(v) {
        return el('div', { class: 'card variant-card' },
            el('div', { class: 'variant-preview' }, miniBoard(v.previewGrid || null, v.summary.size)),

            el('div', { class: 'variant-body' },
                el('div', { class: 'variant-head' },
                    el('h3', {}, v.name),
                    v.isSystem ? el('span', { class: 'chip' }, 'wbudowany') : null,
                    !v.isPublic ? el('span', { class: 'chip chip-lock' }, 'prywatny') : null,
                ),
                el('p', { class: 'muted small' }, v.description || 'Bez opisu.'),

                el('ul', { class: 'variant-specs' },
                    spec('Plansza', `${v.summary.size}×${v.summary.size}`),
                    spec('Klocki', String(v.summary.tiles)),
                    spec('Blanki', String(v.summary.blanks)),
                    spec('Stojak', String(v.summary.rackSize)),
                    spec('Pola premiowe', String(v.summary.premiums)),
                    spec('Suma punktów', String(v.summary.pointSum)),
                ),

                el('div', { class: 'variant-actions' },
                    el('button', {
                        class: 'btn btn-primary btn-small',
                        onclick: () => {
                            if (!store.user) { openAuthModal('login'); return; }
                            openCreateTable(variants.map(x => ({ ...x })), v.id);
                        },
                    }, 'Zagraj'),

                    el('button', {
                        class: 'btn btn-small',
                        onclick: () => navigate(`/tryby/${v.id}`),
                    }, v.canEdit ? 'Edytuj' : 'Podejrzyj'),

                    store.user && !store.user.isGuest
                        ? el('button', {
                            class: 'btn btn-small btn-ghost',
                            onclick: async () => {
                                try {
                                    const res = await api.post(`/variants/${v.id}/copy`);
                                    toast(`Skopiowano jako „${res.variant.name}".`, 'ok');
                                    navigate(`/tryby/${res.variant.id}`);
                                } catch (err) {
                                    toast(err.message, 'error');
                                }
                            },
                        }, 'Skopiuj')
                        : null,

                    v.canEdit
                        ? el('button', {
                            class: 'btn btn-small btn-danger',
                            onclick: async () => {
                                if (!await confirmDialog(`Usunąć tryb „${v.name}"?`)) return;
                                try {
                                    await api.del(`/variants/${v.id}`);
                                    toast('Tryb usunięty.', 'ok');
                                    reload();
                                } catch (err) {
                                    toast(err.message, 'error');
                                }
                            },
                        }, 'Usuń')
                        : null,
                ),

                el('p', { class: 'muted tiny' },
                    `Rozegranych partii: ${v.plays}`),
            ),
        );
    }

    fill(host,
        el('div', { class: 'page' },
            el('div', { class: 'page-head' },
                el('div', {},
                    el('h1', { class: 'page-title' }, '🧩 Tryby gry'),
                    el('p', { class: 'muted' },
                        'Tryb gry to komplet zasad: plansza, rozmieszczenie premii, zestaw liter, '
                        + 'punktacja i kolory. Nic z tego nie jest zaszyte w kodzie — możesz zbudować własny od zera.'),
                ),
                store.user && !store.user.isGuest
                    ? el('button', { class: 'btn btn-primary', onclick: () => navigate('/tryby/nowy') }, '➕ Nowy tryb')
                    : el('button', {
                        class: 'btn',
                        onclick: () => openAuthModal(store.user ? 'register' : 'login'),
                    }, 'Załóż konto, żeby tworzyć tryby'),
            ),

            section('Wbudowane', system, card),
            mine.length ? section(`Moje tryby (${plural(mine.length, 'tryb', 'tryby', 'trybów')})`, mine, card) : null,
            others.length ? section('Od innych graczy', others, card) : null,
        ),
    );

    return () => {};
}

/**
 * Sekcja z listą kart.
 * @param {string} title
 * @param {Array<object>} items
 * @param {Function} render
 * @returns {HTMLElement|null}
 */
function section(title, items, render) {
    if (!items.length) return null;
    return el('section', { class: 'variant-section' },
        el('h2', { class: 'section-title' }, title),
        el('div', { class: 'variant-grid' }, items.map(render)));
}

/**
 * Element listy parametrów trybu.
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function spec(label, value) {
    return el('li', {}, el('span', { class: 'muted' }, label + ': '), el('strong', {}, value));
}
