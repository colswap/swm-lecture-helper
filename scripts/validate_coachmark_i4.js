#!/usr/bin/env node
// Validate v1160-i4 coachmarks — render POPUP_STEPS & TIMETABLE_STEPS into a
// standalone harness, step through each, snapshot the bubble.
// Usage: node scripts/validate_coachmark_i4.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'review', 'v1160-i4');
fs.mkdirSync(OUT, { recursive: true });

function extractStepsArray(jsPath, varName) {
  const src = fs.readFileSync(jsPath, 'utf8');
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*(\\[[\\s\\S]*?\\n  \\]);`);
  const m = src.match(re);
  if (!m) throw new Error(`Could not find ${varName} in ${jsPath}`);
  return m[1];
}

const POPUP_STEPS_SRC = extractStepsArray(path.join(ROOT, 'popup/popup.js'), 'POPUP_STEPS');
const TIMETABLE_STEPS_SRC = extractStepsArray(path.join(ROOT, 'timetable/timetable.js'), 'TIMETABLE_STEPS');

const popupHarness = `
<!doctype html><html><head>
<link rel="stylesheet" href="file://${ROOT}/lib/tokens.css">
<link rel="stylesheet" href="file://${ROOT}/popup/popup.css">
<link rel="stylesheet" href="file://${ROOT}/lib/coachmark.css">
<style>body{margin:0;width:400px;height:640px;}</style>
</head><body>
<header class="header">
  <h1 class="title">SWM Lecture</h1>
  <div class="header-right">
    <button id="openTimetableBtn" class="header-btn">📅 전체화면</button>
    <button id="popupMenuBtn" class="header-btn menu-btn-icon">⋮</button>
  </div>
</header>
<div class="search"><input type="text" id="searchInput" placeholder="검색"></div>
<details class="collapsible advanced-search" id="advancedSearchPanel" open>
  <summary class="collapsible-trigger">상세 검색</summary>
  <div class="collapsible-content">
    <div class="filters">
      <select id="filterStatus"><option>접수중</option></select>
      <select id="filterCategory"><option>전체</option></select>
      <select id="filterLocation"><option>전체</option></select>
    </div>
    <div class="filters filters-topic">
      <select id="filterDerivedCat"><option>전체 주제</option></select>
    </div>
  </div>
</details>
<div id="results" class="results" style="min-height:200px;padding:12px;">카드 영역</div>
<script src="file://${ROOT}/lib/coachmark.js"></script>
<script>
  window.SWM = { getSettings: async () => ({}), saveSettings: async () => {} };
  window.POPUP_STEPS = ${POPUP_STEPS_SRC};
</script>
</body></html>`;

const timetableHarness = `
<!doctype html><html><head>
<link rel="stylesheet" href="file://${ROOT}/lib/tokens.css">
<link rel="stylesheet" href="file://${ROOT}/timetable/timetable.css">
<link rel="stylesheet" href="file://${ROOT}/lib/coachmark.css">
<style>body{margin:0;width:1280px;height:800px;display:flex;}</style>
</head><body>
<aside class="sidebar" style="width:320px;">
  <div class="search"><input type="text" id="searchInput"></div>
  <details class="collapsible advanced-search" id="advancedSearchPanel" open>
    <summary class="collapsible-trigger">상세 검색</summary>
    <div class="collapsible-content">
      <button id="advancedToggle" class="advanced-btn">시간 지정 검색</button>
    </div>
  </details>
</aside>
<main class="main" style="flex:1;">
  <header class="main-header">
    <button id="menuBtn" class="menu-btn">⋯</button>
  </header>
  <div class="grid-wrapper" style="min-height:600px;background:#fff;padding:12px;">그리드</div>
</main>
<script src="file://${ROOT}/lib/coachmark.js"></script>
<script>
  window.SWM = { getSettings: async () => ({}), saveSettings: async () => {} };
  window.TIMETABLE_STEPS = ${TIMETABLE_STEPS_SRC};
</script>
</body></html>`;

async function snapshotSteps({ harness, viewport, stepsVar, prefix, count }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const tmpFile = path.join(OUT, `_harness_${prefix}.html`);
  fs.writeFileSync(tmpFile, harness);
  await page.goto(`file://${tmpFile}`);
  await page.waitForFunction(() => typeof window.SWM_COACHMARK !== 'undefined');

  await page.evaluate((v) => {
    window.SWM_COACHMARK.start(window[v]);
  }, stepsVar);
  await page.waitForTimeout(250);

  for (let i = 1; i <= count; i++) {
    await page.waitForTimeout(250);
    const file = path.join(OUT, `${prefix}-step-${i}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('✓', path.relative(ROOT, file));
    if (i < count) {
      await page.click('.coachmark-btn-primary');
      await page.waitForTimeout(200);
    }
  }
  await browser.close();
  fs.unlinkSync(tmpFile);
}

(async () => {
  await snapshotSteps({
    harness: popupHarness,
    viewport: { width: 420, height: 680 },
    stepsVar: 'POPUP_STEPS',
    prefix: 'popup',
    count: 5,
  });
  await snapshotSteps({
    harness: timetableHarness,
    viewport: { width: 1280, height: 800 },
    stepsVar: 'TIMETABLE_STEPS',
    prefix: 'timetable',
    count: 4,
  });
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
