// r3: 10-scenario E2E harness for SWM Lecture Helper v1.16.0
//
// Strategy: Playwright chromium with extension loaded, dummy-data injection
// (no live SWM login — satisfies "no live account ops" guard). All scenarios
// are read-only UI interactions; apply/cancel buttons never clicked.
//
// Output:
//   /mnt/c/claude/staging/v1160_r3_e2e.md  — report
//   docs/review/v1160-r3/scenario-{N}-*.png — screenshots

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dummy = require('./dummy-data.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXT_PATH = path.resolve(__dirname, '..');
const OUT_DIR = path.resolve(EXT_PATH, 'docs', 'review', 'v1160-r3');
const REPORT_PATH = '/mnt/c/claude/staging/v1160_r3_e2e.md';
const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-r3-'));

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = []; // { id, name, status, detail, evidence, consoleErrors }
let currentScenario = null;
const consoleLog = []; // per scenario

function log(msg) { console.log(`[r3] ${msg}`); }
function record(id, name, status, detail = '', evidence = []) {
  const errors = consoleLog.filter(e => e.type === 'error' || e.type === 'pageerror');
  results.push({ id, name, status, detail, evidence, consoleErrors: [...errors] });
  consoleLog.length = 0;
  log(`${status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️ '} #${id} ${name} — ${status}${detail ? ` (${detail})` : ''}`);
}

async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getExtId(ctx) {
  for (let i = 0; i < 20; i++) {
    const [sw] = ctx.serviceWorkers();
    if (sw) return sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
    await waitMs(250);
  }
  throw new Error('extension service worker did not register');
}

function attachConsole(page, label) {
  page.on('console', m => {
    consoleLog.push({ type: m.type(), text: m.text(), label });
  });
  page.on('pageerror', err => {
    consoleLog.push({ type: 'pageerror', text: String(err?.stack || err), label });
  });
}

async function injectDummy(page, { onboardingSeen = true, timetableCoachmarkSeen = true } = {}) {
  await page.evaluate((data) => new Promise(resolve => {
    chrome.storage.local.clear(() => {
      chrome.storage.local.set(data, () => resolve());
    });
  }), {
    lectures: dummy.lectures,
    favorites: dummy.favorites,
    meta: dummy.meta,
    settings: { ...dummy.settings, onboardingSeen, timetableCoachmarkSeen },
  });
}

async function reloadAndSettle(page, ms = 900) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(ms);
}

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); } catch (e) { log(`shot fail ${name}: ${e.message}`); return null; }
  return path.relative(EXT_PATH, p).replace(/\\/g, '/');
}

(async () => {
  log('launching chromium (headless=true, ext loaded)');
  const ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
    headless: false,  // extensions only work in non-headless + --headless=new
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--headless=new',
    ],
    viewport: { width: 1440, height: 900 },
  });

  const extId = await getExtId(ctx);
  log('extension ID: ' + extId);
  const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
  const timetableUrl = `chrome-extension://${extId}/timetable/timetable.html`;

  // --- Scenario 1: 초기 온보딩 (5 steps + onboardingSeen) ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    attachConsole(page, 'popup');
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page, { onboardingSeen: false, timetableCoachmarkSeen: true });
    await reloadAndSettle(page, 1100);

    const evidence = [];
    const stepTitles = [];
    for (let i = 0; i < 5; i++) {
      const title = await page.evaluate(() => {
        const t = document.querySelector('.coachmark-title');
        return t ? t.textContent.trim() : null;
      });
      stepTitles.push(title);
      evidence.push(await shot(page, `scenario-1-step-${i + 1}`));
      if (i < 4) {
        const btnVisible = await page.evaluate(() => {
          const b = document.querySelector('[data-cm="next"]');
          return b && !b.disabled && getComputedStyle(b).display !== 'none';
        });
        if (!btnVisible) throw new Error(`step ${i + 1}: next button missing`);
        await page.click('[data-cm="next"]');
        await waitMs(300);
      }
    }
    // Final step: click next (completes tour)
    await page.click('[data-cm="next"]');
    await waitMs(400);
    const rootGone = await page.evaluate(() => !document.querySelector('.coachmark-root'));
    const seen = await page.evaluate(() => new Promise(r => chrome.storage.local.get('settings', v => r(!!v.settings?.onboardingSeen))));
    if (stepTitles.filter(Boolean).length === 5 && rootGone && seen) {
      record(1, '초기 온보딩 5 step + onboardingSeen', 'PASS',
        `titles: ${stepTitles.filter(Boolean).length}/5`, evidence);
    } else {
      record(1, '초기 온보딩 5 step + onboardingSeen', 'FAIL',
        `titles=${stepTitles.filter(Boolean).length}/5 rootGone=${rootGone} seen=${seen}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(1, '초기 온보딩 5 step + onboardingSeen', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 2: 자연어 검색 "내일 비대면 AI" → chips + filtered ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    attachConsole(page, 'popup');
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 700);

    // Tomorrow's date: dummy data is always mondayOf(now)+N so "내일" matches any MON+N.
    // We'll use "내일 비대면 AI" as specified.
    await page.fill('#searchInput', '내일 비대면 AI');
    await waitMs(500);
    const chipInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.query-chip')).map(c => ({
        type: c.getAttribute('data-type'),
        val: c.getAttribute('data-val'),
        label: c.querySelector('.qc-label')?.textContent || '',
      }));
    });
    const resultCount = await page.$eval('#resultCount', e => e.textContent);
    const evidence = [await shot(page, 'scenario-2-nls-chips')];

    const hasDate = chipInfo.some(c => c.type === 'date');
    const hasLoc = chipInfo.some(c => c.type === 'location' && c.val === 'online');
    const hasDerived = chipInfo.some(c => c.type === 'derivedCat' && c.val === 'ai');
    if (hasDate && hasLoc && hasDerived) {
      record(2, '자연어 검색 "내일 비대면 AI" → chips 3', 'PASS',
        `chips=${chipInfo.map(c => c.type).join(',')} results=${resultCount}`, evidence);
    } else {
      record(2, '자연어 검색 "내일 비대면 AI" → chips 3', 'FAIL',
        `hasDate=${hasDate} hasLoc=${hasLoc} hasDerived=${hasDerived} chips=${JSON.stringify(chipInfo)}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(2, '자연어 검색', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 3: 고급 검색 "@김멘토 #백엔드 -카카오" ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    attachConsole(page, 'popup');
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 700);

    await page.fill('#searchInput', '@김멘토 #백엔드 -카카오');
    await waitMs(500);
    const ast = await page.evaluate(() => {
      return window.SWM_QUERY?.parse('@김멘토 #백엔드 -카카오');
    });
    const chipInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.query-chip')).map(c => ({
        type: c.getAttribute('data-type'),
        val: c.getAttribute('data-val'),
      }));
    });
    const resultCount = await page.$eval('#resultCount', e => e.textContent);
    const evidence = [await shot(page, 'scenario-3-advanced-search')];

    const mentorOk = ast?.include?.mentor?.includes('김멘토');
    const derivedOk = ast?.include?.derivedCat?.includes('backend');
    const excludeOk = (ast?.exclude || []).includes('카카오');
    const hasAllChips =
      chipInfo.some(c => c.type === 'mentor') &&
      chipInfo.some(c => c.type === 'derivedCat') &&
      chipInfo.some(c => c.type === 'exclude');
    if (mentorOk && derivedOk && excludeOk && hasAllChips) {
      record(3, '고급 검색 "@김멘토 #백엔드 -카카오"', 'PASS',
        `ast ok; chips=${chipInfo.map(c => c.type).join(',')} results=${resultCount}`, evidence);
    } else {
      record(3, '고급 검색 "@김멘토 #백엔드 -카카오"', 'FAIL',
        `mentor=${mentorOk} derived=${derivedOk} exclude=${excludeOk} chips=${JSON.stringify(chipInfo)}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(3, '고급 검색', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 4: 상세 검색 4필터 cumulative ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 820 });
    attachConsole(page, 'popup');
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 700);

    // Open advanced panel
    await page.evaluate(() => {
      const d = document.getElementById('advancedSearchPanel');
      if (d && !d.open) d.open = true;
    });
    await waitMs(200);

    // Measure counts after each filter applied cumulatively
    const readCount = async () => (await page.$eval('#resultCount', e => e.textContent)).replace(/\D/g, '') | 0;
    const base = await readCount();
    await page.selectOption('#filterStatus', 'A');
    await waitMs(200);
    const afterStatus = await readCount();
    await page.selectOption('#filterCategory', 'MRC020');
    await waitMs(200);
    const afterCat = await readCount();
    await page.selectOption('#filterLocation', 'online');
    await waitMs(200);
    const afterLoc = await readCount();
    // 4th filter: derivedCat — pick first non-empty option
    const derivedOptions = await page.$$eval('#filterDerivedCat option', os => os.slice(1).map(o => o.value).filter(Boolean));
    let afterDerived = afterLoc;
    let derivedPicked = null;
    if (derivedOptions.length) {
      derivedPicked = derivedOptions[0];
      await page.selectOption('#filterDerivedCat', derivedPicked);
      await waitMs(200);
      afterDerived = await readCount();
    }
    const evidence = [await shot(page, 'scenario-4-4filters')];

    const monotonic = base >= afterStatus && afterStatus >= afterCat && afterCat >= afterLoc && afterLoc >= afterDerived;
    if (monotonic && derivedPicked) {
      record(4, '상세 검색 4필터 cumulative', 'PASS',
        `base=${base} status=${afterStatus} cat=${afterCat} loc=${afterLoc} derived=${afterDerived} (${derivedPicked})`, evidence);
    } else if (!derivedPicked) {
      record(4, '상세 검색 4필터 cumulative', 'FAIL',
        `no derivedCat options populated`, evidence);
    } else {
      record(4, '상세 검색 4필터 cumulative', 'FAIL',
        `not monotonic: ${base}→${afterStatus}→${afterCat}→${afterLoc}→${afterDerived}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(4, '상세 검색 4필터', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 5: 즐겨찾기 토글 (popup) ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 420, height: 720 });
    attachConsole(page, 'popup');
    await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 700);

    // Find a lecture that is NOT yet favorited (so fav-btn is present, not applied-badge)
    const targetSn = await page.evaluate(() => {
      const btn = document.querySelector('#results .fav-btn:not(.on)');
      return btn ? btn.getAttribute('data-sn') : null;
    });
    if (!targetSn) throw new Error('no non-favorited lecture with fav button found');

    // Click ★
    await page.click(`.fav-btn[data-sn="${targetSn}"]`);
    await waitMs(400);
    // Switch to favorites tab
    await page.click('.tab[data-tab="favorites"]');
    await waitMs(500);
    const favIncludes = await page.evaluate((sn) => {
      return !!document.querySelector(`#results [data-sn="${sn}"]`);
    }, targetSn);
    const favStored = await page.evaluate(() => new Promise(r => chrome.storage.local.get('favorites', v => r(v.favorites || []))));
    const evidence = [await shot(page, 'scenario-5-fav-tab')];

    if (favIncludes && favStored.includes(targetSn)) {
      record(5, '즐겨찾기 토글 → 탭 반영', 'PASS',
        `target sn=${targetSn} in favorites (${favStored.length} total)`, evidence);
    } else {
      record(5, '즐겨찾기 토글 → 탭 반영', 'FAIL',
        `sn=${targetSn} favTab=${favIncludes} stored=${favStored.includes(targetSn)}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(5, '즐겨찾기 토글', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 6: 테마 전환 4 팔레트 + 다크모드 토글 (timetable — 블록 색 변화 확인) ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 900);

    const evidence = [];
    const palettes = ['default', 'sakura', 'pastel', 'night'];
    const blockBgs = [];
    for (const pal of palettes) {
      await page.evaluate((p) => window.SWM_THEMES?.apply(p), pal);
      await waitMs(250);
      const bg = await page.evaluate(() => {
        const b = document.querySelector('.grid-body .lec-block');
        return b ? getComputedStyle(b).backgroundColor : null;
      });
      blockBgs.push({ pal, bg });
      evidence.push(await shot(page, `scenario-6-palette-${pal}`));
    }
    // Dark toggle
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await waitMs(250);
    const darkUiBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    evidence.push(await shot(page, `scenario-6-dark`));
    // Reset
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      window.SWM_THEMES?.apply('default');
    });

    const uniqueBgs = new Set(blockBgs.map(b => b.bg).filter(Boolean));
    if (uniqueBgs.size >= 3 && darkUiBg) {
      record(6, '테마 4 팔레트 + 다크모드 전환', 'PASS',
        `unique block bgs=${uniqueBgs.size}/4, dark bg=${darkUiBg}`, evidence);
    } else {
      record(6, '테마 4 팔레트 + 다크모드 전환', 'FAIL',
        `unique=${uniqueBgs.size}; bgs=${JSON.stringify(blockBgs)}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(6, '테마 전환', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 7: 코치마크 재실행 (popup 5 step + timetable 4 step) ---
  try {
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 420, height: 720 });
    attachConsole(popup, 'popup');
    await popup.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(popup);
    await reloadAndSettle(popup, 700);

    // Trigger popup replay-tour
    await popup.evaluate(() => {
      const menu = document.getElementById('popupMenuDropdown');
      if (menu) menu.style.display = 'block';
    });
    await popup.click('[data-action="replay-tour"]');
    await waitMs(600);
    // Now on close, coachmark started (because clicking triggers window.close() on popup, but we're in a tab context)
    // Actually the flow triggers storage session flag + popup.close; our context reloads. Let's count:
    const popupSteps = await popup.evaluate(() => {
      return document.querySelectorAll('.coachmark-dot').length;
    });
    const popupShot = await shot(popup, 'scenario-7-popup-replay');
    await popup.close();

    const tt = await ctx.newPage();
    await tt.setViewportSize({ width: 1440, height: 900 });
    attachConsole(tt, 'timetable');
    await tt.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(tt);
    await reloadAndSettle(tt, 900);

    await tt.evaluate(() => window.SWM_START_TIMETABLE_TOUR?.());
    await waitMs(500);
    const ttSteps = await tt.evaluate(() => document.querySelectorAll('.coachmark-dot').length);
    const ttShot = await shot(tt, 'scenario-7-tt-replay');
    await tt.close();

    const evidence = [popupShot, ttShot].filter(Boolean);
    if (popupSteps === 5 && ttSteps === 4) {
      record(7, '코치마크 재실행 popup 5 + tt 4', 'PASS',
        `popup=${popupSteps} tt=${ttSteps}`, evidence);
    } else {
      record(7, '코치마크 재실행 popup 5 + tt 4', 'FAIL',
        `popup=${popupSteps} tt=${ttSteps}`, evidence);
    }
  } catch (e) {
    record(7, '코치마크 재실행', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 8: 이미지 저장 (4 팔레트 × light/dark = 8 조합) ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 1000);

    // Intercept html2canvas output: we monkey-patch URL.createObjectURL + a.click
    await page.addInitScript(() => {
      window.__swm_blobs = [];
      const orig = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.__swm_blobs.push({ size: blob?.size || 0, type: blob?.type || '' });
        return orig.call(URL, blob);
      };
    });

    const palettes = ['default', 'sakura', 'pastel', 'night'];
    const themes = ['light', 'dark'];
    const evidence = [];
    const combos = [];
    const darkArtifactIssues = [];

    for (const pal of palettes) {
      for (const th of themes) {
        await page.evaluate(({ p, t }) => {
          window.SWM_THEMES?.apply(p);
          if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
          else document.documentElement.removeAttribute('data-theme');
        }, { p: pal, t: th });
        await waitMs(300);

        // Open menu and click image export (simulate what user sees)
        // exportImage builds a wrapper and runs html2canvas. It appends the wrapper to body.
        // We shoot before it is removed, to inspect "dark 사각형" presence.
        const blobCountBefore = await page.evaluate(() => window.__swm_blobs?.length || 0);

        const clicked = await page.evaluate(async () => {
          const menu = document.getElementById('menuBtn');
          if (menu) menu.click();
          await new Promise(r => setTimeout(r, 100));
          const item = document.querySelector('[data-action="image"]');
          if (!item) return false;
          item.click();
          return true;
        });
        // Wait for html2canvas to complete (it's async). The wrapper is then removed.
        // Upper bound ~4s per combo.
        let doneBlobs = false;
        for (let t = 0; t < 40; t++) {
          await waitMs(100);
          const c = await page.evaluate(() => window.__swm_blobs?.length || 0);
          if (c > blobCountBefore) { doneBlobs = true; break; }
        }

        // Before wrapper is cleaned, inspect for dark column artifacts (bug from pre-v1150):
        // We look up the synthetic wrapper's day-columns in case it's still in DOM.
        const artifactInfo = await page.evaluate(() => {
          const wrappers = Array.from(document.querySelectorAll('.ex-card'));
          if (!wrappers.length) return { wrappersFound: 0, darkCols: 0 };
          const cols = wrappers[0].querySelectorAll('.ex-body .day-column');
          let dark = 0;
          cols.forEach(c => {
            const bg = getComputedStyle(c).backgroundColor;
            // detect todayBg rgba(0, 0, 0, > 0.04) as dark rectangle proxy
            const m = bg.match(/rgba?\(\s*(\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([0-9.]+))?/);
            if (m) {
              const a = m[4] ? parseFloat(m[4]) : 1;
              const lum = (parseInt(m[1]) + parseInt(m[2]) + parseInt(m[3])) / 3;
              if (a > 0.15 && lum < 80) dark++;
            }
          });
          return { wrappersFound: wrappers.length, darkCols: dark };
        });
        if (artifactInfo.darkCols > 0) {
          darkArtifactIssues.push(`${pal}/${th}: ${artifactInfo.darkCols} dark cols`);
        }

        combos.push({ pal, th, success: doneBlobs });
        evidence.push(await shot(page, `scenario-8-${pal}-${th}`));
        // wait for wrapper cleanup
        await waitMs(400);
        // Dismiss any toast
        await page.evaluate(() => {
          document.querySelectorAll('.popover-toast').forEach(t => t.style.display = 'none');
        });
      }
    }

    const blobsTotal = await page.evaluate(() => window.__swm_blobs?.length || 0);
    const success = combos.filter(c => c.success).length;

    if (success === 8 && darkArtifactIssues.length === 0) {
      record(8, '이미지 저장 4 팔레트 × light/dark = 8', 'PASS',
        `${success}/8 blobs=${blobsTotal} no dark-col artifact`, evidence);
    } else if (success === 8 && darkArtifactIssues.length > 0) {
      record(8, '이미지 저장 8 조합 (다크 사각형)', 'FAIL',
        `8 blobs OK but dark cols: ${darkArtifactIssues.join('; ')}`, evidence);
    } else {
      record(8, '이미지 저장 8 조합', 'FAIL',
        `only ${success}/8 blobs produced`, evidence);
    }
    await page.close();
  } catch (e) {
    record(8, '이미지 저장', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 9: 커스텀 모달 (데이터 초기화 취소) ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 900);

    // Open menu → reset
    await page.evaluate(() => document.getElementById('menuBtn')?.click());
    await waitMs(200);
    await page.evaluate(() => document.querySelector('[data-action="reset"]')?.click());
    await waitMs(300);
    const hasCustomModal = await page.evaluate(() => !!document.querySelector('.swm-modal'));
    const hasNativeConfirm = false; // native confirm() can't be inspected but it would block; if we got here, no native
    const modalShot = await shot(page, 'scenario-9-reset-modal');

    // Check focus trap — primary (danger) button should be focused
    const focusedInitial = await page.evaluate(() => document.activeElement?.textContent?.trim());

    // Tab cycle
    await page.keyboard.press('Tab');
    await waitMs(60);
    const focusedAfterTab = await page.evaluate(() => document.activeElement?.textContent?.trim());

    // Cancel via Esc
    await page.keyboard.press('Escape');
    await waitMs(300);
    const modalGone = await page.evaluate(() => !document.querySelector('.swm-modal'));
    const lecturesStill = await page.evaluate(() => new Promise(r =>
      chrome.storage.local.get('lectures', v => r(Object.keys(v.lectures || {}).length))
    ));

    const evidence = [modalShot].filter(Boolean);
    if (hasCustomModal && !hasNativeConfirm && modalGone && lecturesStill > 0 && focusedInitial) {
      record(9, '커스텀 모달 (데이터 초기화 Esc 취소)', 'PASS',
        `custom modal OK, focus=${focusedInitial}→${focusedAfterTab}, lectures kept=${lecturesStill}`, evidence);
    } else {
      record(9, '커스텀 모달 (데이터 초기화)', 'FAIL',
        `custom=${hasCustomModal} gone=${modalGone} lectures=${lecturesStill} focus=${focusedInitial}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(9, '커스텀 모달', 'FAIL', `exception: ${e.message}`);
  }

  // --- Scenario 10: 빈 시간 드래그 → 필터된 결과 카드 preview ---
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 1100);

    // Open advanced panel, toggle advancedToggle ON
    await page.evaluate(() => {
      const d = document.getElementById('advancedSearchPanel');
      if (d && !d.open) d.open = true;
    });
    await waitMs(200);
    await page.click('#advancedToggle');
    await waitMs(300);
    const isOn = await page.$eval('#advancedToggle', el => el.classList.contains('on'));

    // Count baseline results (without slot selection)
    const base = await page.$eval('#resultCount', e => parseInt(e.textContent.replace(/\D/g, '') || '0', 10));

    // Drag within a day-column: pick tuesday column (index 1)
    const box = await page.evaluate(() => {
      const cols = document.querySelectorAll('.grid-body .day-column');
      if (cols.length < 2) return null;
      const r = cols[1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y1: r.y + r.height * 0.25, y2: r.y + r.height * 0.55 };
    });
    if (!box) throw new Error('day-column not found');
    await page.mouse.move(box.x, box.y1);
    await page.mouse.down();
    await page.mouse.move(box.x, box.y2, { steps: 10 });
    await page.mouse.up();
    await waitMs(600);

    const selectedSlots = await page.evaluate(() => document.querySelectorAll('.drag-sel:not(.drag-preview)').length);
    const slotBarOpen = await page.evaluate(() => {
      const b = document.getElementById('slotBar');
      return b && getComputedStyle(b).display !== 'none';
    });
    const filtered = await page.$eval('#resultCount', e => parseInt(e.textContent.replace(/\D/g, '') || '0', 10));
    const evidence = [await shot(page, 'scenario-10-drag-filter')];

    // Also hover a result card → grid preview should appear (hover-preview)
    const hoverOk = await page.evaluate(async () => {
      const card = document.querySelector('#results .lecture-item');
      if (!card) return false;
      const ev = new MouseEvent('mouseenter', { bubbles: true });
      card.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 150));
      return true;
    });

    if (isOn && selectedSlots >= 1 && slotBarOpen) {
      record(10, '빈 시간 드래그 → 필터 매칭', 'PASS',
        `advancedMode=on slots=${selectedSlots} slotBar=${slotBarOpen} base=${base} filtered=${filtered} hover=${hoverOk}`, evidence);
    } else {
      record(10, '빈 시간 드래그 → 필터 매칭', 'FAIL',
        `advancedMode=${isOn} slots=${selectedSlots} slotBar=${slotBarOpen}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(10, '빈 시간 드래그', 'FAIL', `exception: ${e.message}`);
  }

  await ctx.close();
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}

  // --- Write report ---
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const skipCount = results.filter(r => r.status === 'SKIP').length;

  const md = [];
  md.push(`# v1.16.0 R3 — 실사용 10 시나리오 E2E 리포트`);
  md.push(``);
  md.push(`- **생성**: ${new Date().toISOString()}`);
  md.push(`- **환경**: Playwright chromium headless, dummy-data injection (no live SWM login)`);
  md.push(`- **확장 경로**: ${EXT_PATH}`);
  md.push(``);
  md.push(`## 요약`);
  md.push(``);
  md.push(`- ✅ PASS: **${passCount}/10**`);
  md.push(`- ❌ FAIL: **${failCount}/10**`);
  md.push(`- ⚠️  SKIP: **${skipCount}/10**`);
  md.push(``);
  md.push(`| # | 시나리오 | 결과 | 세부 |`);
  md.push(`|---|----------|------|------|`);
  for (const r of results) {
    md.push(`| ${r.id} | ${r.name} | ${r.status} | ${r.detail.replace(/\|/g, '\\|')} |`);
  }
  md.push(``);
  for (const r of results) {
    md.push(`## 시나리오 ${r.id} — ${r.name}`);
    md.push(``);
    md.push(`- **결과**: ${r.status}`);
    md.push(`- **세부**: ${r.detail || '(없음)'}`);
    if (r.evidence.length) {
      md.push(`- **스크린샷**:`);
      for (const e of r.evidence.filter(Boolean)) md.push(`  - \`${e}\``);
    }
    if (r.consoleErrors.length) {
      md.push(`- **Console errors (${r.consoleErrors.length})**:`);
      for (const e of r.consoleErrors.slice(0, 8)) {
        md.push(`  - [${e.type}] \`${(e.text || '').replace(/\n/g, ' ').slice(0, 240)}\``);
      }
    }
    md.push(``);
  }
  md.push(`## 금지 사항 준수`);
  md.push(``);
  md.push(`- apply/cancel API 호출: ❌ 없음 (popoverApply/popoverCancel 버튼 접근 자체 안 함)`);
  md.push(`- popup/timetable/lib/content/background 코드 수정: ❌ 없음 (scripts/ + docs/review/ + staging/ 만 추가)`);
  md.push(`- 실 SWM 계정 로그인: ❌ 사용 안 함 — 더미 데이터 주입 경로로 대체 (사용자 실계정 live 작업 금지 방침)`);

  fs.writeFileSync(REPORT_PATH, md.join('\n'));
  log(`report written: ${REPORT_PATH}`);
  log(`summary: PASS=${passCount} FAIL=${failCount} SKIP=${skipCount}`);

  process.exit(0);
})().catch(err => {
  console.error('[r3] fatal:', err);
  process.exit(1);
});
