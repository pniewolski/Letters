/**
 * @file game.js
 * @description Orkiestracja ekranu gry: przejście do gry, renderowanie stanu,
 * przyciski akcji oraz obsługa trybu widza (komputer vs komputer).
 */

import { dom } from './dom.js';
import { state } from './state.js';
import { CONFIG } from './config.js';
import { wsSend } from './net.js';
import { buildBoard, renderBoard } from './board.js';
import { renderRack, initRackDropZone } from './rack.js';
import { startClock, stopClock } from './clock.js';
import { addChatSystem } from './chat.js';
import { requestHint } from './hints.js';
import { sendLivePreview } from './livePreview.js';

/** Przełącza na ekran gry i konfiguruje UI pod aktualny tryb. */
export function showGame() {
    dom.screenMenu.classList.remove('active');
    dom.screenGame.classList.add('active');

    const spectator = state.gameMode === 'spectator';
    document.body.classList.toggle('mode-spectator', spectator);

    // Widoczność przycisku podpowiedzi
    if (spectator) {
        dom.btnHint.style.display = 'none';
    } else if (state.gameMode === 'human' && !CONFIG.flags.allowHintsVsHuman) {
        dom.btnHint.style.display = 'none';
    } else {
        dom.btnHint.style.display = '';
    }

    // Etykiety zależne od trybu
    if (spectator) {
        dom.myLabel.textContent = 'Komputer 1:';
        dom.oppLabel.textContent = 'Komputer 2:';
        dom.rackLabel1.textContent = 'Komputer 1';
        dom.rackLabel2.textContent = 'Komputer 2';
        dom.oppRackInfo.style.display = 'none';
    } else {
        dom.myLabel.textContent = 'Ty:';
        dom.oppLabel.textContent = 'Przeciwnik:';
        dom.oppRackInfo.style.display = '';
    }

    updatePlayerLabels();

    buildBoard();
    renderGame();
    startClock();
}

/** Ustawia etykiety graczy na podstawie imion ze stanu gry (gra sieciowa). */
function updatePlayerLabels() {
    if (state.gameMode !== 'human') return;
    const g = state.gameState;
    if (!g) return;
    if (g.myName) dom.myLabel.textContent = `${g.myName}:`;
    if (g.opponentName) dom.oppLabel.textContent = `${g.opponentName}:`;
}

/** Renderuje pełny stan gry (info + plansza + stojak + przyciski). */
export function renderGame() {
    const g = state.gameState;
    if (!g) return;

    updatePlayerLabels();

    if (g.spectator) {
        dom.myPoints.textContent = g.points[0];
        dom.oppPoints.textContent = g.points[1];
        dom.bagSize.textContent = g.bagSize;
        dom.turnIndicator.textContent = g.currentSlot === 0 ? 'Komputer 1' : 'Komputer 2';
        dom.turnIndicator.style.color = g.currentSlot === 0 ? '#2ecc71' : '#e74c3c';
    } else {
        dom.myPoints.textContent = g.myPoints;
        dom.oppPoints.textContent = g.opponentPoints;
        dom.oppRackSize.textContent = g.opponentStackSize ?? '?';
        dom.bagSize.textContent = g.bagSize;
        dom.turnIndicator.textContent = g.myTurn ? 'TWOJA' : 'Przeciwnika';
        dom.turnIndicator.style.color = g.myTurn ? '#2ecc71' : '#e74c3c';
    }

    if (g.finished) {
        dom.turnIndicator.textContent = 'KONIEC GRY';
        dom.turnIndicator.style.color = 'var(--color-gold)';
        stopClock();
    }

    renderBoard();
    renderRack();
    updateButtons();
}

/** Aktualizuje dostępność przycisków akcji. */
export function updateButtons() {
    const g = state.gameState;
    const spectator = !!(g && g.spectator);
    const myTurn = !!(g && g.myTurn && !g.finished);

    dom.btnConfirm.disabled = spectator || !myTurn || state.placedTiles.length === 0;
    dom.btnPass.disabled = spectator || !myTurn;
    dom.btnExchange.disabled = spectator || !myTurn;
    dom.btnRecall.disabled = spectator || state.placedTiles.length === 0;
}

/** Obsługa przycisku „Wymień" (wejście w tryb i zatwierdzenie wymiany). */
function onExchangeClick() {
    if (state.exchangeMode) {
        if (state.selectedForExchange.size === 0) {
            state.exchangeMode = false;
            renderGame();
            return;
        }
        const letters = [...state.selectedForExchange].map(i => state.gameState.myStack[i]);
        wsSend({ type: 'replaceLetters', letters });
        state.exchangeMode = false;
        state.selectedForExchange.clear();
    } else {
        state.placedTiles = [];
        state.exchangeMode = true;
        renderGame();
        sendLivePreview();
        addChatSystem('Tryb wymiany — zaznacz litery i kliknij „Wymień" ponownie.');
    }
}

/** Podpina obsługę przycisków akcji (jednorazowo). */
export function initGameActions() {
    initRackDropZone();

    dom.btnConfirm.onclick = () => {
        if (state.placedTiles.length === 0) return;
        const tiles = state.placedTiles.map(p => ({
            letter: p.letter, x: p.x, y: p.y, isBlank: p.isBlank,
        }));
        wsSend({ type: 'makeMove', tiles });
    };

    dom.btnRecall.onclick = () => {
        state.placedTiles = [];
        renderGame();
        sendLivePreview();
    };

    dom.btnPass.onclick = () => {
        if (confirm('Na pewno chcesz spasować?')) wsSend({ type: 'pass' });
    };

    dom.btnExchange.onclick = onExchangeClick;
    dom.btnHint.onclick = requestHint;
    dom.btnMenu.onclick = () => location.reload();
}

