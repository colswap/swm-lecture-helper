// v1.16.1 a3: lecTime → block render safety reproduction harness
//
// Reproduces pathological lecTime strings and inspects rendered .lec-block
// geometry vs. grid column height. Overflow (blockBottom > colBottom) is the
// core bug: parseTimeRange accepts wide inputs (hh up to 29) and blockPos has
// no clamp against (END_HOUR+1)*HOUR_PX.
//
// Scenarios (S1-S6):
//   S1 "00:00 ~ 16:00"  → height 832px vs. colHeight 780px (covers whole day)
//   S2 "23:00 ~ 24:00"  → boundary: top=728, height=52, bottom=780 == colHeight
//   S3 "22:00 ~ 02:00"  → overnight: endMin += 24h, height 208, bottom 884 > 780
//   S4 "" (empty)       → parseTimeRange null → skip path
//   S5 "25:00 ~ 28:00"  → garbage-in (>24h) but accepted by parser (hh ≤ 29)
//                          → top=832 ≥ colHeight (block rendered *below* grid)
//   S6 classifier race   → derivedCategories cleared + window.SWM_CLASSIFY deleted
//                          → applied block falls back to --primary blue (no data-cat)
//
// Strategy: Playwright chromium w/ ext loaded. Load dummy data, then override
// 6 applied lectures' lecTime to the scenario strings. Reload timetable,
// measure block geometry via DOM, capture screenshot.
//
// Output:
//   /mnt/c/claude/staging/v1161_a3_render_safety.md — appended with results
//   docs/review/v1161-a3/{scenario}.png

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
const OUT_DIR = path.resolve(EXT_PATH, 'docs', 'review', 'v1161-a3');
const REPORT_PATH = '/mnt/c/claude/staging/v1161_a3_render_safety_repro.json';
const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-a3-'));

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];

function log(msg) { console.log(`[a3] ${msg}`); }

async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getExtId(ctx) {
  for (let i = 0; i < 20; i++) {
    const [sw] = ctx.serviceWorkers();
    if (sw) return sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
    await waitMs(250);
  }
  throw new Error('extension service worker did not register');
}

async function injectDummy(page, overrides = {}) {
  // clone + apply lecTime overrides per scenario
  await page.evaluate(({ data, overrides }) => new Promise(resolve => {
    chrome.storage.local.clear(() => {
      const lectures = JSON.parse(JSON.stringify(data.lectures));
      // Pick the 10 applied lectures and rewrite their lecTime per scenario.
      const appliedSns = Object.values(lectures).filter(l => l.applied).map(l => l.sn);
      if (overrides.applyToAll && overrides.lecTime != null) {
        for (const sn of appliedSns) lectures[sn].lecTime = overrides.lecTime;
      }
      if (overrides.clearDerivedCats) {
        for (const sn of Object.keys(lectures)) {
          delete lectures[sn].derivedCategories;
          delete lectures[sn].derivedChips;
          delete lectures[sn]._cv;
        }
      }
      chrome.storage.local.set({
        lectures,
        favorites: data.favorites,
        meta: data.meta,
        settings: { ...data.settings, onboardingSeen: true, timetableCoachmarkSeen: true },
      }, () => resolve());
    });
  }), { data: dummy, overrides });
}

async function reloadAndSettle(page, ms = 1000) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(ms);
}

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); } catch (e) { log(`shot fail ${name}: ${e.message}`); return null; }
  return path.relative(EXT_PATH, p).replace(/\\/g, '/');
}

// Read block geometry + grid column height.
async function measureBlocks(page) {
  return await page.evaluate(() => {
    const colHeight = (() => {
      const col = document.querySelector('.grid-body .day-column');
      return col ? col.getBoundingClientRect().height : null;
    })();
    const blocks = Array.from(document.querySelectorAll('.grid-body .lec-block.applied')).map(b => {
      const cs = getComputedStyle(b);
      const col = b.closest('.day-column');
      const colH = col ? col.getBoundingClientRect().height : 0;
      const top = parseFloat(cs.top) || 0;
      const height = parseFloat(cs.height) || 0;
      const overflows = (top + height) > (colH + 0.5);
      return {
        sn: b.dataset.sn || null,
        dataCat: b.dataset.cat || null,
        bg: cs.backgroundColor,
        top,
        height,
        colH,
        bottom: top + height,
        overflowsPx: Math.max(0, (top + height) - colH),
        overflows,
        text: (b.querySelector('.bl')?.textContent || '').trim(),
      };
    });
    return { colHeight, blocks };
  });
}

(async () => {
  log('launching chromium (ext loaded, headless=new)');
  const ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
    headless: false,
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
  const timetableUrl = `chrome-extension://${extId}/timetable/timetable.html`;

  const scenarios = [
    { id: 'S1', name: '16시간 블록 "00:00 ~ 16:00"', overrides: { applyToAll: true, lecTime: '00:00 ~ 16:00' } },
    { id: 'S2', name: '경계 "23:00 ~ 24:00"',        overrides: { applyToAll: true, lecTime: '23:00 ~ 24:00' } },
    { id: 'S3', name: '오버나잇 "22:00 ~ 02:00"',     overrides: { applyToAll: true, lecTime: '22:00 ~ 02:00' } },
    { id: 'S4', name: '빈 문자열 lecTime=""',         overrides: { applyToAll: true, lecTime: '' } },
    { id: 'S5', name: '하루 넘김 "25:00 ~ 28:00"',    overrides: { applyToAll: true, lecTime: '25:00 ~ 28:00' } },
    { id: 'S6', name: 'classifier race (derivedCategories 없음)', overrides: { clearDerivedCats: true } },
  ];

  for (const sc of scenarios) {
    log(`scenario ${sc.id}: ${sc.name}`);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    const consoleLog = [];
    page.on('console', m => consoleLog.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', err => consoleLog.push({ type: 'pageerror', text: String(err?.stack || err) }));

    try {
      await page.goto(timetableUrl, { waitUntil: 'domcontentloaded' });
      await injectDummy(page, sc.overrides);
      // For S6, also nuke window.SWM_CLASSIFY after load to simulate failed library.
      if (sc.id === 'S6') {
        await page.addInitScript(() => {
          // Intercept the global set by classifier.js by polling briefly.
          const iv = setInterval(() => {
            if (window.SWM_CLASSIFY) { delete window.SWM_CLASSIFY; clearInterval(iv); }
          }, 10);
          setTimeout(() => clearInterval(iv), 2000);
        });
      }
      await reloadAndSettle(page, 1300);

      const measurement = await measureBlocks(page);
      const screenshot = await shot(page, sc.id);

      // Analyze
      const overflowing = measurement.blocks.filter(b => b.overflows);
      const missingDataCat = measurement.blocks.filter(b => !b.dataCat);
      const zeroHeight = measurement.blocks.filter(b => b.height <= 0);

      const report = {
        id: sc.id,
        name: sc.name,
        overrides: sc.overrides,
        colHeight: measurement.colHeight,
        blockCount: measurement.blocks.length,
        overflowingCount: overflowing.length,
        maxOverflowPx: Math.max(0, ...measurement.blocks.map(b => b.overflowsPx)),
        missingDataCatCount: missingDataCat.length,
        zeroHeightCount: zeroHeight.length,
        sampleBlock: measurement.blocks[0] || null,
        consoleErrors: consoleLog.filter(e => e.type === 'error' || e.type === 'pageerror').slice(0, 5),
        screenshot,
      };
      results.push(report);
      log(`  ${sc.id}: blocks=${report.blockCount} overflow=${report.overflowingCount}/${report.blockCount} maxOver=${report.maxOverflowPx.toFixed(1)}px missingCat=${report.missingDataCatCount}`);
    } catch (e) {
      log(`  ${sc.id}: FAIL ${e.message}`);
      results.push({ id: sc.id, name: sc.name, error: e.message, consoleErrors: consoleLog });
    }
    await page.close();
  }

  await ctx.close();
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));
  log(`report: ${REPORT_PATH}`);
  process.exit(0);
})().catch(err => {
  console.error('[a3] fatal:', err);
  process.exit(1);
});
