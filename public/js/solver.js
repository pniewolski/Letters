/**
 * @file solver.js
 * @description Frontend formularza „Rozwiąż grę ze zdjęcia”.
 * Wczytuje zdjęcie, skaluje je po stronie przeglądarki do maks. 800 px
 * (mniejszy transfer), wysyła jako base64 do POST /api/solve i wyświetla ruchy.
 */

(function () {
    const dropZone = document.getElementById('drop');
    const fileInput = document.getElementById('file');
    const preview = document.getElementById('preview');
    const btnSolve = document.getElementById('btn-solve');
    const btnReset = document.getElementById('btn-reset');
    const statusEl = document.getElementById('status');
    const resultCard = document.getElementById('result-card');
    const movesEl = document.getElementById('moves');
    const rackEl = document.getElementById('rack');
    const miniBoardEl = document.getElementById('solver-board');
    const warnEl = document.getElementById('warn');

    const MAX_DIM = 1200;
    let selectedDataUrl = null;

    /** Zamienia współrzędne 0-based (x=kolumna, y=wiersz) na etykietę A5. */
    function coordLabel(x, y) {
        return `${String.fromCharCode(65 + x)}${y + 1}`;
    }

    /** Ustawia komunikat statusu. */
    function setStatus(msg, isError) {
        statusEl.textContent = msg || '';
        statusEl.style.color = isError ? '#ff8a8a' : '#b9cabf';
    }

    /**
     * Skaluje obraz do maks. 800 px (dłuższy bok) i zwraca data URL JPEG.
     * @param {File} file
     * @returns {Promise<string>}
     */
    function resizeToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                let { width, height } = img;
                if (Math.max(width, height) > MAX_DIM) {
                    if (width >= height) {
                        height = Math.round(height * (MAX_DIM / width));
                        width = MAX_DIM;
                    } else {
                        width = Math.round(width * (MAX_DIM / height));
                        height = MAX_DIM;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się wczytać obrazu.')); };
            img.src = url;
        });
    }

    /** Obsługa wybranego pliku. */
    async function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            setStatus('Wybierz plik graficzny (JPG/PNG).', true);
            return;
        }
        setStatus('Przygotowywanie obrazu...');
        try {
            selectedDataUrl = await resizeToDataUrl(file);
            preview.src = selectedDataUrl;
            preview.style.display = 'block';
            btnSolve.disabled = false;
            setStatus('Gotowe do rozwiązania.');
        } catch (e) {
            setStatus(e.message, true);
        }
    }

    // ── zdarzenia drag & drop / kliknięcie ──
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

    ['dragenter', 'dragover'].forEach(ev =>
        dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); })
    );
    ['dragleave', 'drop'].forEach(ev =>
        dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); })
    );
    dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // ── reset ──
    btnReset.addEventListener('click', () => {
        selectedDataUrl = null;
        fileInput.value = '';
        preview.src = '';
        preview.style.display = 'none';
        btnSolve.disabled = true;
        resultCard.style.display = 'none';
        setStatus('');
    });

    // ── wysyłka ──
    btnSolve.addEventListener('click', async () => {
        if (!selectedDataUrl) return;
        btnSolve.disabled = true;
        console.log('[solver] Wysyłanie zdjęcia do serwera AI...');
        setStatus('Rozpoznawanie planszy i liczenie ruchów... (to może potrwać kilka sekund)');
        const t0 = performance.now();
        try {
            const resp = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: selectedDataUrl }),
            });
            console.log(`[solver] Serwer odpowiedział: HTTP ${resp.status} (${Math.round(performance.now() - t0)} ms)`);
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.error || `Błąd serwera (${resp.status}).`);
            }
            console.log('[solver] Rozpoznany stojak:', data.rack, '| ruchów:', (data.moves || []).length);
            renderResult(data);
            if (data.rackEmpty) {
                setStatus('Nie wykryto liter na stojaku — zobacz komunikat poniżej.', true);
            } else {
                setStatus(`Znaleziono ${data.moves.length} ruchów.`);
            }
        } catch (e) {
            console.error('[solver] Błąd:', e);
            setStatus(e.message, true);
        } finally {
            btnSolve.disabled = false;
        }
    });

    /** Renderuje graficzną miniplanszę 15×15. */
    function renderMiniBoard(rows) {
        miniBoardEl.innerHTML = '';
        const size = 15;
        const center = 7;
        for (let y = 0; y < size; y++) {
            const row = (rows && rows[y]) || '';
            for (let x = 0; x < size; x++) {
                const ch = row[x] || '.';
                const cell = document.createElement('div');
                cell.className = 'solver-cell';
                if (x === center && y === center) cell.classList.add('center');
                if (ch !== '.' && ch !== ' ') {
                    // mała litera = blank
                    const isBlank = ch === ch.toLowerCase() && ch !== ch.toUpperCase();
                    cell.classList.add(isBlank ? 'blank' : 'filled');
                    cell.textContent = ch.toUpperCase();
                } else if (x === center && y === center) {
                    cell.textContent = '★';
                }
                miniBoardEl.appendChild(cell);
            }
        }
    }

    /** Renderuje kafelki stojaka. */
    function renderRack(rack) {
        rackEl.innerHTML = '';
        if (!rack || !rack.length) {
            const span = document.createElement('span');
            span.className = 'rack-empty';
            span.textContent = '(brak liter)';
            rackEl.appendChild(span);
            return;
        }
        for (const letter of rack) {
            const tile = document.createElement('div');
            tile.className = 'rack-tile';
            if (letter === '*' || letter === '?') {
                tile.classList.add('blank');
                tile.textContent = '?';
            } else {
                tile.textContent = letter;
            }
            rackEl.appendChild(tile);
        }
    }

    /** Renderuje wynik. */
    function renderResult(data) {
        // ostrzeżenie (np. zdjęcie samej planszy)
        if (data.warning) {
            warnEl.textContent = '⚠️ ' + data.warning;
            warnEl.style.display = 'block';
        } else {
            warnEl.style.display = 'none';
        }

        // rozpoznany stan — nad listą ruchów
        renderMiniBoard(data.board || []);
        renderRack(data.rack || []);

        // lista ruchów
        movesEl.innerHTML = '';
        if (!data.moves || !data.moves.length) {
            movesEl.innerHTML = '<li>Nie znaleziono żadnego ruchu.</li>';
        }
        for (const m of (data.moves || [])) {
            const li = document.createElement('li');
            li.innerHTML =
                `<span><span class="move-word">${m.word}</span> ` +
                `<span class="move-info">— ${m.orientation}, pole ${coordLabel(m.fromLeft - 1, m.fromTop - 1)}` +
                `${m.blanks ? `, blanki: ${m.blanks}` : ''}</span></span>` +
                `<span class="move-points">${m.points} pkt</span>`;
            movesEl.appendChild(li);
        }


        resultCard.style.display = 'block';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ZAKŁADKI: RĘCZNIE / ZE ZDJĘCIA
    // ─────────────────────────────────────────────────────────────────────────
    const tabButtons = document.querySelectorAll('.tab-btn');
    const panes = {
        manual: document.getElementById('pane-manual'),
        photo: document.getElementById('pane-photo'),
    };
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            Object.values(panes).forEach(p => p.classList.remove('active'));
            panes[btn.dataset.tab].classList.add('active');
            setStatus('');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // RĘCZNA PLANSZA 15×15
    // ─────────────────────────────────────────────────────────────────────────
    const manualBoardEl = document.getElementById('manual-board');
    const manualRackEl = document.getElementById('manual-rack');
    const btnSolveManual = document.getElementById('btn-solve-manual');
    const btnClearManual = document.getElementById('btn-clear-manual');
    const SIZE = 15;

    /** Buduje siatkę inputów z nagłówkami kolumn (A–O) i wierszy (1–15). */
    function buildManualBoard() {
        manualBoardEl.innerHTML = '';

        // pierwszy wiersz: pusty róg + litery kolumn
        const corner = document.createElement('div');
        corner.className = 'mb-corner';
        manualBoardEl.appendChild(corner);
        for (let x = 0; x < SIZE; x++) {
            const h = document.createElement('div');
            h.className = 'mb-col-head';
            h.textContent = String.fromCharCode(65 + x);
            manualBoardEl.appendChild(h);
        }

        // wiersze planszy: numer + 15 inputów
        for (let y = 0; y < SIZE; y++) {
            const rowHead = document.createElement('div');
            rowHead.className = 'mb-row-head';
            rowHead.textContent = String(y + 1);
            manualBoardEl.appendChild(rowHead);

            for (let x = 0; x < SIZE; x++) {
                const input = document.createElement('input');
                input.className = 'mb-cell';
                input.maxLength = 1;
                input.dataset.x = x;
                input.dataset.y = y;
                if (x === 7 && y === 7) input.classList.add('mb-center');
                input.addEventListener('input', onManualCellInput);
                input.addEventListener('keydown', onManualCellKey);
                manualBoardEl.appendChild(input);
            }
        }
    }

    /** Zwraca input pola (x,y) lub null. */
    function manualCell(x, y) {
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
        return manualBoardEl.querySelector(`input[data-x="${x}"][data-y="${y}"]`);
    }

    /** Po wpisaniu litery przeskocz do pola po prawej. */
    function onManualCellInput(e) {
        const inp = e.target;
        inp.value = inp.value.toUpperCase().slice(0, 1);
        if (inp.value) {
            const x = Number(inp.dataset.x), y = Number(inp.dataset.y);
            const next = manualCell(x + 1, y);
            if (next) next.focus();
        }
    }

    /** Nawigacja strzałkami i backspace po siatce. */
    function onManualCellKey(e) {
        const inp = e.target;
        const x = Number(inp.dataset.x), y = Number(inp.dataset.y);
        let target = null;
        if (e.key === 'ArrowRight') target = manualCell(x + 1, y);
        else if (e.key === 'ArrowLeft') target = manualCell(x - 1, y);
        else if (e.key === 'ArrowDown') target = manualCell(x, y + 1);
        else if (e.key === 'ArrowUp') target = manualCell(x, y - 1);
        else if (e.key === 'Backspace' && !inp.value) target = manualCell(x - 1, y);
        if (target) { e.preventDefault(); target.focus(); }
    }

    /** Zbiera stan ręcznej planszy jako 15 łańcuchów po 15 znaków ('.' = puste). */
    function collectManualBoard() {
        const rows = [];
        for (let y = 0; y < SIZE; y++) {
            let row = '';
            for (let x = 0; x < SIZE; x++) {
                const inp = manualCell(x, y);
                const ch = (inp && inp.value.trim().toUpperCase()) || '';
                row += ch || '.';
            }
            rows.push(row);
        }
        return rows;
    }

    /** Wysyła ręczny stan do serwera. */
    async function solveManual() {
        const board = collectManualBoard();
        const rack = (manualRackEl.value || '').trim().toUpperCase();

        if (!rack) {
            setStatus('Wpisz swoje litery (stojak), aby policzyć ruchy.', true);
            manualRackEl.focus();
            return;
        }

        btnSolveManual.disabled = true;
        setStatus('Liczenie najlepszych ruchów...');
        try {
            const resp = await fetch('/api/solve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manual: true, board, rack }),
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                throw new Error(data.error || `Błąd serwera (${resp.status}).`);
            }
            renderResult(data);
            if (data.rackEmpty) {
                setStatus('Nie rozpoznano liter stojaka — sprawdź wpisane litery.', true);
            } else {
                setStatus(`Znaleziono ${data.moves.length} ruchów.`);
            }
        } catch (e) {
            setStatus(e.message, true);
        } finally {
            btnSolveManual.disabled = false;
        }
    }

    if (btnSolveManual) btnSolveManual.addEventListener('click', solveManual);
    if (btnClearManual) btnClearManual.addEventListener('click', () => {
        manualBoardEl.querySelectorAll('input.mb-cell').forEach(i => (i.value = ''));
        setStatus('');
    });

    buildManualBoard();
})();

