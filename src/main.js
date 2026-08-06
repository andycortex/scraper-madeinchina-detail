import { PlaywrightCrawler, Dataset, log } from '@crawlee/playwright';
import { Actor } from 'apify';
import { router } from './routes.js';
import { setTimeout } from 'node:timers/promises';
import * as cheerio from 'cheerio';

await Actor.init();

const input = await Actor.getInput();
if (!input?.startUrls?.length) {
    throw new Error('No startUrls provided');
}

const BRIGHTDATA_API_KEY = '3740c65d-25cf-4521-b637-84135ccf637a';
const BRIGHTDATA_ZONE = 'web_unlocker_apify'; // asegúrate que esta zona exista

async function fetchWithUnlocker(url, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`📡 Unlocker intento ${attempt}/${retries}: ${url}`);

            const response = await fetch('https://api.brightdata.com/request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${BRIGHTDATA_API_KEY}`,
                },
                body: JSON.stringify({
                    zone: BRIGHTDATA_ZONE,
                    url: url,
                    format: 'raw',
                    country: 'cn',
                    headers: {
                        'Referer': 'https://www.made-in-china.com/',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                }),
            });

            // 🔍 Log crítico ANTES de cualquier validación
            console.log(`   Status: ${response.status} ${response.statusText}`);
            console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));

            const html = await response.text();
            console.log(`📊 HTML recibido: ${html.length} caracteres`);

            // Si sigue vacío pero status es 200, imprime el body crudo (puede ser JSON de error)
            if (html.length < 500) {
                console.log(`   Body crudo: "${html}"`);
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${html}`);
            }

            if (html.length < 25000) {
                throw new Error(`HTML demasiado corto (${html.length})`);
            }

            if (
                html.includes('captcha.made-in-china.com') ||
                html.includes('verification.html') ||
                html.includes('Just a moment...')
            ) {
                throw new Error('CAPTCHA detectado');
            }

            if (
                html.includes('rel="canonical" href="https://www.made-in-china.com/"') ||
                (html.includes('Made-in-China.com') && !html.includes('product-detail') && !html.includes('sr-proMainInfo'))
            ) {
                throw new Error('Redirigido a homepage');
            }

            return html;
        } catch (err) {
            console.warn(`⚠️ Intento ${attempt} falló: ${err.message}`);
            if (attempt === retries) throw err;
            await setTimeout(4000 * attempt + Math.random() * 2000);
        }
    }
}

for (const item of input.startUrls) {
    const url = item.url;

    try {
        const html = await fetchWithUnlocker(url);
        const $ = cheerio.load(html);

        // === Tu lógica de extracción (puedes copiarla de routes.js) ===
        let title = $('h1.sr-proMainInfo-baseInfoH1').first().text().trim();
        console.log('Title:', $('title').text());
        console.log('¿Tiene contenido de producto?', html.includes('sr-proMainInfo'));
        const result = {
            url,
            title: title || 'Title not found',
            // ... resto
            scrapedAt: new Date().toISOString(),
        };

        await Dataset.pushData(result);
        console.log(`✅ ${result.title}`);
    } catch (err) {
        console.error(`❌ ${url}: ${err.message}`);
        await Dataset.pushData({
            url,
            error: err.message,
            status: 'failed',
            scrapedAt: new Date().toISOString(),
        });
    }

    await setTimeout(3000 + Math.random() * 2000);
}

await Actor.exit();