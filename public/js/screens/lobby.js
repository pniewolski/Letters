/**
 * @file screens/lobby.js
 * @description Lobby: lista otwartych stołów, zakładanie własnego i dołączanie
 * po kodzie. Lista odświeża się sama — serwer rozsyła ją przy każdej zmianie.
 */

import { el, fill, toast, modal, avatar, plural, fmtAgo } from '../ui.js';
import { store, subscribe, setState, clearPlacement } from '../store.js';
import { call } from '../net.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { openAuthModal, playAsGuest } from './auth.js';

/**
 * Renderuje lobby.
 * @param {HTMLElement} host
 * @returns {Promise<Function>} Funkcja sprzątająca
 */
export default async function lobbyScreen(host) {
    const listEl = el('div', { class: 'table-list' });
    const headEl = el('div', { class: 'lobby-head' });

    fill(host,
        el('div', { class: 'lobby' },
            headEl,
            listEl,
        ),
    );

    // Tryby gry są potrzebne do formularza zakładania stołu.
    let variants = [];
    try {
        variants = (await api.get('/variants')).variants;
    } catch (err) {
        toast('Nie udało się pobrać trybów gry: ' + err.message, 'error');
    }

    /** Nagłówek z przyciskami. */
    function renderHead() {
        fill(headEl,
            el('div', {},
                el('h1', { class: 'page-title' }, 'Stoły'),
                el('p', { class: 'muted' },
                    `${plural(store.tables.length, 'stół', 'stoły', 'stołów')} · `
                    + `${plural(store.online, 'gracz', 'graczy', 'graczy')} online`),
            ),
            el('div', { class: 'lobby-actions' },
                el('button', {
                    class: 'btn btn-primary',
                    onclick: () => requireUser(() => openCreateTable(variants)),
                }, '➕ Załóż stół'),
                el('button', {
                    class: 'btn',
                    onclick: () => requireUser(openJoinByCode),
                }, '🔑 Dołącz po kodzie'),
            ),
        );
    }

    /** Lista stołów. */
    function renderList() {
        if (store.tables.length === 0) {
            fill(listEl, el('div', { class: 'card empty-state' },
                el('h2', {}, 'Cicho tu'),
                el('p', { class: 'muted' }, 'Nikt jeszcze nie otworzył stołu. Załóż pierwszy — komputer zawsze chętnie zagra.'),
                el('button', {
                    class: 'btn btn-primary',
                    onclick: () => requireUser(() => openCreateTable(variants)),
                }, 'Załóż stół'),
            ));
            return;
        }

        fill(listEl, ...store.tables.map(tableCard));
    }

    /**
     * Karta pojedynczego stołu.
     * @param {object} table
     * @returns {HTMLElement}
     */
    function tableCard(table) {
        const open = table.seats - table.taken;
        const joinable = table.status === 'waiting' && open > 0;
        const mine = store.user && table.players.some(p => p.userId === store.user.id);

        const statusLabel = {
            waiting: open > 0 ? `czeka na ${plural(open, 'gracza', 'graczy', 'graczy')}` : 'komplet',
            playing: 'partia w toku',
            finished: 'po partii',
        }[table.status] || table.status;

        return el('div', { class: `card table-card status-${table.status}` },
            el('div', { class: 'table-card-head' },
                el('h3', { class: 'table-name' }, table.name),
                el('span', { class: 'chip chip-variant' }, table.variant.name),
                table.hasPassword ? el('span', { class: 'chip chip-lock', title: 'Stół na hasło' }, '🔒') : null,
                table.rated ? el('span', { class: 'chip chip-rated', title: 'Partia rankingowa' }, 'ranking') : null,
            ),

            el('div', { class: 'seat-row' }, table.players.map(p => el('div', {
                class: `seat seat-${p.type}`,
                title: p.name || 'Wolne miejsce',
            },
                p.type === 'open'
                    ? el('span', { class: 'seat-empty' }, '+')
                    : avatar({ avatar: p.avatar, name: p.name }, 'sm'),
                el('span', { class: 'seat-name' }, p.name || 'wolne'),
            ))),

            el('div', { class: 'table-card-meta muted small' },
                `${statusLabel} · plansza ${table.variant.size}×${table.variant.size}`,
                table.turnSeconds ? ` · ${table.turnSeconds}s na ruch` : ' · bez limitu czasu',
                table.spectators ? ` · ${plural(table.spectators, 'widz', 'widzów', 'widzów')}` : '',
                ` · ${fmtAgo(table.createdAt)}`,
            ),

            el('div', { class: 'table-card-actions' },
                mine
                    ? el('button', { class: 'btn btn-primary btn-small', onclick: () => joinTable(table) }, 'Wróć do stołu')
                    : joinable
                        ? el('button', { class: 'btn btn-primary btn-small', onclick: () => joinTable(table) }, 'Siadam')
                        : el('button', {
                            class: 'btn btn-small',
                            onclick: () => joinTable(table, { asSpectator: true }),
                        }, '👁 Oglądaj'),
            ),
        );
    }

    /**
     * Dołącza do stołu (z zapytaniem o hasło, jeśli trzeba).
     * @param {object} table
     * @param {object} [options]
     */
    async function joinTable(table, options = {}) {
        if (!store.user) { promptLogin(); return; }

        let password;
        if (table.hasPassword && !table.players.some(p => p.userId === store.user.id)) {
            password = await askPassword(table.name);
            if (password == null) return;
        }

        try {
            const res = await call('table:join', { tableId: table.id, password, ...options });
            if (!res.success) { toast(res.error, 'error'); return; }
            clearPlacement();
            setState({ table: res.table, game: res.game, results: null });
            navigate('/gra');
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    /** Okno dołączania po kodzie. */
    function openJoinByCode() {
        const code = el('input', { type: 'text', placeholder: 'np. K7M2QP', maxlength: '12', class: 'code-input' });
        const password = el('input', { type: 'password', placeholder: 'Hasło (jeśli stół je ma)' });
        const error = el('p', { class: 'form-error' });

        modal({
            title: 'Dołącz po kodzie',
            body: el('div', { class: 'form' },
                el('p', { class: 'muted small' }, 'Kod dostajesz od osoby, która założyła stół.'),
                code, password, error),
            actions: [
                { label: 'Anuluj' },
                {
                    label: 'Dołącz', kind: 'primary',
                    onClick: async () => {
                        try {
                            const res = await call('table:joinCode', {
                                code: code.value.trim().toUpperCase(),
                                password: password.value || undefined,
                            });
                            if (!res.success) { error.textContent = res.error; return false; }
                            clearPlacement();
                            setState({ table: res.table, game: res.game, results: null });
                            navigate('/gra');
                        } catch (err) {
                            error.textContent = err.message;
                            return false;
                        }
                    },
                },
            ],
        });
    }

    /**
     * Prosi o hasło do stołu.
     * @param {string} name
     * @returns {Promise<string|null>}
     */
    function askPassword(name) {
        return new Promise(resolve => {
            const input = el('input', { type: 'password', placeholder: 'Hasło' });
            modal({
                title: `Stół „${name}" jest na hasło`,
                body: el('div', { class: 'form' }, input),
                actions: [
                    { label: 'Anuluj', onClick: () => resolve(null) },
                    { label: 'Dołącz', kind: 'primary', onClick: () => resolve(input.value) },
                ],
            });
        });
    }

    /**
     * Wykonuje akcję wymagającą konta — anonimowemu proponuje logowanie.
     * @param {Function} fn
     */
    function requireUser(fn) {
        if (store.user) { fn(); return; }
        promptLogin();
    }

    /** Zachęca do zalogowania albo gry jako gość. */
    function promptLogin() {
        modal({
            title: 'Zanim usiądziesz do stołu',
            body: el('p', {}, 'Żeby grać, potrzebujesz konta albo sesji gościa. Gość gra od razu, '
                + 'ale jego dorobek znika po zamknięciu karty.'),
            actions: [
                {
                    label: 'Graj jako gość',
                    onClick: async () => {
                        try { await playAsGuest(); } catch (err) { toast(err.message, 'error'); }
                    },
                },
                { label: 'Zaloguj / załóż konto', kind: 'primary', onClick: () => openAuthModal('login') },
            ],
        });
    }

    const unsub = [
        subscribe(['tables', 'online'], () => { renderHead(); renderList(); }),
        subscribe('user', renderHead),
    ];

    // Poproś serwer o świeżą listę (na wypadek wejścia prosto z adresu).
    call('lobby').then(res => {
        if (res.success) setState({ tables: res.tables, online: res.online });
    }).catch(() => {});

    renderHead();
    renderList();

    return () => unsub.forEach(fn => fn());
}

/**
 * Okno zakładania stołu.
 * @param {Array<object>} variants - Dostępne tryby gry
 * @param {number|null} [preselectVariantId] - Tryb wybrany z góry (np. z listy trybów)
 */
export function openCreateTable(variants, preselectVariantId = null) {
    const name = el('input', { type: 'text', placeholder: 'Nazwa stołu', maxlength: '64' });

    const variantSelect = el('select', {},
        variants.map(v => el('option', { value: String(v.id) },
            `${v.name} — plansza ${v.summary.size}×${v.summary.size}, ${v.summary.tiles} klocków`)));

    const seats = el('select', {},
        [2, 3, 4].map(n => el('option', { value: String(n) }, plural(n, 'gracz', 'graczy', 'graczy'))));

    const computerSeats = el('select', {});
    const aiLevel = el('select', {},
        (store.config.aiLevels || []).map(l => el('option', { value: String(l.level) }, l.name)));

    const turnSeconds = el('select', {},
        [
            ['0', 'bez limitu'], ['30', '30 sekund'], ['60', 'minuta'],
            ['120', '2 minuty'], ['300', '5 minut'],
        ].map(([value, label]) => el('option', { value }, label)));

    const isPrivate = el('input', { type: 'checkbox' });
    const password = el('input', { type: 'password', placeholder: 'Hasło (opcjonalnie)' });
    const error = el('p', { class: 'form-error' });
    const ratedNote = el('p', { class: 'muted tiny' });

    /** Aktualizuje liczbę miejsc dla komputera po zmianie liczby graczy. */
    function syncComputerSeats() {
        const total = Number(seats.value);
        const previous = Number(computerSeats.value || 0);
        computerSeats.replaceChildren(
            ...Array.from({ length: total + 1 }, (_, n) => el('option', { value: String(n) },
                n === 0 ? 'sami ludzie' : (n === total ? 'same komputery (podgląd)' : plural(n, 'komputer', 'komputery', 'komputerów')))),
        );
        computerSeats.value = String(Math.min(previous, total));
        syncNote();
    }

    /** Wyjaśnia, kiedy partia liczy się do rankingu. */
    function syncNote() {
        const bots = Number(computerSeats.value || 0);
        const guest = store.user?.isGuest;
        ratedNote.textContent = bots > 0
            ? 'Partie z komputerem nie liczą się do rankingu.'
            : guest
                ? 'Grasz jako gość — partia nie wpłynie na ranking, ale zapisze się w twojej sesji.'
                : 'Partia będzie rankingowa.';
    }

    if (preselectVariantId) variantSelect.value = String(preselectVariantId);
    seats.value = '2';
    syncComputerSeats();
    seats.onchange = syncComputerSeats;
    computerSeats.onchange = syncNote;
    name.value = store.user ? `Stolik ${store.user.displayName}` : 'Stolik';

    modal({
        title: 'Nowy stół',
        body: el('div', { class: 'form form-grid' },
            field('Nazwa', name),
            field('Tryb gry', variantSelect),
            field('Liczba miejsc', seats),
            field('Miejsca dla komputera', computerSeats),
            field('Poziom komputera', aiLevel),
            field('Czas na ruch', turnSeconds),
            field('Hasło', password),
            el('label', { class: 'checkbox-row' }, isPrivate, ' Ukryj stół w lobby (tylko po kodzie)'),
            ratedNote,
            error,
        ),
        actions: [
            { label: 'Anuluj' },
            {
                label: 'Zakładam', kind: 'primary',
                onClick: async () => {
                    try {
                        const res = await call('table:create', {
                            name: name.value.trim(),
                            variantId: Number(variantSelect.value),
                            seats: Number(seats.value),
                            computerSeats: Number(computerSeats.value),
                            aiLevel: Number(aiLevel.value),
                            turnSeconds: Number(turnSeconds.value),
                            isPrivate: isPrivate.checked,
                            password: password.value || undefined,
                        });
                        if (!res.success) { error.textContent = res.error; return false; }

                        clearPlacement();
                        setState({ table: res.table, game: res.game, results: null });
                        navigate('/gra');
                    } catch (err) {
                        error.textContent = err.message;
                        return false;
                    }
                },
            },
        ],
    });
}

/**
 * Etykietowane pole formularza.
 * @param {string} label
 * @param {HTMLElement} input
 * @returns {HTMLElement}
 */
function field(label, input) {
    return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input);
}
