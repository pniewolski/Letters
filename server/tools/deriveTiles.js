/**
 * @file deriveTiles.js
 * @description Wyprowadza zestaw klocków (ilości i punktację) z **rzeczywistej
 * częstości liter w słowniku**. To narzędzie, którym powstały wbudowane tryby
 * gry — zostawione w repozytorium, żeby każdy mógł powtórzyć obliczenia
 * i zbudować własny, uzasadniony rozkład zamiast przepisywać cudzy.
 *
 * Zasada jest prosta: im częstsza litera, tym więcej jej klocków i tym mniej
 * punktów. Dwa parametry sterują charakterem gry:
 * - `alpha` — jak mocno ilości podążają za częstością (1 = wprost proporcjonalnie,
 *   niżej = więcej rzadkich liter w worku),
 * - `beta` — jak stromo rośnie punktacja rzadkich liter.
 *
 * Uruchomienie:
 * ```powershell
 * node server/tools/deriveTiles.js                 # domyślnie 98 liter
 * node server/tools/deriveTiles.js --total 100 --alpha 0.8 --beta 0.8 --min 2
 * node server/tools/deriveTiles.js --json          # sama definicja do wklejenia
 * ```
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/** Ścieżka słownika (ta sama, z której korzysta silnik). */
const DICT_FILE = process.env.DICT_FILE
    ? path.resolve(process.env.DICT_FILE)
    : path.join(__dirname, '..', 'slownik.txt');

/**
 * Czyta argumenty wiersza poleceń w postaci `--klucz wartość`.
 * @returns {object}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = { total: 98, alpha: 0.95, beta: 0.72, min: 1, maxPoints: 12, blanks: 2, json: false };

    for (let i = 0; i < args.length; i++) {
        const key = args[i].replace(/^--/, '');
        if (key === 'json') { out.json = true; continue; }
        if (key in out) out[key] = Number(args[++i]);
    }
    return out;
}

/**
 * Liczy, jak często każda litera występuje w słowniku.
 * @param {number} [minShare=0.005] - Poniżej tego udziału (w %) litera jest pomijana
 *   jako obca (np. X, V, Q w skrótach)
 * @returns {Promise<Object<string, number>>} Litera → udział procentowy
 */
async function letterFrequencies(minShare = 0.005) {
    const rl = readline.createInterface({
        input: fs.createReadStream(DICT_FILE),
        crlfDelay: Infinity,
    });

    const counts = Object.create(null);
    let total = 0;
    let words = 0;

    for await (const line of rl) {
        const word = line.trim().toUpperCase();
        if (!word) continue;
        words++;
        for (const ch of word) {
            counts[ch] = (counts[ch] || 0) + 1;
            total++;
        }
    }

    const freq = {};
    for (const [letter, count] of Object.entries(counts)) {
        const share = (count / total) * 100;
        if (share >= minShare) freq[letter] = share;
    }

    console.log(`Słownik: ${words.toLocaleString('pl-PL')} słów, ${total.toLocaleString('pl-PL')} znaków, `
        + `${Object.keys(freq).length} liter powyżej progu ${minShare}%.`);
    return freq;
}

/**
 * Zamienia częstości na zestaw klocków.
 * @param {Object<string, number>} freq - Litera → udział procentowy
 * @param {object} options - `{ total, alpha, beta, min, maxPoints }`
 * @returns {Array<{letter: string, count: number, points: number, usefulness: number}>}
 */
function deriveTiles(freq, options) {
    const entries = Object.entries(freq);
    const weights = entries.map(([letter, share]) => [letter, Math.pow(share, options.alpha)]);
    const weightSum = weights.reduce((sum, [, w]) => sum + w, 0);

    const tiles = weights.map(([letter, w]) => ({
        letter,
        raw: (options.total * w) / weightSum,
    }));
    tiles.forEach(t => { t.count = Math.max(options.min, Math.round(t.raw)); });

    // Korekta do dokładnie `total` klocków — dokładamy tam, gdzie zaokrąglenie
    // najbardziej skrzywdziło literę (i odejmujemy tam, gdzie jej pomogło).
    const byError = [...tiles].sort((a, b) => (b.raw - b.count) - (a.raw - a.count));
    let diff = options.total - tiles.reduce((sum, t) => sum + t.count, 0);
    let guard = 0;

    while (diff !== 0 && guard++ < 10000) {
        if (diff > 0) {
            byError[guard % byError.length].count++;
            diff--;
        } else {
            const victim = byError[byError.length - 1 - (guard % byError.length)];
            if (victim.count > options.min) { victim.count--; diff++; }
        }
    }

    const maxFreq = Math.max(...Object.values(freq));
    for (const tile of tiles) {
        tile.points = Math.min(
            options.maxPoints,
            Math.max(1, Math.round(Math.pow(maxFreq / freq[tile.letter], options.beta))),
        );
        // Użyteczność dla AI: częste litery są cenne (1), rzadkie to balast (5).
        tile.usefulness = Math.min(5, Math.max(1, Math.ceil(tile.points / 2.5)));
        delete tile.raw;
    }

    tiles.sort((a, b) => a.letter.localeCompare(b.letter, 'pl'));
    return tiles;
}

/**
 * Wypisuje zestaw w czytelnej postaci.
 * @param {Array<object>} tiles
 * @param {object} options
 */
function report(tiles, options) {
    const letters = tiles.reduce((s, t) => s + t.count, 0);
    const points = tiles.reduce((s, t) => s + t.count * t.points, 0);

    const byPoints = {};
    for (const t of tiles) (byPoints[t.points] ||= []).push(t.letter);

    console.log(`\nKlocki: ${letters} liter + ${options.blanks} blanków = ${letters + options.blanks}`);
    console.log(`Suma punktów w worku: ${points} (średnio ${(points / letters).toFixed(2)} na klocek)\n`);

    console.log('Punktacja:');
    for (const p of Object.keys(byPoints).map(Number).sort((a, b) => a - b)) {
        console.log(`  ${String(p).padStart(2)} pkt: ${byPoints[p].join(' ')}`);
    }

    const byCount = {};
    for (const t of tiles) (byCount[t.count] ||= []).push(t.letter);

    console.log('\nIlości:');
    for (const c of Object.keys(byCount).map(Number).sort((a, b) => b - a)) {
        console.log(`  ${String(c).padStart(2)} szt.: ${byCount[c].join(' ')}`);
    }
}

/** Uruchamia narzędzie. */
async function main() {
    const options = parseArgs();
    const freq = await letterFrequencies();
    const tiles = deriveTiles(freq, options);

    if (options.json) {
        console.log(JSON.stringify({ tiles, blank: { count: options.blanks, points: 0 } }, null, 2));
        return;
    }

    report(tiles, options);
    console.log('\nDefinicja do wklejenia w edytorze trybu:');
    console.log(JSON.stringify(tiles.map(t => ({ letter: t.letter, count: t.count, points: t.points, usefulness: t.usefulness }))));
}

main().catch(err => {
    console.error('Błąd:', err.message);
    process.exit(1);
});
