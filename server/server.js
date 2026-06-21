/**
 * @file server.js
 * @description Serwer WebSocket gry Scrabble.
 *
 * Architektura:
 * - Express serwuje pliki statyczne (frontend) z katalogu /public
 * - WebSocket (ws) obsługuje komunikację real-time z klientami
 * - GameManager jest singletonem — jeden słownik dla wszystkich gier
 *
 * Protokół komunikacji (JSON):
 * Klient wysyła:  { type: "nazwaAkcji", ...dane }
 * Serwer odpowiada: { type: "nazwaAkcji:response", ...wynik }
 * Serwer pushuje:  { type: "nazwaZdarzenia", ...dane }
 *
 * @example
 * // Uruchomienie: node server/server.js
 * // Klient łączy się: ws://localhost:3000
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const GameManager = require('./game/GameManager');

// ─────────────────────────────────────────────────────────────────────────────
// KONFIGURACJA
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// Zmiana katalogu roboczego na /server (bo klasy czytają pliki relatywnie)
process.chdir(path.join(__dirname));

/**
 * Buduje wspólną konfigurację dla frontendu z plików serwera.
 * Łączy: config.json (tytuł, kolory, flagi), layout.json (bonusy) oraz
 * letters.json (punktacja liter — spłaszczona do mapy litera→punkty).
 * Dzięki temu front NIE duplikuje tych danych — pobiera je z /api/config.
 * @returns {object} Konfiguracja: { title, alphabet, flags, boardColors, boardLayout, letterPoints }
 */
function buildClientConfig() {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    const boardLayout = JSON.parse(fs.readFileSync(path.join(__dirname, 'layout.json'), 'utf-8'));
    const lettersData = JSON.parse(fs.readFileSync(path.join(__dirname, 'letters.json'), 'utf-8'));

    // Spłaszcz punktację: { "1": ["A",...] } -> { A: 1, ... }
    const letterPoints = {};
    for (const [pts, arr] of Object.entries(lettersData.points)) {
        for (const l of arr) letterPoints[l] = Number(pts);
    }
    letterPoints['*'] = 0; // blank = 0 pkt

    return {
        title: cfg.title || 'Scrabble',
        alphabet: cfg.alphabet || '',
        flags: cfg.flags || {},
        boardColors: (cfg.board && cfg.board.colors) || {},
        boardLayout,
        letterPoints,
    };
}

/** @type {object} Konfiguracja klienta (budowana raz przy starcie, współdzielona). */
const CLIENT_CONFIG = buildClientConfig();

// ─────────────────────────────────────────────────────────────────────────────
// INICJALIZACJA
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * Endpoint konfiguracji — front pobiera stąd tytuł, kolory planszy,
 * układ bonusów i punktację liter (zamiast je duplikować w kodzie).
 */
app.get('/api/config', (req, res) => {
    res.json(CLIENT_CONFIG);
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

/** @type {GameManager} Singleton menedżera gier */
const gm = new GameManager();

/**
 * Mapa: userId -> WebSocket
 * Pozwala wysyłać wiadomości do konkretnego gracza po jego userId.
 * @type {Map<string, WebSocket>}
 */
const connections = new Map();

/**
 * Mapa: ws -> userId
 * Odwrotna mapa do szybkiego odszukania userId po sockecie.
 * @type {Map<WebSocket, string>}
 */
const socketToUser = new Map();

/**
 * Aktywne pętle symulacji komputer vs komputer.
 * @type {Map<string, NodeJS.Timeout>} gameId -> intervalId
 */
const compLoops = new Map();

/**
 * Mapa widzów gier komputer vs komputer.
 * @type {Map<string, string>} userId(widza) -> gameId
 */
const spectatorGames = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// POMOCNICZE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wysyła JSON do konkretnego WebSocket.
 */
function send(ws, data) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

/**
 * Wysyła wiadomość do przeciwnika w grze (jeśli jest podłączony).
 * @param {string} userId - userId NADAWCY (wyślemy do jego przeciwnika)
 * @param {object} data - dane do wysłania
 */
function sendToOpponent(userId, data) {
    const r = gm._resolve(userId);
    if (!r) return;

    const opponentPlayer = r.state.players.find(p => p.userId !== userId);
    if (!opponentPlayer) return;

    const opponentWs = connections.get(opponentPlayer.userId);
    if (opponentWs) {
        send(opponentWs, data);
    }
}

/**
 * Wysyła zaktualizowany stan gry do obu graczy.
 */
function broadcastGameState(userId) {
    const r = gm._resolve(userId);
    if (!r) return;

    for (const player of r.state.players) {
        const ws = connections.get(player.userId);
        if (ws) {
            const state = gm._buildPublicState(r.state, player.slot);
            send(ws, { type: 'gameState', state });
        }
    }
}

/**
 * Zatrzymuje pętlę symulacji komputer vs komputer.
 * @param {string} gameId - Identyfikator gry
 */
function stopCompVsCompLoop(gameId) {
    const interval = compLoops.get(gameId);
    if (interval) {
        clearInterval(interval);
        compLoops.delete(gameId);
    }
}

/**
 * Uruchamia pętlę symulacji komputer vs komputer.
 * Co `stepMs` wykonuje jeden ruch i wysyła stan widzowi, aby oglądał grę na żywo.
 * @param {string} gameId - Identyfikator gry
 * @param {string} spectatorUserId - userId widza
 */
function startCompVsCompLoop(gameId, spectatorUserId) {
    const stepMs = CLIENT_CONFIG.flags.compVsCompStepMs || 1400;
    const MAX_STEPS = 600; // zabezpieczenie przed patologiczną nieskończoną grą
    let steps = 0;

    const interval = setInterval(() => {
        const step = gm.stepCompVsComp(gameId);
        const ws = connections.get(spectatorUserId);

        if (!step.success) { stopCompVsCompLoop(gameId); return; }

        if (ws) {
            send(ws, { type: 'gameState', state: step.state });
            if (step.lastMove) send(ws, { type: 'compMove', move: step.lastMove });
        }

        if (step.finished || ++steps >= MAX_STEPS) {
            stopCompVsCompLoop(gameId);
            if (ws) send(ws, { type: 'gameOver', state: step.state });
        }
    }, stepMs);

    compLoops.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSŁUGA ZDARZEŃ WEBSOCKET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handlery akcji klienta.
 * Każdy handler przyjmuje (ws, payload) i opcjonalnie zwraca odpowiedź.
 */
const handlers = {

    // ═══════════════════════════════════════════════════════════════════════
    // ZARZĄDZANIE GRAMI
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Tworzy grę z komputerem, z innym graczem lub komputer vs komputer.
     * Klient: { type: "createGame", mode: "computer"|"human"|"compcomp", difficulty?: number }
     */
    async createGame(ws, payload) {
        const mode = payload.mode || 'computer';
        let result;

        if (mode === 'computer') {
            result = await gm.createGameWithComputer(payload.difficulty || 1);
        } else if (mode === 'compcomp') {
            result = await gm.createGameWithCompVsComp();
        } else {
            result = await gm.createGameWithHuman();
        }

        if (result.success) {
            // Powiąż socket z userId
            connections.set(result.userId, ws);
            socketToUser.set(ws, result.userId);

            // Tryb obserwacji — uruchom automatyczną symulację
            if (mode === 'compcomp') {
                spectatorGames.set(result.userId, result.gameId);
                startCompVsCompLoop(result.gameId, result.userId);
            }
        }

        return { type: 'createGame:response', ...result };
    },

    /**
     * Dołącza do istniejącej gry (human vs human).
     * Klient: { type: "joinGame", gameId: "..." }
     */
    joinGame(ws, payload) {
        const result = gm.joinGame(payload.gameId);

        if (result.success) {
            connections.set(result.userId, ws);
            socketToUser.set(ws, result.userId);

            // Powiadom twórcę gry że przeciwnik dołączył
            const r = gm._resolve(result.userId);
            if (r) {
                const creator = r.state.players.find(p => p.slot === 0);
                if (creator) {
                    const creatorWs = connections.get(creator.userId);
                    if (creatorWs) {
                        const creatorState = gm._buildPublicState(r.state, 0);
                        send(creatorWs, { type: 'opponentJoined', state: creatorState });
                    }
                }
            }
        }

        return { type: 'joinGame:response', ...result };
    },

    /**
     * Opuszcza grę (rezygnacja).
     * Klient: { type: "leaveGame" }
     */
    leaveGame(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'leaveGame:response', success: false, error: 'Brak sesji.' };

        // Powiadom przeciwnika
        sendToOpponent(userId, { type: 'opponentLeft' });

        const result = gm.leaveGame(userId);
        connections.delete(userId);
        socketToUser.delete(ws);

        return { type: 'leaveGame:response', ...result };
    },

    // ═══════════════════════════════════════════════════════════════════════
    // ROZGRYWKA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Wykonuje ruch (kładzie litery).
     * Klient: { type: "makeMove", tiles: [{letter, x, y, isBlank}, ...] }
     */
    makeMove(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'makeMove:response', success: false, error: 'Brak sesji.' };

        const result = gm.makeMove(userId, payload.tiles);

        if (result.success) {
            // Wyślij zaktualizowany stan do obu graczy
            broadcastGameState(userId);

            // Powiadom przeciwnika o ruchu
            sendToOpponent(userId, {
                type: 'opponentMoved',
                lostTurn: result.lostTurn,
                points: result.points || 0,
                wrongWords: result.wrongWords || null,
            });

            // Jeśli komputer odpowiedział, wyślij info
            if (result.computerMove) {
                send(ws, {
                    type: 'computerMoved',
                    points: result.computerMove.points,
                });
            }
        }

        return { type: 'makeMove:response', ...result };
    },

    /**
     * Wymiana liter.
     * Klient: { type: "replaceLetters", letters: ["A", "B", ...] }
     */
    replaceLetters(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'replaceLetters:response', success: false, error: 'Brak sesji.' };

        const result = gm.replaceLetters(userId, payload.letters);

        if (result.success) {
            broadcastGameState(userId);
            sendToOpponent(userId, { type: 'opponentReplaced' });

            if (result.computerMove) {
                send(ws, { type: 'computerMoved', points: result.computerMove.points });
            }
        }

        return { type: 'replaceLetters:response', ...result };
    },

    /**
     * Pasowanie (pominięcie tury).
     * Klient: { type: "pass" }
     */
    pass(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'pass:response', success: false, error: 'Brak sesji.' };

        const result = gm.pass(userId);

        if (result.success) {
            broadcastGameState(userId);
            sendToOpponent(userId, { type: 'opponentPassed' });

            if (result.computerMove) {
                send(ws, { type: 'computerMoved', points: result.computerMove.points });
            }
        }

        return { type: 'pass:response', ...result };
    },

    /**
     * Pobiera aktualny stan gry.
     * Klient: { type: "getState" }
     */
    getState(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'getState:response', success: false, error: 'Brak sesji.' };

        const result = gm.getGameState(userId);
        return { type: 'getState:response', ...result };
    },

    // ═══════════════════════════════════════════════════════════════════════
    // PODPOWIEDZI
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Zwraca najlepsze ruchy jako podpowiedź.
     * Klient: { type: "hint", count?: number }
     */
    hint(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'hint:response', success: false, error: 'Brak sesji.' };

        const count = payload.count || 5;
        const result = gm.getHint(userId, count);
        return { type: 'hint:response', ...result };
    },

    // ═══════════════════════════════════════════════════════════════════════
    // KOMUNIKACJA DODATKOWA (czat + live preview)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Wysyła wiadomość czatu.
     * Klient: { type: "chat", message: "..." }
     */
    chat(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return { type: 'chat:response', success: false, error: 'Brak sesji.' };

        const message = (payload.message || '').trim();
        if (!message) return { type: 'chat:response', success: false, error: 'Pusta wiadomość.' };
        if (message.length > 500) return { type: 'chat:response', success: false, error: 'Wiadomość za długa.' };

        const result = gm.sendChat(userId, message);

        if (result.success) {
            const r = gm._resolve(userId);
            const chatEntry = {
                type: 'chatMessage',
                slot: r.slot,
                message,
                timestamp: Date.now(),
            };

            // Wyślij do obu graczy (nadawca też widzi potwierdzenie)
            send(ws, chatEntry);
            sendToOpponent(userId, chatEntry);
        }

        return { type: 'chat:response', ...result };
    },

    /**
     * Podgląd na żywo — klient wysyła bieżące ułożenie liter PRZED zatwierdzeniem ruchu.
     * Przeciwnik widzi w real-time co drugi gracz układa na planszy.
     *
     * Klient: { type: "livePreview", tiles: [{letter, x, y, isBlank}, ...] }
     *   - tiles = [] oznacza wyczyszczenie podglądu (gracz zabrał litery z planszy)
     */
    livePreview(ws, payload) {
        const userId = socketToUser.get(ws);
        if (!userId) return;

        // Przesyłamy do przeciwnika tylko pozycje i czy to blank
        // (litery NIE są ujawniane — przeciwnik widzi tylko "klocki" na pozycjach)
        const preview = (payload.tiles || []).map(t => ({
            x: t.x,
            y: t.y,
            hasLetter: true,  // nie ujawniamy samej litery
            isBlank: t.isBlank || false,
        }));

        sendToOpponent(userId, {
            type: 'livePreview',
            tiles: preview,
        });

        // Brak response — fire and forget
        return null;
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// GŁÓWNA PĘTLA WEBSOCKET
// ─────────────────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
    console.log(`[WS] Nowe połączenie (aktywne: ${wss.clients.size})`);

    ws.on('message', async (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (e) {
            send(ws, { type: 'error', error: 'Niepoprawny format JSON.' });
            return;
        }

        const { type, ...payload } = msg;

        if (!type || !handlers[type]) {
            send(ws, { type: 'error', error: `Nieznana akcja: ${type}` });
            return;
        }

        try {
            const response = await handlers[type](ws, payload);
            if (response) {
                send(ws, response);
            }
        } catch (err) {
            console.error(`[WS] Błąd w handlerze "${type}":`, err);
            send(ws, { type: `${type}:response`, success: false, error: 'Błąd wewnętrzny serwera.' });
        }
    });

    ws.on('close', () => {
        const userId = socketToUser.get(ws);
        if (userId) {
            console.log(`[WS] Rozłączono: ${userId}`);

            // Jeśli to widz gry komputer vs komputer — zatrzymaj symulację
            const spectatedGameId = spectatorGames.get(userId);
            if (spectatedGameId) {
                stopCompVsCompLoop(spectatedGameId);
                spectatorGames.delete(userId);
            }

            // Powiadom przeciwnika o rozłączeniu
            sendToOpponent(userId, { type: 'opponentDisconnected' });

            connections.delete(userId);
            socketToUser.delete(ws);
        }
    });

    ws.on('error', (err) => {
        console.error('[WS] Błąd socketu:', err.message);
    });

    // Powitanie — serwer potwierdza połączenie
    send(ws, { type: 'connected', message: 'Połączono z serwerem Scrabble.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERWERA
// ─────────────────────────────────────────────────────────────────────────────

async function start() {
    console.log('[Server] Ładowanie słownika...');
    await gm.dict.ready;
    console.log('[Server] Słownik gotowy.');

    httpServer.listen(PORT, () => {
        console.log(`[Server] Scrabble server nasłuchuje na http://localhost:${PORT}`);
        console.log(`[Server] WebSocket dostępny na ws://localhost:${PORT}`);
    });
}

start().catch(err => {
    console.error('[Server] Nie udało się uruchomić serwera:', err);
    process.exit(1);
});

