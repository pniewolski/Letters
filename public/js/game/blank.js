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

    const grid = el('div', { class: 'blank-grid' },
        [...alphabet].map(ch => el('button', {
            class: 'blank-key',
            type: 'button',
            onclick: () => { dialog.close(); onPick(ch); },
        }, ch)),
    );

    dialog = modal({
        title: 'Jaką literą ma być blank?',
        body: el('div', {},
            el('p', { class: 'muted small' }, 'Blank przyjmie wybraną literę, ale zawsze liczy się jako 0 punktów.'),
            grid,
        ),
    });

    // Wygodny skrót: wpisanie litery z klawiatury działa jak kliknięcie.
    const onKey = (e) => {
        const ch = e.key.toUpperCase();
        if (alphabet.includes(ch)) {
            e.preventDefault();
            document.removeEventListener('keydown', onKey);
            dialog.close();
            onPick(ch);
        } else if (e.key === 'Escape') {
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);
}
