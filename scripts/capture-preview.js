// Playwright 로 preview.html 4가지 조합 캡처 (gray/colored × light/dark)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PREVIEW = path.resolve(__dirname, 'preview.html');
const OUT = path.resolve(__dirname, '..', 'docs', 'preview');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  await page.goto('file://' + PREVIEW, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const combos = [
    { name: 'light-gray',    theme: 'light', colors: false },
    { name: 'light-colored', theme: 'light', colors: true },
    { name: 'dark-gray',     theme: 'dark',  colors: false },
    { name: 'dark-colored',  theme: 'dark',  colors: true },
  ];

  for (const c of combos) {
    await page.evaluate(({ theme, colors }) => {
      document.documentElement.dataset.theme = theme;
      document.body.classList.toggle('cat-colors', colors);
    }, c);
    await page.waitForTimeout(200);
    const p = path.join(OUT, `${c.name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    console.log('saved', p);
  }
  await browser.close();
})();
