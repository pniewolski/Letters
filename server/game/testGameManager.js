const GameManager = require('./GameManager');

async function test() {
    const gm = new GameManager();

    // Gracz 1 tworzy grę
    const create = await gm.createGameWithHuman();
    console.log("Utworzono grę:", create.gameId, "User1:", create.userId);
    const user1 = create.userId;

    // Gracz 2 dołącza
    const join = gm.joinGame(create.gameId);
    console.log("Gracz 2 dołączył:", join.userId);
    const user2 = join.userId;

    // Sprawdź stan
    const s1 = gm.getGameState(user1);
    const s2 = gm.getGameState(user2);
    console.log("\nStack gracza 1:", s1.state.myStack);
    console.log("Stack gracza 2:", s2.state.myStack);
    console.log("Tura gracza 1?", s1.state.myTurn);
    console.log("Tura gracza 2?", s2.state.myTurn);

    // Gracz 2 próbuje ruszać nie w swojej kolejce
    const illegal = gm.pass(user2);
    console.log("\nGracz 2 pass nie w turze:", illegal);

    // Gracz 1 stawia pierwsze słowo - użyj liter ze stacka
    const stack1 = s1.state.myStack;
    console.log("\nGracz 1 próbuje postawić słowo z liter:", stack1.slice(0, 3));
    const tiles = stack1.slice(0, 3).map((letter, i) => ({
        letter, x: 7 + i, y: 7, isBlank: false
    }));
    const move1 = gm.makeMove(user1, tiles);
    console.log("Wynik ruchu 1:", move1.success, move1.error || '', move1.lostTurn !== undefined ? `lostTurn=${move1.lostTurn}` : '', move1.points !== undefined ? `pts=${move1.points}` : '');

    // Gracz 2 pasuje
    const pass2 = gm.pass(user2);
    console.log("\nGracz 2 pasuje:", pass2.success);

    // Gracz 1 wymienia litery
    const s1after = gm.getGameState(user1);
    const toReplace = s1after.state.myStack.slice(0, 2);
    console.log("\nGracz 1 wymienia:", toReplace);
    const repl = gm.replaceLetters(user1, toReplace);
    console.log("Wymiana:", repl.success, repl.error || '');

    // Gracz 2 pasuje znowu
    const pass2b = gm.pass(user2);
    console.log("\nGracz 2 pasuje ponownie:", pass2b.success);

    // Gracz 1 pasuje
    const pass1 = gm.pass(user1);
    console.log("Gracz 1 pasuje:", pass1.success);

    // Gracz 2 pasuje - powinno zakończyć grę (2 pasy z rzędu od obu)
    const pass2c = gm.pass(user2);
    console.log("Gracz 2 pasuje:", pass2c.success);
    
    const finalState = gm.getGameState(user1);
    console.log("\nGra zakończona?", finalState.state.finished);
    console.log("Punkty G1:", finalState.state.myPoints, "Punkty G2:", finalState.state.opponentPoints);
    console.log("state", finalState);
}

test().catch(console.error);
