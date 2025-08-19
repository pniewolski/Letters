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
        let result = [];
        let template = '';
        for (let i=0; i<15; i++) {
            if (horizontal) {
                template += board.getTiles()[i][line].letter == null ? '.' : board.getTiles()[i][line].letter;
            } else {
                template += board.getTiles()[line][i].letter == null ? '.' : board.getTiles()[line][i].letter;
            }
        }
        //console.log("template",template);
        for (let len=2; len<=15; len++) {
            for (let shift=0; shift<=15-len; shift++) {



                //console.log("template",template,"shift",shift,"len",len);
                if ((shift-1 >= 0) && template[shift-1] != '.') {
                    // let s1 = template.slice(shift, shift+len);
                    // console.log("niepoprawny before ",s1);
                    continue;
                } else if ((shift+len < 15) && template[shift+len] != '.') {
                    // let s1 = template.slice(shift, shift+len);
                    // console.log("niepoprawny after ",s1);
                    continue;
                }
                let subtemplate = template.slice(shift, shift+len);

                if (!subtemplate.includes(".")) {
                    continue;
                }
                if (/^\.+$/.test(subtemplate)) {
                    //czy styka sie bokiem
                    let neight = false;
                    for(let i=shift; i<shift+len; i++) {
                        if (horizontal) {
                            if (line>0) {
                                if (board.getTiles()[i][line-1].letter != null) {
                                    neight = true;
                                }
                            } else if (line<(15-1)) {
                                if (board.getTiles()[i][line+1].letter != null) {
                                    neight = true;
                                }
                            }
                        } else {
                            if (line>0) {
                                if (board.getTiles()[line-1][i].letter != null) {
                                    neight = true;
                                }
                            } else if (line<(15-1)) {
                                if (board.getTiles()[line+1][i].letter != null) {
                                    neight = true;
                                }
                            }
                        }
                    }
                    if (!neight) {
                        continue;
                    }
                }
                //console.log("sprawdzam",subtemplate);
                const results = this.dict.search(len, subtemplate, letters);
                if (results.length == 0) {
                    continue;
                }

                //weryfikacja dla kazdego slowa
                results.forEach(word => {

                    let ok = true;
                    let subPoints = 0;
                    //console.log("weryfikacja",word);
                    for(let i=0; i<len; i++) {
                        if (horizontal) {
                            let boardLetter = board.getTiles()[i+shift][line].letter;
                            if (boardLetter) {
                                continue;
                            }
                            //console.log("sprawdzam litere",word[i]);
                            let startWord = word[i];
                            for (let j=line+1; j<15; j++) {
                                if (board.getTiles()[i+shift][j].letter == null) {
                                    break;
                                }
                                startWord = startWord+board.getTiles()[i+shift][j].letter;
                            }
                            for (let j=line-1; j>=0; j--) {
                                if (board.getTiles()[i+shift][j].letter == null) {
                                    break;
                                }
                                startWord = board.getTiles()[i+shift][j].letter+startWord;
                            }
                            if (startWord.length == 1) {
                                continue;
                            }
                            if (!this.dict.searchDicionarySimple(startWord)) {
                                ok = false;
                                break;
                            }
                        } else {
                            let boardLetter = board.getTiles()[line][i+shift].letter;
                            if (boardLetter) {
                                continue;
                            }
                            //console.log("sprawdzam litere",word[i]);
                            let startWord = word[i];
                            for (let j=line+1; j<15; j++) {
                                if (board.getTiles()[j][i+shift].letter == null) {
                                    break;
                                }
                                startWord = startWord+board.getTiles()[j][i+shift].letter;
                            }
                            for (let j=line-1; j>=0; j--) {
                                if (board.getTiles()[j][i+shift].letter == null) {
                                    break;
                                }
                                startWord = board.getTiles()[j][i+shift].letter+startWord;
                            }
                            if (startWord.length == 1) {
                                continue;
                            }
                            if (!this.dict.searchDicionarySimple(startWord)) {
                                ok = false;
                                break;
                            }
                        }
                    }
                    if (ok) {
                        // console.log("dodajemy", word, horizontal, line, shift, "len", len);
                        // let n = board.cloneBoard();
                        // let w2 = [];
                        // for (let i=0; i<word.length; i++) {
                        //     w2[i] = {};
                        //     w2[i].letter = word[i];
                        //     w2[i].isBlank = false;
                        //
                        // }
                        // if (horizontal) n.putWord(w2, shift, line, horizontal);
                        // else n.putWord(w2, line, shift, horizontal);
                        //
                        // n.consolePreviewBoard();
                        let singleResult = this.prepareSingleResult(board, [...letters], word, horizontal, line, shift);

                        result.push(singleResult);
                    }
                });

            }
        }
        return result;
    }

    prepareSingleResult(board, letters, word, horizontal, line, shift) {
        //console.log("prepareSingleResult",word,horizontal,line,shift);
        let resultWord = [];
        for (let i=0; i<word.length; i++) {
            resultWord[i] = {};
        }

        let additPoints = 0;
        let basePoints = 0;
        let wordMultiply = 1;
        let letterCount = 0;


        //console.log("WYRAZ ",word);
        [...word].forEach(letter => {
            //console.log("LITERA ",letter);
            letter = letter.toUpperCase();
            let x=0;
            let y=0;
            let dx = 0;
            let dy = 0;
            let letterPoints = 0;
            let letterMultiplier = 1;
            let currentWordMul = 1;
            let countPerpendi = false;
            if (horizontal) {
                x = shift + letterCount;
                y = line;
                dy = 1;
            } else {
                x = line;
                y = shift + letterCount;
                dx = 1;
            }

            let existingLetter = board.getTiles()[x][y];

            //console.log("existingLetter",x,y,existingLetter);
            if (existingLetter.letter == null) {
                countPerpendi = true;
                resultWord[letterCount].letter = letter;
                resultWord[letterCount].isCurrent = true;
                let bonus = board.getBonus(x,y);
                currentWordMul = bonus.w;
                wordMultiply *= currentWordMul;
                letterMultiplier = bonus.l;

                //usuwanie z literek
                //TODO korzystniej blanki
                letterPoints = 0;

                //console.log("letters",letters,"zabieram",letter);
                const index = letters.indexOf(letter);
                if (index !== -1) {
                    letters.splice(index, 1);
                    resultWord[letterCount].isBlank = false;
                    letterPoints = board.getPointsForLetter(letter);
                } else {
                    const index2 = letters.indexOf('*');
                    if (index2 !== -1) {
                        resultWord[letterCount].isBlank = true;
                        letterPoints = 0;
                        letters.splice(index2, 1);
                    } else {
                        throw new Error("cant find letter");
                    }
                }

            } else {
                resultWord[letterCount].isCurrent = false;
                resultWord[letterCount].letter = letter;
                letterMultiplier = 1;
                if (board.getTiles()[x][y].isBlank) {
                    resultWord[letterCount].isBlank = true;
                    letterPoints = 0;
                } else {
                    resultWord[letterCount].isBlank = false;
                    letterPoints = board.getPointsForLetter(letter);
                }
            }

            //console.log("base letter pts",letterPoints);

            if (countPerpendi) {
                //console.log("countPerpendi!");
                let startWord = letter;
                let extraPoints = letterPoints * letterMultiplier;
                for (let j = 1; j < 15; j++) {
                    if ((x + dx * j >= 15) || (y + dy * j >= 15) || board.getTiles()[x + dx * j][y + dy * j].letter == null) {
                        //console.log("break A",(x + dx * j),(y + dy * j),board.getTiles()[x + dx * j][y + dy * j])
                        break;
                    }
                    startWord = startWord + board.getTiles()[x + dx * j][y + dy * j].letter;
                    if (!board.getTiles()[x + dx * j][y + dy * j].isBlank) {
                        extraPoints += board.getPointsForLetter(board.getTiles()[x + dx * j][y + dy * j].letter);
                    }
                }
                for (let j = 1; j < 15; j++) {
                    if ((x - dx * j < 0) || (y - dy * j < 0) || board.getTiles()[x - dx * j][y - dy * j].letter == null) {
                        //console.log("break b")
                        break;
                    }
                    startWord = board.getTiles()[x - dx * j][y - dy * j].letter + startWord;
                    if (!board.getTiles()[x - dx * j][y - dy * j].isBlank) {
                        extraPoints += board.getPointsForLetter(board.getTiles()[x - dx * j][y - dy * j].letter);
                    }
                }
                if (startWord.length == 1) {
                    extraPoints = 0;
                } else {
                    //console.log("prependiWord",startWord);
                }
                //console.log("extraPoints",extraPoints, "wordMultiply",currentWordMul);
                extraPoints *= currentWordMul;
                additPoints += extraPoints;
            }

            basePoints += letterPoints * letterMultiplier;
            //console.log("base letter pts",letterPoints,"letterMultiplier",letterMultiplier,"basePoints",basePoints);
            //console.log("letterPoints",letterPoints,"letterMultiplier",letterMultiplier,"basePoints",basePoints);
            letterCount += 1;
        })
        basePoints *= wordMultiply;
        //console.log("basePoints",basePoints, "additPoints", additPoints);
        basePoints += additPoints;
        //console.log("ALL",basePoints);

        //console.log('single result', word, resultWord, line, shift, horizontal, basePoints);

        //console.log(retObj);
        return {
            wordSimple: word,
            word: resultWord,
            x: horizontal ? shift : line,
            y: horizontal ? line : shift,
            horizontal: horizontal,
            points: basePoints,
        };
    }
}

module.exports = Solver;
