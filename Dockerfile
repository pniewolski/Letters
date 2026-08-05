# ─────────────────────────────────────────────────────────────
# Scrabble server — obraz produkcyjny dla Northflank
# ─────────────────────────────────────────────────────────────
FROM node:20-slim

# Katalog roboczy aplikacji
WORKDIR /app

# Najpierw manifest zależności (lepszy cache warstw Dockera)
COPY package*.json ./

# Instalacja tylko zależności produkcyjnych
RUN npm install --omit=dev

# Reszta kodu (server/, public/, słownik itd.)
COPY . .

# Port HTTP (Express + WebSocket na tym samym porcie).
# WebSocket to upgrade po TCP — NIE potrzeba osobnego portu ani UDP.
ENV PORT=8080
EXPOSE 8080

# Start serwera
CMD ["node", "server/server.js"]

