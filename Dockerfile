# ─────────────────────────────────────────────────────────────────────────────
# Literki — obraz produkcyjny
#
# Node 24 jest wymagany: baza działa na wbudowanym module `node:sqlite`,
# dzięki czemu obraz nie potrzebuje kompilatora ani zewnętrznego silnika bazy.
#
# WAŻNE — dane: baza to plik w katalogu DATA_DIR. Bez podpiętego wolumenu
# znika przy każdym deployu. Na Northflank dodaj wolumen zamontowany
# w /data (zmienna DATA_DIR poniżej już na niego wskazuje).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-slim

WORKDIR /app

# Najpierw manifest — lepszy cache warstw przy zmianach w kodzie.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Reszta aplikacji (server/, public/, słownik).
COPY . .

# Katalog na bazę; podmontowanie wolumenu w tym miejscu zachowa dane.
RUN mkdir -p /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

# Express i WebSocket dzielą ten sam port — WebSocket to upgrade po TCP.
EXPOSE 8080

# Prosty test kondycji dla platformy hostingowej.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
