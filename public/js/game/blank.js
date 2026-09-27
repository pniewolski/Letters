/**
 * @file blank.js
 * @description Okno wyboru litery dla blanka. Lista liter pochodzi z alfabetu
 * bieżącego trybu gry — nie ma tu żadnej zaszytej listy znaków.
 */

import { el, modal } from '../ui.js';
import { store } from '../store.js';

/**
 * Pokazuje okno wyboru litery dla blanka.
 * @param {(letter: string) => void} onPick - Wywoływane z wybraną literą
 *
 * @example
 * showBlankModal(letter => placeTile(3, letter, 7, 7, true));
 */
export function showBlankModal(onPick) {
    const alphabet = store.game?.variant?.alphabet || '';
    let dialog = null;
    let done = false;

    const pick = (ch) => {
        if (done) return;
        done = true;
        dialog.close();
        onPick(ch);
    };

    // Wygodny skrót: wpisanie litery z klawiatury działa jak kliknięcie.
    const onKey = (e) => {
        const ch = e.key.toUpperCase();
        if (ch.length === 1 && alphabet.includes(ch)) {
            e.preventDefault();
            pick(ch);
        }
    };

    const grid = el('div', { class: 'blank-grid' },
        [...alphabet].map(ch => el('button', {
            class: 'blank-key',
            type: 'button',
            onclick: () => pick(ch),
        }, ch)),
    );

    dialog = modal({
        title: 'Jaką literą ma być blank?',
        body: el('div', {},
            el('p', { class: 'muted small' }, 'Blank przyjmie wybraną literę, ale zawsze liczy się jako 0 punktów.'),
            grid,
        ),
        // Nasłuch znika razem z oknem — także po kliknięciu litery albo tła.
        // Inaczej łapałby potem litery wpisywane na czacie.
        onClose: () => document.removeEventListener('keydown', onKey),
    });

    document.addEventListener('keydown', onKey);
}
