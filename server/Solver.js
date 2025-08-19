const Board = require('./Board');
const WordDictionary = require('./WordDictionary');

class Solver {

    constructor(dictionary) {
        this.dict = dictionary;
    }

    solve(board, letters) {

        const result = [];
        for (let n=0; n<15; n++) {
            result.push(...this.checkLine(board, letters, n, true));
        }
        for (let n=0; n<15; n++) {
            result.push(...this.checkLine(board, letters, n, false));
        }
        result.sort((a,b) => {
            if (a.points > b.points) {
                return -1;
            } else if (a.points < b.points) {
                return 1;
            } else {
                return 0;
            }
        })
        return result;
    }

    checkLine(board, letters, line, horizontal) {
        const BOARD_SIZE = 15;
        const result = [];
        const tiles = board.getTiles();

        // cache dla słów prostopadłych (unikalne: x,y,orientacja)
        const cache = new Map();

        const getPerpWord = (x, y, horizontal, letter) => {
            const key = x + "," + y + "," + horizontal;
            if (cache.has(key)) {
                return cache.get(key);
            }

            let word = letter;

            // w prawo / w dół
            let nx = x, ny = y;
            while (true) {
                nx = horizontal ? nx : nx + 1;
                ny = horizontal ? ny + 1 : ny;
                if (nx >= BOARD_SIZE || ny >= BOARD_SIZE || !tiles[nx][ny].letter) break;
                word += tiles[nx][ny].letter;
            }

            // w lewo / w górę
            nx = x; ny = y;
            while (true) {
                nx = horizontal ? nx : nx - 1;
                ny = horizontal ? ny - 1 : ny;
                if (nx < 0 || ny < 0 || !tiles[nx][ny].letter) break;
                word = tiles[nx][ny].letter + word;
            }

            cache.set(key, word);
            return word;
        };

        // budujemy template linii
        let template = '';
        for (let i = 0; i < BOARD_SIZE; i++) {
            let tile = horizontal ? tiles[i][line] : tiles[line][i];
            if (tile.letter) {
                template += tile.letter;
            } else {
                template += '.';
            }
        }

        // iterujemy po wszystkich możliwych fragmentach
        for (let len = 2; len <= BOARD_SIZE; len++) {
            for (let shift = 0; shift <= BOARD_SIZE - len; shift++) {

                // ignoruj jeśli przed lub po fragmencie jest litera
                if ((shift - 1 >= 0) && template[shift - 1] !== '.') continue;
                if ((shift + len < BOARD_SIZE) && template[shift + len] !== '.') continue;

                const subtemplate = template.slice(shift, shift + len);

                if (subtemplate.indexOf(".") === -1) continue;

                // całkiem puste, ale musi stykać się bokiem
                if (/^\.+$/.test(subtemplate)) {
                    let neighbor = false;
                    for (let i = shift; i < shift + len; i++) {
                        const x = horizontal ? i : line;
                        const y = horizontal ? line : i;

                        // sprawdzamy sąsiedztwo "bokiem"
                        if ((line > 0 && tiles[x][y - 1] && tiles[x][y - 1].letter) ||
                            (line < BOARD_SIZE - 1 && tiles[x][y + 1] && tiles[x][y + 1].letter)) {
                            neighbor = true;
                            break;
                        }
                    }
                    if (!neighbor) continue;
                }

                const candidates = this.dict.search(len, subtemplate, letters);
                if (candidates.length === 0) continue;

                candidates.forEach(word => {
                    let ok = true;

                    for (let i = 0; i < len; i++) {
                        const x = horizontal ? i + shift : line;
                        const y = horizontal ? line : i + shift;
                        const boardLetter = tiles[x][y].letter;

                        if (boardLetter) continue;

                        // sprawdzamy słowo prostopadłe z cache
                        const perpWord = getPerpWord(x, y, horizontal, word[i]);
                        if (perpWord.length > 1 && !this.dict.searchDicionarySimple(perpWord)) {
                            ok = false;
                            break;
                        }
                    }

                    if (ok) {
                        let singleResult = this.prepareSingleResult(board, [].concat(letters), word, horizontal, line, shift);
                        result.push(singleResult);
                    }
                });
            }
        }

        return result;
    }


    prepareSingleResult(board, letters, word, horizontal, line, shift, withVerification) {
        const resultWord = [];
        let additPoints = 0;
        let basePoints = 0;
        let wordMultiply = 1;
        let createdWords = [];

        // funkcja pomocnicza do skanowania dodatkowych słów
        const scanDirection = (x, y, dx, dy) => {
            let points = 0;
            let built = "";
            while (x >= 0 && y >= 0 && x < 15 && y < 15) {
                const tile = board.getTiles()[x][y];
                if (!tile.letter) break;
                built += tile.letter;
                if (!tile.isBlank) points += board.getPointsForLetter(tile.letter);
                x += dx;
                y += dy;
            }
            return { built, points };
        };

        for (let i = 0; i < word.length; i++) {
            const letter = word[i].toUpperCase();
            const x = horizontal ? shift + i : line;
            const y = horizontal ? line : shift + i;
            const tile = board.getTiles()[x][y];

            let letterPoints = 0;
            let letterMultiplier = 1;
            let currentWordMul = 1;
            let isBlank = false;
            let isCurrent = false;

            if (!tile.letter) {
                // nowa litera
                isCurrent = true;
                const bonus = board.getBonus(x, y);
                currentWordMul = bonus.w;
                wordMultiply *= currentWordMul;
                letterMultiplier = bonus.l;

                // zdejmujemy literę z ręki
                const index = letters.indexOf(letter);
                if (index !== -1) {
                    letters.splice(index, 1);
                    letterPoints = board.getPointsForLetter(letter);
                } else {
                    const blankIndex = letters.indexOf('*');
                    if (blankIndex !== -1) {
                        letters.splice(blankIndex, 1);
                        isBlank = true;
                    } else {
                        throw new Error("Can't find letter");
                    }
                }

                // liczymy słowa prostopadłe
                let { built: right, points: ptsR } = scanDirection(x + (horizontal ? 0 : 1), y + (horizontal ? 1 : 0), horizontal ? 0 : 1, horizontal ? 1 : 0);
                let { built: left, points: ptsL } = scanDirection(x - (horizontal ? 0 : 1), y - (horizontal ? 1 : 0), horizontal ? 0 : -1, horizontal ? -1 : 0);

                const perpendWord = left + letter + right;
                if (perpendWord.length > 1) {
                    let extra = (letterPoints * letterMultiplier) + ptsL + ptsR;
                    additPoints += extra * currentWordMul;

                    if (withVerification) {
                        createdWords.push(perpendWord);
                    }
                }
            } else {
                // litera już istnieje na planszy
                isBlank = tile.isBlank;
                letterPoints = isBlank ? 0 : board.getPointsForLetter(letter);
            }

            basePoints += letterPoints * letterMultiplier;

            if (withVerification) {
                // główne słowo
                createdWords.push(word);

                // sprawdź wszystkie
                for (const w of createdWords) {
                    if (!this.dict.searchDicionarySimple(w)) {
                        return {
                            success: false,
                            badWord: w
                        }
                    }
                }
            }

            resultWord.push({
                letter,
                isBlank,
                isCurrent
            });
        }

        basePoints = basePoints * wordMultiply + additPoints;

        return {
            success: true,
            wordSimple: word,
            word: resultWord,
            x: horizontal ? shift : line,
            y: horizontal ? line : shift,
            horizontal,
            points: basePoints,
        };
    }

}

module.exports = Solver;
