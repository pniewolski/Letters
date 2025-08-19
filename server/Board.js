const fs = require('fs');

class Board {
    constructor() {
        this.tiles = [];
        for (let i = 0; i < 15; i++) {
            this.tiles[i] = [];
            for (let j = 0; j < 15; j++) {
                this.tiles[i][j] = {
                    letter: null,
                    isBlank: false,
                    isCurrent: false,
                };
            }
        }
        this.getBoardMultiply();
        this.loadPoints();
    }

    loadPoints() {
        const pointsJson = fs.readFileSync('points.json', 'utf-8');
        this.points = JSON.parse(pointsJson).points;
    }


    getPointsForLetter(litera) {
        const literaUpper = litera.toUpperCase();

        for (const [punktyZaLitere, litery] of Object.entries(this.points)) {
            //console.log("punktyZaLitere",punktyZaLitere,"litery",litery);
            // Sprawdź, czy `litery` faktycznie jest tablicą
            if (Array.isArray(litery) && litery.includes(literaUpper)) {
                return parseInt(punktyZaLitere);
            }
        }
        return 0; // nieznana litera lub znak specjalny
    }



    getBoardMultiply() {
        const multiJson = fs.readFileSync('layout.json', 'utf-8');
        this.multiplies = JSON.parse(multiJson);
    }

    getBonus(x,y) {
        return this.multiplies[x][y];
    }

    getTiles() {
        return this.tiles;
    }

    setTiles(tiles) {
        this.tiles = tiles;
    }

    consolePreviewBoard() {
        let result = "Stan planszy:\n";
        for (let j = 0; j < 15; j++) {
            for (let i = 0; i < 15; i++) {
                if (this.tiles[i][j].letter === null) {
                    result += "_";
                } else {
                    result += this.tiles[i][j].letter;
                }
            }
            result += "\n";
        }
        console.log(result);
    }

    
    cloneBoard() {
        let result = new Board();
        let tilesCopy = [];
        for (let i = 0; i < 15; i++) {
            tilesCopy[i] = [];
            for (let j = 0; j < 15; j++) {
                tilesCopy[i][j] = {...this.tiles[i][j]};
            }
        }
        result.setTiles(tilesCopy);
        return result;
    }

    putWord(word, x, y, horizontal) {
        for (let i = 0; i < word.length; i++) {
            let currX = x + (horizontal ? i : 0);
            let currY = y + (!horizontal ? i : 0);
            if (this.tiles[currX][currY].letter == null) {
                this.tiles[currX][currY].letter = word[i].letter;
                this.tiles[currX][currY].isCurrent = word[i].isCurrent;
                this.tiles[currX][currY].isBlank = word[i].isBlank;
            }

        }
    }

    resetCurrents() {
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                this.tiles[i][j].isCurrent = false;
            }
        }
    }

    eraseCurrents() {
        for (let i = 0; i < 15; i++) {
            for (let j = 0; j < 15; j++) {
                if (this.tiles[i][j].isCurrent) {
                    this.tiles[i][j].isCurrent = false;
                    this.tiles[i][j].letter = null;
                    this.tiles[i][j].isBlank = false;
                }

            }
        }
    }

    getBoardState() {
        return this.tiles;
    }

}

module.exports = Board;
