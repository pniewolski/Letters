const Board = require('./Board');
const WordDictionary = require('./WordDictionary');

class Solver {
    constructor(dictionary) {
        this.dict = dictionary;
    }

    solve(board, letters) {
        const results = [];
        console.log("SOLVE");

        // sprawdzamy poziomo i pionowo
        for (let i = 0; i < 15; i++) {
            results.push(...this.checkLine(board, letters, i, true));
            results.push(...this.checkLine(board, letters, i, false));
        }

        // sortowanie po punktach malejąco
        return results.sort((a, b) => b.points - a.points);
    }

    checkLine(board, letters, line, horizontal) {
        const result = [];
        const template = this.buildTemplate(board, line, horizontal);
        //console.log("template",template);

        for (let len = 2; len <= 15; len++) {
            for (let shift = 0; shift <= 15 - len; shift++) {
                if (!this.isValidPlacement(template, shift, len)) continue;

                const subtemplate = template.slice(shift, shift + len);
                if (!subtemplate.includes('.')) continue;

                //jak linia pusta to olewamy chyba że są jakieś sąsiednie litery to można
                if (/^\.+$/.test(subtemplate) && !this.hasAdjacentLetter(board, line, shift, len, horizontal)) {
                    continue;
                }

                const candidates = this.dict.search(len, subtemplate, letters);
                for (const word of candidates) {
                    if (this.isWordValid(board, word, line, shift, horizontal)) {
                        result.push(
                            this.prepareSingleResult(board, [...letters], word, horizontal, line, shift)
                        );
                    }
                }
            }
        }

        return result;
    }

    generateFirstWord(board, letters) {
        const template = "...............";
        const horizontal = true;
        const line = 6;
        const result = [];

        for (let len = 2; len <= 7; len++) {
            for (let shift = 1; shift <= 15 - len; shift++) {
                if ((shift+len < 6) || (shift > 6)) {
                    continue;
                }
                const subtemplate = template.slice(shift, shift + len);
                console.log(subtemplate);
                const candidates = this.dict.search(len, subtemplate, letters);
                for (const word of candidates) {
                    result.push(
                        this.prepareSingleResult(board, [...letters], word, horizontal, line, shift)
                    );
                }
            }
        }
        return result.sort((a, b) => b.points - a.points);
    }

    buildTemplate(board, line, horizontal) {
        let template = '';
        for (let i = 0; i < 15; i++) {
            const tile = horizontal ? board.getTiles()[i][line] : board.getTiles()[line][i];
            template += tile.letter ?? '.';
        }
        return template;
    }

    isValidPlacement(template, shift, len) {
        if (shift > 0 && template[shift - 1] !== '.') return false;
        if (shift + len < 15 && template[shift + len] !== '.') return false;
        return true;
    }

    hasAdjacentLetter(board, line, shift, len, horizontal) {
        for (let i = shift; i < shift + len; i++) {
            if (horizontal) {
                if ((line > 0 && board.getTiles()[i][line - 1].letter) ||
                    (line < 14 && board.getTiles()[i][line + 1].letter)) {
                    return true;
                }
            } else {
                if ((line > 0 && board.getTiles()[line - 1][i].letter) ||
                    (line < 14 && board.getTiles()[line + 1][i].letter)) {
                    return true;
                }
            }
        }
        return false;
    }

    isWordValid(board, word, line, shift, horizontal) {
        for (let i = 0; i < word.length; i++) {
            const x = horizontal ? i + shift : line;
            const y = horizontal ? line : i + shift;

            if (board.getTiles()[x][y].letter) continue;

            let candidate = word[i];

            // rozszerzamy w dół/prawo
            for (let j = (horizontal ? y : x) + 1; j < 15; j++) {
                const tile = horizontal ? board.getTiles()[x][j] : board.getTiles()[j][y];
                if (!tile.letter) break;
                candidate += tile.letter;
            }

            // rozszerzamy w górę/lewo
            for (let j = (horizontal ? y : x) - 1; j >= 0; j--) {
                const tile = horizontal ? board.getTiles()[x][j] : board.getTiles()[j][y];
                if (!tile.letter) break;
                candidate = tile.letter + candidate;
            }

            if (candidate.length > 1 && !this.dict.searchDicionarySimple(candidate)) {
                return false;
            }
        }
        return true;
    }

    checkWord(board, letters, word, horizontal, x, y) {
        return this.prepareSingleResult(
            board,
            [...letters],
            word,
            horizontal,
            horizontal ? y : x,  // line
            horizontal ? x : y,  // shift
            true
        );
    }
    prepareSingleResult(board, letters, word, horizontal, line, shift, withChecking = false) {
        const resultWord = Array.from(word, () => ({}));
        let additPoints = 0, basePoints = 0, wordMultiply = 1;
        const perpendicularWords = [];
        const usedLetters = [];

        [...word].forEach((letter, idx) => {
            letter = letter.toUpperCase();

            const x = horizontal ? shift + idx : line;
            const y = horizontal ? line : shift + idx;
            const tile = board.getTiles()[x][y];

            let letterPoints = 0, letterMultiplier = 1, currentWordMul = 1;
            const isCurrent = !tile.letter;

            if (isCurrent) {
                const bonus = board.getBonus(x, y);
                currentWordMul = bonus.w;
                wordMultiply *= currentWordMul;
                letterMultiplier = bonus.l;

                const index = letters.indexOf(letter);
                if (index !== -1) {
                    letters.splice(index, 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: false };
                    letterPoints = board.getPointsForLetter(letter);
                    usedLetters.push(letter);
                } else {
                    const blankIndex = letters.indexOf('*');
                    if (blankIndex === -1) throw new Error("cant find letter");
                    letters.splice(blankIndex, 1);
                    resultWord[idx] = { letter, isCurrent: true, isBlank: true };
                    usedLetters.push('*');
                }

                // 🚀 zapisujemy słowo prostopadłe
                const perp = this.calculatePerpendicular(
                    board, x, y, letter,
                    letterPoints, letterMultiplier,
                    currentWordMul, horizontal
                );
                additPoints += perp.points;
                if (perp.word) perpendicularWords.push(perp.word);

            } else {
                resultWord[idx] = { letter, isCurrent: false, isBlank: tile.isBlank };
                letterPoints = tile.isBlank ? 0 : board.getPointsForLetter(letter);
            }

            basePoints += letterPoints * letterMultiplier;
        });

        basePoints = basePoints * wordMultiply + additPoints;

        if (usedLetters.length == 7) {
            basePoints += 50;
        }

        // 🔎 dodatkowa walidacja słownika
        if (withChecking) {
            let wrongWords = [];
            if (!this.dict.searchDicionarySimple(word)) {
                wrongWords.push(word);
            }
            for (const perpWord of perpendicularWords) {
                if (!this.dict.searchDicionarySimple(perpWord)) {
                    wrongWords.push(perpWord);
                }
            }

            if (wrongWords.length > 0) {
                return {
                    success: false,
                    wrongWords: wrongWords
                };
            }
        }

        return {
            success: true,
            replace: false,
            wordSimple: word,
            perpendicularWords: perpendicularWords,
            word: resultWord,
            x: horizontal ? shift : line,
            y: horizontal ? line : shift,
            horizontal,
            points: basePoints,
            usedLetters: usedLetters
        };
    }

    calculatePerpendicular(board, x, y, letter, letterPoints, letterMultiplier, currentWordMul, horizontal) {
        let dx = horizontal ? 0 : 1;
        let dy = horizontal ? 1 : 0;
        let startWord = letter;
        let extraPoints = letterPoints * letterMultiplier;

        // w dół/prawo
        for (let j = 1; j < 15; j++) {
            const nx = x + dx * j, ny = y + dy * j;
            if (nx >= 15 || ny >= 15) break;
            const tile = board.getTiles()[nx][ny];
            if (!tile.letter) break;
            startWord += tile.letter;
            if (!tile.isBlank) extraPoints += board.getPointsForLetter(tile.letter);
        }

        // w górę/lewo
        for (let j = 1; j < 15; j++) {
            const nx = x - dx * j, ny = y - dy * j;
            if (nx < 0 || ny < 0) break;
            const tile = board.getTiles()[nx][ny];
            if (!tile.letter) break;
            startWord = tile.letter + startWord;
            if (!tile.isBlank) extraPoints += board.getPointsForLetter(tile.letter);
        }

        if (startWord.length === 1) {
            return { word: null, points: 0 };
        }
        return { word: startWord, points: extraPoints * currentWordMul };
    }

}

module.exports = Solver;
