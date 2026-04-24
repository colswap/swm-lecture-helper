const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PREVIEW = path.resolve(__dirname, 'preview-palette-v4.html');
const OUT = path.resolve(__dirname, '..', 'docs', 'review');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const palettes = ['default', 'sakura', 'pastel', 'night'];
  for (const p of palettes) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 2400 }, deviceScaleFactor: 1 });
    await page.goto('file://' + PREVIEW, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    // Click the actual palette button so JS handler runs (updates swatches + indicator)
    await page.click(`button[data-palette="${p}"]`);
    if (p === 'night') {
      await page.click('#theme-toggle').catch(() => {});
    }
    await page.waitForTimeout(400);
    const out = path.join(OUT, `palette-v5-${p}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved', out);
    await page.close();
  }
  await browser.close();
})();
