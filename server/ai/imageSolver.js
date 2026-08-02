/**
 * @file imageSolver.js
 * @description Rozwiązywanie gry Scrabble na podstawie zdjęcia planszy.
 *
 * Przepływ:
 * 1. Zdjęcie jest skalowane do maks. 800 px (dłuższy bok) — mniejszy transfer i koszt.
 * 2. Obraz wysyłany jest do modelu wizyjnego (LLM), który zwraca JSON:
 *    { board: [15 x string(15)], rack: [litery] }.
 * 3. Z odpowiedzi budowana jest plansza (Board) i wołany jest istniejący Solver,
 *    który zwraca listę najkorzystniejszych ruchów.
 * 4. Ruchy są formatowane do czytelnej postaci: SŁOWO, poziomo/pionowo, od lewej X, od góry Y.
 *
 * Konfiguracja modelu (zmienne środowiskowe lub server/ai.config.json):
 *   AI_PROVIDER  — "openai" | "gemini" (domyślnie wykrywany automatycznie
 *                  na podstawie AI_MODEL / AI_API_URL)
 *   AI_API_URL   — endpoint. Dla OpenAI: pełny URL chat/completions.
 *                  Dla Gemini: baza modeli (domyślnie
 *                  https://generativelanguage.googleapis.com/v1beta/models)
 *   AI_API_KEY   — klucz API
 *   AI_MODEL     — nazwa modelu (domyślnie gpt-4o-mini; np. gemini-flash-latest)
 *
 * Obaj dostawcy są wymienni — wystarczy podać klucz i model. Gemini korzysta
 * z natywnego API generateContent (nagłówek X-goog-api-key), OpenAI z Bearer.
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const fetch = require('node-fetch');

const Board = require('../board/Board');
const Solver = require('../board/Solver');

const SIZE = 15;
const MAX_DIM = 800; // Wyższa rozdzielczość = lepszy OCR kafelków (15x15 → ~80px/pole)

const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_DEFAULT_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Prosty log z prefiksem i znacznikiem czasu. */
function log(...args) {
    console.log(`[imageSolver ${new Date().toISOString()}]`, ...args);
}

// ─────────────────────────────────────────────────────────────────────────────
// KONFIGURACJA MODELU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wykrywa dostawcę na podstawie jawnego ustawienia, nazwy modelu lub URL-a.
 * @param {string} explicit - Jawnie podany provider ('openai'|'gemini'|'')
 * @param {string} model
 * @param {string} apiUrl
 * @returns {'openai'|'gemini'}
 */
function detectProvider(explicit, model, apiUrl) {
    const e = (explicit || '').toLowerCase();
    if (e === 'openai' || e === 'gemini') return e;
    const m = (model || '').toLowerCase();
    const u = (apiUrl || '').toLowerCase();
    if (m.startsWith('gemini') || u.includes('generativelanguage.googleapis.com')) {
        return 'gemini';
    }
    return 'openai';
}

/**
 * Wczytuje konfigurację modelu AI: najpierw ze zmiennych środowiskowych,
 * a brakujące wartości uzupełnia z opcjonalnego pliku server/ai.config.json.
 * @returns {{provider: 'openai'|'gemini', apiUrl: string, apiKey: string, model: string}}
 */
function loadAiConfig() {
    let fileCfg = {};
    try {
        const p = path.join(__dirname, '..', 'ai.config.json');
        if (fs.existsSync(p)) {
            fileCfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        }
    } catch (e) {
        console.warn('[imageSolver] Nie udało się wczytać ai.config.json:', e.message);
    }

    const model = process.env.AI_MODEL || fileCfg.model || 'gpt-4o-mini';
    const explicitProvider = process.env.AI_PROVIDER || fileCfg.provider || '';
    const rawUrl = process.env.AI_API_URL || fileCfg.apiUrl || '';
    const provider = detectProvider(explicitProvider, model, rawUrl);

    const apiUrl = rawUrl || (provider === 'gemini' ? GEMINI_DEFAULT_URL : OPENAI_DEFAULT_URL);

    return {
        provider,
        apiUrl,
        apiKey: process.env.AI_API_KEY || fileCfg.apiKey || '',
        model,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRZETWARZANIE OBRAZU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Skaluje obraz tak, aby dłuższy bok miał maks. MAX_DIM px, i zwraca JPEG.
 * @param {Buffer} buffer - Surowe dane obrazu (dowolny format obsługiwany przez jimp)
 * @returns {Promise<{buffer: Buffer, mime: string, width: number, height: number}>}
 */
async function resizeImage(buffer) {
    const img = await Jimp.read(buffer);
    const w = img.getWidth();
    const h = img.getHeight();

    if (Math.max(w, h) > MAX_DIM) {
        if (w >= h) img.resize(MAX_DIM, Jimp.AUTO);
        else img.resize(Jimp.AUTO, MAX_DIM);
    }

    img.quality(85);
    const out = await img.getBufferAsync(Jimp.MIME_JPEG);
    return { buffer: out, mime: Jimp.MIME_JPEG, width: img.getWidth(), height: img.getHeight() };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL WIZYJNY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Buduje instrukcję (prompt) dla modelu wizyjnego.
 * @param {string} alphabet - Alfabet gry (dozwolone litery)
 * @returns {string}
 */
function buildPrompt(alphabet) {
    return [
        'Jesteś ekspertem rozpoznawania planszy do gry w Scrabble ze zdjęcia.',
        'Na obrazie widnieje plansza 15x15 oraz stojak (rack) z literami gracza.',
        'UWAGA: Gra jest w toku — na planszy NA PEWNO leżą litery. Jeśli widzisz pustą planszę, przyjrzyj się dokładniej kafelkom na siatce.',
        '',
        'Jak rozpoznać elementy na zdjęciu:',
        '- Plansza to kwadratowa siatka 15x15 pól. Kafelki z literami to jasne/beżowe prostokąty z literą i małą liczbą (wartość punktowa).',
        '- Puste pola planszy to kolorowe kwadraty (premium squares) lub puste beżowe/zielone pola.',
        '- Stojak gracza to rząd 7 (lub mniej) kafelków poniżej planszy lub w dolnej części zdjęcia.',
        '- Każdy kafelek ma JEDNĄ literę (duża, wyraźna) i małą cyfrę w rogu (punkty) — odczytaj LITERĘ, zignoruj cyfrę.',
        '',
        `Dozwolone litery w tej grze (polski alfabet): ${alphabet}`,
        '',
        'Zwróć WYŁĄCZNIE obiekt JSON w formacie:',
        '{',
        '  "board": [15 łańcuchów, każdy dokładnie 15 znaków],',
        '  "rack":  ["A","B", ... litery ze stojaka gracza]',
        '}',
        '',
        'Zasady kodowania planszy:',
        '- Każdy z 15 łańcuchów to jeden wiersz planszy, od góry do dołu.',
        '- Znak o indeksie i w łańcuchu to kolumna i (od lewej), licząc od 0.',
        '- Puste pole = kropka ".".',
        '- Zwykła litera = WIELKA litera z alfabetu.',
        '- Blank (pusty żeton użyty jako litera) = ta sama litera, ale MAŁA.',
        '',
        'Zasady stojaka (rack):',
        '- Podaj litery WIELKIMI literami.',
        '- Pusty żeton (blank) w stojaku zapisz jako gwiazdkę "*".',
        '',
        'WAŻNE: Dokładnie przeanalizuj KAŻDE pole planszy 15x15. Na planszy powinny być słowa ułożone poziomo i pionowo. Nie zwracaj pustej planszy jeśli widzisz kafelki z literami.',
        'Nie dodawaj komentarzy ani markdown. Zwróć czysty JSON.',
    ].join('\n');
}

/**
 * Wyodrębnia obiekt JSON z odpowiedzi modelu (usuwa ewentualne ```json ... ```).
 * @param {string} text
 * @returns {object}
 */
function extractJson(text) {
    if (!text) throw new Error('Pusta odpowiedź modelu.');
    let s = text.trim();
    // usuń ogrodzenia markdown
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // wytnij od pierwszego { do ostatniego }
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1) s = s.slice(first, last + 1);
    return JSON.parse(s);
}

/**
 * Wysyła obraz do modelu wizyjnego i zwraca rozpoznany stan gry.
 * Wybiera dostawcę (OpenAI vs Gemini) na podstawie konfiguracji.
 * @param {Buffer} imageBuffer - Obraz (najlepiej już przeskalowany)
 * @param {string} mime - Typ MIME obrazu (np. image/jpeg)
 * @param {string} alphabet - Alfabet gry
 * @returns {Promise<{board: string[], rack: string[]}>}
 */
async function callVisionModel(imageBuffer, mime, alphabet) {
    const cfg = loadAiConfig();
    if (!cfg.apiKey) {
        throw new Error('Brak klucza API modelu. Ustaw AI_API_KEY lub server/ai.config.json.');
    }

    const prompt = buildPrompt(alphabet);
    const base64 = imageBuffer.toString('base64');

    log(`Łączenie z modelem AI: provider=${cfg.provider}, model=${cfg.model}`);
    const t0 = Date.now();
    try {
        const result = cfg.provider === 'gemini'
            ? await callGemini(cfg, prompt, mime, base64, alphabet)
            : await callOpenAi(cfg, prompt, mime, base64, alphabet);
        log(`Połączenie z AI OK (${Date.now() - t0} ms) — rozpoznano stan gry.`);
        return result;
    } catch (e) {
        log(`Błąd połączenia z AI (${Date.now() - t0} ms): ${e.message}`);
        throw e;
    }
}

/**
 * Wywołuje model zgodny z OpenAI Chat Completions (Bearer auth).
 * @param {object} cfg
 * @param {string} prompt
 * @param {string} mime
 * @param {string} base64
 * @param {string} alphabet
 * @returns {Promise<{board: string[], rack: string[]}>}
 */
async function callOpenAi(cfg, prompt, mime, base64, alphabet) {
    const dataUrl = `data:${mime};base64,${base64}`;
    const modelName = String(cfg.model || '').toLowerCase();
    const isReasoning = modelName.startsWith('gpt-5') || modelName.startsWith('o1') || modelName.startsWith('o3');
    const tokenParam = isReasoning ? 'max_completion_tokens' : 'max_tokens';
    // Modele rozumujące (GPT-5, o1, o3) używają reasoning tokens — potrzebują więcej limitu
    const tokenLimit = isReasoning ? 16000 : 1500;

    // Modele rozumujące:
    //  - nie wspierają temperature
    //  - nie wspierają response_format: json_object
    //  - rola "system" → "developer"
    //  - trzeba wymusić JSON instrukcją w promptcie
    const messages = isReasoning
        ? [
            { role: 'developer', content: prompt + '\n\nODPOWIEDZ WYŁĄCZNIE CZYSTYM OBIEKTEM JSON, BEZ MARKDOWN, BEZ KOMENTARZY.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Rozpoznaj planszę i stojak z tego zdjęcia. Zwróć TYLKO JSON.' },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
            },
        ]
        : [
            { role: 'system', content: prompt },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Rozpoznaj planszę i stojak z tego zdjęcia.' },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                ],
            },
        ];

    const body = {
        model: cfg.model,
        ...(isReasoning ? {} : { temperature: 0, response_format: { type: 'json_object' } }),
        [tokenParam]: tokenLimit,
        messages,
    };

    let resp = await fetch(cfg.apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    // Fallback kompatybilności: część modeli OpenAI wymaga max_completion_tokens.
    if (!resp.ok && tokenParam === 'max_tokens') {
        const errText = await resp.text().catch(() => '');
        if (resp.status === 400 && /max_completion_tokens/i.test(errText)) {
            log('OpenAI zwrócił unsupported_parameter dla max_tokens; ponawiam z max_completion_tokens.');
            const retryBody = { ...body };
            delete retryBody.max_tokens;
            retryBody.max_completion_tokens = tokenLimit;

            resp = await fetch(cfg.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${cfg.apiKey}`,
                },
                body: JSON.stringify(retryBody),
            });
        } else {
            throw new Error(`Błąd modelu OpenAI (${resp.status}): ${errText.slice(0, 500)}`);
        }
    }

    log(`OpenAI odpowiedział: HTTP ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Błąd modelu OpenAI (${resp.status}): ${errText.slice(0, 500)}`);
    }

    const json = await resp.json();

    // Log zużycia tokenów (szczególnie ważne dla modeli rozumujących)
    if (json.usage) {
        const u = json.usage;
        const reasoning = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
        log(`OpenAI tokeny: input=${u.prompt_tokens}, output=${u.completion_tokens} (reasoning=${reasoning}), razem=${u.total_tokens}`);
    }

    // Dla modeli rozumujących: loguj surową odpowiedź (debug)
    if (isReasoning) {
        const choice0 = json.choices && json.choices[0];
        log(`OpenAI [reasoning debug] finish_reason=${choice0 && choice0.finish_reason}`);
        log(`OpenAI [reasoning debug] message keys=${choice0 && choice0.message ? Object.keys(choice0.message).join(',') : 'brak'}`);
        log(`OpenAI [reasoning debug] content (pierwsze 200 zn.)=${choice0 && choice0.message && JSON.stringify(choice0.message.content || '').slice(0, 200)}`);
        // Sprawdź czy jest pole 'reasoning' lub inne nowe pola
        if (choice0 && choice0.message) {
            const extraKeys = Object.keys(choice0.message).filter(k => !['role','content','refusal','annotations'].includes(k));
            if (extraKeys.length) log(`OpenAI [reasoning debug] dodatkowe pola w message: ${extraKeys.join(', ')}`);
        }
    }

    // GPT-4: choices[0].message.content
    // GPT-5 (Responses API / nowy format): output[].content[].text lub output_text
    let content = null;

    // Klasyczny format (Chat Completions)
    if (json.choices && json.choices[0] && json.choices[0].message) {
        const msg = json.choices[0].message.content;
        if (msg && msg.trim()) content = msg;
    }
    // GPT-5 nowy format: output_text (skrótowa forma)
    if (!content && json.output_text) {
        content = json.output_text;
    }
    // GPT-5 nowy format: output[].content[].text
    if (!content && Array.isArray(json.output)) {
        for (const item of json.output) {
            if (item.type === 'message' && Array.isArray(item.content)) {
                for (const part of item.content) {
                    if (part.type === 'output_text' || part.type === 'text') {
                        content = part.text || part.content || '';
                        break;
                    }
                }
            }
            if (content) break;
        }
    }

    if (!content) {
        log('OpenAI — nie znaleziono treści w odpowiedzi. Klucze:', Object.keys(json).join(', '));
        log('OpenAI — surowa odpowiedź (pierwsze 1500 zn.):', JSON.stringify(json).slice(0, 1500));

        // Dla modeli rozumujących: spróbuj Responses API jako fallback
        if (isReasoning) {
            log('OpenAI — próbuję Responses API (/v1/responses) jako fallback...');
            content = await callOpenAiResponses(cfg, prompt, mime, base64);
        }

        if (!content) {
            throw new Error('Pusta odpowiedź modelu OpenAI — model nie zwrócił rozpoznanej planszy.');
        }
    }

    const parsed = extractJson(typeof content === 'string' ? content : JSON.stringify(content));
    return normalizeAiData(parsed, alphabet);
}

/**
 * Fallback: wywołuje OpenAI Responses API (nowy endpoint dla modeli rozumujących).
 * @param {object} cfg
 * @param {string} prompt
 * @param {string} mime
 * @param {string} base64
 * @returns {Promise<string|null>}
 */
async function callOpenAiResponses(cfg, prompt, mime, base64) {
    const url = cfg.apiUrl.replace('/chat/completions', '/responses');
    const dataUrl = `data:${mime};base64,${base64}`;

    const body = {
        model: cfg.model,
        max_output_tokens: 4000,
        input: [
            { role: 'developer', content: prompt + '\n\nODPOWIEDZ WYŁĄCZNIE CZYSTYM OBIEKTEM JSON, BEZ MARKDOWN, BEZ KOMENTARZY.' },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Rozpoznaj planszę i stojak z tego zdjęcia. Zwróć TYLKO JSON.' },
                    { type: 'input_image', image_url: dataUrl },
                ],
            },
        ],
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    log(`OpenAI Responses API: HTTP ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        log(`OpenAI Responses API błąd: ${errText.slice(0, 500)}`);
        return null;
    }

    const json = await resp.json();

    // Responses API format: output_text lub output[].content[].text
    if (json.output_text && json.output_text.trim()) {
        log(`OpenAI Responses API — otrzymano output_text (${json.output_text.length} zn.)`);
        return json.output_text;
    }
    if (Array.isArray(json.output)) {
        for (const item of json.output) {
            if (item.type === 'message' && Array.isArray(item.content)) {
                for (const part of item.content) {
                    if ((part.type === 'output_text' || part.type === 'text') && part.text && part.text.trim()) {
                        log(`OpenAI Responses API — otrzymano output[].content[].text (${part.text.length} zn.)`);
                        return part.text;
                    }
                }
            }
        }
    }

    log('OpenAI Responses API — brak treści. Surowa odp.:', JSON.stringify(json).slice(0, 1000));
    return null;
}

/**
 * Wywołuje natywne API Google Gemini (generateContent, nagłówek X-goog-api-key).
 * @param {object} cfg
 * @param {string} prompt
 * @param {string} mime
 * @param {string} base64
 * @param {string} alphabet
 * @returns {Promise<{board: string[], rack: string[]}>}
 */
async function callGemini(cfg, prompt, mime, base64, alphabet) {
    // cfg.apiUrl to baza modeli; dołączamy {model}:generateContent.
    // Obsłuż też sytuację, gdy ktoś poda pełny URL z ':generateContent'.
    let url = cfg.apiUrl;
    if (!/:generateContent/.test(url)) {
        url = `${url.replace(/\/+$/, '')}/${encodeURIComponent(cfg.model)}:generateContent`;
    }

    const body = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: `${prompt}\n\nRozpoznaj planszę i stojak z tego zdjęcia.` },
                    { inline_data: { mime_type: mime, data: base64 } },
                ],
            },
        ],
        generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': cfg.apiKey,
        },
        body: JSON.stringify(body),
    });

    log(`Gemini odpowiedział: HTTP ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`Błąd modelu Gemini (${resp.status}): ${errText.slice(0, 500)}`);
    }

    const json = await resp.json();
    const cand = json.candidates && json.candidates[0];
    const parts = cand && cand.content && Array.isArray(cand.content.parts)
        ? cand.content.parts
        : [];
    const content = parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');

    if (!content) {
        const reason = cand && cand.finishReason ? ` (finishReason: ${cand.finishReason})` : '';
        throw new Error(`Gemini nie zwrócił treści${reason}.`);
    }

    const parsed = extractJson(content);
    return normalizeAiData(parsed, alphabet);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSOWANIE I WALIDACJA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizuje surowe dane od modelu do postaci { board: string[15], rack: string[] }.
 * @param {object} data - Dane z modelu
 * @param {string} alphabet - Alfabet gry
 * @returns {{board: string[], rack: string[]}}
 */
function normalizeAiData(data, alphabet) {
    if (!data || typeof data !== 'object') throw new Error('Model nie zwrócił obiektu.');

    const allowed = new Set(alphabet.toUpperCase().split(''));

    // --- plansza ---
    let rows = data.board || data.plansza;
    if (typeof rows === 'string') rows = rows.split(/\r?\n/);
    if (!Array.isArray(rows)) throw new Error('Brak pola "board" (plansza) w odpowiedzi modelu.');
    rows = rows.filter(r => typeof r === 'string');
    if (rows.length < SIZE) throw new Error(`Plansza ma ${rows.length} wierszy, oczekiwano ${SIZE}.`);
    rows = rows.slice(0, SIZE).map(r => normalizeRow(r, allowed));

    // --- stojak ---
    let rack = data.rack || data.stojak || data.stack || [];
    if (typeof rack === 'string') rack = rack.split(/[\s,]+/);
    if (!Array.isArray(rack)) rack = [];
    rack = rack
        .map(x => String(x).trim())
        .filter(Boolean)
        .map(x => normalizeRackLetter(x, allowed))
        .filter(Boolean)
        .slice(0, 7);

    return { board: rows, rack };
}

/**
 * Normalizuje pojedynczy wiersz planszy do dokładnie 15 znaków.
 * Wielkie litery = zwykły żeton, małe = blank, reszta = puste pole '.'.
 * @param {string} row
 * @param {Set<string>} allowed - Dozwolone WIELKIE litery
 * @returns {string}
 */
function normalizeRow(row, allowed) {
    const chars = [];
    for (const ch of row) {
        if (ch === '.') { chars.push('.'); continue; }
        const upper = ch.toUpperCase();
        if (allowed.has(upper)) {
            // zachowaj wielkość liter (mała = blank)
            chars.push(ch === upper ? upper : upper.toLowerCase());
        } else {
            chars.push('.'); // spacje, '-', '_', nieznane znaki => puste
        }
    }
    while (chars.length < SIZE) chars.push('.');
    return chars.slice(0, SIZE).join('');
}

/**
 * Normalizuje literę ze stojaka. Zwraca WIELKĄ literę, '*' dla blanka lub '' gdy nieznana.
 * @param {string} raw
 * @param {Set<string>} allowed
 * @returns {string}
 */
function normalizeRackLetter(raw, allowed) {
    if (raw === '*' || raw === '?' || raw === '_') return '*';
    const upper = raw.toUpperCase();
    // małą literą model może oznaczać blank -> traktuj jako blank
    if (raw.length === 1 && raw !== upper && allowed.has(upper)) return '*';
    if (allowed.has(upper)) return upper;
    return '';
}

/**
 * Buduje instancję Board z rozpoznanej planszy.
 * @param {string[]} rows - 15 łańcuchów po 15 znaków (wiersze od góry)
 * @returns {Board}
 */
function buildBoard(rows) {
    const board = new Board();
    for (let y = 0; y < SIZE; y++) {
        const row = rows[y];
        for (let x = 0; x < SIZE; x++) {
            const ch = row[x];
            if (!ch || ch === '.') continue;
            const isBlank = ch === ch.toLowerCase() && ch !== ch.toUpperCase();
            board.putWord(
                [{ letter: ch.toUpperCase(), isBlank, isCurrent: false }],
                x, y, true
            );
        }
    }
    return board;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROZWIĄZYWANIE I FORMATOWANIE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Znajduje najkorzystniejsze ruchy dla danej planszy i stojaka.
 * @param {Board} board
 * @param {string[]} rack
 * @param {WordDictionary} dict - Załadowany słownik (współdzielony singleton)
 * @param {number} [limit=20]
 * @returns {Array<object>} Sformatowane ruchy
 */
function solveTopMoves(board, rack, dict, limit = 20) {
    const solver = new Solver(dict);
    const moves = solver.solve(board, rack); // posortowane malejąco wg punktów

    const seen = new Set();
    const out = [];
    for (const m of moves) {
        if (!m || !m.success) continue;
        const key = `${m.wordSimple}|${m.x}|${m.y}|${m.horizontal}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(formatMove(m));
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * Formatuje pojedynczy ruch do czytelnej postaci.
 * @param {object} m - Ruch z Solvera
 * @returns {object} { word, orientation, fromLeft, fromTop, points, blanks, usedLetters, text }
 */
function formatMove(m) {
    const orientation = m.horizontal ? 'poziomo' : 'pionowo';
    const fromLeft = m.x + 1; // 1-based od lewej
    const fromTop = m.y + 1;  // 1-based od góry
    const blanks = (m.usedLetters || []).filter(l => l === '*').length;

    const text = `${m.wordSimple} — ${orientation}, od lewej ${fromLeft}, od góry ${fromTop} — ${m.points} pkt`;

    return {
        word: m.wordSimple,
        orientation,
        horizontal: m.horizontal,
        fromLeft,
        fromTop,
        points: m.points,
        blanks,
        usedLetters: m.usedLetters,
        perpendicularWords: m.perpendicularWords,
        text,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// GŁÓWNA FUNKCJA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pełny przepływ: obraz -> model wizyjny -> najlepsze ruchy.
 * @param {Buffer} imageBuffer - Surowy obraz przesłany przez użytkownika
 * @param {WordDictionary} dict - Załadowany słownik (współdzielony)
 * @param {object} [opts]
 * @param {string} [opts.alphabet] - Alfabet gry
 * @param {number} [opts.limit=20] - Maks. liczba zwracanych ruchów
 * @returns {Promise<{success: boolean, board: string[], rack: string[], moves: Array<object>}>}
 */
async function solveFromImage(imageBuffer, dict, opts = {}) {
    const alphabet = opts.alphabet || 'AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ';
    const limit = opts.limit || 20;

    log(`Start: obraz ${imageBuffer.length} B, limit ruchów=${limit}`);
    const resized = await resizeImage(imageBuffer);
    log(`Obraz przeskalowany do ${resized.width}x${resized.height} px (${resized.buffer.length} B).`);

    const recognized = await callVisionModel(resized.buffer, resized.mime, alphabet);
    log(`Rozpoznany stojak: [${recognized.rack.join(' ') || '—'}]`);

    const board = buildBoard(recognized.board);

    // Zdjęcie samej planszy (bez liter gracza) — nie da się policzyć ruchów.
    if (!recognized.rack.length) {
        log('Brak liter na stojaku — prawdopodobnie zdjęcie samej planszy.');
        return {
            success: true,
            board: recognized.board,
            rack: recognized.rack,
            rackEmpty: true,
            warning: 'Nie wykryto liter na Twoim stojaku. Zrób zdjęcie planszy RAZEM z Twoimi literkami — bez nich nie policzę ruchów.',
            moves: [],
        };
    }

    const moves = solveTopMoves(board, recognized.rack, dict, limit);
    log(`Gotowe: znaleziono ${moves.length} ruchów.`);

    return {
        success: true,
        board: recognized.board,
        rack: recognized.rack,
        rackEmpty: false,
        moves,
    };
}

module.exports = {
    solveFromImage,
    resizeImage,
    callVisionModel,
    buildBoard,
    solveTopMoves,
    normalizeAiData,
    loadAiConfig,
};

