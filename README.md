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

To nie jest sposób na łamanie zabezpieczeń serwisów — logowanie, CAPTCHA
wymagająca interakcji człowieka czy świadome blokady IP nadal zadziałają.
To po prostu poprawny, "grzeczny" sposób pobierania treści do audytu.

## Uruchomienie lokalnie

```bash
cd render-server
npm install          # zainstaluje też Chromium dla Playwright (postinstall)
npm start
# -> [render-server] nasłuchuje na porcie 3001
```

Test:

```bash
curl "http://localhost:3001/render?url=https://example.com"
```

## Podłączenie do Audytora WCAG

W `application.js` znajduje się zmienna na górze pliku:

```js
var RENDER_SERVER_URL = 'http://localhost:3001';
```

- Zostaw jak jest do developmentu lokalnego.
- Do produkcji podmień na publiczny adres, pod którym wdrożysz ten serwer
  (patrz sekcja "Wdrożenie produkcyjne" niżej).
- Ustaw na pusty string `''`, aby całkowicie wyłączyć i wrócić do starego
  zachowania (bezpośredni fetch + publiczne proxy).

Kolejność prób pobierania po zmianie:
1. Własny serwer renderujący (jeśli `RENDER_SERVER_URL` ustawiony)
2. Bezpośredni `fetch()` z przeglądarki (zadziała dla stron z otwartym CORS)
3. Publiczne proxy (`allorigins`, `codetabs`, `corsproxy.io`, `cors.workers.dev`)
   jako ostatnia deska ratunku

## Wdrożenie bez dostępu do serwera produkcyjnego (Render.com)

Jeśli macie tylko statyczny hosting (bez SSH/Node, np. cPanel/FTP) dla
Audytora WCAG, ten serwer wdrażacie **całkowicie osobno** — nie potrzeba do
tego żadnych uprawnień na serwerze produkcyjnym. Kroki dla Render.com
(darmowy plan, bez karty kredytowej):

1. Wrzućcie zawartość folderu `render-server/` do osobnego repozytorium na
   GitHubie (musi zawierać `Dockerfile`, `package.json`, `server.js`).
2. Na [render.com](https://render.com) załóżcie darmowe konto i wybierzcie
   **New → Web Service**, wskażcie to repozytorium.
3. Render sam wykryje `Dockerfile` (typ środowiska: Docker). Plan: **Free**.
4. Poczekajcie na pierwszy build (kilka minut — instaluje Chromium).
5. Po zbudowaniu Render poda publiczny adres, np.
   `https://wcag-render-proxy.onrender.com`.
6. Ustawcie zmienną środowiskową `ALLOWED_ORIGIN` na adres waszej aplikacji
   (np. `https://audytor.wasza-domena.pl`), żeby ograniczyć CORS wyłącznie
   do niej.
7. W `application.js` podmieńcie:
   ```js
   var RENDER_SERVER_URL = 'https://wcag-render-proxy.onrender.com';
   ```
   i wgrajcie ten plik na serwer produkcyjny dokładnie tak, jak zwykle
   wgrywacie pozostałe pliki statyczne (FTP/panel hostingowy). To jedyna
   zmiana potrzebna po stronie produkcyjnej.

**Uwaga o darmowym planie:** Render usypia nieaktywny serwis po ~15 minutach
bezczynności. Pierwsze żądanie po przerwie może potrwać do ~50 sekund (tzw.
cold start) — dlatego `RENDER_SERVER_TIMEOUT_MS` w `application.js` jest
ustawiony na 55 s. Jeśli to za wolno w praktyce, rozważcie:
- płatny plan Render (Starter, ~7$/mies.) — serwis nie usypia,
- albo Railway/Fly.io — podobny model, warto porównać aktualne darmowe limity.

Plik `render.yaml` w tym folderze to gotowy "Blueprint" — jeśli wolicie,
Render potrafi go wykryć automatycznie i skonfigurować usługę za jednym
kliknięciem (New → Blueprint → wskazać repo).

## Alternatywa: gotowa usługa zamiast własnego serwera

Jeśli wolicie nie utrzymywać żadnego własnego serwera (nawet darmowego),
usługi typu **Browserless.io** lub **ScrapingBee** oferują dokładnie to samo
(renderowanie strony w przeglądarce + zwrot HTML) jako płatne API z
niewielkim darmowym limitem próbnym — wtedy `tryRenderServer()` w
`application.js` trzeba by dostosować do formatu ich odpowiedzi (inny URL i
inny kształt JSON-a), ale reszta logiki fallbacku zostaje bez zmian.

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