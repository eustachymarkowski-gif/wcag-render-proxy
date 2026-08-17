// ============================================================
// WCAG Render Proxy - serwer pomocniczy do pobierania stron
// ============================================================
// Renderuje stronę w prawdziwej przeglądarce (Chromium/Playwright)
// po stronie serwera, więc:
//  - CORS w ogóle nie wchodzi w grę (żądanie robi serwer, nie przeglądarka usera)
//  - zwrócony HTML zawiera treść wygenerowaną przez JS (SPA, React itd.),
//    co jest kluczowe dla rzetelnego audytu WCAG
//  - część prostych blokad anty-botowych (opartych o User-Agent lub
//    wykrywanie "headless") jest omijana, bo to realna przeglądarka
//
// Uwaga: to NIE jest sposób na łamanie zabezpieczeń stron - serwer
// nadal respektuje standardowe kody HTTP i nie próbuje obchodzić
// logowania, CAPTCHA wymagającej interakcji człowieka itd.

const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();

// Domyślnie otwarte dla wszystkich (wygodne na start). W produkcji zalecane
// ustawienie zmiennej środowiskowej ALLOWED_ORIGIN na adres waszej domeny
// produkcyjnej, żeby nikt obcy nie korzystał z waszego serwera jako
// darmowego, otwartego proxy do dowolnych stron.
const allowedOrigin = process.env.ALLOWED_ORIGIN; // np. 'https://audytor.wasza-domena.pl'
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));

const PORT = process.env.PORT || 3001;
const MAX_CONCURRENT_PAGES = 4;

let browserPromise = null;
let activePages = 0;

function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    }
    return browserPromise;
}

function isSafeUrl(raw) {
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (e) {
        return { ok: false, reason: 'Nieprawidłowy format URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { ok: false, reason: 'Dozwolone są tylko adresy http:// i https://' };
    }
    // podstawowa ochrona przed SSRF do sieci wewnętrznej/localhost serwera
    const host = parsed.hostname.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (blocked.includes(host) || host.endsWith('.local')) {
        return { ok: false, reason: 'Adresy lokalne/wewnętrzne są zablokowane' };
    }
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) {
        return { ok: false, reason: 'Adresy z sieci prywatnej są zablokowane' };
    }
    return { ok: true, parsed };
}

app.get('/render', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Brak parametru ?url=' });
    }

    const check = isSafeUrl(targetUrl);
    if (!check.ok) {
        return res.status(400).json({ error: check.reason });
    }

    if (activePages >= MAX_CONCURRENT_PAGES) {
        return res.status(429).json({ error: 'Serwer jest obecnie zajęty, spróbuj ponownie za chwilę' });
    }

    let context;
    activePages++;
    try {
        const browser = await getBrowser();
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            viewport: { width: 1366, height: 900 },
            locale: 'pl-PL',
            ignoreHTTPSErrors: false
        });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(30000);

        let response;
        try {
            response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (navErr) {
            // niektóre strony nigdy nie osiągają "networkidle" (np. ciągły polling) -
            // spróbuj łagodniejszego warunku zanim się poddamy
            response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        // dodatkowy czas na późny JS (lazy-load, treści dokładane po chwili,
        // regiony aria-live itp. - istotne dla audytu dostępności)
        await page.waitForTimeout(1200);

        const html = await page.content();
        const status = response ? response.status() : 200;
        const finalUrl = page.url();

        await context.close();
        activePages--;

        if (status >= 400) {
            return res.status(502).json({
                error: 'Serwer docelowy zwrócił HTTP ' + status,
                status,
                html // i tak zwracamy treść - może to np. strona 404 z treścią wartą audytu
            });
        }

        res.json({ html, status, finalUrl });
    } catch (err) {
        if (context) await context.close().catch(() => {});
        activePages--;
        console.error('[render] błąd dla', targetUrl, '-', err.message);
        res.status(502).json({ error: 'Nie udało się wyrenderować strony: ' + err.message });
    }
});

app.get('/healthz', (req, res) => res.json({ ok: true, activePages }));

async function shutdown() {
    if (browserPromise) {
        try {
            const browser = await browserPromise;
            await browser.close();
        } catch (e) { /* noop */ }
    }
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
    console.log(`[render-server] nasłuchuje na porcie ${PORT}`);
    console.log(`[render-server] test: http://localhost:${PORT}/render?url=https://example.com`);
});
