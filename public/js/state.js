/**
 * @file state.js
 * @description Współdzielony, mutowalny stan aplikacji frontendu.
 * Pojedynczy obiekt `state` jest importowany przez wszystkie moduły (przekazywany
 * przez referencję), dzięki czemu zmiany są widoczne globalnie bez zmiennych window.
 */

/** Globalny stan aplikacji. */
export const state = {
    /** Tryb gry: 'computer' | 'human' | 'spectator' */
    gameMode: null,
    gameId: null,
    userId: null,
    /** Slot lokalnego gracza (0 lub 1); nieistotny w trybie widza. */
    mySlot: null,
    /** Imię lokalnego gracza (gra sieciowa). */
    playerName: null,

    /** Ostatni stan gry otrzymany z serwera. */
    gameState: null,

    /** Litery postawione w bieżącej turze (jeszcze niezatwierdzone). */
    placedTiles: [], // [{letter, x, y, isBlank, rackIndex}]

    /** Tryb wymiany liter. */
    exchangeMode: false,
    /** Indeksy liter na stojaku zaznaczone do wymiany. */
    selectedForExchange: new Set(),

    /** Dane aktualnie przeciąganego klocka. */
    drag: null, // { source:'rack'|'board', rackIndex?, letter, x?, y?, isBlank? }
};

/**
 * Czy lokalny gracz może teraz interagować z planszą (układać/przesuwać klocki)?
 * Blokuje interakcję poza swoją turą, po zakończeniu gry, w trybie widza
 * oraz w trybie wymiany liter.
 * @returns {boolean}
 */
export function canInteract() {
    const g = state.gameState;
    return !!g && g.myTurn === true && !g.finished && !g.spectator && !state.exchangeMode;
}

