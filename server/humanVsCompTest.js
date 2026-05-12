const readline = require('readline');
const WordDictionary = require('./board/WordDictionary');
const Game = require('./game/Game');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
    const dict = new WordDictionary();
    await dict.ready;

    const game = new Game(dict);
    const HUMAN = 0;
    const COMP = 1;

    console.log("=== Scrabble: Człowiek vs Komputer ===\n");
    game.table.board.consolePreviewBoard();

    while (true) {
        console.log(`\nTwój stack: [${game.table.stack[HUMAN].join(', ')}]`);
        console.log(`Punkty: Ty=${game.table.points[HUMAN]}  Komputer=${game.table.points[COMP]}`);

        const action = await ask("Akcja (s=słowo, w=wymiana, p=pas): ");

        if (action === 'p') {
            game.table.currentTurn += 1;
            console.log("Pasujesz.");
        } else if (action === 'w') {
            const letters = (await ask("Litery do wymiany (np. A,B,C): ")).split(',').map(l => l.trim().toUpperCase());
            const result = game.humanMove(HUMAN, true, { letters });
            if (!result.success) {
                console.log("Błąd:", result.errors.join('; '));
                continue;
            }
            console.log("Wymieniono litery.");
        } else if (action === 's') {
            // Format: "X,Y,LITERA X,Y,LITERA ..." np. "7,7,K 8,7,O 9,7,T"
            // małą literą = blank
            const raw = await ask("Kafelki (np. 7,7,K 8,7,O 9,7,t): ");
            const tiles = raw.trim().split(/\s+/).map(part => {
                const [xs, ys, letterRaw] = part.split(',');
                return {
                    x: parseInt(xs),
                    y: parseInt(ys),
                    letter: letterRaw.toUpperCase(),
                    isBlank: letterRaw === letterRaw.toLowerCase() && letterRaw !== letterRaw.toUpperCase(),
                };
            });

            const result = game.humanMove(HUMAN, false, { tiles });
            if (!result.success) {
                console.log("Błąd:", result.errors.join('; '));
                continue;
            }
            if (result.lostTurn) {
                console.log(`Złe słowa: ${result.wrongWords.join(', ')} — tracisz kolejkę!`);
            } else {
                console.log(`Zdobyto ${result.points} punktów.`);
            }
        } else {
            console.log("Nieznana akcja.");
            continue;
        }

        game.table.board.consolePreviewBoard();

        if (game.table.bag.getBagSize() === 0 && game.table.stack[HUMAN].length === 0) {
            console.log("Koniec gry!");
            break;
        }

        console.log("\n--- Ruch komputera ---");
        game.computerMove(COMP);

        if (game.table.bag.getBagSize() === 0 && game.table.stack[COMP].length === 0) {
            console.log("Koniec gry!");
            break;
        }
    }

    console.log(`\nWynik końcowy: Ty=${game.table.points[HUMAN]}  Komputer=${game.table.points[COMP]}`);
    rl.close();
}

main();
