/**
 * @file dom.js
 * @description Referencje do elementów DOM. Moduł ładowany jako `type="module"`
 * jest odroczony (defer), więc zapytania wykonują się po sparsowaniu HTML.
 */

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export const dom = {
    // Ekrany
    screenMenu: $('#screen-menu'),
    screenGame: $('#screen-game'),
    appTitle: $('#app-title'),

    // Menu
    menuStatus: $('#menu-status'),
    joinSection: $('#join-section'),
    inputGameId: $('#input-game-id'),
    inputPlayerName: $('#input-player-name'),
    btnHost: $('#btn-host'),
    onlineList: $('#online-list'),

    // Plansza / stojaki
    board: $('#board'),
    colLabels: $('#col-labels'),
    rowLabels: $('#row-labels'),
    rack: $('#rack'),
    rack2: $('#rack2'),
    rackLabel1: $('#rack-label-1'),
    rackLabel2: $('#rack-label-2'),

    // Info
    myLabel: $('#my-label'),
    oppLabel: $('#opp-label'),
    myPoints: $('#my-points'),
    oppPoints: $('#opp-points'),
    oppRackInfo: $('#opp-rack-info'),
    oppRackSize: $('#opp-rack-size'),
    bagSize: $('#bag-size'),
    turnIndicator: $('#turn-indicator'),
    myClock: $('#my-clock'),
    oppClock: $('#opp-clock'),

    // Czat
    chatMessages: $('#chat-messages'),
    chatInput: $('#chat-input'),
    btnChatSend: $('#btn-chat-send'),

    // Panel prawy
    hintBox: $('#hint-box'),
    hintList: $('#hint-list'),
    livePreviewInfo: $('#live-preview-info'),
    liveDots: $('#live-dots'),

    // Modal blanka
    modalBlank: $('#modal-blank'),
    blankLetters: $('#blank-letters'),

    // Akcje
    actions: $('#actions'),
    btnConfirm: $('#btn-confirm'),
    btnRecall: $('#btn-recall'),
    btnPass: $('#btn-pass'),
    btnExchange: $('#btn-exchange'),
    btnHint: $('#btn-hint'),
    btnMenu: $('#btn-menu'),
};

