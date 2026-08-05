import { createPlaywrightRouter, Dataset } from '@crawlee/playwright';
import * as cheerio from 'cheerio';

export const router = createPlaywrightRouter();

router.addHandler('detail', async ({ request, page, log }) => {
    const url = request.loadedUrl || request.url;

    log.info(`🛒 Scraping: ${url}`);

    // Esperar a que cargue contenido importante
    await page.waitForSelector('body', { timeout: 20000 }).catch(() => {});
    
    // Pequeña espera extra para que termine de renderizar JS
    await page.waitForTimeout(2000 + Math.random() * 1500);

    const currentUrl = page.url();

    // Detectar CAPTCHA
    if (currentUrl.includes('captcha') || currentUrl.includes('verification.html')) {
        throw new Error(`⛔ CAPTCHA detectado en ${currentUrl}`);
    }

    // Detectar redirect a homepage
    if (
        currentUrl === 'https://www.made-in-china.com/' ||
        currentUrl === 'https://www.made-in-china.com' ||
        currentUrl.endsWith('made-in-china.com/')
    ) {
        throw new Error(`⛔ Redirigido a homepage desde ${url}`);
    }

    const html = await page.content();
    const $ = cheerio.load(html);

    // === Extracción de datos ===
    let title = $('h1.sr-proMainInfo-baseInfoH1').first().text().trim();

    let price = $('div.only-one-priceNum table tbody tr td span.only-one-priceNum-td-left')
        .text()
        .trim();

    // Ladder prices
    const productLadderPrices = await page.$$eval('.swiper-slide-div', (nodes) => {
        return nodes.map((node) => {
            const priceText = node.querySelector('.swiper-money-container')?.innerText || '';
            const unitText = node.querySelector('.swiper-unit-container')?.innerText || '';

            const priceVal = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;

            const cleanUnit = unitText
                .replace(/,/g, '')
                .replace(/Pieces/i, '')
                .trim();

            let min = null;
            let max = null;

            if (cleanUnit.includes('-')) {
                const [minStr, maxStr] = cleanUnit.split('-');
                min = parseInt(minStr.trim()) || null;
                max = parseInt(maxStr.trim()) || null;
            } else if (cleanUnit.includes('+')) {
                min = parseInt(cleanUnit.replace('+', '').trim()) || null;
                max = -1;
            }

            return { min, max, price: priceVal };
        });
    }).catch(() => []);

    // Dimensions
    let dimensionsText = $('div.bac-item-label:contains("Package Size")')
        .parent()
        .find('div.bac-item-value')
        .text()
        .trim();
    let dimensions = dimensionsText
        ? dimensionsText.replace(/cm/g, '').replace(/\*/g, 'x').trim()
        : '';

    // Weight
    let weightText = $('div.bac-item-label:contains("Weight")')
        .parent()
        .find('div.bac-item-value')
        .text()
        .trim();
    let weight = weightText
        ? parseFloat(weightText.match(/(\d+\.?\d*)/)?.[1]) || 0
        : 0;

    // Images
    let images = [];
    $('img.J-picImg-zoom-in').each(function () {
        let imgUrl = $(this).attr('src') || $(this).attr('data-src');
        if (imgUrl) {
            images.push(imgUrl.startsWith('http') ? imgUrl : 'https:' + imgUrl);
        }
    });

    // Characteristics
    let characteristics = [];
    $('div.sr-layout-subblock:first-child div.bsc-item').each(function () {
        let attrName = $(this).find('div.bac-item-label').text().trim();
        let attrValue = $(this).find('div.bac-item-value').text().trim();

        if (attrName && attrValue) {
            characteristics.push({ attrName, attrValue });
        }
    });

    // Product ID
    const productId = url.split('/')[4] || '';

    const result = {
        url,
        finalUrl: currentUrl,
        title: title || 'Title not found',
        price: price || 0,
        productLadderPrices: productLadderPrices || [],
        moq: 1,
        dimensions: dimensions || '',
        weight: weight || 0,
        images: images || [],
        characteristics: characteristics || [],
        productId: productId || '',
        scrapedAt: new Date().toISOString(),
    };

    // Si no encontró el título, guardamos el HTML para debug
    if (result.title === 'Title not found') {
        await Dataset.pushData({
            ...result,
            status: 'title_not_found',
            htmlLength: html.length,
        });
        log.warning(`⚠️ Title not found — HTML length: ${html.length}`);
    } else {
        await Dataset.pushData(result);
        log.info(`✅ ${result.title} | ${result.images.length} images | $${result.price}`);
    }
});