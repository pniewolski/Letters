/**
 * @file screens/variantEditor.js
 * @description Edytor trybu gry — miejsce, w którym gracz układa własne zasady
 * od zera: rozmiar planszy, rozmieszczenie premii, zestaw liter z ilościami
 * i punktacją, wielkość stojaka, premie, reguły końcówki i kolory pól.
 *
 * Serwer waliduje definicję niezależnie (`POST /api/variants/preview`), więc
 * edytor pokazuje na żywo, czy tryb w ogóle da się rozegrać.
 */

import { el, fill, toast, confirmDialog, modal, plural } from '../ui.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

/** Paleta pól planszy. */
const PALETTE = [
    { code: '.', label: 'Zwykłe', cls: 'p-normal' },
    { code: '@', label: 'Start', cls: 'p-start' },
    { code: '2', label: '2× słowo', cls: 'p-w2' },
    { code: '3', label: '3× słowo', cls: 'p-w3' },
    { code: '4', label: '4× słowo', cls: 'p-w4' },
    { code: 'd', label: '2× litera', cls: 'p-l2' },
    { code: 't', label: '3× litera', cls: 'p-l3' },
    { code: 'q', label: '4× litera', cls: 'p-l4' },
];

/** Nazwy kolorów w formularzu. */
const COLOR_FIELDS = [
    ['normal', 'Pole zwykłe'], ['start', 'Pole startowe'],
    ['word2', '2× słowo'], ['word3', '3× słowo'], ['word4', '4× słowo'],
    ['letter2', '2× litera'], ['letter3', '3× litera'], ['letter4', '4× litera'],
    ['tile', 'Klocek'], ['tileCurrent', 'Klocek świeżo położony'], ['tileText', 'Napis na klocku'],
];

/** Pusty tryb startowy — plansza 15×15 z jednym polem startowym. */
function blankDefinition() {
    const size = 15;
    const grid = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => (x === 7 && y === 7 ? '@' : '.')).join(''));

    return {
        board: { size, grid },
        rack: { size: 7 },
        bingo: { tiles: 7, bonus: 50 },
        blank: { count: 2, points: 0 },
        tiles: [...'AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ'].map(letter => ({
            letter, count: 3, points: 2, usefulness: 3,
        })),
        rules: {
            exchangeMinBag: 7, maxScorelessTurns: 6,
            endgameRackPenalty: true, endgameOutBonus: true,
            validateWords: true, invalidWord: 'loseTurn',
            firstMoveMustCoverStart: true, minWordLength: 2,
        },
        colors: {},
        dictionary: 'pl',
    };
}

/**
 * Renderuje edytor trybu gry.
 * @param {HTMLElement} host
 * @param {object} params - `{ id }`; `nowy` = tworzenie od zera
 * @returns {Promise<Function>}
 */
export default async function variantEditorScreen(host, params = {}) {
    const isNew = !params.id || params.id === 'nowy';

    if (!store.user || store.user.isGuest) {
        fill(host, el('div', { class: 'card empty-state' },
            el('h2', {}, 'Tworzenie trybów wymaga konta'),
            el('p', { class: 'muted' }, 'Gość może grać w istniejące tryby, ale własnych nie zapisze.'),
            el('button', { class: 'btn btn-primary', onclick: () => navigate('/tryby') }, 'Wróć do listy')));
        return () => {};
    }

    fill(host, el('div', { class: 'loading' }, 'Ładowanie edytora...'));

    /** @type {{name: string, description: string, isPublic: boolean, definition: object, readOnly: boolean, id: number|null}} */
    const model = {
        id: null, name: 'Mój tryb', description: '', isPublic: true,
        definition: blankDefinition(), readOnly: false,
    };

    if (!isNew) {
        try {
            const res = await api.get(`/variants/${params.id}`);
            Object.assign(model, {
                id: res.variant.id,
                name: res.variant.name,
                description: res.variant.description,
                isPublic: res.variant.isPublic,
                definition: res.variant.definition,
                readOnly: !res.variant.canEdit,
            });
        } catch (err) {
            fill(host, el('div', { class: 'card empty-state' },
                el('h2', {}, 'Nie udało się wczytać trybu'),
                el('p', { class: 'muted' }, err.message)));
            return () => {};
        }
    }

    let brush = '2';
    let symmetry = true;

    const boardEl = el('div', { class: 'editor-board' });
    const paletteEl = el('div', { class: 'palette' });
    const tilesEl = el('div', { class: 'tiles-editor' });
    const summaryEl = el('div', { class: 'editor-summary' });
    const errorEl = el('p', { class: 'form-error' });

    // ─────────────────────────────────────────────────────────────────────────
    // PLANSZA
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Ustawia znak pola (z opcjonalnym odbiciem symetrycznym).
     * @param {number} x
     * @param {number} y
     */
    function paint(x, y) {
        if (model.readOnly) return;

        const size = model.definition.board.size;
        const grid = model.definition.board.grid.map(r => [...r]);

        const targets = symmetry
            ? [...new Set([
                `${x},${y}`, `${size - 1 - x},${y}`, `${x},${size - 1 - y}`, `${size - 1 - x},${size - 1 - y}`,
                `${y},${x}`, `${size - 1 - y},${x}`, `${y},${size - 1 - x}`, `${size - 1 - y},${size - 1 - x}`,
            ])].map(s => s.split(',').map(Number))
            : [[x, y]];

        for (const [tx, ty] of targets) {
            if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
            grid[ty][tx] = brush;
        }

        model.definition.board.grid = grid.map(r => r.join(''));
        renderBoard();
        schedulePreview();
    }

    /** Rysuje siatkę edytora. */
    function renderBoard() {
        const { size, grid } = model.definition.board;
        boardEl.replaceChildren();
        boardEl.style.setProperty('--edit-cells', String(size));

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const code = grid[y][x];
                const style = PALETTE.find(p => p.code === code) || PALETTE[0];

                const cell = el('div', {
                    class: `edit-cell ${style.cls}`,
                    title: `${String.fromCharCode(65 + (x % 26))}${y + 1} — ${style.label}`,
                    onclick: () => paint(x, y),
                    onmouseover: (e) => { if (e.buttons === 1) paint(x, y); },
                }, code === '@' ? '★' : (code === '.' ? '' : style.label.replace('× ', '×')));

                boardEl.append(cell);
            }
        }
    }

    /** Paleta pól i narzędzia planszy. */
    function renderPalette() {
        fill(paletteEl,
            el('div', { class: 'palette-row' }, PALETTE.map(p => el('button', {
                class: `palette-btn ${p.cls} ${brush === p.code ? 'active' : ''}`,
                type: 'button',
                onclick: () => { brush = p.code; renderPalette(); },
            }, p.label))),

            el('div', { class: 'palette-tools' },
                el('label', { class: 'checkbox-row' },
                    el('input', {
                        type: 'checkbox', checked: symmetry,
                        onchange: (e) => { symmetry = e.target.checked; },
                    }),
                    ' Symetria ośmiokrotna'),

                el('button', {
                    class: 'btn btn-small', type: 'button',
                    onclick: async () => {
                        if (!await confirmDialog('Wyczyścić wszystkie premie z planszy?')) return;
                        const { size } = model.definition.board;
                        const center = Math.floor(size / 2);
                        model.definition.board.grid = Array.from({ length: size }, (_, y) =>
                            Array.from({ length: size }, (_, x) => (x === center && y === center ? '@' : '.')).join(''));
                        renderBoard();
                        schedulePreview();
                    },
                }, 'Wyczyść planszę'),

                el('button', {
                    class: 'btn btn-small', type: 'button',
                    onclick: () => sprinkle(),
                }, 'Rozsyp premie losowo'),
            ),
        );
    }

    /** Rozsypuje premie z zachowaniem symetrii — punkt wyjścia do dalszej pracy. */
    function sprinkle() {
        const { size } = model.definition.board;
        const center = Math.floor(size / 2);
        const grid = Array.from({ length: size }, () => Array(size).fill('.'));
        const codes = ['2', '3', 'd', 't', 'q'];

        const put = (x, y, code) => {
            for (const [a, b] of [[x, y], [y, x]]) {
                for (const px of [a, size - 1 - a]) {
                    for (const py of [b, size - 1 - b]) grid[py][px] = code;
                }
            }
        };

        const seeds = Math.max(4, Math.round(size * 0.8));
        for (let i = 0; i < seeds; i++) {
            const x = Math.floor(Math.random() * center);
            const y = Math.floor(Math.random() * center);
            if (x === center && y === center) continue;
            put(x, y, codes[Math.floor(Math.random() * codes.length)]);
        }

        grid[center][center] = '@';
        model.definition.board.grid = grid.map(r => r.join(''));
        renderBoard();
        schedulePreview();
    }

    /**
     * Zmienia rozmiar planszy, zachowując środek.
     * @param {number} newSize
     */
    function resizeBoard(newSize) {
        const old = model.definition.board;
        const size = Math.max(7, Math.min(21, newSize));
        const offset = Math.floor((size - old.size) / 2);

        const grid = Array.from({ length: size }, (_, y) =>
            Array.from({ length: size }, (_, x) => {
                const sx = x - offset;
                const sy = y - offset;
                if (sx < 0 || sy < 0 || sx >= old.size || sy >= old.size) return '.';
                return old.grid[sy][sx];
            }).join(''));

        // Po zmianie rozmiaru pole startowe mogło wypaść poza planszę.
        if (!grid.some(row => row.includes('@'))) {
            const center = Math.floor(size / 2);
            const row = [...grid[center]];
            row[center] = '@';
            grid[center] = row.join('');
        }

        model.definition.board = { size, grid };
        renderBoard();
        schedulePreview();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LITERY
    // ─────────────────────────────────────────────────────────────────────────

    /** Tabela liter z ilościami, punktacją i użytecznością dla AI. */
    function renderTiles() {
        const tiles = model.definition.tiles;

        fill(tilesEl,
            el('div', { class: 'tiles-head' },
                el('span', {}, 'Litera'),
                el('span', {}, 'Sztuk'),
                el('span', {}, 'Punktów'),
                el('span', { title: '1 = litera bardzo przydatna, 5 = balast, który komputer chętnie wymieni' }, 'Dla AI'),
                el('span', {}, ''),
            ),

            ...tiles.map((tile, index) => el('div', { class: 'tiles-row' },
                el('span', { class: 'tile-letter' }, tile.letter),
                numberInput(tile.count, 0, 99, v => { tile.count = v; schedulePreview(); }),
                numberInput(tile.points, 0, 99, v => { tile.points = v; schedulePreview(); }),
                numberInput(tile.usefulness, 1, 5, v => { tile.usefulness = v; schedulePreview(); }),
                el('button', {
                    class: 'btn btn-tiny btn-ghost', type: 'button', title: 'Usuń literę',
                    disabled: model.readOnly,
                    onclick: () => { tiles.splice(index, 1); renderTiles(); schedulePreview(); },
                }, '✕'),
            )),

            el('div', { class: 'tiles-tools' },
                el('button', {
                    class: 'btn btn-small', type: 'button', disabled: model.readOnly,
                    onclick: addLetter,
                }, '➕ Dodaj literę'),
                el('button', {
                    class: 'btn btn-small', type: 'button', disabled: model.readOnly,
                    onclick: () => scaleCounts(1),
                }, '+1 do każdej'),
                el('button', {
                    class: 'btn btn-small', type: 'button', disabled: model.readOnly,
                    onclick: () => scaleCounts(-1),
                }, '−1 od każdej'),
            ),
        );
    }

    /**
     * Pole liczbowe.
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @param {(value: number) => void} onChange
     * @returns {HTMLElement}
     */
    function numberInput(value, min, max, onChange) {
        return el('input', {
            type: 'number', value: String(value), min: String(min), max: String(max),
            disabled: model.readOnly,
            oninput: (e) => {
                const n = Math.max(min, Math.min(max, Number(e.target.value) || 0));
                onChange(n);
            },
        });
    }

    /** Pyta o nową literę i dopisuje ją do zestawu. */
    function addLetter() {
        const input = el('input', { type: 'text', maxlength: '1', placeholder: 'np. Q' });
        modal({
            title: 'Nowa litera',
            body: el('div', { class: 'form' },
                el('p', { class: 'muted small' },
                    'Litera musi występować w słowniku, żeby dało się nią ułożyć słowa. '
                    + 'Znaki spoza polskiego alfabetu będą leżeć na stojaku bezużytecznie.'),
                input),
            actions: [
                { label: 'Anuluj' },
                {
                    label: 'Dodaj', kind: 'primary',
                    onClick: () => {
                        const letter = input.value.trim().toUpperCase();
                        if (!letter) return false;
                        if (model.definition.tiles.some(t => t.letter === letter)) {
                            toast('Ta litera już jest w zestawie.', 'error');
                            return false;
                        }
                        model.definition.tiles.push({ letter, count: 2, points: 3, usefulness: 3 });
                        model.definition.tiles.sort((a, b) => a.letter.localeCompare(b.letter, 'pl'));
                        renderTiles();
                        schedulePreview();
                    },
                },
            ],
        });
    }

    /**
     * Zmienia ilość wszystkich liter o stałą wartość.
     * @param {number} delta
     */
    function scaleCounts(delta) {
        for (const tile of model.definition.tiles) {
            tile.count = Math.max(0, Math.min(99, tile.count + delta));
        }
        renderTiles();
        schedulePreview();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PODGLĄD I ZAPIS
    // ─────────────────────────────────────────────────────────────────────────

    let previewTimer = null;

    /** Odpytuje serwer o walidację — z opóźnieniem, żeby nie zasypać go żądaniami. */
    function schedulePreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(runPreview, 350);
    }

    /** Pobiera podsumowanie i komunikaty walidacji. */
    async function runPreview() {
        try {
            const res = await api.post('/variants/preview', { definition: model.definition });
            errorEl.textContent = '';
            renderSummary(res.summary, true);
        } catch (err) {
            errorEl.textContent = err.message;
            renderSummary(null, false);
        }
    }

    /**
     * Panel z liczbami trybu.
     * @param {object|null} summary
     * @param {boolean} valid
     */
    function renderSummary(summary, valid) {
        const localTiles = model.definition.tiles.reduce((s, t) => s + t.count, 0) + model.definition.blank.count;

        fill(summaryEl,
            el('h3', { class: 'panel-title' }, valid ? '✅ Tryb jest grywalny' : '⚠️ Popraw ustawienia'),
            el('div', { class: 'summary-grid' },
                summaryItem('Plansza', `${model.definition.board.size}×${model.definition.board.size}`),
                summaryItem('Klocków', String(summary ? summary.tiles : localTiles)),
                summaryItem('Liter', String(summary ? summary.letters : localTiles - model.definition.blank.count)),
                summaryItem('Blanków', String(model.definition.blank.count)),
                summaryItem('Pól premiowych', String(summary ? summary.premiums : '—')),
                summaryItem('Suma punktów', String(summary ? summary.pointSum : '—')),
                summaryItem('Stojak', String(model.definition.rack.size)),
                summaryItem('Premia za stojak',
                    `${model.definition.bingo.bonus} pkt za ${plural(model.definition.bingo.tiles, 'klocek', 'klocki', 'klocków')}`),
            ),
            summary
                ? el('p', { class: 'muted tiny' },
                    `Średnia wartość klocka: ${(summary.pointSum / Math.max(1, summary.letters)).toFixed(2)} pkt.`)
                : null,
        );
    }

    const summaryItem = (label, value) => el('div', { class: 'summary-item' },
        el('span', { class: 'muted small' }, label),
        el('strong', {}, value));

    /** Zapisuje tryb. */
    async function save() {
        try {
            const payload = {
                name: model.name,
                description: model.description,
                isPublic: model.isPublic,
                definition: model.definition,
            };

            const res = model.id
                ? await api.put(`/variants/${model.id}`, payload)
                : await api.post('/variants', payload);

            toast(`Tryb „${res.variant.name}" zapisany.`, 'ok');
            navigate('/tryby');
        } catch (err) {
            errorEl.textContent = err.message;
            toast(err.message, 'error');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UKŁAD EKRANU
    // ─────────────────────────────────────────────────────────────────────────

    const nameInput = el('input', {
        type: 'text', value: model.name, maxlength: '64', disabled: model.readOnly,
        oninput: e => { model.name = e.target.value; },
    });
    const descInput = el('textarea', {
        rows: '2', maxlength: '250', disabled: model.readOnly,
        oninput: e => { model.description = e.target.value; },
    }, model.description);
    const publicInput = el('input', {
        type: 'checkbox', checked: model.isPublic, disabled: model.readOnly,
        onchange: e => { model.isPublic = e.target.checked; },
    });

    const sizeInput = el('input', {
        type: 'number', value: String(model.definition.board.size), min: '7', max: '21', step: '2',
        disabled: model.readOnly,
        onchange: e => resizeBoard(Number(e.target.value)),
    });

    fill(host,
        el('div', { class: 'page editor' },
            el('div', { class: 'page-head' },
                el('div', {},
                    el('h1', { class: 'page-title' },
                        model.readOnly ? 'Podgląd trybu' : (model.id ? 'Edycja trybu' : 'Nowy tryb gry')),
                    el('p', { class: 'muted' },
                        model.readOnly
                            ? 'Ten tryb należy do kogoś innego. Skopiuj go do siebie, żeby móc coś zmienić.'
                            : 'Wszystkie zasady są tutaj — plansza, litery, punktacja i reguły końcówki.'),
                ),
                el('div', { class: 'page-head-actions' },
                    el('button', { class: 'btn btn-ghost', onclick: () => navigate('/tryby') }, 'Wróć'),
                    model.readOnly ? null : el('button', { class: 'btn btn-primary', onclick: save }, '💾 Zapisz tryb'),
                ),
            ),

            errorEl,

            el('div', { class: 'editor-layout' },

                el('div', { class: 'editor-left' },
                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Plansza'),
                        el('label', { class: 'field inline' },
                            el('span', { class: 'field-label' }, 'Rozmiar (bok)'), sizeInput),
                        paletteEl,
                        el('p', { class: 'muted tiny' },
                            'Kliknij pole, żeby nadać mu wybraną premię. Przy włączonej symetrii '
                            + 'zmiana odbija się na wszystkie osiem odpowiadających pól.'),
                        boardEl,
                    ),
                ),

                el('div', { class: 'editor-right' },
                    el('div', { class: 'card' }, summaryEl),

                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Opis'),
                        el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Nazwa'), nameInput),
                        el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Opis'), descInput),
                        el('label', { class: 'checkbox-row' }, publicInput, ' Widoczny dla innych graczy'),
                    ),

                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Stojak i premie'),
                        numberField('Liter na stojaku', model.definition.rack.size, 3, 10,
                            v => { model.definition.rack.size = v; }),
                        numberField('Premia za wyłożenie ilu klocków', model.definition.bingo.tiles, 1, 10,
                            v => { model.definition.bingo.tiles = v; }),
                        numberField('Wysokość premii', model.definition.bingo.bonus, 0, 500,
                            v => { model.definition.bingo.bonus = v; }),
                        numberField('Blanków w worku', model.definition.blank.count, 0, 20,
                            v => { model.definition.blank.count = v; }),
                        numberField('Punktów za blanka', model.definition.blank.points, 0, 99,
                            v => { model.definition.blank.points = v; }),
                    ),

                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Reguły'),
                        numberField('Minimum liter w worku, by wymieniać', model.definition.rules.exchangeMinBag, 0, 50,
                            v => { model.definition.rules.exchangeMinBag = v; }),
                        numberField('Tur bez punktów kończących partię', model.definition.rules.maxScorelessTurns, 2, 40,
                            v => { model.definition.rules.maxScorelessTurns = v; }),
                        numberField('Najkrótsze słowo', model.definition.rules.minWordLength, 1, 5,
                            v => { model.definition.rules.minWordLength = v; }),
                        checkField('Na koniec odejmuj wartość liter ze stojaka',
                            model.definition.rules.endgameRackPenalty,
                            v => { model.definition.rules.endgameRackPenalty = v; }),
                        checkField('Kończący dostaje sumę cudzych liter',
                            model.definition.rules.endgameOutBonus,
                            v => { model.definition.rules.endgameOutBonus = v; }),
                        checkField('Pierwsze słowo musi przechodzić przez pole startowe',
                            model.definition.rules.firstMoveMustCoverStart,
                            v => { model.definition.rules.firstMoveMustCoverStart = v; }),
                        checkField('Sprawdzaj słowa w słowniku',
                            model.definition.rules.validateWords,
                            v => { model.definition.rules.validateWords = v; }),
                        selectField('Przy słowie spoza słownika',
                            model.definition.rules.invalidWord,
                            [['loseTurn', 'gracz traci turę'], ['reject', 'ruch zostaje odrzucony']],
                            v => { model.definition.rules.invalidWord = v; }),
                    ),

                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Litery'),
                        el('p', { class: 'muted small' },
                            'Ilość i wartość każdego klocka. Suma punktów w worku decyduje o tym, '
                            + 'czy partia będzie spokojna, czy bardzo punktowa.'),
                        tilesEl,
                    ),

                    el('div', { class: 'card' },
                        el('h2', { class: 'panel-title' }, 'Kolory'),
                        el('div', { class: 'color-grid' }, COLOR_FIELDS.map(([key, label]) => el('label', { class: 'color-field' },
                            el('span', { class: 'field-label' }, label),
                            el('input', {
                                type: 'color',
                                value: model.definition.colors[key] || defaultColor(key),
                                disabled: model.readOnly,
                                oninput: e => { model.definition.colors[key] = e.target.value; renderBoard(); },
                            }),
                        ))),
                    ),
                ),
            ),
        ),
    );

    /**
     * Pole liczbowe z etykietą.
     * @param {string} label
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @param {(v: number) => void} onChange
     * @returns {HTMLElement}
     */
    function numberField(label, value, min, max, onChange) {
        return el('label', { class: 'field inline' },
            el('span', { class: 'field-label' }, label),
            el('input', {
                type: 'number', value: String(value), min: String(min), max: String(max),
                disabled: model.readOnly,
                oninput: e => {
                    onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)));
                    schedulePreview();
                },
            }));
    }

    /**
     * Pole wyboru tak/nie.
     * @param {string} label
     * @param {boolean} value
     * @param {(v: boolean) => void} onChange
     * @returns {HTMLElement}
     */
    function checkField(label, value, onChange) {
        return el('label', { class: 'checkbox-row' },
            el('input', {
                type: 'checkbox', checked: value, disabled: model.readOnly,
                onchange: e => { onChange(e.target.checked); schedulePreview(); },
            }), ' ', label);
    }

    /**
     * Lista wyboru.
     * @param {string} label
     * @param {string} value
     * @param {Array<[string, string]>} options
     * @param {(v: string) => void} onChange
     * @returns {HTMLElement}
     */
    function selectField(label, value, options, onChange) {
        return el('label', { class: 'field inline' },
            el('span', { class: 'field-label' }, label),
            el('select', {
                disabled: model.readOnly,
                onchange: e => { onChange(e.target.value); schedulePreview(); },
            }, options.map(([v, text]) => el('option', { value: v, selected: v === value }, text))));
    }

    renderPalette();
    renderBoard();
    renderTiles();
    runPreview();

    return () => clearTimeout(previewTimer);
}

/**
 * Domyślny kolor dla pola formularza (żeby `input[type=color]` miał sensowną wartość).
 * @param {string} key
 * @returns {string}
 */
function defaultColor(key) {
    return {
        normal: '#2a4a3a', start: '#3a3326', word2: '#5b2a2a', word3: '#7a2b22', word4: '#8d2f5a',
        letter2: '#22405c', letter3: '#163a52', letter4: '#1d5c53',
        tile: '#d4a94a', tileCurrent: '#f5d76e', tileText: '#1a1a2e',
    }[key] || '#333333';
}
