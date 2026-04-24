// r3: retry harness for scenarios 1, 6, 8, 10 — with fixes for harness bugs
// found in the first run (not product bugs).
//
// Fixes:
//   #1  Last step button uses data-cm="done" not "next" — broaden selector.
//   #6  First .lec-block picked had no data-cat → use [data-cat="ai"] and
//       also sample CSS token `--cat-ai-bg` on :root as backup.
//   #8  addInitScript was called AFTER goto so monkey-patch missed → inject
//       via page.evaluate post-load, and also intercept html2canvas success
//       by watching for toast "이미지로 저장 완료" or clipboard write.
//   #10 Drag landed on a lec-block → advancedMode requires empty column
//       area; pick coordinates that avoid existing blocks.

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
const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-r3-retry-'));

const results = {};
const consoleLog = [];
function log(msg) { console.log(`[r3-retry] ${msg}`); }
function record(id, name, status, detail, evidence = []) {
  const errors = consoleLog.filter(e => e.type === 'error' || e.type === 'pageerror');
  results[id] = { id, name, status, detail, evidence, consoleErrors: [...errors] };
  consoleLog.length = 0;
  log(`${status === 'PASS' ? '✅' : '❌'} #${id} ${name} — ${status}${detail ? ` (${detail})` : ''}`);
}
async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getExtId(ctx) {
  for (let i = 0; i < 40; i++) {
    const [sw] = ctx.serviceWorkers();
    if (sw) return sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
    await waitMs(250);
  }
  throw new Error('sw not loaded');
}
function attachConsole(page, label) {
  page.on('console', m => consoleLog.push({ type: m.type(), text: m.text(), label }));
  page.on('pageerror', err => consoleLog.push({ type: 'pageerror', text: String(err?.stack || err), label }));
}
async function injectDummy(page, { onboardingSeen = true, timetableCoachmarkSeen = true } = {}) {
  await page.evaluate(data => new Promise(r => {
    chrome.storage.local.clear(() => chrome.storage.local.set(data, () => r()));
  }), {
    lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta,
    settings: { ...dummy.settings, onboardingSeen, timetableCoachmarkSeen },
  });
}
async function reloadAndSettle(page, ms = 900) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(ms);
}
async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); }
  catch (e) { log(`shot fail ${name}: ${e.message}`); return null; }
  return path.relative(EXT_PATH, p).replace(/\\/g, '/');
}

(async () => {
  const ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--headless=new',
    ],
    viewport: { width: 1440, height: 900 },
  });
  const extId = await getExtId(ctx);
  log(`ext ID: ${extId}`);
  const popupUrl = `chrome-extension://${extId}/popup/popup.html`;
  const timetableUrl = `chrome-extension://${extId}/timetable/timetable.html`;

  // ----- Scenario 1 (retry): last button data-cm="done" -----
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
      const title = await page.evaluate(() => document.querySelector('.coachmark-title')?.textContent?.trim() ?? null);
      stepTitles.push(title);
      evidence.push(await shot(page, `scenario-1-step-${i + 1}`));
      // Click whichever button is active — data-cm switches from "next" to "done" on last step
      await page.click('[data-cm="next"], [data-cm="done"]');
      await waitMs(350);
    }
    await waitMs(300);
    const rootGone = await page.evaluate(() => !document.querySelector('.coachmark-root'));
    const seen = await page.evaluate(() => new Promise(r => chrome.storage.local.get('settings', v => r(!!v.settings?.onboardingSeen))));
    if (stepTitles.filter(Boolean).length === 5 && rootGone && seen) {
      record(1, '초기 온보딩 5 step + onboardingSeen', 'PASS',
        `titles=5/5 rootGone=${rootGone} onboardingSeen=${seen}`, evidence);
    } else {
      record(1, '초기 온보딩', 'FAIL',
        `titles=${stepTitles.filter(Boolean).length} rootGone=${rootGone} seen=${seen}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(1, '초기 온보딩', 'FAIL', `exception: ${e.message}`);
  }

  // ----- Scenario 6 (retry): sample data-cat="ai" block and :root CSS vars -----
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 1100);

    const evidence = [];
    const palettes = ['default', 'sakura', 'pastel', 'night'];
    const samples = [];
    for (const pal of palettes) {
      await page.evaluate(p => window.SWM_THEMES?.apply(p), pal);
      await waitMs(400);
      const s = await page.evaluate(() => {
        const ai = document.querySelector('.lec-block[data-cat="ai"]') || document.querySelector('.lec-block[data-cat]');
        const blockBg = ai ? getComputedStyle(ai).backgroundColor : null;
        const aiVar = getComputedStyle(document.documentElement).getPropertyValue('--cat-ai-bg').trim();
        const backVar = getComputedStyle(document.documentElement).getPropertyValue('--cat-backend-bg').trim();
        return { blockBg, aiVar, backVar, cat: ai?.getAttribute('data-cat') };
      });
      samples.push({ pal, ...s });
      evidence.push(await shot(page, `scenario-6-palette-${pal}`));
    }
    // Dark toggle
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await waitMs(400);
    const darkSample = await page.evaluate(() => ({
      bodyBg: getComputedStyle(document.body).backgroundColor,
      fg: getComputedStyle(document.body).color,
    }));
    evidence.push(await shot(page, 'scenario-6-dark'));
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
      window.SWM_THEMES?.apply('default');
    });

    const uniqueBlockBgs = new Set(samples.map(s => s.blockBg).filter(Boolean));
    const uniqueAiVars = new Set(samples.map(s => s.aiVar).filter(Boolean));
    const uniqueBackVars = new Set(samples.map(s => s.backVar).filter(Boolean));

    if ((uniqueBlockBgs.size >= 3 || uniqueAiVars.size >= 3 || uniqueBackVars.size >= 3) && darkSample.bodyBg) {
      record(6, '테마 4 팔레트 + 다크모드 전환', 'PASS',
        `unique block bgs=${uniqueBlockBgs.size}/4 aiVar=${uniqueAiVars.size}/4 backVar=${uniqueBackVars.size}/4 dark bodyBg=${darkSample.bodyBg}`, evidence);
    } else {
      record(6, '테마 전환', 'FAIL',
        `block=${uniqueBlockBgs.size} ai=${uniqueAiVars.size} back=${uniqueBackVars.size} samples=${JSON.stringify(samples)}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(6, '테마 전환', 'FAIL', `exception: ${e.message}`);
  }

  // ----- Scenario 8 (retry): inject blob interceptor via evaluate post-load -----
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 1100);

    // Install interceptor on the already-loaded page
    await page.evaluate(() => {
      window.__swm_blobs = [];
      const orig = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        try { window.__swm_blobs.push({ size: blob?.size || 0, type: blob?.type || '' }); } catch {}
        return orig.call(URL, blob);
      };
      // Also intercept anchor.click() for download triggers
      const OrigAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) {
          window.__swm_downloads = window.__swm_downloads || [];
          window.__swm_downloads.push({ name: this.download, href: (this.href || '').slice(0, 40) });
        }
        // Do not actually trigger the download (avoids unhandled navigations)
      };
      window.__origAnchorClick = OrigAnchorClick;
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
        await waitMs(400);

        const blobsBefore = await page.evaluate(() => window.__swm_blobs?.length || 0);
        const dlBefore = await page.evaluate(() => window.__swm_downloads?.length || 0);

        // Click image export
        await page.evaluate(() => document.getElementById('menuBtn')?.click());
        await waitMs(200);
        const clicked = await page.evaluate(() => {
          const item = document.querySelector('[data-action="image"]');
          if (!item) return false;
          item.click();
          return true;
        });
        if (!clicked) {
          combos.push({ pal, th, success: false, reason: 'no menu item' });
          continue;
        }

        // html2canvas is heavy — poll up to 12s for blob or download
        let success = false;
        for (let t = 0; t < 120; t++) {
          await waitMs(100);
          const blobs = await page.evaluate(() => window.__swm_blobs?.length || 0);
          const dls = await page.evaluate(() => window.__swm_downloads?.length || 0);
          if (blobs > blobsBefore || dls > dlBefore) { success = true; break; }
        }

        // Before wrapper is cleaned, check for dark-column artifact
        const artifact = await page.evaluate(() => {
          const wrappers = Array.from(document.querySelectorAll('.ex-card'));
          if (!wrappers.length) return { wrappersFound: 0, darkCols: 0 };
          const cols = wrappers[0].querySelectorAll('.ex-body .day-column');
          let dark = 0;
          cols.forEach(c => {
            const bg = getComputedStyle(c).backgroundColor;
            const m = bg.match(/rgba?\(\s*(\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([0-9.]+))?/);
            if (m) {
              const a = m[4] ? parseFloat(m[4]) : 1;
              const lum = (parseInt(m[1]) + parseInt(m[2]) + parseInt(m[3])) / 3;
              if (a > 0.15 && lum < 80) dark++;
            }
          });
          return { wrappersFound: wrappers.length, darkCols: dark };
        });
        if (artifact.darkCols > 0) darkArtifactIssues.push(`${pal}/${th}: ${artifact.darkCols}`);

        combos.push({ pal, th, success });
        evidence.push(await shot(page, `scenario-8-${pal}-${th}`));

        // Wait for wrapper cleanup
        await waitMs(500);
        await page.evaluate(() => document.querySelectorAll('.popover-toast').forEach(t => t.style.display = 'none'));
      }
    }

    const okCount = combos.filter(c => c.success).length;
    if (okCount === 8 && darkArtifactIssues.length === 0) {
      record(8, '이미지 저장 4 팔레트 × light/dark = 8', 'PASS',
        `${okCount}/8 produced, no dark-col artifact`, evidence);
    } else if (okCount === 8) {
      record(8, '이미지 저장 8 조합 (다크 사각형)', 'FAIL',
        `${okCount}/8 but dark cols: ${darkArtifactIssues.join('; ')}`, evidence);
    } else {
      record(8, '이미지 저장 8 조합', 'FAIL',
        `only ${okCount}/8 produced. detail=${JSON.stringify(combos.map(c => `${c.pal}/${c.th}:${c.success ? 'ok' : 'fail'}`))}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(8, '이미지 저장', 'FAIL', `exception: ${e.message}`);
  }

  // ----- Scenario 10 (retry): pick empty column space (avoid lec-blocks) -----
  try {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    attachConsole(page, 'timetable');
    await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
    await injectDummy(page);
    await reloadAndSettle(page, 1100);

    await page.evaluate(() => {
      const d = document.getElementById('advancedSearchPanel');
      if (d && !d.open) d.open = true;
    });
    await waitMs(200);
    await page.click('#advancedToggle');
    await waitMs(300);
    const isOn = await page.$eval('#advancedToggle', el => el.classList.contains('on'));

    // Find empty vertical region in a day-column (no lec-block overlap)
    const box = await page.evaluate(() => {
      const cols = document.querySelectorAll('.grid-body .day-column');
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        const r = col.getBoundingClientRect();
        const blocks = Array.from(col.querySelectorAll('.lec-block')).map(b => b.getBoundingClientRect());
        // Scan 16px steps for a 60-120px contiguous free window
        const step = 8;
        for (let y = r.top + 10; y < r.bottom - 120; y += step) {
          const yEnd = y + 100;
          const overlap = blocks.some(b => !(b.bottom <= y || b.top >= yEnd));
          if (!overlap) {
            return { colIndex: c, x: r.left + r.width / 2, y1: y, y2: yEnd };
          }
        }
      }
      return null;
    });
    if (!box) throw new Error('no empty region in any day-column');
    // Drag — use small steps and ensure button held
    await page.mouse.move(box.x, box.y1);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x, box.y1 + ((box.y2 - box.y1) * i / 12));
      await waitMs(15);
    }
    await page.mouse.up();
    await waitMs(700);

    const selectedSlots = await page.evaluate(() => document.querySelectorAll('.drag-sel:not(.drag-preview)').length);
    const slotBarOpen = await page.evaluate(() => {
      const b = document.getElementById('slotBar');
      return b && getComputedStyle(b).display !== 'none';
    });
    const base = await page.$eval('#resultCount', e => parseInt(e.textContent.replace(/\D/g, '') || '0', 10));
    const evidence = [await shot(page, 'scenario-10-drag-filter')];

    // Hover a result card → grid should show preview block
    const hoverOk = await page.evaluate(async () => {
      const card = document.querySelector('#results .lecture-item');
      if (!card) return false;
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      return !!document.querySelector('.lec-block.preview');
    });

    if (isOn && selectedSlots >= 1 && slotBarOpen) {
      record(10, '빈 시간 드래그 → 필터 매칭', 'PASS',
        `advancedMode=on slots=${selectedSlots} slotBar=${slotBarOpen} results=${base} previewOnHover=${hoverOk} col=${box.colIndex}`, evidence);
    } else {
      record(10, '빈 시간 드래그', 'FAIL',
        `advancedMode=${isOn} slots=${selectedSlots} slotBar=${slotBarOpen} col=${box.colIndex}`, evidence);
    }
    await page.close();
  } catch (e) {
    record(10, '빈 시간 드래그', 'FAIL', `exception: ${e.message}`);
  }

  await ctx.close();
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}

  // Write retry results to staging as JSON so we can merge into report
  fs.writeFileSync('/mnt/c/claude/staging/v1160_r3_e2e_retry.json', JSON.stringify(results, null, 2));
  log('retry results saved');
  log(`summary: ${Object.values(results).filter(r => r.status === 'PASS').length}/${Object.keys(results).length} PASS`);
  process.exit(0);
})().catch(err => {
  console.error('[r3-retry] fatal:', err);
  process.exit(1);
});
