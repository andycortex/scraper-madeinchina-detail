import { PlaywrightCrawler, Dataset, log } from '@crawlee/playwright';
import { Actor } from 'apify';
import { router } from './routes.js';
import { setTimeout } from 'node:timers/promises';

await Actor.init();

const input = await Actor.getInput();
if (!input?.startUrls?.length) {
    throw new Error('No startUrls provided in input.');
}

const BRIGHTDATA_WS = 'wss://brd-customer-hl_d6363161-zone-scraping_browser_madeinchina:h58qk983tfgf@brd.superproxy.io:9222';

const crawler = new PlaywrightCrawler({
    maxRequestRetries: 4,
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 150,
    minConcurrency: 1,
    maxConcurrency: 1, // importante: solo 1 a la vez

    preNavigationHooks: [
        async ({ page }) => {
            // Headers más realistas
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'Upgrade-Insecure-Requests': '1',
            });

            // Evitar detección de webdriver
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            });
        },
    ],

    requestHandler: router,

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

// Conexión a Bright Data Scraping Browser
crawler.launchContext.launcher = {
    launch: async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.connectOverCDP(BRIGHTDATA_WS);
        return browser;
    },
};

await crawler.addRequests(
    input.startUrls.map((item) => ({
        url: item.url,
        label: 'detail',
        // Forzar que no use cache
        uniqueKey: `${item.url}?t=${Date.now()}`,
    }))
);

console.log('🚀 Iniciando con configuración anti-detección...');
await crawler.run();
await Actor.exit();