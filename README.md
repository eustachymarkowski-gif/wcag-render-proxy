# WCAG Render Proxy

Mały serwer Node/Express + Playwright, który renderuje strony docelowe w
prawdziwej przeglądarce Chromium **po stronie serwera**. Dzięki temu:

- **CORS przestaje mieć znaczenie** — żądanie do strony docelowej wykonuje
  serwer, a nie przeglądarka użytkownika, więc polityka CORS strony docelowej
  w ogóle nie wchodzi w grę (dotyczy tylko żądań z przeglądarki do innej domeny).
- **Audyt widzi realny DOM po wykonaniu JS** — istotne dla SPA (React, Vue,
  Angular), gdzie treść, ARIA i landmarki są dokładane dynamicznie.
- **Część prostych blokad anty-botowych jest omijana**, bo to realna
  przeglądarka z pełnym renderowaniem, a nie goły `fetch`.

## Uruchomienie lokalnie

```bash
cd render-server
npm install
npm start
```

Test:

```bash
curl "http://localhost:3001/render?url=https://example.com"
```

## Podłączenie do Audytora WCAG

W `application.js` znajduje się zmienna na górze pliku:

```js
var RENDER_SERVER_URL = 'https://render-server-erqf.onrender.com';
```

Kolejność prób pobierania po zmianie:
1. Własny serwer renderujący (jeśli `RENDER_SERVER_URL` ustawiony)
2. Bezpośredni `fetch()` z przeglądarki (zadziała dla stron z otwartym CORS)
3. Publiczne proxy (`allorigins`, `codetabs`, `corsproxy.io`, `cors.workers.dev`)
   jako ostatnia deska ratunku

## Wdrożenie produkcyjne

Kilka prostych opcji (od najprostszej):

- **Render.com / Railway / Fly.io** — deploy repo z `Dockerfile` bazującym na
  `mcr.microsoft.com/playwright:v1.46.0-jammy` (ma już zainstalowane
  przeglądarki, oszczędza czas builda).
- **VPS + PM2** — `npm ci --omit=dev && npx playwright install --with-deps chromium`,
  potem `pm2 start server.js`, za Nginx jako reverse-proxy z HTTPS.
- **Docker (przykładowy Dockerfile)**:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.46.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3001
CMD ["node", "server.js"]
```

## Uwagi bezpieczeństwa

- Serwer ma wbudowaną podstawową ochronę SSRF (blokuje `localhost`,
  `127.0.0.1`, adresy z sieci prywatnej `10.x/172.16-31.x/192.168.x`).
  Jeśli wdrażacie to w infrastrukturze z dostępem do sieci wewnętrznej firmy,
  rozważcie dodatkową listę dozwolonych/zablokowanych domen.
- `MAX_CONCURRENT_PAGES` (domyślnie 4) ogranicza liczbę równoległych kart
  Chromium — dostosujcie do zasobów serwera (każda karta to realna instancja
  przeglądarki, więc to koszt RAM/CPU).
- Jeśli serwer będzie publicznie dostępny, warto dodać prosty rate-limiting
  (np. pakiet `express-rate-limit`), żeby nikt obcy nie zrobił z niego
  otwartego proxy do dowolnych stron.
