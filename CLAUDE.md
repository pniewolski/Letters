# CLAUDE.md — Literki

Portal do gier słownych: Node.js + Express + WebSocket na backendzie, waniliowy
JS (moduły ES) na froncie. Bez frameworków, bez builda, bez testów
automatycznych. Kod, komentarze i komunikaty są **po polsku** — trzymaj się tego.

Pełny opis projektu dla ludzi: [README.md](README.md). Ten plik zbiera to,
o czym łatwo zapomnieć przy zmianach.

## Uruchamianie

```powershell
npm start          # node server/server.js  (http://localhost:8080)
npm run dev        # to samo z --watch
npm run db:reset   # skasowanie i odtworzenie bazy (usuwa konta i partie!)
```

Wymagany Node **22.5+** — baza działa na wbudowanym `node:sqlite`. Obraz
Dockera używa `node:24-slim`.

Weryfikacja odbywa się ręcznie: przez skrypty w `server/tools/` albo przez
uruchomienie serwera.

## Trzy rzeczy, które łatwo zepsuć

1. **Reguły gry nie należą do kodu.** Rozmiar planszy, punktacja, ilości liter,
   premie i kolory pochodzą z `CompiledVariant` (`server/variant/`). Jeśli
   wpisujesz w silniku `15`, `7` albo `50` — cofnij się i weź to z trybu gry.
   To samo dotyczy frontu: punktacja i alfabet przychodzą w stanie partii.

2. **Słownik ładuje się raz na proces.** Budowa Trie z 3,2 mln słów zajmuje
   ~2 s i sporo pamięci. Instancja `WordDictionary` jest tworzona w
   `server.js` i przekazywana dalej. Nie twórz nowej na żądanie.

3. **`TableManager` nie zna WebSocketów.** Emituje zdarzenia (`lobby`, `table`,
   `game`, `move`, `over`, `chat`), a `ws/Hub.js` zamienia je na komunikaty.
   Nie wywołuj `ws.send` z warstwy lobby — inaczej logiki nie da się
   przetestować bez serwera.

Dawna pułapka z `process.chdir` **już nie istnieje**: `WordDictionary` liczy
ścieżkę słownika względem swojego pliku, a plansza i worek nie czytają niczego
z dysku. Skrypty można odpalać z dowolnego katalogu.

## Architektura w skrócie

```
server/
  server.js        start: baza → słownik → TableManager → Express + WebSocket
  db/              warstwa bazy (SQLite domyślnie, MySQL po zmianie DB_DRIVER)
  variant/         definicja, walidacja i kompilacja trybów gry + presety
  board/           Board, DrawstringBag, WordDictionary, Solver, BestMoveFinder
  game/            Game (tury, koniec partii), Table (stan), Strategy (AI)
  lobby/           GameTable (miejsca, zegar), TableManager (rejestr, przebieg)
  repo/            dostęp do danych (User, Session, Variant, Stats, Game, Friend)
  auth/            hashowanie haseł i usługa kont
  ws/              Hub (połączenia, rozsyłanie) + handlers (akcje)
  app/routes.js    REST API
  ai/              solver ze zdjęcia
  tools/           skrypty pomocnicze
public/js/
  main.js router.js store.js api.js net.js ui.js
  game/            plansza, stojak, blank, podgląd, miniaturka
  screens/         home, lobby, game, ranking, profile, variants,
                   variantEditor, friends, auth
```

## Tryby gry — jedyne źródło reguł

Definicja trybu (`server/variant/schema.js`) opisuje wszystko: planszę
(rozmiar + siatka znaków), zestaw liter z ilościami i punktacją, blanki,
stojak, premię za wyłożenie stojaka, reguły końcówki i kolory.

Znaki siatki planszy:

| znak | pole |
|------|------|
| `.` | zwykłe |
| `@` | startowe |
| `2` / `3` / `4` | podwójna / potrójna / poczwórna wartość słowa |
| `d` / `t` / `q` | podwójna / potrójna / poczwórna wartość litery |

`normalizeDefinition()` uzupełnia braki i przycina wartości do bezpiecznych
zakresów, a rzuca `VariantError` tylko wtedy, gdy tryb byłby niegrywalny
(np. worek mniejszy niż suma stojaków). `compileVariant()` zamienia definicję
w struktury dla silnika i trzyma je w pamięci podręcznej po `id:updated_at` —
po edycji trybu wołaj `clearVariantCache()` (robi to `VariantRepo`).

Wbudowane tryby (`presets.js`) trafiają do bazy przy pierwszym starcie jako
zwykłe rekordy. Ich definicje są autorskie: plansze wygenerowano z reguł
geometrycznych, a zestawy klocków wyprowadzono z częstości liter w słowniku
narzędziem `server/tools/deriveTiles.js`. Zmieniając je, uruchom to narzędzie
zamiast wpisywać liczby z sufitu.

Po zmianie presetu sprawdź spójność:

```powershell
node -e "const{compileVariant}=require('./server/variant/compile');const{PRESETS}=require('./server/variant/presets');for(const p of PRESETS)console.log(p.slug,JSON.stringify(compileVariant(p.definition).summary))"
```

## Baza danych

Schemat jest zapisany **raz**, w `server/db/migrations.js`, ze znacznikami
typów (`{{PK}}`, `{{STR:64}}`, `{{TEXT}}`, `{{BIGINT}}`, `{{BOOL}}`,
`{{ENGINE}}`), które `db/types.js` tłumaczy na SQLite albo MySQL. Zapytania
pisz z placeholderami `?`; konstrukcje różniące się między silnikami (UPSERT)
opakowuje `Database.upsert()`.

Dodając tabelę lub kolumnę: **dopisz nową migrację**, nie zmieniaj istniejącej —
zastosowane migracje są zapisane w `schema_migrations`.

Świadomie nie ma kluczy obcych: integralności pilnują repozytoria, a brak FK
upraszcza czyszczenie kont gości i przenosiny między silnikami.

Baza to plik w `DATA_DIR` (domyślnie `server/data`). Na hostingu **musi**
wskazywać na wolumen, inaczej dane znikają przy deployu.

## Protokół

REST (`/api`) — konta, profile, ranking, tryby gry, solver ze zdjęcia.
WebSocket — lobby i rozgrywka.

```
klient  → { type, rid?, ...dane }
serwer  → { type: "<type>:response", rid, success, ... }   (odpowiedź)
serwer  → { type: "lobby" | "table" | "game" | ... }        (zdarzenie)
```

Akcje: `auth`, `sync`, `ping`, `lobby`, `table:create`, `table:join`,
`table:joinCode`, `table:leave`, `table:start`, `table:rematch`, `table:chat`,
`game:move`, `game:exchange`, `game:pass`, `game:resign`, `game:hint`,
`game:state`, `game:preview`.

Zdarzenia: `hello`, `lobby`, `table`, `table:closed`, `game`, `game:move`,
`game:over`, `chat`, `preview`, `error`.

Dodając akcję: handler w `server/ws/handlers.js` (rzuć `fail('...')` przy
błędzie walidacji — komunikat trafi wprost do gracza), metoda w
`TableManager`, obsługa w `handleServerMessage()` w `public/js/main.js`.

Handler z `requiresAuth = false` działa przed zalogowaniem.

## Konta i sesje

Goście mają wiersz w `users` z `is_guest = 1`, więc partie i statystyki
odwołują się do jednego typu identyfikatora. Token gościa trafia do
`sessionStorage` (ginie z kartą), token konta do `localStorage`.
Awans gościa na pełne konto zachowuje dorobek (`AuthService.upgradeGuest`).

Ranking (Elo) zmienia się tylko w partiach między zarejestrowanymi graczami —
pilnuje tego `StatsRepo.applyGameResult`, więc warstwa wyżej nie musi.

## Konwencje

- Komentarze, nazwy w interfejsie i komunikaty błędów **po polsku**.
  JSDoc nad klasami i metodami publicznymi, z `@example` tam, gdzie pomaga.
- Front: moduły ES, bez bundlera. `net.js` nie zna logiki gry — handler
  wiadomości wstrzykuje `main.js` przez `onMessage()`. Ekrany zwracają funkcję
  sprzątającą; router woła ją przed przejściem dalej.
- Stan frontu żyje w `store.js`; ekrany zapisują się na klucze przez
  `subscribe()` zamiast szukać się nawzajem.
- Wszystkie litery wewnętrznie **wielkimi**; `slownik.txt` jest małymi —
  porównania wymagają normalizacji.
- Blank: `isBlank: true` + wybrana litera, zawsze 0 punktów. Klient **musi**
  wskazać, na których polach leży blank — serwer nie zgaduje.
- Sekcje w większych plikach oddzielaj komentarzem `// ─────`.
- Nowe pliki zapisuj z końcami linii LF (pilnuje tego `.gitattributes`).
