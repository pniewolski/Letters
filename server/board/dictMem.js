// Pomiar pamięci po załadowaniu słownika w izolowanym procesie.
// Uruchamiaj: node --expose-gc board/dictMem.js legacy|packed   (z katalogu server)
const which = process.argv[2] === 'legacy' ? 'legacy' : 'packed';
const WordDictionary = which === 'legacy'
    ? require('./WordDictionary.legacy')
    : require('./WordDictionary');

(async () => {
    const t0 = Date.now();
    const dict = new WordDictionary();
    await dict.ready;
    const loadMs = Date.now() - t0;

    if (global.gc) { global.gc(); global.gc(); }

    const m = process.memoryUsage();
    const MB = (b) => (b / 1048576).toFixed(1);
    // linia wynikowa w formacie JSON dla łatwego parsowania
    console.log('RESULT ' + JSON.stringify({
        which,
        loadMs,
        rssMB: +MB(m.rss),
        heapUsedMB: +MB(m.heapUsed),
        externalMB: +MB(m.external),
        arrayBuffersMB: +MB(m.arrayBuffers || 0),
    }));
})();

