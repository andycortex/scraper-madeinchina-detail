import { PlaywrightCrawler, Dataset, log } from '@crawlee/playwright';
import { Actor } from 'apify';
import { router } from './routes.js';
import { setTimeout } from 'node:timers/promises';

await Actor.init();

const input = await Actor.getInput();
if (!input?.startUrls?.length) {
    throw new Error('No startUrls provided in input.');
}

// === Bright Data Scraping Browser ===
const BRIGHTDATA_WS = 'wss://brd-customer-hl_d6363161-zone-scraping_browser_madeinchina:h58qk983tfgf@brd.superproxy.io:9222';

const crawler = new PlaywrightCrawler({
    // Conectar al browser remoto de Bright Data
    launchContext: {
        launchOptions: {
            // No lanzamos browser local, usamos el remoto
        },
    },

    // Usamos el endpoint CDP de Bright Data
    browserPoolOptions: {
        useFingerprints: false, // Bright Data ya maneja el fingerprint
    },

    // Configuración importante para Scraping Browser
    preNavigationHooks: [
        async ({ page, request }) => {
            // Opcional: headers extra
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.made-in-china.com/',
            });
        },
    ],

    requestHandler: router,

    // Timeouts más generosos (Made-in-China es lento)
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 120,

    // Reintentos
    maxRequestRetries: 3,

    // Delays entre requests
    minConcurrency: 1,
    maxConcurrency: 2, // No pongas muy alto con Scraping Browser (es más caro)

    // Detectar bloqueos y reintentar
    failedRequestHandler: async ({ request, log }, error) => {
        log.error(`❌ Falló ${request.url}: ${error.message}`);
        await Dataset.pushData({
            url: request.url,
            error: error.message,
            status: 'failed',
            scrapedAt: new Date().toISOString(),
        });
    },
});

// Forzamos la conexión al Scraping Browser de Bright Data
crawler.launchContext.launcher = {
    launch: async () => {
        const { chromium } = await import('playwright');
        return chromium.connectOverCDP(BRIGHTDATA_WS);
    },
};

// Agregamos las URLs
await crawler.addRequests(
    input.startUrls.map((item) => ({
        url: item.url,
        label: 'detail',
    }))
);

log.info(`🚀 Iniciando scraper con Bright Data Scraping Browser...`);
await crawler.run();

log.info(`🏁 Finalizado`);
await Actor.exit();