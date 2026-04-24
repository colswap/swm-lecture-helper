/**
 * Windows Chrome 직접 런칭 → 스토리 있는 CWS 스샷 5종 (1280×800).
 * 폰트·이모지 모두 Windows 실 Chrome 그대로.
 *
 * 실행 (Windows 측 node):
 *   cd C:\claude\swm-lecture-helper
 *   node scripts/gen-store-screenshots.js
 *
 * 또는 WSL 에서:
 *   /mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command "cd C:\claude\swm-lecture-helper; node scripts/gen-store-screenshots.js"
 *
 * 산출: /mnt/c/claude/swm-lecture-helper/store_screenshots/{1..5}_*.png
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const dummy = require('./dummy-data.js');

const EXT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(EXT_DIR, 'store_screenshots');
const PROFILE = path.join(require('os').tmpdir(), 'swm-store-profile');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

// Chrome 135+ 이후 --load-extension 이 dev mode 활성화된 프로필만 허용.
// Preferences 파일에 developer_mode 를 미리 써서 첫 런 즉시 허용 상태로 만든다.
function seedDevMode() {
  const defaultDir = path.join(PROFILE, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  const prefPath = path.join(defaultDir, 'Preferences');
  let pref = {};
  if (fs.existsSync(prefPath)) {
    try { pref = JSON.parse(fs.readFileSync(prefPath, 'utf8')); } catch {}
  }
  pref.extensions = pref.extensions || {};
  pref.extensions.ui = pref.extensions.ui || {};
  pref.extensions.ui.developer_mode = true;
  fs.writeFileSync(prefPath, JSON.stringify(pref));
}
seedDevMode();

const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VP = { width: 1280, height: 800 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function injectDummy(page) {
  await page.evaluate((data) => new Promise((resolve) => {
    chrome.storage.local.clear(() => chrome.storage.local.set(data, () => resolve()));
  }), { lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta, settings: { ...dummy.settings, onboardingSeen: true, timetableCoachmarkSeen: true } });
}

// ─── Hero composite — 팝업 + 시간표 나란히 + 설명 ───
async function composeHero(ctx, popupPath, ttCropPath, outPath) {
  const popupB64 = fs.readFileSync(popupPath).toString('base64');
  const ttB64 = fs.readFileSync(ttCropPath).toString('base64');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI','Malgun Gothic',sans-serif;-webkit-font-smoothing:antialiased}
    html,body{width:1280px;height:800px;overflow:hidden}
    body{
      background: linear-gradient(135deg,#0f172a 0%,#1e3a8a 45%,#2563eb 100%);
      padding:52px 60px;color:#fff;
    }
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;height:100%;align-items:center}
    .left h1{font-size:56px;font-weight:800;letter-spacing:-2px;line-height:1.08;margin-bottom:20px}
    .left h1 .hl{color:#fde047}
    .left p.sub{font-size:20px;opacity:0.9;line-height:1.5;margin-bottom:26px;font-weight:500}
    .left ul{list-style:none;display:grid;gap:10px;font-size:16px}
    .left li{display:flex;align-items:center;gap:10px;font-weight:500}
    .left li .ic{font-size:18px}
    .right{position:relative;display:flex;align-items:center;justify-content:center}
    .shot{border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.5),0 8px 20px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.25)}
    .shot-popup{position:absolute;left:-10px;top:50%;transform:translateY(-50%);width:290px;z-index:2}
    .shot-tt{width:440px;margin-left:130px;z-index:1;transform:rotate(2deg)}
    .shot img{display:block;width:100%;height:auto}
  </style></head><body>
    <div class="grid">
      <div class="left">
        <h1>SWM 강연,<br/><span class="hl">한눈에</span></h1>
        <p class="sub">SW마에스트로 멘토링·특강 검색부터 시간표, 알림, 캘린더 연동까지</p>
        <ul>
          <li><span class="ic">🔍</span> 자연어 검색 + 18색 카테고리 필터</li>
          <li><span class="ic">📅</span> 주간 시간표 · 충돌 감지 · 빈시간 탐색</li>
          <li><span class="ic">⭐</span> 즐겨찾기 · 관심 멘토 알림</li>
          <li><span class="ic">🎨</span> 4종 팔레트 · 다크 모드 · 캘린더 연동</li>
        </ul>
      </div>
      <div class="right">
        <div class="shot shot-tt"><img src="data:image/png;base64,${ttB64}"/></div>
        <div class="shot shot-popup"><img src="data:image/png;base64,${popupB64}"/></div>
      </div>
    </div>
  </body></html>`;
  const page = await ctx.newPage();
  await page.setViewportSize(VP);
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, ...VP } });
  await page.close();
}

// ─── Single feature composite — 좌측 설명 + 우측 스샷 크롭 ───
async function composeFeature(ctx, imgPath, outPath, { title, sub, bullets, accent }) {
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const accentColor = accent || '#fde047';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI','Malgun Gothic',sans-serif;-webkit-font-smoothing:antialiased}
    html,body{width:1280px;height:800px;overflow:hidden}
    body{
      background: linear-gradient(135deg,#fafafa 0%,#f1f5f9 100%);
      padding:70px 60px;color:#0f172a;
    }
    .wrap{display:grid;grid-template-columns:1fr 1.25fr;gap:60px;height:100%;align-items:center}
    .text h2{font-size:48px;font-weight:800;letter-spacing:-1.5px;line-height:1.1;margin-bottom:18px}
    .text h2 .hl{color:${accentColor};background:${accentColor}20;padding:2px 10px;border-radius:10px}
    .text p.sub{font-size:18px;color:#475569;line-height:1.55;margin-bottom:24px;font-weight:500}
    .text ul{list-style:none;display:grid;gap:12px;font-size:15px;color:#334155}
    .text li{display:flex;align-items:flex-start;gap:8px;line-height:1.5}
    .text li::before{content:"✓";color:#2563eb;font-weight:800;flex-shrink:0}
    .shot{border-radius:16px;overflow:hidden;box-shadow:0 28px 70px rgba(15,23,42,0.18),0 6px 16px rgba(15,23,42,0.1);border:1px solid #e2e8f0;background:#fff}
    .shot img{display:block;width:100%;height:auto}
  </style></head><body>
    <div class="wrap">
      <div class="text">
        <h2>${title}</h2>
        <p class="sub">${sub}</p>
        <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
      <div class="shot"><img src="data:image/png;base64,${b64}"/></div>
    </div>
  </body></html>`;
  const page = await ctx.newPage();
  await page.setViewportSize(VP);
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, ...VP } });
  await page.close();
}

// ─── Dark feature composite — 다크 모드용 ───
async function composeDarkFeature(ctx, imgPath, outPath, { title, sub, bullets }) {
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI','Malgun Gothic',sans-serif;-webkit-font-smoothing:antialiased}
    html,body{width:1280px;height:800px;overflow:hidden}
    body{
      background: linear-gradient(135deg,#020617 0%,#0f172a 60%,#1e293b 100%);
      padding:70px 60px;color:#f1f5f9;
    }
    .wrap{display:grid;grid-template-columns:1fr 1.25fr;gap:60px;height:100%;align-items:center}
    .text h2{font-size:48px;font-weight:800;letter-spacing:-1.5px;line-height:1.1;margin-bottom:18px}
    .text h2 .hl{color:#38bdf8}
    .text p.sub{font-size:18px;color:#94a3b8;line-height:1.55;margin-bottom:24px;font-weight:500}
    .text ul{list-style:none;display:grid;gap:12px;font-size:15px;color:#cbd5e1}
    .text li{display:flex;align-items:flex-start;gap:8px;line-height:1.5}
    .text li::before{content:"✓";color:#38bdf8;font-weight:800;flex-shrink:0}
    .shot{border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.6),0 8px 20px rgba(0,0,0,0.4);border:1px solid #334155;background:#0f172a}
    .shot img{display:block;width:100%;height:auto}
  </style></head><body>
    <div class="wrap">
      <div class="text">
        <h2>${title}</h2>
        <p class="sub">${sub}</p>
        <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
      <div class="shot"><img src="data:image/png;base64,${b64}"/></div>
    </div>
  </body></html>`;
  const page = await ctx.newPage();
  await page.setViewportSize(VP);
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, ...VP } });
  await page.close();
}

(async () => {
  // Playwright 번들 Chromium (Windows 네이티브 프로세스) — 시스템 폰트·이모지 동일 사용.
  // 굳이 real Chrome 바이너리 쓰지 않는 이유: Chrome 135+ 은 --load-extension 을 dev mode
  // 활성 프로필에서만 허용하는데, UI 확인이 필요해 headless 런칭에 부적합.
  console.log('[ss] launching Playwright Chromium (Windows font stack)...');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: VP,
    // 기본 --disable-extensions 가 추가되는데 load-extension 과 충돌. 두 개 제외.
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages', '--enable-automation'],
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider,MediaRouter',
    ],
  });

  // service worker 대기 — extension ID 획득. 최대 20초.
  let sw = ctx.serviceWorkers()[0];
  for (let i = 0; i < 80 && !sw; i++) { await sleep(250); sw = ctx.serviceWorkers()[0]; }
  if (!sw) {
    // 진단: 열린 page + SW 상태 덤프
    console.error('[ss] service worker not found. Diagnostic dump:');
    console.error('  serviceWorkers():', ctx.serviceWorkers().map(s => s.url()));
    console.error('  backgroundPages():', ctx.backgroundPages().map(p => p.url()));
    console.error('  pages():', ctx.pages().map(p => p.url()));
    // chrome://extensions 열어서 상태 확인
    const diagPage = await ctx.newPage();
    try {
      await diagPage.goto('chrome://extensions/', { timeout: 5000 });
      await sleep(1000);
      const diagShot = path.join(OUT_DIR, '_diag_extensions.png');
      await diagPage.screenshot({ path: diagShot, fullPage: true });
      console.error('  saved chrome://extensions snapshot →', diagShot);
    } catch (e) {
      console.error('  could not capture diag:', e.message);
    }
    await ctx.close();
    throw new Error('service worker not found — extension failed to load');
  }
  const extId = sw.url().split('/')[2];
  console.log('[ss] extension ID:', extId);

  // ───── 1. Hero: 팝업 + 시간표 크롭 ─────
  console.log('[ss] 1/5: hero (popup + timetable)');
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 420, height: 680 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await sleep(400);
  await injectDummy(popup);
  await popup.reload();
  await sleep(1500);
  const popupPath = path.join(OUT_DIR, '_popup.png');
  await popup.screenshot({ path: popupPath, clip: { x: 0, y: 0, width: 420, height: 680 } });
  await popup.close();

  const tt = await ctx.newPage();
  await tt.setViewportSize(VP);
  await tt.goto(`chrome-extension://${extId}/timetable/timetable.html`);
  await injectDummy(tt);
  await tt.reload();
  await sleep(1800);
  const ttFullPath = path.join(OUT_DIR, '_tt_full.png');
  await tt.screenshot({ path: ttFullPath });
  // 시간표 body 만 크롭 (grid 영역)
  const ttCropPath = path.join(OUT_DIR, '_tt_crop.png');
  await tt.screenshot({ path: ttCropPath, clip: { x: 180, y: 90, width: 880, height: 640 } });
  await composeHero(ctx, popupPath, ttCropPath, path.join(OUT_DIR, '1_hero.png'));

  // ───── 2. 자연어 검색 ─────
  console.log('[ss] 2/5: NLS search');
  await tt.click('#searchInput').catch(() => {});
  await tt.fill('#searchInput', '이번주 비대면 AI');
  await tt.keyboard.press('Enter');
  await sleep(1000);
  const nlsPath = path.join(OUT_DIR, '_nls.png');
  // 좌측 검색 영역 + 일부 리스트 크롭
  await tt.screenshot({ path: nlsPath, clip: { x: 0, y: 0, width: 520, height: 720 } });
  await composeFeature(ctx, nlsPath, path.join(OUT_DIR, '2_search.png'), {
    title: '<span class="hl">자연어</span>로 찾기',
    sub: '"이번주 비대면 AI" — 자연어를 그대로 입력하면 파싱해서 필터가 자동 적용됩니다.',
    bullets: [
      '시간 표현 (이번주 · 내일 · 오늘 밤) · 장소 (비대면 · 대면)',
      '18색 카테고리 태그 + 멘토 이름 퍼지 매칭',
      '칩으로 보이는 해석 결과 — 의도와 일치하는지 즉시 확인',
    ],
    accent: '#2563eb',
  });
  await tt.fill('#searchInput', '');
  await tt.keyboard.press('Enter');
  await sleep(500);

  // ───── 3. 팝오버 (신청 버튼 + 캘린더 버튼) ─────
  console.log('[ss] 3/5: popover');
  // applied 블록 중 하나 클릭
  await tt.evaluate(() => {
    const blocks = [...document.querySelectorAll('.lec-block.applied')];
    const mid = blocks[Math.floor(blocks.length / 2)] || blocks[0];
    if (mid) mid.click();
  });
  await sleep(900);
  const popoverPath = path.join(OUT_DIR, '_popover.png');
  // 팝오버 중심 크롭 — popover 는 중앙에 뜸, 추정 위치
  const bbox = await tt.evaluate(() => {
    const p = document.querySelector('#popover');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height) };
  });
  if (bbox) {
    const pad = 20;
    await tt.screenshot({
      path: popoverPath,
      clip: {
        x: Math.max(0, bbox.x - pad),
        y: Math.max(0, bbox.y - pad),
        width: Math.min(VP.width, bbox.w + pad * 2),
        height: Math.min(VP.height, bbox.h + pad * 2),
      },
    });
  } else {
    await tt.screenshot({ path: popoverPath, clip: { x: 280, y: 120, width: 720, height: 560 } });
  }
  await composeFeature(ctx, popoverPath, path.join(OUT_DIR, '3_popover.png'), {
    title: '<span class="hl">한 클릭</span>으로 신청·캘린더',
    sub: '강의 블록을 누르면 신청·취소·즐겨찾기·Google 캘린더 추가를 한 팝오버에서 처리합니다.',
    bullets: [
      '상태 배지: 접수중 · 마감 · 개설 확정 · 신청 완료',
      '내 신청 강의와 시간 충돌 자동 감지',
      'Google 캘린더 1클릭 추가 (OAuth 불필요)',
    ],
    accent: '#059669',
  });
  await tt.keyboard.press('Escape');
  await sleep(400);

  // ───── 4. 테마 선택 ─────
  console.log('[ss] 4/5: theme modal');
  await tt.click('#menuBtn').catch(() => {});
  await sleep(300);
  await tt.click('[data-action="palette"]').catch(() => {});
  await sleep(900);
  const themePath = path.join(OUT_DIR, '_theme.png');
  const themeBbox = await tt.evaluate(() => {
    const p = document.querySelector('#themeModal');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height) };
  });
  if (themeBbox) {
    const pad = 16;
    await tt.screenshot({
      path: themePath,
      clip: {
        x: Math.max(0, themeBbox.x - pad),
        y: Math.max(0, themeBbox.y - pad),
        width: Math.min(VP.width, themeBbox.w + pad * 2),
        height: Math.min(VP.height, themeBbox.h + pad * 2),
      },
    });
  } else {
    await tt.screenshot({ path: themePath });
  }
  await composeFeature(ctx, themePath, path.join(OUT_DIR, '4_theme.png'), {
    title: '<span class="hl">4종 팔레트</span>',
    sub: '기본·벚꽃·파스텔·다크 플랜 — 용도와 취향에 맞춰 시간표 색상 선택.',
    bullets: [
      '각 테마 18색 카테고리 팔레트, WCAG AA 대비 확보',
      '다크 모드와 독립적으로 조합 가능',
      '미니 프리뷰로 적용 전 즉시 확인',
    ],
    accent: '#db2777',
  });
  await tt.keyboard.press('Escape');
  await sleep(500);

  // ───── 5. 다크 모드 ─────
  console.log('[ss] 5/5: dark mode');
  await tt.evaluate(() => {
    if (window.SWMTheme?.setMode) return window.SWMTheme.setMode('dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await sleep(800);
  const darkPath = path.join(OUT_DIR, '_dark.png');
  await tt.screenshot({ path: darkPath, clip: { x: 120, y: 60, width: 1000, height: 700 } });
  await composeDarkFeature(ctx, darkPath, path.join(OUT_DIR, '5_dark.png'), {
    title: '다크 모드도 <span class="hl">완벽</span>',
    sub: '시스템 설정 자동 추종 + 수동 전환. 팔레트 색·배지·대비 모두 다크 전용으로 재설계.',
    bullets: [
      '카테고리 색상 다크 모드용 재채색 (WCAG AA 보장)',
      '시간선·야간 영역 구분 강조',
      '팝오버·모달·코치마크 모두 다크 일관',
    ],
  });

  // cleanup intermediates
  for (const f of ['_popup.png', '_tt_full.png', '_tt_crop.png', '_nls.png', '_popover.png', '_theme.png', '_dark.png']) {
    try { fs.unlinkSync(path.join(OUT_DIR, f)); } catch {}
  }

  await tt.close();
  await ctx.close();
  console.log('\n[ss] done. Final shots:');
  fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).forEach(f => console.log('  - ' + f));
})().catch(e => {
  console.error('[ss] FAIL:', e);
  process.exit(1);
});
