// Benchmark: poprawność (identyczne wyniki) + szybkość, legacy vs packed.
// Uruchamiaj z katalogu server:  node board/dictBench.js
const { spawnSync } = require('child_process');
const path = require('path');

const Legacy = require('./WordDictionary.legacy');
const Packed = require('./WordDictionary');

const LETTERS = 'AĄBCĆDEĘFGHIJKLŁMNŃOÓPRSŚTUWYZŹŻ'.split('');
const RACK_POOL = 'AAAABBCCDDEEEEFGGHIIIJKLLMMNNOOOPRRSSTTUUWWYYZZ*'.split('');

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }

function randomRack() {
    const n = 7;
    const r = [];
    for (let i = 0; i < n; i++) r.push(pick(RACK_POOL));
    return r;
}
function randomTemplate(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
        // ~30% szansy na stałą literę
        s += Math.random() < 0.3 ? pick(LETTERS) : '.';
    }
    return s;
}
function randomWordish(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += pick(LETTERS);
    return s;
}

function sortedJoin(arr) { return [...arr].sort().join('|'); }
function setEq(aSet, bSet) {
    if (aSet.size !== bSet.size) return false;
    for (const x of aSet) if (!bSet.has(x)) return false;
    return true;
}

async function main() {
    console.log('Ładowanie obu słowników...');
    const legacy = new Legacy();
    const packed = new Packed();
    await Promise.all([legacy.ready, packed.ready]);
    console.log('Załadowano.\n');

    // seed deterministyczny
    let seed = 12345;
    Math.random = (function () {
        let s = seed;
        return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    })();

    // ---------- POPRAWNOŚĆ ----------
    console.log('== Test poprawności (wyniki muszą być identyczne) ==');
    let mismatches = 0;
    const N_CORRECT = 3000;

    for (let i = 0; i < N_CORRECT; i++) {
        const len = 2 + rand(9);          // 2..10
        const template = randomTemplate(len);
        const rack = randomRack();

        const a = legacy.search(len, template, rack);
        const b = packed.search(len, template, rack);
        if (sortedJoin(a) !== sortedJoin(b)) {
            mismatches++;
            if (mismatches <= 5) {
                console.log(`  [search] różnica len=${len} tpl=${template} rack=${rack.join('')}`);
                console.log(`     legacy(${a.length}) packed(${b.length})`);
            }
        }
    }

    for (let i = 0; i < N_CORRECT; i++) {
        const len = 2 + rand(9);
        const w = randomWordish(len);
        if (legacy.searchDicionarySimple(w) !== packed.searchDicionarySimple(w)) {
            mismatches++;
            if (mismatches <= 5) console.log(`  [simple] różnica: ${w}`);
        }
    }

    for (let i = 0; i < N_CORRECT; i++) {
        const pl = rand(4), sl = rand(4);
        const prefix = randomWordish(pl);
        const suffix = randomWordish(sl);
        const a = legacy.crossCheckLetters(prefix, suffix);
        const b = packed.crossCheckLetters(prefix, suffix);
        if (!setEq(a, b)) {
            mismatches++;
            if (mismatches <= 5) console.log(`  [cross] różnica pre=${prefix} suf=${suffix}`);
        }
    }

    console.log(mismatches === 0
        ? `  OK — ${N_CORRECT * 3} zapytań, 0 różnic.\n`
        : `  BŁĄD — ${mismatches} różnic!\n`);

    // ---------- SZYBKOŚĆ ----------
    console.log('== Test szybkości ==');

    // przygotuj wspólne zestawy zapytań
    const searchQ = [];
    for (let i = 0; i < 20000; i++) {
        const len = 2 + rand(9);
        searchQ.push([len, randomTemplate(len), randomRack()]);
    }
    const simpleQ = [];
    for (let i = 0; i < 200000; i++) {
        const len = 2 + rand(9);
        simpleQ.push(randomWordish(len));
    }
    const crossQ = [];
    for (let i = 0; i < 50000; i++) {
        crossQ.push([randomWordish(rand(4)), randomWordish(rand(4))]);
    }

    function timeIt(label, fn) {
        // rozgrzewka
        fn();
        const t0 = process.hrtime.bigint();
        fn();
        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        console.log(`  ${label}: ${ms.toFixed(1)} ms`);
        return ms;
    }

    console.log(' search (20k zapytań z szablonem):');
    const sL = timeIt('   legacy', () => { for (const [l, t, r] of searchQ) legacy.search(l, t, r); });
    const sP = timeIt('   packed', () => { for (const [l, t, r] of searchQ) packed.search(l, t, r); });

    console.log(' searchDicionarySimple (200k zapytań):');
    const dL = timeIt('   legacy', () => { for (const w of simpleQ) legacy.searchDicionarySimple(w); });
    const dP = timeIt('   packed', () => { for (const w of simpleQ) packed.searchDicionarySimple(w); });

    console.log(' crossCheckLetters (50k zapytań):');
    const cL = timeIt('   legacy', () => { for (const [p, s] of crossQ) legacy.crossCheckLetters(p, s); });
    const cP = timeIt('   packed', () => { for (const [p, s] of crossQ) packed.crossCheckLetters(p, s); });

    const ratio = (a, b) => (b / a).toFixed(2) + 'x';
    console.log('\n  Podsumowanie (packed / legacy, <1 = szybciej):');
    console.log(`   search:  ${ratio(sL, sP)}`);
    console.log(`   simple:  ${ratio(dL, dP)}`);
    console.log(`   cross:   ${ratio(cL, cP)}`);

    // ---------- PAMIĘĆ (osobne procesy) ----------
    console.log('\n== Pomiar pamięci (osobne procesy, --expose-gc) ==');
    const script = path.join(__dirname, 'dictMem.js');
    for (const which of ['legacy', 'packed']) {
        const res = spawnSync(process.execPath, ['--expose-gc', script, which], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        const line = (res.stdout || '').split('\n').find(l => l.startsWith('RESULT '));
        if (line) {
            const info = JSON.parse(line.slice(7));
            console.log(`  ${which.padEnd(7)} rss=${info.rssMB}MB  heapUsed=${info.heapUsedMB}MB  arrayBuffers=${info.arrayBuffersMB}MB  load=${info.loadMs}ms`);
        } else {
            console.log(`  ${which}: brak wyniku`);
            if (res.stderr) console.log(res.stderr);
        }
    }
}

main();

