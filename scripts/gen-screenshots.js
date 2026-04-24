// Chrome Web Store 용 스크린샷 5장 생성.
// 본인 프로필과 격리된 임시 디렉토리에서 확장 로드 → 더미 데이터 주입 → 캡처.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dummy = require('./dummy-data.js');

const EXT_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(__dirname, '..', 'store_screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-ext-ss-'));

const VIEWPORT = { width: 1280, height: 800 };

async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getExtensionId(ctx) {
  // MV3 서비스워커에서 ID 추출
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const m = sw.url().match(/chrome-extension:\/\/([^/]+)\//);
  return m[1];
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css" rel="stylesheet">
    <style>
    html,body{margin:0;padding:0;width:1280px;height:800px;overflow:hidden;
      font-family:'Pretendard Variable','Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;
      -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;
    }
    body{
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #60a5fa 100%);
      display:flex;align-items:center;justify-content:center;gap:90px;
    }
    .panel{color:white;max-width:420px}
    .panel h1{
      font-size:50px;font-weight:800;margin:0 0 22px;
      letter-spacing:-1.5px;line-height:1.12;
    }
    .panel h1 .accent{color:#fde047}
    .panel p{
      font-size:19px;line-height:1.65;opacity:0.94;margin:0 0 12px;
      font-weight:500;letter-spacing:-0.3px;
    }
    .panel p .hl{font-weight:700;color:#fef08a}
    .shot{
      box-shadow: 0 40px 90px rgba(0,0,0,0.45), 0 12px 35px rgba(0,0,0,0.3);
      border-radius:14px;
      overflow:hidden;
      background:white;
      border: 1px solid rgba(255,255,255,0.3);
    }
    .shot img{display:block;width:420px;height:auto}
    </style></head><body>
    <div class="panel">
      <h1>SWM 강연을<br/><span class="accent">더 빠르게</span></h1>
      <p><span class="hl">실시간 검색</span>과 다중 필터</p>
      <p>즐겨찾기 · 내 신청 한 눈에</p>
      <p>비대면 / 대면 · 날짜 범위 선택</p>
    </div>
    <div class="shot"><img src="data:image/png;base64,${base64}"/></div>
  </body></html>`;
  const page = await ctx.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  // 웹폰트 명시적 로딩
  await page.evaluate(async () => {
    try {
      await document.fonts.load('800 50px "Pretendard Variable"');
      await document.fonts.load('700 19px "Pretendard Variable"');
    } catch {}
    await document.fonts.ready;
  });
  await waitMs(800);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, ...VIEWPORT } });
  await page.close();
}

(async () => {
  console.log('[ss] launching chromium with extension loaded (headful)...');
  const ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
    headless: false,  // MV3 extensions need headful
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--disable-features=DialMediaRouteProvider',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
    viewport: VIEWPORT,
  });

  const extId = await getExtensionId(ctx);
  console.log('[ss] extension ID:', extId);

  // ── 1. 팝업 ──
  console.log('[ss] 1/6: popup');
  const popupTab = await ctx.newPage();
  await popupTab.setViewportSize({ width: 420, height: 720 });
  try {
    await popupTab.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
  } catch (e) {
    console.log('[ss] popup nav timeout, retry once:', e.message);
    await waitMs(1000);
    await popupTab.goto(`chrome-extension://${extId}/popup/popup.html`, {
      waitUntil: 'domcontentloaded', timeout: 15000,
    });
  }
  await waitMs(500);
  await injectDummy(popupTab);
  await popupTab.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(1200);
  const bodyHeight = await popupTab.evaluate(() => {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
  });
  const clipH = Math.min(Math.max(bodyHeight, 660), 720);
  await popupTab.setViewportSize({ width: 420, height: clipH });
  await waitMs(400);
  const popupRaw = path.join(OUT_DIR, '_popup_raw.png');
  await popupTab.screenshot({ path: popupRaw, clip: { x: 0, y: 0, width: 420, height: clipH } });
  await popupTab.close();

  // 1.png: 팝업을 1280x800 에 합성
  await compositePopupOnto1280(ctx, popupRaw, path.join(OUT_DIR, '1_popup.png'));
  fs.unlinkSync(popupRaw);

  // ── 2. 시간표 + NLS 칩 (자연어 검색) ──
  console.log('[ss] 2/6: timetable + NLS chips');
  const ttTab = await ctx.newPage();
  await ttTab.setViewportSize(VIEWPORT);
  await ttTab.goto(`chrome-extension://${extId}/timetable/timetable.html`);
  await injectDummy(ttTab);
  await ttTab.reload();
  await waitMs(1500);
  // 자연어 쿼리 입력 → chips 생성
  await ttTab.click('#searchInput').catch(() => {});
  await ttTab.fill('#searchInput', '내일 비대면 AI');
  await ttTab.keyboard.press('Enter');
  await waitMs(800);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '2_timetable_basic.png'), fullPage: false });
  // 쿼리 클리어 (다음 시나리오 영향 방지)
  await ttTab.fill('#searchInput', '');
  await ttTab.keyboard.press('Enter');
  await waitMs(400);

  // ── 3. 상세검색 ON + 빈 시간 전체 선택 ──
  console.log('[ss] 3/6: drag slot selection');
  await ttTab.click('#advancedToggle').catch(() => {});
  await waitMs(400);
  await ttTab.click('#slotFreeBtn').catch(() => {});
  await waitMs(1000);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '3_slot_selection.png'), fullPage: false });
  // 원상복구
  await ttTab.click('#slotClearBtn').catch(() => {});
  await ttTab.click('#advancedToggle').catch(() => {});
  await waitMs(400);

  // ── 4. 팝오버 (강연 클릭) ──
  console.log('[ss] 4/6: popover');
  // 미래 applied 블록 클릭 → "신청 취소" 버튼 노출 (rose color, 눈에 띔)
  const clicked = await ttTab.evaluate(() => {
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    const blocks = [...document.querySelectorAll('.lec-block.applied')];
    for (const b of blocks) {
      const col = b.closest('.day-column[data-date]');
      if (!col) continue;
      const date = col.dataset.date;
      if (date && date > today) {
        b.click();
        return { date, text: b.textContent?.trim().slice(0, 30) };
      }
    }
    return null;
  });
  console.log('[ss]   clicked block:', clicked);
  await waitMs(1000);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '4_popover.png'), fullPage: false });
  // 팝오버 닫기
  await ttTab.keyboard.press('Escape');
  await waitMs(300);

  // ── 5. 팔레트 테마 모달 ──
  console.log('[ss] 5/6: theme palette modal');
  await ttTab.click('#menuBtn').catch(() => ttTab.click('#fsMenuBtn').catch(() => {}));
  await waitMs(300);
  await ttTab.click('[data-action="palette"]').catch(() => {});
  await waitMs(800);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '5_theme.png'), fullPage: false });
  // 모달 닫기
  await ttTab.keyboard.press('Escape').catch(() => {});
  await waitMs(300);

  // ── 6. 다크 모드 ──
  console.log('[ss] 6/6: dark mode');
  await ttTab.evaluate(() => {
    if (window.SWMTheme && window.SWMTheme.setMode) {
      window.SWMTheme.setMode('dark');
    } else {
      document.documentElement.dataset.theme = 'dark';
    }
  });
  await waitMs(500);
  await ttTab.screenshot({ path: path.join(OUT_DIR, '6_dark_mode.png'), fullPage: false });

  await ctx.close();
  console.log('[ss] done. output:', OUT_DIR);
  console.log(fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).map(f => '  - ' + f).join('\n'));

  // 임시 프로필 정리
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}
})().catch(e => {
  console.error('[ss] ERROR:', e);
  process.exit(1);
});
