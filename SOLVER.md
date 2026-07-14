# Rozwiązywanie gry ze zdjęcia (AI)

Funkcja pozwala wysłać zdjęcie planszy Scrabble (razem z literkami gracza),
a serwer rozpozna stan gry przez model wizyjny i zwróci do 20 najlepszych ruchów.

## Jak to działa

1. Zdjęcie jest skalowane do maks. **800 px** (po stronie przeglądarki oraz dodatkowo na serwerze).
2. Obraz trafia do modelu wizyjnego (LLM), który zwraca JSON: `{ board, rack }`.
3. Już załadowany **słownik** (singleton, ładowany raz przy starcie serwera) + `Solver`
   wyliczają najkorzystniejsze ruchy.
4. Zwracana jest lista ruchów w postaci: `SŁOWO, poziomo/pionowo, od lewej X, od góry Y — punkty`.

Serwer działa cały czas w tle, więc słownik nie jest ładowany przy każdym zapytaniu.

## Konfiguracja modelu

Ustaw dane dostępowe na jeden z dwóch sposobów:

**A) Zmienne środowiskowe** (zalecane produkcyjnie):
```powershell
$env:AI_API_KEY = "sk-..."
$env:AI_MODEL   = "gpt-4o-mini"           # opcjonalnie
$env:AI_API_URL = "https://api.openai.com/v1/chat/completions"  # opcjonalnie
node server/server.js
```

**B) Plik `server/ai.config.json`** (skopiuj z `server/ai.config.example.json`):
```json
{
  "apiUrl": "https://api.openai.com/v1/chat/completions",
  "apiKey": "sk-...",
  "model": "gpt-4o-mini"
}
```
Plik `server/ai.config.json` jest w `.gitignore` (nie trafi do repo).

Endpoint jest zgodny z **OpenAI Chat Completions**, więc działa też z każdą usługą
kompatybilną z tym API (OpenRouter, Google Gemini w trybie OpenAI-compat, itp.) —
wystarczy zmienić `apiUrl` i `model`.

## Który model wybrać (najtaniej)

Zadanie = odczyt siatki 15×15 + kilku liter. To proste OCR/rozpoznanie układu,
więc wystarczy tani model wizyjny. Rekomendacje (od najtańszych):

| Model | Dostawca | Orientacyjny koszt* | Uwagi |
|-------|----------|---------------------|-------|
| **gemini-2.0-flash-lite** / **gemini-2.5-flash-lite** | Google | najniższy | świetny stosunek cena/jakość dla obrazów |
| **gpt-4o-mini** | OpenAI | bardzo niski | domyślny, prosty w konfiguracji |
| **gpt-4.1-mini** | OpenAI | niski | trochę dokładniejszy przy trudnych zdjęciach |
| Qwen2-VL / Llama 3.2 Vision (via OpenRouter) | różni | niski | opcja open-source |

\* Ceny zmieniają się często — sprawdź aktualny cennik dostawcy. Jedno zapytanie to
zwykle ułamek grosza (obraz 800 px ≈ kilkaset–1–2 tys. tokenów wejściowych).

**Rekomendacja:** zacznij od `gpt-4o-mini` (najprościej) albo `gemini-2.0-flash-lite`
(zwykle najtaniej). Jeśli rozpoznawanie planszy będzie się mylić — przejdź na
`gpt-4.1-mini` / `gemini-2.5-flash`.

## API

`POST /api/solve`

- **multipart/form-data**, pole plikowe `image`, **lub**
- **application/json**: `{ "imageBase64": "data:image/jpeg;base64,..." }`
- opcjonalnie `?limit=20` (maks. 50)

Odpowiedź:
```json
{
  "success": true,
  "board": ["...15 znaków...", "..."],
  "rack": ["A","L","E","..."],
  "moves": [
    { "word": "SŁOWO", "orientation": "pionowo", "fromLeft": 5, "fromTop": 3,
      "points": 24, "blanks": 0, "text": "SŁOWO — pionowo, od lewej 5, od góry 3 — 24 pkt" }
  ]
}
```

Przykład (PowerShell):
```powershell
curl.exe -X POST "http://localhost:3000/api/solve" -F "image=@plansza.jpg"
```

## Frontend

W menu gry pojawił się link **„🧩 Rozwiąż grę ze zdjęcia"** (strona `/solver.html`):
przeciągnij/wybierz zdjęcie i kliknij „Rozwiąż".

