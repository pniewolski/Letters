/**
 * @file clock.js
 * @description Prosty zegar mierzący czas od rozpoczęcia gry (licznik w górę).
 */

import { dom } from './dom.js';

let clockSeconds = 0;
let clockInterval = null;

/** Startuje (lub restartuje) zegar od 0:00. */
export function startClock() {
    clockSeconds = 0;
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        clockSeconds++;
        const min = Math.floor(clockSeconds / 60);
        const sec = clockSeconds % 60;
        dom.clock.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
    }, 1000);
}

/** Zatrzymuje zegar. */
export function stopClock() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

