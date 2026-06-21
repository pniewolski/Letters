/**
 * @file chat.js
 * @description Czat w ramach gry oraz komunikaty systemowe / log ruchów.
 */

import { dom } from './dom.js';
import { wsSend } from './net.js';

/** Podpina obsługę wysyłania wiadomości czatu. */
export function initChat() {
    dom.btnChatSend.onclick = sendChatMessage;
    dom.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
}

/** Wysyła wiadomość z pola czatu. */
export function sendChatMessage() {
    const msg = dom.chatInput.value.trim();
    if (!msg) return;
    wsSend({ type: 'chat', message: msg });
    dom.chatInput.value = '';
}

/**
 * Dodaje wiadomość czatu (moja / przeciwnika).
 * @param {'mine'|'opp'} who
 * @param {string} text
 */
export function addChatMsg(who, text) {
    const div = document.createElement('div');
    div.className = `msg ${who}`;
    div.textContent = (who === 'mine' ? 'Ty: ' : 'Rywal: ') + text;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

/**
 * Dodaje komunikat systemowy (informacja o ruchu, błąd, log itp.).
 * @param {string} text
 */
export function addChatSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = `⚙ ${text}`;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

