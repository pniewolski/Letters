/**
 * @file blank.js
 * @description Modal wyboru litery dla blanka (pustego klocka).
 * Lista liter pochodzi z konfiguracji (CONFIG.alphabet).
 */

import { dom } from './dom.js';
import { CONFIG } from './config.js';

let blankCallback = null;

/**
 * Pokazuje modal wyboru litery dla blanka.
 * @param {(letter: string) => void} cb - wywoływane z wybraną literą
 */
export function showBlankModal(cb) {
    blankCallback = cb;
    dom.blankLetters.innerHTML = '';

    for (const ch of CONFIG.alphabet) {
        const btn = document.createElement('button');
        btn.textContent = ch;
        btn.onclick = () => {
            dom.modalBlank.classList.add('hidden');
            const fn = blankCallback;
            blankCallback = null;
            if (fn) fn(ch);
        };
        dom.blankLetters.appendChild(btn);
    }

    dom.modalBlank.classList.remove('hidden');
}

