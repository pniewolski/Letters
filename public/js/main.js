/**
 * @file main.js
 * @description Punkt wejścia frontendu. Ładuje konfigurację z serwera, podpina
 * menu, czat i akcje gry oraz routuje wiadomości WebSocket do modułów.
 */

import { loadConfig, applyConfigToDom } from './config.js';
import { connectWs, setMessageHandler, wsSend } from './net.js';
import { state } from './state.js';
import { dom, $ } from './dom.js';
import { showGame, renderGame, initGameActions } from './game.js';
import { initChat, addChatMsg, addChatSystem } from './chat.js';
import { showHints } from './hints.js';
import { showLivePreview, clearLivePreview } from './livePreview.js';

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING WIADOMOŚCI Z SERWERA
// ─────────────────────────────────────────────────────────────────────────────

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            console.log(msg.message);
            break;

        case 'createGame:response':
            if (msg.success) {
                state.gameId = msg.gameId;
                state.userId = msg.userId;
                state.mySlot = 0;
                if (state.gameMode === 'human') {
                    dom.menuStatus.textContent = `Kod gry: ${msg.gameId} (oczekiwanie na gracza...)`;
                    navigator.clipboard?.writeText(msg.gameId);
                } else {
                    // 'computer' lub 'spectator'
                    state.gameState = msg.state;
                    showGame();
                }
            } else {
                dom.menuStatus.textContent = msg.error || 'Błąd tworzenia gry';
            }
            break;

        case 'joinGame:response':
            if (msg.success) {
                state.userId = msg.userId;
                state.mySlot = 1;
                state.gameState = msg.state;
                showGame();
            } else {
                dom.menuStatus.textContent = msg.error || 'Nie udało się dołączyć';
            }
            break;

        case 'opponentJoined':
            state.gameState = msg.state;
            showGame();
            addChatSystem('Przeciwnik dołączył do gry!');
            break;

        case 'gameState':
            state.gameState = msg.state;
            renderGame();
            break;

        case 'makeMove:response':
            if (!msg.success) addChatSystem(`Błąd: ${msg.error}`);
            else if (msg.lostTurn) addChatSystem(`Stracono turę! Złe słowa: ${msg.wrongWords?.join(', ')}`);
            state.placedTiles = [];
            if (msg.state) { state.gameState = msg.state; renderGame(); }
            break;

        case 'replaceLetters:response':
            if (!msg.success) addChatSystem(`Błąd: ${msg.error}`);
            state.exchangeMode = false;
            state.selectedForExchange.clear();
            if (msg.state) { state.gameState = msg.state; renderGame(); }
            break;

        case 'pass:response':
            if (!msg.success) addChatSystem(`Błąd: ${msg.error}`);
            if (msg.state) { state.gameState = msg.state; renderGame(); }
            break;

        case 'hint:response':
            if (msg.success) showHints(msg.hints);
            else addChatSystem(`Podpowiedź: ${msg.error}`);
            break;

        case 'opponentMoved':
            clearLivePreview();
            addChatSystem(msg.lostTurn ? 'Przeciwnik stracił turę.' : `Przeciwnik zagrał (+${msg.points} pkt)`);
            break;

        case 'opponentPassed':
            addChatSystem('Przeciwnik spasował.');
            break;

        case 'opponentReplaced':
            addChatSystem('Przeciwnik wymienił litery.');
            break;

        case 'computerMoved':
            addChatSystem(`Komputer zagrał (+${msg.points} pkt)`);
            break;

        case 'opponentDisconnected':
            addChatSystem('⚠ Przeciwnik rozłączył się.');
            break;

        case 'opponentLeft':
            addChatSystem('⚠ Przeciwnik opuścił grę.');
            break;

        case 'chatMessage':
            addChatMsg(msg.slot === state.mySlot ? 'mine' : 'opp', msg.message);
            break;

        case 'livePreview':
            showLivePreview(msg.tiles);
            break;

        case 'compMove':
            logCompMove(msg.move);
            break;

        case 'gameOver':
            state.gameState = msg.state;
            renderGame();
            announceWinner(msg.state);
            break;

        case 'chat:response':
            break;

        default:
            console.log('[WS] Unhandled:', msg);
    }
}

/** Loguje ruch komputera w trybie widza. */
function logCompMove(move) {
    if (!move) return;
    const who = `Komputer ${move.slot + 1}`;
    let what;
    if (move.passed) what = 'pas';
    else if (move.replaced) what = 'wymiana liter';
    else what = `${move.wordSimple} (+${move.points} pkt)`;
    addChatSystem(`${who}: ${what}`);
}

/** Ogłasza zwycięzcę w trybie widza. */
function announceWinner(s) {
    if (!s || !s.points) return;
    const [a, b] = s.points;
    let txt;
    if (a === b) txt = `Remis ${a}:${b}`;
    else if (a > b) txt = `Wygrywa Komputer 1 (${a}:${b})`;
    else txt = `Wygrywa Komputer 2 (${b}:${a})`;
    addChatSystem(`🏁 Koniec gry. ${txt}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU
// ─────────────────────────────────────────────────────────────────────────────

function initMenu() {
    $('#btn-vs-computer').onclick = () => {
        state.gameMode = 'computer';
        dom.menuStatus.textContent = 'Tworzenie gry...';
        wsSend({ type: 'createGame', mode: 'computer' });
    };

    $('#btn-vs-compcomp').onclick = () => {
        state.gameMode = 'spectator';
        dom.menuStatus.textContent = 'Uruchamianie symulacji...';
        wsSend({ type: 'createGame', mode: 'compcomp' });
    };

    $('#btn-vs-human').onclick = () => {
        state.gameMode = 'human';
        dom.joinSection.classList.remove('hidden');
        dom.menuStatus.textContent = 'Wklej kod aby dołączyć, lub kliknij „Dołącz / Stwórz pokój" z pustym polem';
    };

    $('#btn-join').onclick = () => {
        const id = dom.inputGameId.value.trim();
        if (!id) {
            dom.menuStatus.textContent = 'Tworzenie pokoju...';
            wsSend({ type: 'createGame', mode: 'human' });
        } else {
            dom.menuStatus.textContent = 'Dołączanie...';
            wsSend({ type: 'joinGame', gameId: id });
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
    try {
        await loadConfig();
        applyConfigToDom();
    } catch (e) {
        console.error('Nie udało się załadować konfiguracji:', e);
    }

    initMenu();
    initChat();
    initGameActions();

    setMessageHandler(handleMessage);
    connectWs();
}

init();

