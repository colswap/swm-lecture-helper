// Connect to user's real Windows Chrome via CDP (remote debugging).
// Windows 폰트 + 이모지 + 렌더링 엔진 그대로 반영.
//
// 전제 조건: 사용자가 Windows PowerShell 에서 아래 명령으로 Chrome 기동 완료:
//   "C:\Program Files\Google\Chrome\Application\chrome.exe" `
//     --remote-debugging-port=9222 `
//     --user-data-dir="$env:TEMP\swm-ss-cdp" `
//     --load-extension="C:\claude\swm-lecture-helper" `
//     --window-size=1280,800

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const dummy = require('./dummy-data.js');

const CDP_URL = process.env.CDP_URL || 'http://localhost:9222';
const OUT_DIR = path.resolve(__dirname, '..', 'store_screenshots_cdp');
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };

async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findExtensionId(ctx, cdpUrl) {
  // CDP /json/list 에서 chrome-extension:// URL 가진 타겟 (service_worker, popup 등) 찾기
  const http = require('http');
  const u = new URL(cdpUrl.replace(/^ws/, 'http'));
  const listUrl = `http://${u.hostname}:${u.port}/json/list`;
  const json = await new Promise((resolve, reject) => {
    http.get(listUrl, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
  // service_worker 우선 (MV3 본인), 그 외 background_page (built-in 가능성) 무시
  for (const t of json) {
    if (t.type !== 'service_worker') continue;
    const m = (t.url || '').match(/^chrome-extension:\/\/([a-p]{32})\//);
    if (m) return m[1];
  }
  // fallback: 아무 chrome-extension URL
  for (const t of json) {
    const m = (t.url || '').match(/^chrome-extension:\/\/([a-p]{32})\//);
    if (m) return m[1];
  }
  return null;
}

async function injectDummy(page) {
  await page.evaluate((data) => new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      chrome.storage.local.set(data, () => resolve());
    });
  }), { lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta, settings: dummy.settings });
}

async function compositePopupOnto1280(ctx, popupPath, outPath) {
  const base64 = fs.readFileSync(popupPath).toString('base64');
  const html = `<!doctype html><html><head>
    <style>
    html,body{margin:0;padding:0;width:1280px;height:800px;overflow:hidden;
      font-family:'Segoe UI','맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;
      -webkit-font-smoothing:antialiased;
    }
    body{
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #60a5fa 100%);
      display:flex;align-items:center;justify-content:center;gap:90px;
    }
    .panel{color:white;max-width:420px}
    .panel h1{font-size:50px;font-weight:800;margin:0 0 22px;letter-spacing:-1.5px;line-height:1.12}
    .panel h1 .accent{color:#fde047}
    .panel p{font-size:19px;line-height:1.65;opacity:0.94;margin:0 0 12px;font-weight:500;letter-spacing:-0.3px}
    .panel p .hl{font-weight:700;color:#fef08a}
    .shot{box-shadow:0 40px 90px rgba(0,0,0,0.45),0 12px 35px rgba(0,0,0,0.3);
      border-radius:14px;overflow:hidden;background:white;border:1px solid rgba(255,255,255,0.3)}
    .shot img{display:block;width:420px;height:auto}
    </style></head><body>
    <div class="panel">
      <h1>SWM 강연을<br/><span class="accent">더 빠르게</span></h1>
      <p><span class="hl">자연어 검색</span> · 4 테마 · 다크 모드</p>
      <p>즐겨찾기 · 내 신청 · 이미지 저장</p>
      <p>비대면 / 대면 · 날짜 범위 · 빈 시간 드래그</p>
    </div>
    <div class="shot"><img src="data:image/png;base64,${base64}"/></div>
  </body></html>`;
  const page = await ctx.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await waitMs(800);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, ...VIEWPORT } });
  await page.close();
}

(async () => {
  console.log(`[ss-cdp] connecting to ${CDP_URL} ...`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    console.error('\nERROR: CDP 연결 실패. Windows Chrome 이 --remote-debugging-port=9222 로 켜져 있는지 확인.');
    console.error(e.message);
    process.exit(1);
  }

  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('ERROR: 기본 context 없음');
    process.exit(1);
  }
  console.log('[ss-cdp] connected. existing pages:', ctx.pages().length);

  const extId = await findExtensionId(ctx, CDP_URL);
  if (!extId) {
    console.error('\nERROR: SWM 확장 못 찾음. --load-extension=C:\\claude\\swm-lecture-helper 로 켰는지 확인.');
    process.exit(1);
  }
  console.log('[ss-cdp] extension ID:', extId);

  // ── 1. 팝업 ──
  console.log('[ss-cdp] 1/6: popup');
  const popupTab = await ctx.newPage();
  await popupTab.setViewportSize({ width: 420, height: 720 });
  await popupTab.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await waitMs(500);
  await injectDummy(popupTab);
  await popupTab.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(1200);
  const popupRaw = path.join(OUT_DIR, '_popup_raw.png');
  await popupTab.screenshot({ path: popupRaw, clip: { x: 0, y: 0, width: 420, height: 720 } });
  await popupTab.close();
  await compositePopupOnto1280(ctx, popupRaw, path.join(OUT_DIR, '1_popup.png'));
  fs.unlinkSync(popupRaw);

  // ── 2. 시간표 + NLS chips ──
  console.log('[ss-cdp] 2/6: timetable + NLS');
  const ttTab = await ctx.newPage();
  await ttTab.setViewportSize(VIEWPORT);
  await ttTab.goto(`chrome-extension://${extId}/timetable/timetable.html`);
  await injectDummy(ttTab);
  await ttTab.reload();
  await waitMs(1500);
  await ttTab.click('#searchInput').catch(() => {});
  await ttTab.fill('#searchInput', '내일 비대면 AI');
  await ttTab.keyboard.press('Enter');
  await waitMs(800);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '2_timetable_basic.png'), fullPage: false });
  await ttTab.fill('#searchInput', '');
  await ttTab.keyboard.press('Enter');
  await waitMs(400);

  // ── 3. 드래그 슬롯 선택 ──
  console.log('[ss-cdp] 3/6: drag selection');
  await ttTab.click('#advancedToggle').catch(() => {});
  await waitMs(400);
  await ttTab.click('#slotFreeBtn').catch(() => {});
  await waitMs(1000);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '3_slot_selection.png'), fullPage: false });
  await ttTab.click('#slotClearBtn').catch(() => {});
  await ttTab.click('#advancedToggle').catch(() => {});
  await waitMs(400);

  // ── 4. 팝오버 ──
  console.log('[ss-cdp] 4/6: popover');
  await ttTab.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    const blocks = [...document.querySelectorAll('.lec-block.applied')];
    for (const b of blocks) {
      const col = b.closest('.day-column[data-date]');
      if (col?.dataset.date > today) { b.click(); return; }
    }
  });
  await waitMs(1000);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '4_popover.png'), fullPage: false });
  await ttTab.keyboard.press('Escape');
  await waitMs(300);

  // ── 5. 테마 모달 ──
  console.log('[ss-cdp] 5/6: theme modal');
  await ttTab.click('#menuBtn').catch(() => ttTab.click('#fsMenuBtn').catch(() => {}));
  await waitMs(300);
  await ttTab.click('[data-action="palette"]').catch(() => {});
  await waitMs(800);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '5_theme.png'), fullPage: false });
  await ttTab.keyboard.press('Escape').catch(() => {});
  await waitMs(300);

  // ── 6. 다크 모드 ──
  console.log('[ss-cdp] 6/6: dark mode');
  await ttTab.evaluate(() => {
    if (window.SWMTheme?.setMode) window.SWMTheme.setMode('dark');
    else document.documentElement.dataset.theme = 'dark';
  });
  await waitMs(500);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '6_dark_mode.png'), fullPage: false });

  await ttTab.close();
  await browser.close();
  console.log(`\n[ss-cdp] done. output: ${OUT_DIR}`);
  console.log(fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).map(f => '  - ' + f).join('\n'));
})().catch(e => {
  console.error('[ss-cdp] ERROR:', e);
  process.exit(1);
});
