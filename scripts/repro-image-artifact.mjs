// v1.16.0 I3 repro — 이미지 저장 PNG 내부 artifact 자동 캡처 + 다크픽셀 bbox 측정.
//
// 사용법:
//   node scripts/repro-image-artifact.mjs [--out=docs/review/v1160-i3/before] [--headless]
//
// 4 팔레트 × light/dark = 8 스냅샷 저장. PNG 디코드는 playwright 내장 canvas 로.

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dummy = require('./dummy-data.js');

const EXT = path.resolve(__dirname, '..');
const argMap = Object.fromEntries(process.argv.slice(2)
  .map(a => a.startsWith('--') ? a.slice(2).split('=') : [a, true]));
const OUT = path.resolve(EXT, argMap.out || 'docs/review/v1160-i3/before');
const HEADLESS = argMap.headless === 'true' || argMap.headless === true;
fs.mkdirSync(OUT, { recursive: true });

const PALETTES = ['default', 'sakura', 'pastel', 'night'];
const THEMES = ['light', 'dark'];
const VP = { width: 1400, height: 900 };

const wait = ms => new Promise(r => setTimeout(r, ms));

function nowStr() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(`[${nowStr()}]`, ...a); }

// 다크-픽셀 bbox 측정 — PNG 파일을 base64 data URL 로 인코딩해 canvas 에 로드.
// body 영역만 (헤더 아래, 푸터 위) 스캔.
async function analyzeDarkBox(page, pngPath, themeIsDark) {
  const bytes = fs.readFileSync(pngPath);
  const dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
  return await page.evaluate(async ({ url, themeIsDark }) => {
    const img = new Image();
    img.src = url;
    await new Promise(r => { img.onload = r; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    // body 영역: y ∈ [160, height-80] 대략. 헤더는 40+28+44≈112, 여유 160 부터.
    const yStart = Math.round(img.height * 0.15);
    const yEnd = Math.round(img.height * 0.92);
    const xStart = Math.round(img.width * 0.06);
    const xEnd = Math.round(img.width * 0.94);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    // 배경 픽셀 luma 추정: 첫 20x20 sample (좌측 여백) 평균.
    let bgR = 0, bgG = 0, bgB = 0, n = 0;
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) {
        const i = (y * img.width + x) * 4;
        bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2]; n++;
      }
    }
    bgR /= n; bgG /= n; bgB /= n;
    const bgLuma = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    // 이상치: body 영역 내 bgLuma 대비 |Δluma| > 40 픽셀 모음.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
    for (let y = yStart; y < yEnd; y += 2) {
      for (let x = xStart; x < xEnd; x += 2) {
        const i = (y * img.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        // 강연 블록은 채도 높음 (R/G/B 차이 > 20). 중성 회색/어두운 사각형은 채도 낮음.
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        const sat = maxC - minC;
        const lumaDelta = themeIsDark ? (luma - bgLuma) : (bgLuma - luma);
        // "artifact" 조건: 배경 대비 luma 가 크게 다르면서 채도 낮은 (즉 블록 아님) 픽셀.
        if (lumaDelta > 40 && sat < 30) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    return { bgLuma: Math.round(bgLuma), suspiciousPx: count,
      bbox: count > 0 ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null,
      imgSize: { w: img.width, h: img.height } };
  }, { url: dataUrl, themeIsDark });
}

async function captureOne(ctx, extId, palette, themeMode, outDir) {
  const page = await ctx.newPage();
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') log(`    [${palette}-${themeMode}][${t}]`, m.text().slice(0, 200));
  });
  page.on('pageerror', e => log(`    [${palette}-${themeMode}][pageerror]`, String(e).slice(0, 200)));
  await page.setViewportSize(VP);
  try {
    await page.goto(`chrome-extension://${extId}/timetable/timetable.html`,
      { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) { /* service worker race */ }
  // inject dummy + settings
  await page.evaluate(({ data, palette, themeMode }) => new Promise(r => chrome.storage.local.clear(() => {
    const settings = {
      ...data.settings, palette, themeMode,
      timetableCoachmarkSeen: true, popupCoachmarkSeen: true,
    };
    chrome.storage.local.set({
      lectures: data.lectures, favorites: data.favorites, meta: data.meta, settings,
    }, r);
  })), { data: dummy, palette, themeMode });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(1600);

  // 테마가 'light'/'dark' 이면 즉시 적용 (auto 대신). html2canvas 전에 확실히.
  await page.evaluate(({ themeMode }) => {
    document.documentElement.dataset.theme = themeMode;
  }, { themeMode });
  await wait(200);

  // 다운로드 대기
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  // ⋯ 메뉴 열고 '이미지로 저장' 클릭
  await page.click('#menuBtn');
  await wait(400);
  const menuVisible = await page.$eval('#menuDropdown', el => el.style.display !== 'none');
  log(`    [${palette}-${themeMode}] menu visible=${menuVisible}`);
  await page.click('.menu-item[data-action="image"]');
  log(`    [${palette}-${themeMode}] clicked image`);

  const dl = await downloadPromise;
  const target = path.join(outDir, `repro-${palette}-${themeMode}.png`);
  await dl.saveAs(target);
  log(`saved ${path.basename(target)}`);
  await page.close();

  // 분석 — 확장 CSP 회피 위해 별도 about:blank 페이지에서 수행
  const apage = await ctx.newPage();
  await apage.goto('about:blank');
  const analysis = await analyzeDarkBox(apage, target, themeMode === 'dark');
  await apage.close();
  return { path: target, analysis };
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-repro-i3-'));
  log('launching chromium, ext:', EXT, 'out:', OUT, 'headless:', HEADLESS);
  const ctx = await chromium.launchPersistentContext(TMP, {
    headless: HEADLESS,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
    ],
    viewport: VP,
    acceptDownloads: true,
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const extId = sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
  log('extension id:', extId);

  const results = [];
  for (const p of PALETTES) {
    for (const t of THEMES) {
      try {
        const r = await captureOne(ctx, extId, p, t, OUT);
        results.push({ palette: p, theme: t, ...r });
      } catch (e) {
        log(`FAIL ${p}-${t}:`, e?.message || e);
        results.push({ palette: p, theme: t, error: String(e?.message || e) });
      }
    }
  }

  const report = results.map(r => {
    if (r.error) return `${r.palette}-${r.theme}  ERROR: ${r.error}`;
    const a = r.analysis;
    const bbox = a.bbox ? `bbox=(${a.bbox.x},${a.bbox.y} ${a.bbox.w}x${a.bbox.h})` : 'clean';
    return `${r.palette.padEnd(8)} ${r.theme.padEnd(5)}  bg=${a.bgLuma.toString().padStart(3)}  px=${String(a.suspiciousPx).padStart(5)}  ${bbox}`;
  }).join('\n');
  const reportPath = path.join(OUT, 'analysis.txt');
  fs.writeFileSync(reportPath, report + '\n');
  log('\n--- ANALYSIS ---\n' + report);
  log('wrote', reportPath);

  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
