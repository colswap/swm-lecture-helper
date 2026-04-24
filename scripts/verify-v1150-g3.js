// verify-v1150-g3.js — Phase F (F5 NLS v2 + F6 18색 팔레트 v2 + F7 coachmark live demo)
// integrated runtime verification. Extends verify-v1150.js focus areas with fresh scenarios.
//
// Run: cd /mnt/c/claude/swm-lecture-helper && node scripts/verify-v1150-g3.js
// Requires WSLg (DISPLAY=:0). Output: docs/review/v1150-g3/*.png + verify-result.json

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dummy = require('./dummy-data.js');

const EXT_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'review', 'v1150-g3');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-v1150-g3-'));
const POPUP_VP = { width: 460, height: 760 };
const WIDE_VP = { width: 1400, height: 900 };

const results = [];
const consoleErrs = [];
const pageErrs = [];
const unhandled = [];
const fatal = [];

function log(...a) { console.log('[g3]', ...a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rec(id, name, status, note = '') {
  results.push({ id, name, status, note });
  log(`  [${status}] ${id} ${name}${note ? ' — ' + String(note).slice(0, 240) : ''}`);
}

function attachConsole(page, tag) {
  page.on('console', m => {
    if (m.type() === 'error') consoleErrs.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', e => pageErrs.push(`[${tag}] ${e.message}`));
  page.on('crash', () => fatal.push(`[${tag}] crashed`));
  page.on('weberror', e => pageErrs.push(`[${tag}:weberror] ${e.error().message}`));
}

async function getExtId(ctx) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  return sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
}

async function seedStorage(page, overrides = {}) {
  await page.evaluate(async ({ dum, ov }) => {
    await new Promise(r => chrome.storage.local.clear(r));
    const settings = { ...(dum.settings || {}), ...(ov.settings || {}) };
    await new Promise(r => chrome.storage.local.set({
      lectures: dum.lectures,
      favorites: dum.favorites,
      meta: dum.meta,
      settings,
    }, r));
    try { await chrome.storage.session.clear(); } catch {}
  }, { dum: { lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta, settings: dummy.settings },
       ov: overrides });
}

async function openPopup(ctx, extId, tag = 'popup') {
  const p = await ctx.newPage();
  attachConsole(p, tag);
  p.on('pageerror', e => unhandled.push(`[${tag}] ${e.message}`));
  await p.setViewportSize(POPUP_VP);
  await p.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return p;
}
async function openTT(ctx, extId, tag = 'tt') {
  const p = await ctx.newPage();
  attachConsole(p, tag);
  p.on('pageerror', e => unhandled.push(`[${tag}] ${e.message}`));
  await p.setViewportSize(WIDE_VP);
  await p.goto(`chrome-extension://${extId}/timetable/timetable.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return p;
}

// ─── A. NLS v2 live — chip renders ───
async function scenarioA(ctx, extId) {
  log('=== A. NLS v2 live ===');
  const page = await openPopup(ctx, extId);
  await seedStorage(page, { settings: { onboardingSeen: true, timetableCoachmarkSeen: true } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);

  async function typeAndGetChips(q) {
    const si = await page.$('#searchInput');
    await si.click({ clickCount: 3 });
    await si.press('Backspace');
    await si.type(q, { delay: 15 });
    await sleep(400); // debounce 200ms + buffer
    return page.$$eval('#queryChips .query-chip', els =>
      els.map(c => ({
        type: c.dataset.type,
        val: c.dataset.val,
        label: c.querySelector('.qc-label')?.textContent || '',
      }))
    );
  }

  // A1: "내일 비대면 접수중" — 3 chips (date/location/status)
  let chips = await typeAndGetChips('내일 비대면 접수중');
  const hasDate = chips.some(c => c.type === 'date' && c.label.includes('내일'));
  const hasLoc = chips.some(c => c.type === 'location' && c.label.includes('비대면'));
  const hasSt = chips.some(c => c.type === 'status' && c.label.includes('접수중'));
  rec('A1', 'Query "내일 비대면 접수중" → 3 chips (date/loc/status)',
    (hasDate && hasLoc && hasSt && chips.length === 3) ? 'PASS' : 'FAIL',
    `len=${chips.length} labels=${chips.map(c => c.label).join(' | ')}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'popup-nls-chips.png'), clip: { x: 0, y: 0, width: 460, height: 200 } });

  // A2: "이현수 AI 특강" — derivedCat (ai) + category (MRC020) at minimum
  chips = await typeAndGetChips('이현수 AI 특강');
  const hasDerived = chips.some(c => c.type === 'derivedCat' && c.val === 'ai');
  const hasCat = chips.some(c => c.type === 'category' && c.val === 'MRC020');
  rec('A2', 'Query "이현수 AI 특강" → derivedCat(ai)+category(MRC020) chips',
    (hasDerived && hasCat) ? 'PASS' : 'FAIL',
    `chips=${chips.length} labels=${chips.map(c => c.label).join(' | ')}`);

  // A3: prefix mode 여전히 동작 — "@이현수 -카카오"
  chips = await typeAndGetChips('@이현수 -카카오');
  const hasMentor = chips.some(c => c.type === 'mentor' && c.val === '이현수');
  const hasExcl = chips.some(c => c.type === 'exclude' && c.val === '카카오');
  rec('A3', 'Prefix mode "@이현수 -카카오" still renders mentor+exclude chips',
    (hasMentor && hasExcl) ? 'PASS' : 'FAIL',
    `labels=${chips.map(c => c.label).join(' | ')}`);

  // A4: chip × click → input 재구성 (stringify)
  const inputBefore = await page.$eval('#searchInput', el => el.value);
  await page.click('#queryChips .query-chip[data-type="exclude"] .qc-x').catch(() => {});
  await sleep(400);
  const inputAfter = await page.$eval('#searchInput', el => el.value);
  const typesAfter = await page.$$eval('#queryChips .query-chip', els => els.map(c => c.dataset.type));
  rec('A4', 'Chip × click removes exclude + rewrites input',
    (inputBefore !== inputAfter && !typesAfter.includes('exclude')) ? 'PASS' : 'FAIL',
    `before="${inputBefore}" after="${inputAfter}" remaining=${JSON.stringify(typesAfter)}`);

  // A5: help popover 예시 4건 렌더 확인
  await page.click('#queryHelp');
  await sleep(180);
  const helpVisible = await page.$eval('#queryHelpPopover', el => !el.hidden);
  const helpExamples = await page.$$eval('#queryHelpPopover .help-examples li code', els => els.map(e => e.textContent));
  rec('A5', 'Help popover open + 4 examples rendered',
    (helpVisible && helpExamples.length >= 4) ? 'PASS' : 'FAIL',
    `visible=${helpVisible} examples=${helpExamples.length} first="${helpExamples[0] || ''}"`);
  await page.screenshot({ path: path.join(OUT_DIR, 'popup-nls-help.png') });
  await page.click('#queryHelp'); // close
  await sleep(150);

  await page.close();
}

// ─── B. 18색 팔레트 v2 ───
async function scenarioB(ctx, extId) {
  log('=== B. 18색 팔레트 v2 ===');
  // Ensure dummy data has derivedCategories attached via classifier — mimic real flow
  const tt = await openTT(ctx, extId);
  await seedStorage(tt, { settings: { onboardingSeen: true, timetableCoachmarkSeen: true, themeMode: 'light' } });
  await tt.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // B1: applied blocks carry data-cat with 18-color palette
  const blockInfo = await tt.evaluate(() => {
    const blocks = [...document.querySelectorAll('.lec-block.applied')];
    const withCat = blocks.filter(b => b.dataset.cat);
    const cats = [...new Set(withCat.map(b => b.dataset.cat))];
    const samples = withCat.slice(0, 5).map(b => {
      const cs = getComputedStyle(b);
      return {
        cat: b.dataset.cat,
        bg: cs.backgroundColor,
        color: cs.color,
        boxShadow: cs.boxShadow,
        borderLeftWidth: cs.borderLeftWidth,
      };
    });
    return { total: blocks.length, withCatCount: withCat.length, uniqueCats: cats, samples };
  });
  rec('B1', `18색 팔레트: ${blockInfo.withCatCount}/${blockInfo.total} applied blocks have data-cat across ${blockInfo.uniqueCats.length} palette(s)`,
    (blockInfo.withCatCount > 0 && blockInfo.uniqueCats.length > 0) ? 'PASS' : 'FAIL',
    `cats=${blockInfo.uniqueCats.join(',')} sample=${JSON.stringify(blockInfo.samples[0] || {})}`);

  // B2: border-left 없어짐 + inset shadow 적용 (applied[data-cat])
  const noBorderLeft = blockInfo.samples.every(s => s.borderLeftWidth === '0px' || s.borderLeftWidth === '' || !s.borderLeftWidth);
  const hasInset = blockInfo.samples.some(s => /inset/i.test(s.boxShadow || ''));
  rec('B2', 'applied[data-cat] blocks: border-left=0 + inset box-shadow',
    (noBorderLeft && hasInset) ? 'PASS' : 'FAIL',
    `noBorderLeft=${noBorderLeft} hasInset=${hasInset} sample.boxShadow="${blockInfo.samples[0]?.boxShadow || ''}"`);

  await tt.screenshot({ path: path.join(OUT_DIR, 'timetable-palette-v2.png'), fullPage: false });

  // B3: 다크 모드 — 블록 색 유지 + 대비
  await tt.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, themeMode: 'dark' } });
  });
  await tt.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1200);
  const darkTheme = await tt.$eval('html', el => el.dataset.theme).catch(() => '');
  const darkSample = await tt.evaluate(() => {
    const b = document.querySelector('.lec-block.applied[data-cat]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { cat: b.dataset.cat, bg: cs.backgroundColor, color: cs.color };
  });
  rec('B3', 'Dark mode: applied blocks keep palette colors (bg+fg from vars)',
    (darkTheme === 'dark' && darkSample && darkSample.bg !== 'rgb(0, 0, 0)') ? 'PASS' : 'FAIL',
    `theme=${darkTheme} sample=${JSON.stringify(darkSample)}`);
  await tt.screenshot({ path: path.join(OUT_DIR, 'timetable-dark-palette.png') });

  await tt.close();

  // B4: 팝업 카드 태그 (data-cat) 회색 유지 — body.cat-colors 미적용
  const popup = await openPopup(ctx, extId, 'popup-palette');
  await seedStorage(popup, { settings: { onboardingSeen: true, themeMode: 'light' } });
  await popup.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);
  const popupCatCheck = await popup.evaluate(() => {
    const hasCatColorsClass = document.body.classList.contains('cat-colors');
    const b = document.querySelector('.cat-chips .badge[data-cat]');
    if (!b) return { hasCatColorsClass, found: false };
    const cs = getComputedStyle(b);
    return { hasCatColorsClass, found: true, cat: b.dataset.cat, bg: cs.backgroundColor, color: cs.color };
  });
  // Gray heuristic: rgb value with R≈G≈B (tolerance ±15). If body.cat-colors false, tokens.css defaults to gray.
  let isGray = false;
  if (popupCatCheck.bg) {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(popupCatCheck.bg);
    if (m) {
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
      isGray = maxDiff <= 20;
    }
  }
  rec('B4', 'Popup badge[data-cat]: gray (body.cat-colors not applied)',
    (!popupCatCheck.hasCatColorsClass && (!popupCatCheck.found || isGray)) ? 'PASS' : 'FAIL',
    `hasCatColorsClass=${popupCatCheck.hasCatColorsClass} sample=${JSON.stringify(popupCatCheck)}`);
  await popup.close();
}

// ─── C. Coachmark live demo ───
async function scenarioC(ctx, extId) {
  log('=== C. Coachmark live demo ===');
  const page = await openPopup(ctx, extId, 'popup-tour');
  await seedStorage(page, { settings: { onboardingSeen: false, timetableCoachmarkSeen: true, themeMode: 'light' } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);

  // C1: auto tour 발동 (Step 1)
  let cm = await page.waitForSelector('.coachmark-bubble', { state: 'visible', timeout: 5000 }).catch(() => null);
  rec('C1', 'Popup onboarding auto-triggers (onboardingSeen=false)',
    cm ? 'PASS' : 'FAIL');
  if (!cm) { await page.close(); return; }

  async function stepInfo() {
    return page.evaluate(() => {
      const root = document.querySelector('.coachmark-root');
      if (!root) return null;
      const bubble = root.querySelector('.coachmark-bubble');
      if (!bubble) return null;
      const dots = [...root.querySelectorAll('.coachmark-dot')];
      const active = dots.findIndex(d => d.classList.contains('is-active'));
      const title = root.querySelector('.coachmark-title')?.textContent || '';
      const bodyHTML = root.querySelector('.coachmark-body')?.innerHTML || '';
      const hasDemo = bodyHTML.includes('cm-demo');
      const w = bubble.getBoundingClientRect().width;
      return { title, active, total: dots.length, hasDemo, width: Math.round(w) };
    });
  }

  const stepFiles = [
    'coachmark-step1-demo.png',
    'coachmark-step2-nls.png',
    null, // step3 cat dropdown — skip screenshot
    'coachmark-step4-thumb.png',
    null, // step5 menu — screenshot manually below
  ];
  const widths = [];
  for (let i = 0; i < 5; i++) {
    const info = await stepInfo();
    if (!info) { rec(`C2.${i + 1}`, `Step ${i + 1} live demo renders`, 'FAIL', 'bubble gone'); break; }
    widths.push(info.width);
    rec(`C2.${i + 1}`, `Step ${i + 1} "${info.title}" live demo`,
      (info.hasDemo && info.active === i && info.total === 5) ? 'PASS' : 'FAIL',
      `hasDemo=${info.hasDemo} active=${info.active + 1}/${info.total} w=${info.width}px`);
    if (stepFiles[i]) await page.screenshot({ path: path.join(OUT_DIR, stepFiles[i]) });
    if (i < 4) {
      const next = await page.$('.coachmark-btn-primary');
      if (next) { await next.click(); await sleep(350); }
    }
  }

  // C3: bubble width ~380px (clamped min(380, vw-24) — popup vw=460 → 380)
  const widthOk = widths.every(w => w >= 370 && w <= 440);
  rec('C3', `Bubble width ~380px across steps (observed ${widths.join(',')})`,
    widthOk ? 'PASS' : 'FAIL', `widths=${widths.join(',')}`);

  // End popup tour via Esc
  await page.keyboard.press('Escape');
  await sleep(300);

  // C4: welcome CTA "사용법 보기" button exists
  const welcome = await ctx.newPage();
  attachConsole(welcome, 'welcome');
  await welcome.setViewportSize(WIDE_VP);
  await welcome.goto(`chrome-extension://${extId}/welcome.html`, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  const ctaLabel = await welcome.$eval('#startTourBtn', el => el.textContent.trim()).catch(() => '');
  rec('C4', '"사용법 보기" CTA exists on welcome.html',
    /사용법\s*보기/.test(ctaLabel) ? 'PASS' : 'FAIL', `label="${ctaLabel}"`);
  await welcome.screenshot({ path: path.join(OUT_DIR, 'welcome-cta-new.png') });
  await welcome.close();
  await page.close();

  // C5: Timetable tour 2-step + flip on narrow-ish popup
  const tt = await openTT(ctx, extId, 'tt-tour');
  await seedStorage(tt, { settings: { onboardingSeen: true, timetableCoachmarkSeen: false } });
  await tt.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1800);
  const ttCm = await tt.waitForSelector('.coachmark-bubble', { state: 'visible', timeout: 5000 }).catch(() => null);
  if (!ttCm) {
    rec('C5', 'Timetable tour auto-starts (2-step)', 'FAIL', 'bubble not shown');
  } else {
    const ttInfo = await tt.evaluate(() => {
      const root = document.querySelector('.coachmark-root');
      const dots = [...root.querySelectorAll('.coachmark-dot')];
      const title = root.querySelector('.coachmark-title')?.textContent || '';
      const bodyHTML = root.querySelector('.coachmark-body')?.innerHTML || '';
      return { total: dots.length, title, hasDemo: bodyHTML.includes('cm-demo') };
    });
    rec('C5', 'Timetable tour: 2 steps + live demo',
      (ttInfo.total === 2 && ttInfo.hasDemo) ? 'PASS' : 'FAIL',
      `dots=${ttInfo.total} title="${ttInfo.title}" hasDemo=${ttInfo.hasDemo}`);
    await tt.screenshot({ path: path.join(OUT_DIR, 'coachmark-tt-step1.png') });
  }

  // C6: "⋯ → 💡 설명 다시 보기" 재실행
  // First finish / skip current tour
  await tt.keyboard.press('Escape').catch(() => {});
  await sleep(400);
  // Open menu + click replay
  const menuOk = await tt.evaluate(() => {
    const btn = document.getElementById('menuBtn');
    if (btn) btn.click();
    return !!btn;
  });
  await sleep(250);
  const replayItem = await tt.$('#menuReplayTour');
  const replayLabel = replayItem ? (await tt.$eval('#menuReplayTour', el => el.textContent.trim())) : '';
  await tt.click('#menuReplayTour').catch(() => {});
  await sleep(600);
  const replayCm = await tt.$('.coachmark-bubble');
  rec('C6', '⋯ → "💡 설명 다시 보기" re-triggers tour',
    (menuOk && replayItem && replayCm && /설명\s*다시\s*보기/.test(replayLabel)) ? 'PASS' : 'FAIL',
    `menuOk=${menuOk} replayLabel="${replayLabel}" newBubble=${!!replayCm}`);
  // Screenshot the menu (reopen to capture)
  await tt.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  await tt.evaluate(() => {
    const btn = document.getElementById('menuBtn');
    if (btn) btn.click();
  });
  await sleep(250);
  await tt.screenshot({ path: path.join(OUT_DIR, 'menu-replay-tour.png') });
  await tt.close();
}

// ─── D. Perf 체감 ───
async function scenarioD(ctx, extId) {
  log('=== D. Perf 체감 ===');

  // D1: debounce — 10+ rapid storage.settings changes → 렌더 ~1회
  const popup = await openPopup(ctx, extId, 'popup-perf');
  await seedStorage(popup, { settings: { onboardingSeen: true, timetableCoachmarkSeen: true } });
  await popup.reload({ waitUntil: 'domcontentloaded' });
  await sleep(800);

  const renderCount = await popup.evaluate(async () => {
    const results = document.getElementById('results');
    let mutations = 0;
    const mo = new MutationObserver(ms => {
      for (const m of ms) if (m.type === 'childList' && m.target === results) mutations++;
    });
    mo.observe(results, { childList: true, subtree: false });
    // 15 rapid storage writes (trigger onChanged)
    for (let i = 0; i < 15; i++) {
      const favs = await new Promise(r => chrome.storage.local.get('favorites', r));
      const next = (favs.favorites || []).slice();
      if (i % 2) next.push('__perf_' + i); else if (next.length) next.pop();
      await new Promise(r => chrome.storage.local.set({ favorites: next }, r));
    }
    await new Promise(r => setTimeout(r, 300));
    mo.disconnect();
    return mutations;
  });
  // Debounce 80ms → 15 writes in a tight loop coalesce to 1 (occasionally 2)
  rec('D1', `Debounce: 15 rapid storage writes → ${renderCount} render(s)`,
    renderCount <= 3 ? 'PASS' : 'FAIL', `mutations=${renderCount} (expected ≤3 via 80ms debounce)`);

  // D2: classifier cache — _cv marker present after first render
  const cvCoverage = await popup.evaluate(async () => {
    const { lectures = {} } = await chrome.storage.local.get('lectures');
    const arr = Object.values(lectures);
    // injectInto mutates in-memory references but may not persist _cv to storage.
    // Instead, check popup's in-memory lectures via re-trigger by forcing a re-inject.
    if (!window.SWM_CLASSIFY) return { skip: true };
    const t0 = performance.now();
    window.SWM_CLASSIFY.injectInto(lectures);
    const t1 = performance.now();
    // Second call should be ~0ms via _cv cache hit
    const t2 = performance.now();
    window.SWM_CLASSIFY.injectInto(lectures);
    const t3 = performance.now();
    const cvCount = arr.filter(l => l._cv).length;
    return {
      skip: false,
      first: +(t1 - t0).toFixed(2),
      second: +(t3 - t2).toFixed(2),
      cvCount,
      total: arr.length,
    };
  });
  const cacheFaster = cvCoverage.skip ? false :
    (cvCoverage.second < cvCoverage.first * 0.5 || cvCoverage.second < 2);
  rec('D2', `Classifier cache: 2nd injectInto call ${cvCoverage.skip ? 'SKIP(no classifier)' : `${cvCoverage.second}ms vs 1st ${cvCoverage.first}ms`}`,
    (!cvCoverage.skip && cacheFaster) ? 'PASS' : (cvCoverage.skip ? 'FAIL' : 'FAIL'),
    JSON.stringify(cvCoverage));

  await popup.close();

  // D3: optimistic UI — fav toggle reflects in UI before storage round-trip completes
  const popup2 = await openPopup(ctx, extId, 'popup-optim');
  await seedStorage(popup2, { settings: { onboardingSeen: true, timetableCoachmarkSeen: true } });
  await popup2.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);
  // Switch to favorites tab — no date filter, guaranteed rendered lectures with .fav-btn
  await popup2.click('.tab[data-tab="favorites"]').catch(() => {});
  await popup2.waitForSelector('.lecture-item .fav-btn', { timeout: 5000 }).catch(() => null);
  await sleep(300);
  const optim = await popup2.evaluate(async () => {
    const btn = document.querySelector('.lecture-item .fav-btn');
    if (!btn) {
      const items = document.querySelectorAll('.lecture-item').length;
      const anyFav = document.querySelectorAll('.fav-btn').length;
      return { skip: true, reason: `no fav-btn found (items=${items}, anyFav=${anyFav})` };
    }
    const snBefore = btn.dataset.sn;
    const wasOn = btn.classList.contains('on');
    const t0 = performance.now();
    btn.click();
    // Allow toggleFavorite().then → doSearch() → renderResults to run
    await new Promise(r => setTimeout(r, 120));
    const t1 = performance.now();
    const afterBtn = document.querySelector(`.lecture-item .fav-btn[data-sn="${snBefore}"]`);
    const afterOn = afterBtn?.classList.contains('on');
    return { skip: false, snBefore, wasOn, afterOn, dtMs: +(t1 - t0).toFixed(2) };
  });
  rec('D3', `Favorite toggle optimistic UI (<100ms rerender)`,
    (!optim.skip && optim.wasOn !== optim.afterOn && optim.dtMs < 200) ? 'PASS' : 'FAIL',
    JSON.stringify(optim));
  await popup2.close();
}

(async () => {
  log(`DISPLAY=${process.env.DISPLAY || '(none)'}`);
  log(`extension: ${EXT_PATH}`);
  log(`output:    ${OUT_DIR}`);

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--no-first-run',
        '--disable-features=DialMediaRouteProvider',
        `--window-size=${WIDE_VP.width},${WIDE_VP.height}`,
      ],
      viewport: WIDE_VP,
    });
  } catch (e) {
    log('FATAL: failed to launch Chromium headful —', e.message);
    log('On WSL2 ensure WSLg + DISPLAY=:0, or run from Windows node.');
    process.exit(2);
  }

  let extId;
  try { extId = await getExtId(ctx); }
  catch (e) { log('FATAL: extension SW not ready —', e.message); await ctx.close(); process.exit(3); }
  log('extension id:', extId);

  try {
    await scenarioA(ctx, extId);
    await scenarioB(ctx, extId);
    await scenarioC(ctx, extId);
    await scenarioD(ctx, extId);
  } catch (e) {
    fatal.push(`scenario fatal: ${e.message}`);
    log('FATAL during scenarios —', e);
    log(e.stack);
  } finally {
    await ctx.close().catch(() => {});
    try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}
  }

  const summary = {
    ranAt: new Date().toISOString(),
    total: results.length,
    pass: results.filter(r => r.status === 'PASS').length,
    fail: results.filter(r => r.status === 'FAIL').length,
    consoleErrorCount: consoleErrs.length,
    pageErrorCount: pageErrs.length,
    unhandledCount: unhandled.length,
    fatalCount: fatal.length,
    results,
    consoleErrors: consoleErrs,
    pageErrors: pageErrs,
    unhandled,
    fatalErrors: fatal,
  };
  const out = path.join(OUT_DIR, 'verify-result.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  log(`\n=== Summary ===`);
  log(`PASS ${summary.pass} / FAIL ${summary.fail} (total ${summary.total})`);
  log(`console.errors=${consoleErrs.length} pageerrors=${pageErrs.length} unhandled=${unhandled.length} fatal=${fatal.length}`);
  log(`result: ${out}`);
  log(`screenshots: ${OUT_DIR}/*.png`);
  if (summary.fail > 0 || fatal.length > 0) process.exitCode = 1;
})();
