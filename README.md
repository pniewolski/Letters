# Literki

Portal do gier słownych: konta i sesje gości, stoły w lobby, gra przez sieć
albo z komputerem, ranking, skalpy i — co najważniejsze — **całkowicie
konfigurowalne tryby gry**.

Backend: Node.js + Express + WebSocket. Frontend: waniliowy JavaScript
(moduły ES), bez frameworka i bez builda. Baza: SQLite w pliku (wbudowany
moduł `node:sqlite`), z gotowym sterownikiem MySQL na później.

---

## Szybki start

```powershell
npm install
npm start          # http://localhost:8080
npm run dev        # to samo z automatycznym restartem
```

Przy pierwszym uruchomieniu serwer sam zakłada bazę (`server/data/literki.db`)
i dodaje wbudowane tryby gry. Nie trzeba niczego konfigurować.

Wymagany Node **22.5+** (moduł `node:sqlite`); zalecany 24+.

---

## Tryby gry — serce portalu

Tryb gry to komplet zasad zapisany jako **dane**, nie jako kod:

| co obejmuje | przykład |
|-------------|----------|
| rozmiar planszy | od 7×7 do 21×21 |
| rozmieszczenie premii | dowolne, z podglądem i symetrią |
| zestaw liter | które litery, ile sztuk, ile punktów warte |
| blanki | ile ich jest i ile są warte |
| stojak | ile liter, premia za wyłożenie całego |
| reguły | wymiana, koniec partii, rozliczenie liter, sprawdzanie w słowniku |
| kolory pól | pełna paleta |

Każdy zalogowany gracz może zbudować własny tryb od zera w edytorze
(`#/tryby/nowy`), opublikować go albo zostawić dla siebie, a potem zakładać
na nim stoły. Trybów wbudowanych nie da się nadpisać — trzeba je skopiować
do siebie, więc nikt nikomu nie zepsuje ustawień.

### Wbudowane tryby

**Literki** (domyślny) — plansza z premiami na koncentrycznych pierścieniach.
Mało mnożników słowa (4 potrójne w rogach, 8 podwójnych), za to dużo mnożników
litery, łącznie z poczwórnymi. 100 liter + 4 blanki. Gra bardziej pozycyjna,
mniej zależna od jednego szczęśliwego trafienia w róg.

**SCR** — tryb klasyczny: standardowy układ premii 15×15 (8 pól potrójnej
wartości słowa, 16 podwójnej, 12 potrójnej litery, 24 podwójnej), 100 klocków
o łącznej wartości 190 punktów i premia 50 punktów za wyłożenie całego stojaka.
Ma grać dokładnie tak, jak przywykli gracze.

Zestaw klocków dla trybu **Literki** wyprowadzono z **rzeczywistej częstości
liter w słowniku** (`server/slownik.txt`) narzędziem `npm run tiles:derive` —
im częstsza litera, tym więcej jej klocków i tym mniej punktów. Możesz powtórzyć
te obliczenia z własnymi parametrami i zbudować swój rozkład:

```powershell
node server/tools/deriveTiles.js --total 100 --alpha 0.8 --beta 0.8 --min 2
```

---

## Architektura

```
server/
  server.js              start: baza, słownik, Express, WebSocket
  config.json            tytuł i flagi portalu (żadnych reguł gry)
  slownik.txt            ~3,2 mln słów, po jednym w wierszu

  db/                    warstwa bazy niezależna od silnika
    index.js             createDatabase() — wybór sterownika
    Database.js          CRUD, UPSERT, migracje
    types.js             tłumaczenie typów SQL na dialekt
    migrations.js        schemat (jedna definicja dla SQLite i MySQL)
    drivers/             SqliteDriver.js, MysqlDriver.js

  variant/               tryby gry
    schema.js            walidacja i normalizacja definicji
    compile.js           kompilacja do struktur silnika (z cache)
    presets.js           wbudowane tryby: Literki, SCR

  board/                 silnik
    Board.js             plansza (rozmiar i premie z trybu gry)
    DrawstringBag.js     worek (zawartość z trybu gry)
    WordDictionary.js    słownik na Trie w układzie CSR (oszczędny RAM)
    Solver.js            generowanie i punktowanie ruchów
    BestMoveFinder.js    fasada nad Board + Solver

  game/                  rozgrywka
    Game.js              tury, ruchy, koniec partii, rozliczenie
    Table.js             stan stołu: plansza, worek, stojaki, punkty
    Strategy.js          decyzje komputera (3 poziomy trudności)

  lobby/
    GameTable.js         stół: miejsca, zegar, widoki stanu
    TableManager.js      rejestr stołów, ruchy komputera, zapis wyników

  repo/                  dostęp do danych
    UserRepo, SessionRepo, VariantRepo, StatsRepo, GameRepo, FriendRepo

  auth/                  konta
    password.js          hashowanie scrypt (bez zależności)
    AuthService.js       rejestracja, logowanie, goście

  ws/                    warstwa sieciowa
    Hub.js               połączenia, rozsyłanie stanu
    handlers.js          akcje klienta

  app/routes.js          REST API
  ai/imageSolver.js      rozpoznanie planszy ze zdjęcia (OpenAI / Gemini)
  tools/                 skrypty pomocnicze (patrz niżej)

public/
  index.html, style.css
  js/
    main.js              start, nagłówek, routing wiadomości
    router.js            router na kotwicy adresu
    store.js             wspólny stan + powiadomienia
    api.js, net.js       REST i WebSocket
    ui.js                budowanie DOM, modale, komunikaty
    game/                plansza, stojak, blank, podgląd, miniaturka
    screens/             ekrany portalu
  solver.html            osobna strona „rozwiąż ze zdjęcia"
```

### Zasady, których warto się trzymać

1. **Nic o regułach gry nie należy do kodu.** Rozmiar planszy, punktacja,
   ilości liter i premie pochodzą z `CompiledVariant`. Jeśli piszesz `15`
   albo `50` w silniku — coś poszło nie tak.
2. **Słownik ładuje się raz** na proces. Budowa Trie z 3,2 mln słów jest
   kosztowna; instancja jest współdzielona przez wszystkie stoły.
3. **Front nie duplikuje danych serwera.** Punktacja, alfabet, kolory
   i układ planszy przychodzą razem ze stanem partii.
4. **Litery wewnętrznie wielkimi.** Słownik jest małymi — porównania
   wymagają normalizacji.
5. **`TableManager` nie zna WebSocketów** — emituje zdarzenia, które
   `Hub` zamienia na komunikaty.

---

## Baza danych

Domyślnie SQLite w pliku — bez instalacji, bez kompilacji, bez osobnego
serwera. Ścieżkę wskazuje `DATA_DIR` (domyślnie `server/data`) albo `DB_FILE`.

Przejście na MySQL nie wymaga zmian w kodzie:

```powershell
npm install mysql2
$env:DB_DRIVER = "mysql"
$env:DB_URL = "mysql://user:haslo@host:3306/literki"
npm start
```

Schemat jest zapisany raz (`server/db/migrations.js`) ze znacznikami typów
(`{{PK}}`, `{{STR:64}}`, `{{TEXT}}`…), które `server/db/types.js` tłumaczy na
właściwy dialekt. Migracje wykonują się przy starcie i zapisują w tabeli
`schema_migrations`.

### Tabele

| tabela | zawartość |
|--------|-----------|
| `users` | konta i goście (`is_guest`), ranking Elo |
| `sessions` | tokeny sesji (konta 30 dni, goście 1 dzień) |
| `variants` | tryby gry — definicja w JSON-ie (systemowe nadpisywane z kodu przy starcie) |
| `game_tables` | stoły (ślad historyczny; stan na żywo jest w pamięci) |
| `games`, `game_participants` | rozegrane partie i wyniki |
| `user_stats` | statystyki zbiorcze gracza |
| `scalps` | bilans z każdym przeciwnikiem osobno |
| `friends` | znajomi i zaproszenia |

---

## Połączenie i telefony

WebSocket na telefonie bywa zdradliwy: po zminimalizowaniu przeglądarki system
zrywa gniazdo po cichu, a strona po powrocie widzi `readyState === OPEN` i nigdy
nie dostaje zdarzenia `close`. Połączenie wygląda na sprawne i nie wraca.

Dlatego `public/js/net.js` nie ufa samemu `readyState`:

- mierzy czas od ostatniej wiadomości serwera — po 15 s ciszy pyta `ping`,
  po 35 s uznaje gniazdo za martwe i zestawia nowe,
- powrót do karty (`visibilitychange`, `pageshow`, `focus`) i zmiana sieci
  (`online`) natychmiast weryfikują łącze i zerują odczekiwanie,
- stare gniazdo jest odpinane przed zestawieniem nowego, żeby jego spóźniony
  `close` nie wywołał wyścigu dwóch połączeń.

Po stronie serwera `TableManager` daje graczowi **90 sekund na powrót**, zanim
zwolni jego miejsce przy stole, który jeszcze nie wystartował. W trakcie partii
miejsce zostaje na stałe, ale gracz nieobecny dłużej niż 150 sekund dostaje
automatyczny pas — inaczej jedna zerwana sesja blokowałaby stół w nieskończoność.

## Konta i goście

- **Partie z komputerem nie liczą się do statystyk ani rankingu.** Komputer
  gra zawsze tak samo i jest dostępny bez ograniczeń, więc rekordy z nim nic
  nie mówią o graczu. Partia trafia do historii, ale nie rusza liczników.
- **Gość** dostaje konto techniczne i sesję zapisaną w `sessionStorage` —
  zamknięcie karty kończy jego przygodę. Nie wpływa na ranking i nie może
  tworzyć trybów gry.
- **Konto** ma sesję w `localStorage` (30 dni), ranking, skalpy i własne tryby.
- Gość może w każdej chwili **zamienić się w pełne konto** bez utraty dorobku
  (`POST /api/auth/upgrade`).
- Hasła: scrypt z `node:crypto`, format `scrypt$N$r$p$sól$hash`.
- Nieaktywne konta gości znikają po 14 dniach (sprzątaczka w tle).

---

## Komputerowy przeciwnik

Trzy poziomy trudności — różnią się nie tempem, tylko tym, co komputer bierze
pod uwagę:

| poziom | nazwa | co robi |
|--------|-------|---------|
| 1 | Łatwy | celowo sięga po słabsze zagrania z listy |
| 2 | Średni | gra po prostu najwięcej punktów — tak, jak liczy większość ludzi |
| 3 | Trudny | patrzy też na to, **co zostaje na stojaku** (blank, balans samogłosek, duplikaty), a przy kończącym się worku gra na wyjście z liter, bo to ono rozstrzyga końcówkę |

Nic tu nie zna wartości konkretnych liter „z pamięci" — wszystko skaluje się
wartościami z trybu gry, więc AI gra sensownie także na planszach ułożonych
przez graczy.

### Skąd wiadomo, że wyższy poziom jest lepszy

Z pomiaru, nie z przekonania. `npm run ai:duel` sadza dwa poziomy naprzeciw
siebie i podaje wynik z marginesem błędu:

```powershell
node server/tools/aiDuel.js --a 3 --b 2 --games 60
node server/tools/aiDuel.js --a 2 --b 1 --games 40 --variant scr
```

Gra słowna jest bardzo losowa, więc przy strojeniu warto rozgrywać **pary**
partii na tym samym losowaniu worka z zamienionymi stronami — inaczej różnica
umiejętności ginie w szczęściu przy dobieraniu liter. Tak zmierzona drabinka
(800 partii na porównanie):

| porównanie | Literki | SCR |
|------------|---------|-----|
| Trudny kontra Średni | +32,7 ±11,9 pkt | +18,1 ±11,6 pkt |
| Średni kontra Łatwy | +804,9 ±12,9 pkt | +723,2 ±12,1 pkt |

### Czego w AI nie ma i dlaczego

Kilka rozsądnie brzmiących pomysłów przeszło pomiar i **odpadło** — warto
o tym wiedzieć, zanim ktoś zechce je wprowadzić po raz drugi:

- **wycena pojedynczych liter** (przez częstość w słowniku, przez punktację,
  przez „użyteczność" z trybu gry) — od −29 pkt do zera,
- **kara za otwieranie przeciwnikowi pól premiowych** — +0,7 ±8,9 pkt na 1000 partii,
- **zamykanie planszy przy prowadzeniu** — −0,7 ±6,3 pkt na 1000 partii,
- **symulacja odpowiedzi przeciwnika** (jeden ruch w przód, losowanie jego
  stojaka z liter niewidzianych) — bez efektu przy 15-krotnie droższym ruchu.
  Przy jednym ruchu w przód najlepsza odpowiedź przeciwnika zależy głównie od
  jego liter, a nie od tego, które z naszych zagrań wybierzemy. Zrobienie tego
  porządnie (dwa ruchy w przód, setki losowań) kosztowałoby sekundy na ruch —
  za dużo przy wielu stołach naraz.

Zostało to, co wygrywa partie: ocena reszty stojaka i gra pod końcówkę.

## Protokół

REST (`/api`) obsługuje konta, profile, ranking i tryby gry.
WebSocket obsługuje lobby i rozgrywkę.

Klient → serwer: `{ type, rid?, ...dane }`
Serwer → klient: `{ type: "<type>:response", rid, success, ... }` albo zdarzenie.

**Akcje:** `auth`, `sync`, `ping`, `lobby`, `table:create`, `table:join`,
`table:joinCode`, `table:leave`, `table:start`, `table:rematch`, `table:chat`,
`game:move`, `game:exchange`, `game:pass`, `game:resign`, `game:hint`,
`game:state`, `game:preview`.

**Zdarzenia:** `hello`, `lobby`, `table`, `table:closed`, `game`, `game:move`,
`game:over`, `chat`, `preview`, `error`.

Dodając akcję: handler w `server/ws/handlers.js`, metoda w `TableManager`,
obsługa zdarzenia w `public/js/main.js`.

---

## Skrypty pomocnicze

Uruchamiaj z katalogu projektu — nic już nie wymaga `process.chdir`.

| polecenie | do czego |
|-----------|----------|
| `npm run sim` | partia komputer kontra komputer, statystyki z wielu partii |
| `npm run play` | partia w konsoli przeciw komputerowi |
| `npm run tiles:derive` | wyprowadzenie zestawu klocków z częstości liter |
| `npm run db:reset` | skasowanie i odtworzenie bazy |
| `node server/tools/sandbox.js` | piaskownica solvera na jednej planszy |
| `node server/ai/testImageSolver.js` | solver ze zdjęcia bez wywołania modelu |

Przykłady:

```powershell
node server/tools/simulate.js --variant scr --games 20
node server/tools/playConsole.js --level 3
node server/tools/sandbox.js --rack ALESZYK --top 15
```

---

## Solver ze zdjęcia

Szczegóły w [SOLVER.md](SOLVER.md). Klucze API w `server/ai.config.json`
(plik jest w `.gitignore`; wzorzec: `ai.config.example.json`) albo w zmiennych
`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`. Dostawca wykrywany z nazwy modelu
(`gemini*` → Gemini, nagłówek `X-goog-api-key`, **nie** `Bearer`).
Kluczy nigdy nie commituj.

---

## Wdrożenie

Obraz: `Dockerfile` (node:24-slim, port 8080). Express i WebSocket dzielą
jeden port — WebSocket to upgrade po TCP, nie trzeba osobnego portu ani UDP.

### Northflank

1. Zbuduj serwis z repozytorium (Dockerfile w katalogu głównym).
2. **Podepnij wolumen zamontowany w `/data`.** Bez tego baza — a więc konta,
   ranking i tryby gry — znika przy każdym deployu.
3. Zmienne środowiskowe: `DATA_DIR=/data` (już ustawione w obrazie),
   opcjonalnie `PORT`.
4. Port 8080, protokół HTTP; WebSocket działa na tym samym porcie.

Serwer wystawia `/healthz` (odpowiada liczbą stołów i graczy online).

### Zmienne środowiskowe

| zmienna | domyślnie | znaczenie |
|---------|-----------|-----------|
| `PORT` | 8080 | port HTTP i WebSocket |
| `DATA_DIR` | `server/data` | katalog na plik bazy |
| `DB_FILE` | — | pełna ścieżka pliku bazy (zamiast `DATA_DIR`) |
| `DB_DRIVER` | `sqlite` | `sqlite` albo `mysql` |
| `DB_URL` | — | adres MySQL |
| `DICT_FILE` | `server/slownik.txt` | plik słownika |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | — | solver ze zdjęcia |

---

## Uwaga o zasadach gry

Układ premii, rozkład liter i punktacja w tym repozytorium są autorskie —
plansze wygenerowano z reguł geometrycznych, a zestawy klocków wyprowadzono
z częstości liter w słowniku (narzędzie `server/tools/deriveTiles.js`).
Wszystko to jest **danymi w bazie**, nie kodem, więc administrator może je
w każdej chwili zmienić albo usunąć bez ruszania aplikacji. Nie jest to porada
prawna — jeśli planujesz publiczne wdrożenie, warto skonsultować kwestię
znaków towarowych i ochrony układu planszy z prawnikiem.
