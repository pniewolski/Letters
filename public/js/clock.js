/**
 * @file clock.js
 * @description Zegary czasu gry — osobny dla każdego z dwóch graczy. Tyka tylko
 * zegar gracza, którego aktualnie jest tura (indeks 0 = „ja"/Komputer 1,
 * indeks 1 = przeciwnik/Komputer 2).
 */

import { dom } from './dom.js';

let seconds = [0, 0];
let activeSlot = null; // 0, 1 lub null (nikt — zegary stoją)
let clockInterval = null;

/** Formatuje sekundy jako M:SS. */
function fmt(s) {
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** Odświeża oba wyświetlacze zegarów. */
function render() {
    if (dom.myClock) dom.myClock.textContent = fmt(seconds[0]);
    if (dom.oppClock) dom.oppClock.textContent = fmt(seconds[1]);
    // Podświetlenie aktywnego zegara.
    dom.myClock?.parentElement?.classList.toggle('timer-active', activeSlot === 0);
    dom.oppClock?.parentElement?.classList.toggle('timer-active', activeSlot === 1);
}

/** Startuje (lub restartuje) zegary od 0:00 dla obu graczy. */
export function startClock() {
    seconds = [0, 0];
    activeSlot = null;
    render();
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
        if (activeSlot === 0 || activeSlot === 1) {
            seconds[activeSlot]++;
        }
        render();
    }, 1000);
}

/**
 * Ustawia, którego gracza zegar ma teraz tykać.
 * @param {number|null} slot - 0, 1 lub null (zatrzymanie odliczania obu)
 */
export function setActiveSlot(slot) {
    activeSlot = slot;
    render();
}

/** Zatrzymuje oba zegary. */
export function stopClock() {
    activeSlot = null;
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
    render();
}

