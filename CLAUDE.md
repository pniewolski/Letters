# CLAUDE.md — Literkowa Gra (Scrabble)

Serwer gry w Scrabble po polsku: Node.js + Express + WebSocket na backendzie,
waniliowy JS (ES modules) na froncie. Bez frameworków, bez buildu, bez testów
automatycznych. Kod i komentarze są **po polsku** — trzymaj się tego.

## Uruchamianie

```powershell
npm start          # node server/server.js  (http://localhost:8080)
npm run dev        # to samo z --watch
```

Nie ma testów jednostkowych ani lintera. Weryfikacja odbywa się ręcznie przez
skrypty w `server/` (patrz „Skrypty pomocnicze”) albo przez uruchomienie serwera.

Docker: `Dockerfile` (node:20-slim, port 8080). Express i WebSocket dzielą jeden port.

## Architektura

```
server/
  server.js          punkt wejścia: Express (statyki z /public) + WebSocketServer + /api/*
  config.json        tytuł, alfabet, flagi, kolory planszy
  layout.json        mnożniki pól 15x15
  letters.json       ŹRÓDŁO PRAWDY: punkty, ilości i „użyteczność” liter
  slownik.txt        ~3,2 mln słów, po jednym w wierszu, małe litery
  board/
    Board.js         plansza 15x15, mnożniki, getPointsForLetter()
    DrawstringBag.js worek liter (ilości z letters.json)
    WordDictionary.js słownik na Trie w układzie CSR (tablice typowane, oszczędny RAM)
    Solver.js        generowanie i punktowanie ruchów
    BestMoveFinder.js wygodna fasada nad Board+Solver (buduj stan → getSolution())
  game/
    GameManager.js   SINGLETON — jeden słownik dla wszystkich gier, mapa userId→gra
    Game.js          pojedyncza rozgrywka, tury, ruch komputera
    Table.js         stan stołu: punkty, stojaki, worek
    Strategy.js      decyzja AI: położyć słowo czy wymienić litery (próg ~25 pkt)
  ai/
    imageSolver.js   rozpoznanie planszy ze zdjęcia przez LLM (OpenAI | Gemini)
public/
  index.html, style.css
  js/                moduły ES: main.js (routing WS), net.js, state.js, board.js,
                     rack.js, game.js, config.js, hints.js, livePreview.js, chat.js,
                     blank.js, clock.js, dom.js, solver.js
  solver.html        osobna strona „rozwiąż ze zdjęcia”
```

### Dwie ważne pułapki

1. **`process.chdir(__dirname)` w `server.js`.** Klasy `Board`, `DrawstringBag`
   i `Strategy` czytają `letters.json` / `layout.json` **ścieżką względną**.
   Każdy skrypt uruchamiany poza `server.js` musi startować z katalogu `server/`
   albo sam zrobić `chdir`, inaczej poleci `ENOENT`.
2. **Słownik ładuje się raz.** `GameManager` jest singletonem i trzyma jedną
   instancję `WordDictionary` (`await dict.ready`). Nie twórz nowego słownika
   na żądanie — budowa Trie z 3,2 mln słów jest kosztowna.

## Konfiguracja liter — jedno źródło prawdy

`server/letters.json` to **jedyne** miejsce z punktacją, ilościami i użytecznością liter.
Front **nie duplikuje** tych danych: `server.js` spłaszcza sekcję `points`
(`{ "1": ["A",...] }` → `{ A: 1, ... }`, plus `'*': 0`) i wystawia ją razem z
`config.json` i `layout.json` pod `GET /api/config`; `public/js/config.js` pobiera
to przez `loadConfig()` i udostępnia `pointsOf(letter)`.

Zmieniając punktację edytuj **tylko** `letters.json`. Nie wpisuj wartości na sztywno
w kodzie ani we froncie. Oficjalna polska dystrybucja (100 płytek, suma 190 pkt):

| pkt | litery |
|-----|--------|
| 1 | A E I N O R S W Z |
| 2 | C D K L M P T Y |
| 3 | B G H J Ł U |
| 5 | Ą Ę F Ó Ś Ż |
| 6 | Ć |
| 7 | Ń |
| 9 | Ź |
| 0 | `*` (blank, 2 szt.) |

Sekcja `usefulness` to **osobna heurystyka AI** (wyższa = mniej przydatna, chętniej
wymieniana przez `Strategy`) — nie ma nic wspólnego z punktacją i nie należy jej
synchronizować z `points`.

Po zmianie `letters.json` sprawdź spójność:

```powershell
node -e "const d=require('./server/letters.json');const q={};for(const[k,v]of Object.entries(d.quantities))v.forEach(l=>q[l]=+k);console.log('plytek:',Object.values(q).reduce((a,b)=>a+b,0))"
```

## Protokół WebSocket

Klient → serwer: `{ type: "akcja", ...dane }`
Serwer → klient: `{ type: "akcja:response", success, ... }` albo push `{ type: "zdarzenie", ... }`

Akcje: `createGame` (`mode: computer|human|compcomp`), `hostGame`, `listLobby`,
`joinGame`, `leaveGame`, `makeMove`, `replaceLetters`, `pass`, `getState`, `hint`,
`chat`, `livePreview`.

Pushe: `connected`, `lobby`, `gameState`, `opponentJoined`, `opponentMoved`,
`opponentPassed`, `opponentReplaced`, `opponentLeft`, `opponentDisconnected`,
`computerMoved`, `compMove`, `gameOver`, `chatMessage`, `livePreview`, `error`.

Dodając akcję: handler w `server.js` (zwraca obiekt odpowiedzi), metoda w
`GameManager.js`, `case` w `handleMessage()` w `public/js/main.js`.

REST: `GET /api/config`, `POST /api/solve` (zdjęcie planszy).

## Solver ze zdjęcia (AI)

Szczegóły w `SOLVER.md`. Klucze w `server/ai.config.json` (w `.gitignore`;
wzorzec: `ai.config.example.json`) lub przez `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL`.
Dostawca wykrywany z nazwy modelu (`gemini*` → Gemini, natywne API z nagłówkiem
`X-goog-api-key`, **nie** `Bearer`). Nigdy nie commituj kluczy.

## Skrypty pomocnicze (uruchamiaj z katalogu `server/`)

| plik | do czego |
|------|----------|
| `main.js` | piaskownica solvera na jednej planszy |
| `compVsCompTest.js` | pełna partia komputer vs komputer |
| `humanVsCompTest.js` | partia w konsoli (readline) |
| `board/dictBench.js` | benchmark poprawności/szybkości słownika |
| `board/dictMem.js` | zużycie pamięci przez słownik |
| `board/cheaterTest.js`, `game/testGameManager.js`, `ai/testImageSolver.js` | testy ręczne |

## Konwencje

- Komentarze, nazwy w UI i komunikaty błędów **po polsku**; JSDoc nad klasami i
  metodami publicznymi (z `@example` tam, gdzie to pomaga) — kontynuuj ten styl.
- Front: moduły ES z `import`/`export`, bez bundlera. `net.js` nie zna logiki gry —
  handler wiadomości wstrzykuje `main.js` przez `setMessageHandler()`, żeby nie
  powstawały zależności cykliczne. Zachowaj ten podział.
- Wszystkie litery wewnętrznie **wielkimi literami**; słownik `slownik.txt` jest
  małymi — porównania wymagają normalizacji.
- Blank: `isBlank: true` + wybrana litera, zawsze 0 pkt (patrz `blank.js`).
- Sekcje w większych plikach oddzielane komentarzem `// ─────` — trzymaj konwencję.
