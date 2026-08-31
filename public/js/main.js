/**
 * @file main.js
 * @description Punkt wejścia portalu: wczytuje konfigurację, odtwarza sesję,
 * buduje nagłówek, uruchamia router i rozdziela zdarzenia z WebSocketa.
 *
 * To jedyne miejsce, które zna wszystkie ekrany — moduły niżej nie wiedzą
 * o sobie nawzajem.
 */

import { el, fill, toast, avatar, plural } from './ui.js';
import { store, setState, setToken, subscribe, clearPlacement, pushFeed } from './store.js';
import { api } from './api.js';
import { connect, onMessage, call } from './net.js';
import { registerRoutes, startRouter, navigate, currentRoute } from './router.js';
import { receivePreview, clearPreviews } from './game/preview.js';

import homeScreen from './screens/home.js';
import lobbyScreen from './screens/lobby.js';
import gameScreen from './screens/game.js';
import rankingScreen from './screens/ranking.js';
import profileScreen from './screens/profile.js';
import variantsScreen from './screens/variants.js';
import variantEditorScreen from './screens/variantEditor.js';
import friendsScreen from './screens/friends.js';
import authScreen, { openAuthModal, playAsGuest, logout } from './screens/auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// NAGŁÓWEK
// ─────────────────────────────────────────────────────────────────────────────

/** Pozycje menu głównego. */
const NAV = [
    { path: '/', label: 'Start', icon: '🏠' },
    { path: '/lobby', label: 'Stoły', icon: '🪑' },
    { path: '/tryby', label: 'Tryby gry', icon: '🧩' },
    { path: '/ranking', label: 'Ranking', icon: '🏆' },
    { path: '/znajomi', label: 'Znajomi', icon: '👥' },
    { path: '/solver.html', label: 'Solver', icon: '🔍', external: true },
];

/** Rysuje górny pasek portalu. */
function renderHeader() {
    const header = document.getElementById('app-header');
    if (!header) return;

    const route = currentRoute();

    fill(header,
        el('div', { class: 'header-inner' },
            el('a', {
                class: 'brand', href: '#/',
                onclick: (e) => { e.preventDefault(); navigate('/'); },
            },
                el('span', { class: 'brand-mark' }, 'L'),
                el('span', { class: 'brand-name' }, store.config.title)),

            el('nav', { class: 'main-nav' }, NAV.map(item => el('a', {
                class: `nav-link ${route === item.path || (item.path !== '/' && route.startsWith(item.path)) ? 'active' : ''}`,
                href: item.external ? item.path : `#${item.path}`,
                onclick: item.external ? null : (e) => { e.preventDefault(); navigate(item.path); },
            }, el('span', { class: 'nav-icon' }, item.icon), el('span', { class: 'nav-label' }, item.label)))),

            el('div', { class: 'header-right' },
                store.table
                    ? el('button', {
                        class: 'btn btn-small btn-primary',
                        onclick: () => navigate('/gra'),
                    }, '▶ Wróć do stołu')
                    : null,

                el('span', {
                    class: `conn conn-${store.connection}`,
                    title: {
                        on: 'Połączono z serwerem',
                        connecting: 'Łączenie...',
                        off: 'Brak połączenia — próbuję ponownie',
                    }[store.connection],
                }, store.online ? plural(store.online, 'gracz', 'graczy', 'graczy') : ''),

                store.user
                    ? el('button', {
                        class: 'user-chip',
                        onclick: () => navigate('/profil'),
                        title: 'Twój profil',
                    },
                        avatar(store.user, 'sm'),
                        el('span', { class: 'user-name' }, store.user.displayName),
                        store.user.isGuest ? el('span', { class: 'tag tag-guest' }, 'gość') : null)
                    : el('div', { class: 'header-auth' },
                        el('button', {
                            class: 'btn btn-small',
                            onclick: async () => {
                                try { await playAsGuest(); } catch (err) { toast(err.message, 'error'); }
                            },
                        }, 'Graj jako gość'),
                        el('button', {
                            class: 'btn btn-small btn-primary',
                            onclick: () => openAuthModal('login'),
                        }, 'Zaloguj')),

                store.user
                    ? el('button', { class: 'btn btn-tiny btn-ghost', title: 'Wyloguj', onclick: logout }, '⏻')
                    : null,
            ),
        ),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// ZDARZENIA Z SERWERA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rozdziela wiadomości przychodzące z WebSocketa.
 * @param {object} msg
 */
function handleServerMessage(msg) {
    switch (msg.type) {
        case 'hello':
            break;

        // Odpowiedź na `auth` po (ponownym) połączeniu — odtwarza stan stołu.
        case 'auth:restored':
            if (!msg.success) return;
            setState({
                user: msg.user,
                table: msg.table,
                game: msg.game,
                tables: msg.tables || [],
                online: msg.online || 0,
            });
            if (msg.table && currentRoute() === '/gra') clearPlacement();
            break;

        case 'lobby':
            setState({ tables: msg.tables, online: msg.online });
            break;

        case 'table':
            setState({ table: msg.table });
            break;

        case 'table:closed':
            if (store.table && store.table.id === msg.tableId) {
                setState({ table: null, game: null, results: null });
                clearPlacement();
                clearPreviews();
                toast(`Stół został zamknięty (${msg.reason || 'koniec'}).`, 'info');
                if (currentRoute() === '/gra') navigate('/lobby');
            }
            break;

        case 'game':
            handleGameState(msg.state);
            break;

        case 'game:move':
            describeMove(msg);
            break;

        case 'game:over':
            setState({ game: msg.state, results: msg.results });
            clearPlacement();
            clearPreviews();
            announceResults(msg.results);
            break;

        case 'chat':
            pushFeed({
                kind: msg.entry.system ? 'system' : 'chat',
                name: msg.entry.system ? null : msg.entry.name,
                text: msg.entry.message,
            });
            break;

        case 'preview':
            receivePreview(msg.slot, msg.tiles);
            break;

        case 'error':
            toast(msg.error, 'error');
            break;

        default:
            break;
    }
}

/**
 * Przyjmuje nowy stan partii. Jeśli zmienił się numer partii albo nasz stojak,
 * czyścimy niedokończone układanie — inaczej klocki wisiałyby w powietrzu.
 * @param {object} state
 */
function handleGameState(state) {
    const previous = store.game;
    const newGame = !previous || previous.gameId !== state.gameId;
    const rackChanged = previous && JSON.stringify(previous.myRack) !== JSON.stringify(state.myRack);

    setState({ game: state });

    if (newGame) {
        clearPlacement();
        clearPreviews();
        setState({ results: null });
    } else if (rackChanged && store.placed.length) {
        clearPlacement();
    }
}

/**
 * Zamienia ruch na wpis w logu przy stole.
 * @param {object} msg - `{ move, playerName, isComputer }`
 */
function describeMove(msg) {
    const move = msg.move;
    const who = msg.playerName || `Gracz ${move.slot + 1}`;

    const text = {
        word: () => `${move.wordSimple} za ${move.points} pkt${move.bingo ? ' 🎉 premia za stojak!' : ''}`,
        exchange: () => `wymienia ${plural((move.letters || []).length, 'literę', 'litery', 'liter')}`,
        pass: () => (move.timeout ? 'nie zdążył — pas' : 'pasuje'),
        invalid: () => `traci turę (nie znam słowa: ${(move.wrongWords || []).join(', ')})`,
        resign: () => 'poddaje partię',
    }[move.type];

    pushFeed({ kind: 'move', name: who, text: text ? text() : move.type });

    // Podgląd cudzego układania przestaje być aktualny po jego ruchu.
    clearPreviews();
}

/**
 * Ogłasza wynik partii.
 * @param {Array<object>} results
 */
function announceResults(results) {
    if (!results || results.length === 0) return;

    const sorted = [...results].sort((a, b) => a.place - b.place);
    const winners = sorted.filter(r => r.place === 1);

    const summary = winners.length > 1
        ? `Remis: ${winners.map(r => r.name).join(' i ')}`
        : `Wygrywa ${winners[0].name} (${winners[0].score} pkt)`;

    pushFeed({ kind: 'system', text: `🏁 Koniec partii. ${summary}.` });

    const me = store.game && store.game.mySlot != null
        ? results.find(r => r.slot === store.game.mySlot)
        : null;

    if (me) {
        const kind = me.result === 'win' ? 'ok' : (me.result === 'draw' ? 'info' : 'error');
        const delta = me.ratingDelta != null ? ` (${me.ratingDelta >= 0 ? '+' : ''}${me.ratingDelta} rankingu)` : '';
        toast(`${summary}${delta}`, kind, 8000);
    } else {
        toast(summary, 'info', 6000);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

/** Uruchamia aplikację. */
async function boot() {
    try {
        const config = await api.get('/config');
        setState({ config });
        document.title = config.title;
    } catch (err) {
        console.error('Nie udało się pobrać konfiguracji:', err);
    }

    // Odtworzenie sesji z zapisanego tokenu.
    try {
        const me = await api.get('/auth/me');
        if (me.user) setState({ user: me.user });
    } catch {
        setToken(null); // token wygasł albo jest nieznany
    }

    onMessage(handleServerMessage);
    connect();

    registerRoutes({
        '/': homeScreen,
        '/lobby': lobbyScreen,
        '/gra': gameScreen,
        '/ranking': rankingScreen,
        '/profil': profileScreen,
        '/gracz/:name': profileScreen,
        '/tryby': variantsScreen,
        '/tryby/:id': variantEditorScreen,
        '/znajomi': friendsScreen,
        '/konto': authScreen,
    });

    subscribe(['user', 'connection', 'online', 'table'], renderHeader);
    window.addEventListener('hashchange', renderHeader);

    renderHeader();
    startRouter(document.getElementById('view'), '/');
    setState({ booting: false });

    // Utrata i powrót łączności — dopytujemy serwer o świeży stan.
    window.addEventListener('online', () => connect());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && store.connection === 'on') {
            call('sync').then(res => {
                if (!res.success) return;
                setState({ table: res.table, game: res.game, tables: res.tables, online: res.online });
            }).catch(() => {});
        }
    });
}

boot();
