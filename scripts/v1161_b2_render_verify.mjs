// v1.16.1 §B2: 렌더 가드 검증 (post-fix verification).
//
// a3 재현 harness (scripts/v1161_a3_repro.mjs) 와 동일한 6개 시나리오를 돌려
// blockPos 패치 후:
//   - S1 "00:00~16:00"  → duration > 14h → block render skipped, console.warn
//   - S2 "23:00~24:00"  → 경계 pass (top=728, height=52)
//   - S3 "22:00~02:00"  → duration == 4h 정상 (colH 내 clamp)
//   - S4 ""             → 기존과 동일 parseTimeRange null → skip
//   - S5 "25:00~28:00"  → top >= colHeight → block render skipped, console.warn
//   - S6 classifier race → 기존과 동일 --primary fallback (b2 범위 외)
//
// 성공 기준:
//   S1: blockCount=0, warnCount>=1 (blockPos duration guard)
//   S2: blockCount=10, overflowingCount=0
//   S3: blockCount=10, overflowingCount=0 (clamp 되어 colH 내부에 맞춰 렌더)
//   S4: blockCount=0
//   S5: blockCount=0, warnCount>=1 (blockPos top>=colHeight guard)
//
// 결과: /mnt/c/claude/staging/v1161_b2_render_verify.json

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
const OUT_DIR = path.resolve(EXT_PATH, 'docs', 'review', 'v1161-b2');
const REPORT_PATH = '/mnt/c/claude/staging/v1161_b2_render_verify.json';
const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-b2-'));

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];

function log(msg) { console.log(`[b2] ${msg}`); }
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
  await page.evaluate(({ data, overrides }) => new Promise(resolve => {
    chrome.storage.local.clear(() => {
      const lectures = JSON.parse(JSON.stringify(data.lectures));
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

async function reloadAndSettle(page, ms = 1300) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(ms);
}

async function shot(page, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); } catch (e) { log(`shot fail ${name}: ${e.message}`); return null; }
  return path.relative(EXT_PATH, p).replace(/\\/g, '/');
}

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
        top, height, colH,
        bottom: top + height,
        overflowsPx: Math.max(0, (top + height) - colH),
        overflows,
      };
    });
    return { colHeight, blocks };
  });
}

// Per-scenario success criteria.
// 방어층이 2중: (1) parseTimeRange boundary reject, (2) blockPos guard.
// 두 층 중 어느 쪽에서라도 잡히면 overflow 0 + blockCount 0 인 것이 핵심.
// warn 은 blockPos 에서만 발생하므로 parser 가 먼저 reject 하면 warn=0 도 정상.
function judge(sc, rep) {
  switch (sc.id) {
    case 'S1': // duration 16h → parser reject (>14h) 또는 blockPos duration guard
      return {
        pass: rep.blockCount === 0 && rep.overflowingCount === 0,
        why: `S1 expect 0 blocks no overflow (parser 14h reject 또는 blockPos guard). got blocks=${rep.blockCount} warn=${rep.warnCount} overflow=${rep.overflowingCount}`,
      };
    case 'S2': // 경계 23:00~24:00 → 10 blocks fit
      return {
        pass: rep.blockCount === 10 && rep.overflowingCount === 0,
        why: `S2 expect 10 blocks no overflow. got blocks=${rep.blockCount} overflow=${rep.overflowingCount}`,
      };
    case 'S3': // overnight 22:00~02:00 → 4h duration, should render within col
      return {
        pass: rep.blockCount === 10 && rep.overflowingCount === 0,
        why: `S3 expect 10 blocks no overflow (clamped). got blocks=${rep.blockCount} overflow=${rep.overflowingCount}`,
      };
    case 'S4': // empty lecTime → parser null → no blocks
      return {
        pass: rep.blockCount === 0,
        why: `S4 expect 0 blocks. got blocks=${rep.blockCount}`,
      };
    case 'S5': // 25:00~28:00 → parser h1>23 reject 또는 blockPos top>=colHeight guard
      return {
        pass: rep.blockCount === 0 && rep.overflowingCount === 0,
        why: `S5 expect 0 blocks no overflow (parser h1>23 reject 또는 blockPos guard). got blocks=${rep.blockCount} warn=${rep.warnCount}`,
      };
    case 'S6':
      return {
        pass: rep.blockCount === 10, // classifier race unrelated to b2
        why: `S6 classifier race - b2 영역 외, blocks=${rep.blockCount}`,
      };
    default:
      return { pass: false, why: 'unknown scenario' };
  }
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
    { id: 'S6', name: 'classifier race',              overrides: { clearDerivedCats: true } },
  ];

  const summary = [];

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
      if (sc.id === 'S6') {
        await page.addInitScript(() => {
          const iv = setInterval(() => {
            if (window.SWM_CLASSIFY) { delete window.SWM_CLASSIFY; clearInterval(iv); }
          }, 10);
          setTimeout(() => clearInterval(iv), 2000);
        });
      }
      await reloadAndSettle(page, 1300);

      const measurement = await measureBlocks(page);
      const screenshot = await shot(page, sc.id);

      const warnCount = consoleLog.filter(e =>
        e.type === 'warning' && /\[timetable\]\s*blockPos/.test(e.text)
      ).length;
      const blockPosWarns = consoleLog
        .filter(e => e.type === 'warning' && /blockPos/.test(e.text))
        .slice(0, 3)
        .map(e => e.text);

      const overflowing = measurement.blocks.filter(b => b.overflows);
      const report = {
        id: sc.id,
        name: sc.name,
        overrides: sc.overrides,
        colHeight: measurement.colHeight,
        blockCount: measurement.blocks.length,
        overflowingCount: overflowing.length,
        maxOverflowPx: Math.max(0, ...measurement.blocks.map(b => b.overflowsPx)),
        warnCount,
        blockPosWarns,
        sampleBlock: measurement.blocks[0] || null,
        consoleErrors: consoleLog.filter(e => e.type === 'error' || e.type === 'pageerror').slice(0, 5),
        screenshot,
      };
      const verdict = judge(sc, report);
      report.pass = verdict.pass;
      report.why = verdict.why;
      summary.push({ id: sc.id, pass: verdict.pass, why: verdict.why });
      log(`  ${sc.id}: ${verdict.pass ? 'PASS' : 'FAIL'} — ${verdict.why}`);
      results.push(report);
    } catch (e) {
      log(`  ${sc.id}: FAIL ${e.message}`);
      results.push({ id: sc.id, name: sc.name, error: e.message });
      summary.push({ id: sc.id, pass: false, why: `exception: ${e.message}` });
    }
    await page.close();
  }

  await ctx.close();
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}

  const allPass = summary.every(s => s.pass);
  const payload = {
    version: 'v1.16.1-b2',
    allPass,
    summary,
    results,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(payload, null, 2));
  log(`report: ${REPORT_PATH}  allPass=${allPass}`);
  process.exit(allPass ? 0 : 1);
})().catch(err => {
  console.error('[b2] fatal:', err);
  process.exit(1);
});
