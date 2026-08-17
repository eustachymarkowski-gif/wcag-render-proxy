// ============================================================
// WCAG Render Proxy - serwer pomocniczy do pobierania stron
// ============================================================
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(cors());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Zbyt wiele zapytań z tego adresu IP, spróbuj ponownie później.'
});
app.use(limiter);

const PORT = process.env.PORT || 3001;
const MAX_CONCURRENT_PAGES = 4;

let browserPromise = null;
let activePages = 0;

function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-web-security'
            ]
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

// ============================================================
// UKRYWANIE POPUPÓW PRZEZ INIEKCJĘ CSS/JS
// ============================================================
async function hidePopups(page) {
    // Metoda 1: Ukrywanie poprzez CSS
    await page.addStyleTag({
        content: `
            [class*="cookie"], [class*="consent"], [class*="gdpr"],
            [id*="cookie"], [id*="consent"], [id*="gdpr"],
            [class*="popup"], [class*="modal"], [class*="overlay"],
            [class*="banner"], [class*="notification"],
            .cookie-bar, .cookie-notice, .cookie-popup,
            .consent-popup, .gdpr-popup, .gdpr-banner,
            .modal-backdrop, .modal-overlay, .overlay-background,
            .dialog-overlay, .dialog-backdrop,
            .cookie-consent, .privacy-banner, .privacy-notice,
            .cc-banner, .cc-window, .cc-popup,
            .ot-sdk-container, .ot-sdk-banner, .onetrust-pc-dark-filter,
            [aria-label*="cookie"], [aria-label*="consent"],
            [aria-label*="zgoda"], [aria-label*="ciasteczka"],
            .fc-consent-root, .fc-dialog, .fc-frame,
            .truste-box, .truste-overlay,
            .cmpbox, .cmpboxbtns, .cmpboxinner,
            .didomi-popup, .didomi-banner, .didomi-consent,
            .osano-cookie-banner, .osano-consent {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                overflow: hidden !important;
                position: absolute !important;
                z-index: -9999 !important;
            }
            
            body {
                overflow: auto !important;
                position: static !important;
                height: auto !important;
            }
            
            html {
                overflow: auto !important;
            }
        `
    });

    // Metoda 2: Usuwanie przez JavaScript
    await page.evaluate(() => {
        const selectors = [
            '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
            '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]',
            '[class*="popup"]', '[class*="modal"]', '[class*="overlay"]',
            '.cookie-bar', '.cookie-notice', '.consent-popup',
            '.modal-backdrop', '.modal-overlay',
            '.ot-sdk-container', '.ot-sdk-banner',
            '.fc-consent-root', '.fc-dialog',
            '.cmpbox', '.cmpboxinner',
            '.didomi-popup', '.didomi-banner'
        ];
        
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const style = window.getComputedStyle(el);
                const isVisible = style.display !== 'none' && 
                                 style.visibility !== 'hidden' && 
                                 style.opacity !== '0';
                
                if (isVisible && (
                    el.textContent.includes('cookie') ||
                    el.textContent.includes('consent') ||
                    el.textContent.includes('zgoda') ||
                    el.textContent.includes('ciasteczka') ||
                    el.textContent.includes('prywatność') ||
                    el.textContent.includes('privacy') ||
                    el.textContent.includes('GDPR')
                )) {
                    el.remove();
                }
            });
        });

        document.body.style.overflow = 'auto';
        document.body.style.position = 'static';
        document.documentElement.style.overflow = 'auto';

        document.body.classList.remove('no-scroll', 'modal-open', 'overflow-hidden');
    });

    // Metoda 3: Próba kliknięcia przycisków akceptacji
    try {
        const cookieButtons = [
            'button:has-text("Akceptuj")',
            'button:has-text("Accept all")',
            'button:has-text("Zezwól")',
            'button:has-text("Allow all")',
            'button:has-text("OK")',
            'button:has-text("Rozumiem")',
            'button:has-text("Zgadzam się")',
            'button:has-text("I agree")',
            '#onetrust-accept-btn-handler',
            '.cookie-accept-button',
            '.accept-cookies',
            '[aria-label="Accept cookies"]',
            '[aria-label="Zgoda na cookies"]',
            '.cc-btn',
            '.fc-button',
            '.didomi-consent-popup__actions__accept'
        ];

        for (const selector of cookieButtons) {
            const button = await page.$(selector);
            if (button) {
                await button.click();
                console.log(`[render] Kliknięto przycisk: ${selector}`);
                await page.waitForTimeout(300);
                break;
            }
        }
    } catch (e) {
        console.warn('[render] Błąd przy klikaniu przycisków:', e.message);
    }

    // Metoda 4: Dodatkowe CSS do usunięcia popupów po kliknięciu
    await page.addStyleTag({
        content: `
            [class*="cookie"], [class*="consent"], [class*="popup"],
            [class*="modal"], [class*="overlay"], [class*="banner"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                overflow: hidden !important;
            }
        `
    });
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
            timezoneId: 'Europe/Warsaw',
            ignoreHTTPSErrors: false
        });
        const page = await context.newPage();

        let response;
        try {
            response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
        } catch (navErr) {
            response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }

        try {
            await hidePopups(page);
            console.log('[render] Ukryto popupy na stronie');
        } catch (popupError) {
            console.warn('[render] Błąd przy ukrywaniu popupów:', popupError.message);
        }

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
                html
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
        } catch (e) {}
    }
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
    console.log(`[render-server] nasłuchuje na porcie ${PORT}`);
    console.log(`[render-server] test: http://localhost:${PORT}/render?url=https://example.com`);
});