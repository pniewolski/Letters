/**
 * @file screens/game.js
 * @description Ekran stołu: poczekalnia przed startem, plansza, stojak,
 * panel graczy, log zdarzeń i czat.
 *
 * Ten sam ekran obsługuje wszystkie warianty stołu — grę z komputerem,
 * partię sieciową i podgląd symulacji — bo różnice sprowadzają się do tego,
 * czy mamy swoje miejsce (`mySlot`) i czyja jest tura.
 */

import { el, fill, toast, confirmDialog, fmtTime, avatar, plural } from '../ui.js';
import { store, subscribe, canPlay, clearPlacement, touch } from '../store.js';
import { call } from '../net.js';
import { navigate, refresh } from '../router.js';
import { buildBoard, renderBoard, bindPlacedTaps, recallAll, coordLabel, resetBoard } from '../game/board.js';
import { renderRack, bindRackDropZone, shuffleRack } from '../game/rack.js';
import { clearPreviews, resetPreviewCache } from '../game/preview.js';

/**
 * Renderuje ekran gry.
 * @param {HTMLElement} host - Element, w którym ma powstać ekran
 * @returns {Function} Funkcja sprzątająca (odpina nasłuchy i zegar)
 */
export default function gameScreen(host) {
    if (!store.table) {
        // Po odświeżeniu strony stan stołu wraca dopiero z odpowiedzią serwera na
        // uwierzytelnienie WebSocketa. Zanim przyjdzie, pokazujemy oczekiwanie
        // i przerysowujemy ekran, gdy tylko stół się pojawi.
        const restoring = store.connection !== 'on' || store.booting;

        fill(host, restoring
            ? el('div', { class: 'card empty-state' },
                el('h2', {}, 'Wracam do stołu...'),
                el('p', { class: 'muted' }, 'Odtwarzam stan partii z serwera.'))
            : el('div', { class: 'card empty-state' },
                el('h2', {}, 'Nie siedzisz przy żadnym stole'),
                el('p', { class: 'muted' }, 'Wybierz stół w lobby albo załóż własny.'),
                el('button', { class: 'btn btn-primary', onclick: () => navigate('/lobby') }, 'Przejdź do lobby')));

        const stop = subscribe(['table', 'connection'], () => {
            if (store.table) { stop(); refresh(); }
            else if (store.connection === 'on' && !store.booting) { stop(); refresh(); }
        });
        return stop;
    }

    resetBoard();
    resetPreviewCache();

    const boardHost = el('div', { class: 'board-host' });
    const rackEl = el('div', { class: 'rack', id: 'rack' });
    const actionsEl = el('div', { class: 'actions' });
    const playersEl = el('div', { class: 'players-panel' });
    const metaEl = el('div', { class: 'game-meta' });
    const feedEl = el('div', { class: 'feed' });
    const sideEl = el('div', { class: 'side-panel' });

    const chatInput = el('input', {
        type: 'text', class: 'chat-input', placeholder: 'Napisz coś...', maxlength: '400',
        onkeydown: (e) => { if (e.key === 'Enter') sendChat(); },
    });

    const sendChat = () => {
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        call('table:chat', { message: text }).catch(err => toast(err.message, 'error'));
    };

    fill(host,
        el('div', { class: 'game-screen' },
            el('aside', { class: 'panel-left' },
                el('div', { class: 'card tight' }, metaEl),
                el('div', { class: 'card tight' }, playersEl),
                el('div', { class: 'card chat-card' },
                    feedEl,
                    el('div', { class: 'chat-row' },
                        chatInput,
                        el('button', { class: 'btn btn-small', onclick: sendChat }, 'Wyślij'),
                    ),
                ),
            ),
            el('main', { class: 'board-area' },
                boardHost,
                el('div', { class: 'rack-area' },
                    rackEl,
                    el('button', {
                        class: 'btn btn-ghost btn-small', title: 'Przetasuj litery',
                        onclick: () => shuffleRack(),
                    }, '🔀'),
                ),
                actionsEl,
            ),
            el('aside', { class: 'panel-right' }, sideEl),
        ),
    );

    bindRackDropZone(rackEl);

    // ─────────────────────────────────────────────────────────────────────────
    // AKCJE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wykonuje akcję serwera i pokazuje błąd, jeśli się nie uda.
     * @param {string} action - Nazwa akcji WebSocket
     * @param {object} [payload] - Dane
     * @returns {Promise<object|null>}
     */
    async function act(action, payload = {}) {
        try {
            const res = await call(action, payload);
            if (!res.success) { toast(res.error, 'error'); return null; }
            return res;
        } catch (err) {
            toast(err.message, 'error');
            return null;
        }
    }

    async function confirmMove() {
        if (store.placed.length === 0) return;

        const tiles = store.placed.map(p => ({ letter: p.letter, x: p.x, y: p.y, isBlank: p.isBlank }));
        const res = await act('game:move', { tiles });
        if (!res) return;

        if (res.lostTurn) {
            toast(`Nie znam słowa: ${(res.wrongWords || []).join(', ')} — tracisz turę.`, 'error', 6000);
        } else if (res.points) {
            toast(`+${res.points} pkt`, 'ok');
        }
        clearPlacement();
    }

    async function doExchange() {
        if (!store.exchangeMode) {
            recallAll();
            store.exchangeMode = true;
            store.exchangeSelection = new Set();
            touch('exchangeMode');
            toast('Zaznacz litery do wymiany i kliknij „Wymień" jeszcze raz.', 'info');
            return;
        }

        const indices = [...store.exchangeSelection];
        if (indices.length === 0) {
            store.exchangeMode = false;
            touch('exchangeMode');
            return;
        }

        const letters = indices.map(i => store.game.myRack[i]);
        const res = await act('game:exchange', { letters });
        store.exchangeMode = false;
        store.exchangeSelection = new Set();
        touch('exchangeMode');
        if (res) toast(`Wymieniono ${plural(letters.length, 'literę', 'litery', 'liter')}.`, 'ok');
    }

    async function doPass() {
        if (!await confirmDialog('Na pewno pasujesz? Nie zdobędziesz punktów w tej turze.')) return;
        await act('game:pass');
        clearPlacement();
    }

    async function doResign() {
        if (!await confirmDialog(
            'Poddanie kończy dla ciebie partię i liczy się jako przegrana. Na pewno?',
            { title: 'Poddaj partię', confirmLabel: 'Poddaję' },
        )) return;
        await act('game:resign');
    }

    async function doHint() {
        const res = await act('game:hint', { count: 6 });
        if (!res) return;
        store.hints = { list: res.hints, highlight: null };
        touch('hints');
        if (res.hints.length === 0) toast('Nie widzę żadnego ruchu z tymi literami.', 'info');
    }

    async function doLeave() {
        const playing = store.table?.status === 'playing' && store.game && !store.game.finished;
        const question = playing
            ? 'Wyjście w trakcie partii liczy się jako poddanie. Na pewno wychodzisz?'
            : 'Wstać od stołu?';
        if (!await confirmDialog(question)) return;

        await act('table:leave');
        clearPlacement();
        navigate('/lobby');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RYSOWANIE
    // ─────────────────────────────────────────────────────────────────────────

    /** Panel informacji o stole. */
    function renderMeta() {
        const table = store.table;
        const game = store.game;
        if (!table) return;

        const turnName = game && !game.finished && game.currentSlot != null
            ? (game.players[game.currentSlot]?.name || '—')
            : null;

        fill(metaEl,
            el('div', { class: 'meta-head' },
                el('h2', { class: 'meta-title' }, table.name),
                el('span', { class: 'chip chip-variant', title: 'Tryb gry' }, table.variant.name),
            ),
            el('div', { class: 'meta-grid' },
                metaItem('Kod stołu', table.code),
                metaItem('Worek', game ? String(game.bagSize) : '—'),
                metaItem('Ranking', table.rated ? 'tak' : 'nie'),
                metaItem('Plansza', `${table.variant.size}×${table.variant.size}`),
            ),
            game && !game.finished
                ? el('div', { class: 'turn-banner ' + (game.currentSlot === game.mySlot ? 'my-turn' : '') },
                    game.mySlot == null
                        ? `Tura: ${turnName}`
                        : (game.currentSlot === game.mySlot ? 'Twoja kolej' : `Czeka: ${turnName}`))
                : null,
            game && game.finished
                ? el('div', { class: 'turn-banner finished' }, 'Koniec partii')
                : null,
        );
    }

    const metaItem = (label, value) => el('div', { class: 'meta-item' },
        el('span', { class: 'meta-label' }, label),
        el('span', { class: 'meta-value' }, value));

    /** Lista graczy z wynikami i zegarem. */
    function renderPlayers() {
        const game = store.game;
        const table = store.table;
        const seats = game ? game.players : (table ? table.players : []);

        fill(playersEl,
            el('h3', { class: 'panel-title' }, 'Gracze'),
            ...seats.map(p => {
                const isMe = game && p.slot === game.mySlot;
                const active = game && !game.finished && game.currentSlot === p.slot;

                return el('div', {
                    class: `player-row ${active ? 'active' : ''} ${isMe ? 'me' : ''} ${p.resigned ? 'resigned' : ''}`,
                },
                    avatar({ avatar: p.avatar, name: p.name || 'Wolne miejsce' }, 'sm'),
                    el('div', { class: 'player-main' },
                        el('div', { class: 'player-name' },
                            p.name || el('span', { class: 'muted' }, 'wolne miejsce'),
                            isMe ? el('span', { class: 'tag' }, 'ty') : null,
                            p.isComputer ? el('span', { class: 'tag tag-bot' }, 'bot') : null,
                            p.isGuest ? el('span', { class: 'tag tag-guest' }, 'gość') : null,
                        ),
                        el('div', { class: 'player-sub muted small' },
                            game ? `${plural(p.rackSize ?? 0, 'litera', 'litery', 'liter')} na stojaku` : 'czeka',
                            p.connected === false && !p.isComputer ? ' · rozłączony' : '',
                        ),
                    ),
                    el('div', { class: 'player-score' }, game ? String(p.score) : '—'),
                );
            }),
            game && game.timeLeftMs != null
                ? el('div', { class: 'clock' }, '⏱ ', el('span', { id: 'clock-value' }, fmtTime(game.timeLeftMs / 1000)))
                : null,
        );
    }

    /** Przyciski akcji. */
    function renderActions() {
        const game = store.game;
        const table = store.table;

        if (!game || table.status === 'waiting') {
            fill(actionsEl, el('button', { class: 'btn btn-ghost', onclick: doLeave }, '⏏ Wstań od stołu'));
            return;
        }

        const spectator = game.mySlot == null;
        const myTurn = canPlay();
        const finished = game.finished;

        if (spectator || finished) {
            fill(actionsEl,
                finished && !spectator
                    ? el('button', {
                        class: 'btn btn-primary',
                        onclick: () => act('table:rematch'),
                    }, '🔁 Rewanż')
                    : null,
                el('button', { class: 'btn btn-ghost', onclick: doLeave }, '⏏ Wstań od stołu'),
            );
            return;
        }

        const hintsAllowed = table.mode !== 'human' || store.config.flags?.allowHintsVsHuman;

        fill(actionsEl,
            el('button', {
                class: 'btn btn-primary', disabled: !myTurn || store.placed.length === 0,
                onclick: confirmMove,
            }, '✓ Zatwierdź'),
            el('button', {
                class: 'btn', disabled: store.placed.length === 0, onclick: () => recallAll(),
            }, '↩ Cofnij'),
            el('button', {
                class: `btn ${store.exchangeMode ? 'btn-warn' : ''}`, disabled: !game || game.finished || game.currentSlot !== game.mySlot,
                onclick: doExchange,
            }, store.exchangeMode ? '🔄 Zatwierdź wymianę' : '🔄 Wymień'),
            el('button', {
                class: 'btn', disabled: game.currentSlot !== game.mySlot, onclick: doPass,
            }, '⏭ Pas'),
            hintsAllowed
                ? el('button', { class: 'btn btn-hint', onclick: doHint }, '💡 Podpowiedź')
                : null,
            el('button', { class: 'btn btn-danger btn-small', onclick: doResign }, 'Poddaj'),
            el('button', { class: 'btn btn-ghost btn-small', onclick: doLeave }, '⏏'),
        );
    }

    /** Prawy panel: poczekalnia, podpowiedzi albo wyniki. */
    function renderSide() {
        const table = store.table;
        const game = store.game;
        const blocks = [];

        if (table.status === 'waiting') blocks.push(waitingRoom());
        if (store.results) blocks.push(resultsCard());
        if (store.hints?.list) blocks.push(hintsCard());
        if (game && game.finished && game.endgame) blocks.push(endgameCard());

        fill(sideEl, ...blocks);
    }

    /** Karta poczekalni: miejsca, kod zaproszenia, przycisk startu. */
    function waitingRoom() {
        const table = store.table;
        const open = table.players.filter(p => p.type === 'open').length;

        return el('div', { class: 'card' },
            el('h3', { class: 'panel-title' }, 'Poczekalnia'),
            el('p', { class: 'muted small' },
                open > 0
                    ? `Czekamy na ${plural(open, 'gracza', 'graczy', 'graczy')}. Podaj znajomym kod stołu albo zacznij z komputerem.`
                    : 'Wszystkie miejsca zajęte — zaraz startujemy.'),
            el('div', { class: 'invite-box' },
                el('span', { class: 'muted small' }, 'Kod stołu'),
                el('code', { class: 'invite-code' }, table.code),
                el('button', {
                    class: 'btn btn-small btn-ghost',
                    onclick: async () => {
                        try {
                            await navigator.clipboard.writeText(table.code);
                            toast('Kod skopiowany.', 'ok');
                        } catch {
                            toast('Skopiuj kod ręcznie: ' + table.code, 'info');
                        }
                    },
                }, 'Kopiuj'),
            ),
            table.isOwner && open > 0
                ? el('button', {
                    class: 'btn btn-primary full',
                    onclick: () => act('table:start'),
                }, `Zacznij teraz (wolne miejsca zajmie komputer)`)
                : null,
        );
    }

    /** Karta z podpowiedziami. */
    function hintsCard() {
        const list = store.hints.list;
        return el('div', { class: 'card' },
            el('div', { class: 'panel-title-row' },
                el('h3', { class: 'panel-title' }, 'Podpowiedzi'),
                el('button', {
                    class: 'btn btn-ghost btn-tiny',
                    onclick: () => { store.hints = null; touch('hints'); },
                }, '✕'),
            ),
            list.length === 0
                ? el('p', { class: 'muted small' }, 'Brak możliwych ruchów.')
                : el('ul', { class: 'hint-list' }, list.map(h => el('li', {
                    class: 'hint-item',
                    onmouseenter: () => { store.hints.highlight = h.tiles; touch('hints'); },
                    onmouseleave: () => { store.hints.highlight = null; touch('hints'); },
                    onclick: () => applyHint(h),
                },
                    el('span', { class: 'hint-pts' }, String(h.points)),
                    el('span', { class: 'hint-word' }, h.wordSimple),
                    el('span', { class: 'hint-pos muted small' },
                        `${coordLabel(h.x, h.y)} ${h.horizontal ? '→' : '↓'}`),
                ))),
        );
    }

    /**
     * Układa podpowiedziany ruch na planszy (bez zatwierdzania — gracz decyduje).
     * @param {object} hint
     */
    function applyHint(hint) {
        recallAll();
        const rack = store.game.myRack;
        const usedIndices = new Set();

        for (const tile of hint.tiles) {
            const wanted = tile.isBlank ? store.game.variant.blankSymbol : tile.letter;
            const index = rack.findIndex((l, i) => l === wanted && !usedIndices.has(i));
            if (index === -1) continue;
            usedIndices.add(index);
            store.placed.push({ letter: tile.letter, x: tile.x, y: tile.y, isBlank: tile.isBlank, rackIndex: index });
        }

        store.hints.highlight = null;
        touch('placed', 'hints');
    }

    /** Karta z wynikami po partii. */
    function resultsCard() {
        const rows = [...store.results].sort((a, b) => a.place - b.place);
        return el('div', { class: 'card' },
            el('h3', { class: 'panel-title' }, '🏁 Wynik partii'),
            el('ul', { class: 'result-list' }, rows.map(r => el('li', {
                class: `result-row ${r.result === 'win' ? 'winner' : ''}`,
            },
                el('span', { class: 'result-place' }, `${r.place}.`),
                el('span', { class: 'result-name' }, r.name),
                el('span', { class: 'result-score' }, String(r.score)),
                r.ratingDelta != null
                    ? el('span', { class: `result-delta ${r.ratingDelta >= 0 ? 'up' : 'down'}` },
                        `${r.ratingDelta >= 0 ? '+' : ''}${r.ratingDelta}`)
                    : null,
            ))),
            rows.some(r => r.bestWord)
                ? el('p', { class: 'muted small' },
                    'Najlepsze słowo: ' + rows
                        .filter(r => r.bestWord)
                        .sort((a, b) => b.bestWordPoints - a.bestWordPoints)
                        .slice(0, 1)
                        .map(r => `${r.bestWord} (${r.bestWordPoints} pkt, ${r.name})`)
                        .join(''))
                : null,
        );
    }

    /** Karta z rozliczeniem końcówki (litery zostające na stojakach). */
    function endgameCard() {
        return el('div', { class: 'card' },
            el('h3', { class: 'panel-title' }, 'Rozliczenie końcówki'),
            el('ul', { class: 'plain-list small' }, store.game.endgame.map(e => {
                const name = store.game.players[e.slot]?.name || `Gracz ${e.slot + 1}`;
                const rack = e.rack.length ? e.rack.join(' ') : '—';
                const sign = e.adjustment > 0 ? '+' : '';
                return el('li', {}, `${name}: ${rack} → `,
                    el('strong', { class: e.adjustment >= 0 ? 'up' : 'down' }, `${sign}${e.adjustment}`));
            })),
        );
    }

    /** Log zdarzeń i czatu. */
    function renderFeed() {
        const atBottom = feedEl.scrollTop + feedEl.clientHeight >= feedEl.scrollHeight - 40;

        fill(feedEl, ...store.feed.slice(-120).map(entry => el('div', {
            class: `feed-line feed-${entry.kind || 'info'}`,
        },
            entry.name ? el('span', { class: 'feed-name' }, entry.name + ': ') : null,
            entry.text,
        )));

        if (atBottom) feedEl.scrollTop = feedEl.scrollHeight;
    }

    /** Pełne przerysowanie. */
    function renderAll() {
        if (!store.table) { navigate('/lobby'); return; }

        renderMeta();
        renderPlayers();
        renderActions();
        renderSide();

        if (store.game) {
            buildBoard(boardHost);
            renderBoard();
            bindPlacedTaps();
            renderRack(rackEl);
        } else {
            fill(boardHost, el('div', { class: 'board-placeholder' },
                el('p', {}, 'Partia jeszcze się nie zaczęła.'),
                el('p', { class: 'muted small' }, 'Plansza pojawi się, gdy wszystkie miejsca będą zajęte.')));
            rackEl.replaceChildren();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NASŁUCHY
    // ─────────────────────────────────────────────────────────────────────────

    const unsub = [
        subscribe(['table', 'game', 'results'], renderAll),
        subscribe(['placed', 'selected', 'previews', 'hints'], () => {
            renderBoard();
            bindPlacedTaps();
            renderRack(rackEl);
            renderActions();
            renderSide();
        }),
        subscribe(['exchangeMode', 'rackOrder'], () => { renderRack(rackEl); renderActions(); }),
        subscribe('feed', renderFeed),
    ];

    // Zegar odliczający czas na ruch. Serwer podaje stan na moment wysłania,
    // więc odliczamy lokalnie od chwili, w której ten stan dotarł.
    let clockBase = Date.now();
    unsub.push(subscribe('game', () => { clockBase = Date.now(); }));

    const ticker = setInterval(() => {
        const game = store.game;
        const value = document.getElementById('clock-value');
        if (!value || !game || game.finished || game.timeLeftMs == null) return;

        const left = game.timeLeftMs - (Date.now() - clockBase);
        value.textContent = fmtTime(Math.max(0, left) / 1000);
        value.parentElement.classList.toggle('clock-low', left < 15000);
    }, 500);

    // Klawiatura: Enter zatwierdza, Escape cofa.
    const onKey = (e) => {
        if (e.target.matches('input, textarea')) return;
        if (e.key === 'Enter' && canPlay() && store.placed.length) { e.preventDefault(); confirmMove(); }
        if (e.key === 'Escape' && store.placed.length) { e.preventDefault(); recallAll(); }
    };
    document.addEventListener('keydown', onKey);

    renderAll();
    renderFeed();

    return () => {
        unsub.forEach(fn => fn());
        clearInterval(ticker);
        document.removeEventListener('keydown', onKey);
        clearPreviews();
    };
}
