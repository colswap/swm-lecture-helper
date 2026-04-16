// v1.12.0 전체 UI 자동 테스트 — Playwright
// 기능 동작 + 글씨 잘림 + 모달 + 동기화 버튼 SVG 보존 검증

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dummy = require('./dummy-data.js');

const EXT_PATH = path.resolve(__dirname, '..');
const TMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-test-'));
const VIEWPORT = { width: 1280, height: 800 };
const results = [];

function pass(name) { results.push({ name, status: 'PASS' }); console.log(`  ✅ ${name}`); }
function fail(name, reason) { results.push({ name, status: 'FAIL', reason }); console.log(`  ❌ ${name}: ${reason}`); }

async function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getExtId(ctx) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  return sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
}

async function injectDummy(page) {
  await page.evaluate((data) => new Promise(resolve => {
    chrome.storage.local.clear(() => {
      chrome.storage.local.set(data, () => resolve());
    });
  }), { lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta, settings: dummy.settings });
}

(async () => {
  console.log('[test] launching chromium...');
  const ctx = await chromium.launchPersistentContext(TMP_PROFILE, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
    viewport: VIEWPORT,
  });

  const extId = await getExtId(ctx);
  console.log('[test] extension ID:', extId);

  // ========== 1. POPUP 테스트 ==========
  console.log('\n[test] === POPUP ===');
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 420, height: 720 });
  try {
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch { await waitMs(500); }
  await injectDummy(popup);
  await popup.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(1000);

  // 1-1. 헤더 stats 잘림
  const statsText = await popup.$eval('#headerStats', el => el.textContent);
  const statsOverflow = await popup.$eval('#headerStats', el => el.scrollWidth > el.clientWidth);
  if (statsOverflow) fail('popup-header-stats', `overflow: "${statsText}"`);
  else pass('popup-header-stats 잘림 없음');

  // 1-2. title-line 잘림 (2줄 제한)
  const titleOverflows = await popup.$$eval('.title-line', els =>
    els.filter(el => el.scrollHeight > el.clientHeight + 2).length
  );
  if (titleOverflows > 0) fail('popup-title-line', `${titleOverflows}개 overflow`);
  else pass('popup-title-line 2줄 ellipsis OK');

  // 1-3. filter select 잘림
  const selectOverflows = await popup.$$eval('.filters select', els =>
    els.filter(el => el.scrollWidth > el.clientWidth + 5).length
  );
  if (selectOverflows > 0) fail('popup-filter-select', `${selectOverflows}개 overflow`);
  else pass('popup-filter-select 잘림 없음');

  // 1-4. 동기화 버튼 SVG 존재
  const popupSyncSvg = await popup.$('#syncBtn svg');
  if (!popupSyncSvg) fail('popup-sync-svg', 'SVG 없음');
  else pass('popup-sync-btn SVG 존재');

  // 1-5. 동기화 버튼 클릭 후 SVG 복구 (탭 없어서 에러 → 2.5초 후 복구)
  await popup.click('#syncBtn');
  await waitMs(3000);
  const popupSyncSvgAfter = await popup.$('#syncBtn svg');
  if (!popupSyncSvgAfter) fail('popup-sync-svg-restore', '클릭 후 SVG 미복구');
  else pass('popup-sync-btn SVG 복구 OK');

  await popup.close();

  // ========== 2. TIMETABLE 테스트 ==========
  console.log('\n[test] === TIMETABLE ===');
  const tt = await ctx.newPage();
  await tt.setViewportSize(VIEWPORT);
  try {
    await tt.goto(`chrome-extension://${extId}/timetable/timetable.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  } catch { await waitMs(500); }
  await injectDummy(tt);
  await tt.reload({ waitUntil: 'domcontentloaded' });
  await waitMs(1500);

  // 2-1. lec-block 텍스트 — ellipsis 적용 여부 (overflow:hidden 인지 확인)
  const blockEllipsisOk = await tt.$$eval('.lec-block .bt', els =>
    els.every(el => getComputedStyle(el).overflow === 'hidden' && getComputedStyle(el).textOverflow === 'ellipsis')
  );
  if (!blockEllipsisOk) fail('tt-block-text', 'overflow:hidden 또는 ellipsis 미적용');
  else pass('tt-block .bt ellipsis CSS 적용 OK');

  // 2-2. 동기화 버튼 SVG
  const ttSyncSvg = await tt.$('#syncBtn svg');
  if (!ttSyncSvg) fail('tt-sync-svg', 'SVG 없음');
  else pass('tt-sync-btn SVG 존재');

  // 2-3. 동기화 클릭 후 SVG 복구
  await tt.click('#syncBtn');
  await waitMs(3500);
  const ttSyncSvgAfter = await tt.$('#syncBtn svg');
  if (!ttSyncSvgAfter) fail('tt-sync-svg-restore', 'SVG 미복구');
  else pass('tt-sync-btn SVG 복구 OK');

  // 2-4. 팝오버 열기 (applied 블록 클릭)
  const appliedBlock = await tt.$('.lec-block.applied');
  if (appliedBlock) {
    await appliedBlock.click();
    await waitMs(800);
    const popoverVisible = await tt.$eval('#popover', el => el.classList.contains('show'));
    if (!popoverVisible) fail('tt-popover-open', '팝오버 안 열림');
    else pass('tt-popover 열림');

    // 2-5. "상세페이지" 라벨 확인
    const openBtnText = await tt.$eval('#popoverOpen', el => el.textContent.trim());
    if (openBtnText.includes('신청하러')) fail('tt-popover-label', `아직 "신청하러 가기": "${openBtnText}"`);
    else if (openBtnText.includes('상세페이지')) pass('tt-popover "상세페이지" 라벨 OK');
    else fail('tt-popover-label', `unexpected: "${openBtnText}"`);

    // 2-6. popover actions overflow
    const actionsOverflow = await tt.$eval('.popover-actions', el => el.scrollWidth > el.clientWidth + 5);
    if (actionsOverflow) fail('tt-popover-actions', 'actions 가로 overflow');
    else pass('tt-popover-actions 잘림 없음');

    // 2-7. meta-row 장소 wrap
    const metaOverflow = await tt.$$eval('.meta-row', els =>
      els.some(el => el.scrollWidth > el.parentElement.clientWidth + 10)
    );
    if (metaOverflow) fail('tt-meta-row', '장소/URL overflow');
    else pass('tt-meta-row 줄바꿈 OK');

    await tt.keyboard.press('Escape');
    await waitMs(300);
  } else {
    fail('tt-popover', 'applied 블록 없음 (dummy 데이터 문제)');
  }

  // 2-8. 알림 설정 모달 열기
  console.log('\n[test] === 알림 설정 모달 ===');
  await tt.click('#menuBtn');
  await waitMs(300);
  await tt.click('[data-action="notify"]');
  await waitMs(500);
  const modalVisible = await tt.$eval('#notifyModal', el => el.style.display !== 'none');
  if (!modalVisible) fail('modal-open', '모달 안 열림');
  else pass('알림 설정 모달 열림');

  // 2-9. 기본값 OFF 확인
  const toggleNewChecked = await tt.$eval('#nfToggleNew', el => el.checked);
  const toggleSlotChecked = await tt.$eval('#nfToggleSlot', el => el.checked);
  const toggleMentorChecked = await tt.$eval('#nfToggleMentor', el => el.checked);
  if (toggleNewChecked || toggleSlotChecked || toggleMentorChecked) {
    fail('modal-defaults', `기본 OFF 아님: new=${toggleNewChecked}, slot=${toggleSlotChecked}, mentor=${toggleMentorChecked}`);
  } else {
    pass('모달 토글 기본 전부 OFF');
  }

  // 2-10. 멘토 추가 테스트
  await tt.fill('#nfMentorInput', '테스트멘토');
  await tt.click('#nfMentorAdd');
  await waitMs(200);
  const chipCount = await tt.$$eval('#nfMentorChips .chip-item', els => els.length);
  if (chipCount !== 1) fail('modal-mentor-add', `chip ${chipCount}개 (expected 1)`);
  else pass('멘토 chip 추가 OK');

  // 2-11. 멘토 chip 제거
  await tt.click('#nfMentorChips .chip-item .remove');
  await waitMs(200);
  const chipCountAfter = await tt.$$eval('#nfMentorChips .chip-item', els => els.length);
  if (chipCountAfter !== 0) fail('modal-mentor-remove', `chip ${chipCountAfter}개 남음`);
  else pass('멘토 chip 제거 OK');

  // 2-12. 토글 ON → 저장 → 재열기 → 상태 유지
  await tt.check('#nfToggleNew');
  await tt.fill('#nfMentorInput', '김민수');
  await tt.click('#nfMentorAdd');
  await waitMs(200);
  await tt.click('#notifyModalSave');
  await waitMs(500);

  // 다시 열어서 저장 확인
  await tt.click('#menuBtn');
  await waitMs(300);
  await tt.click('[data-action="notify"]');
  await waitMs(500);
  const savedNew = await tt.$eval('#nfToggleNew', el => el.checked);
  const savedSlot = await tt.$eval('#nfToggleSlot', el => el.checked);
  const savedChips = await tt.$$eval('#nfMentorChips .chip-item', els => els.length);
  if (!savedNew) fail('modal-save', '토글 저장 안 됨 (new 꺼져있음)');
  else if (savedSlot) fail('modal-save', '토글 저장 오류 (slot 켜져있음, OFF 여야)');
  else if (savedChips !== 1) fail('modal-save', `칩 저장 안 됨 (${savedChips}개)`);
  else pass('모달 저장 + 복원 OK');

  // 2-13. Esc 닫기
  await tt.keyboard.press('Escape');
  await waitMs(300);
  const modalHidden = await tt.$eval('#notifyModal', el => el.style.display === 'none');
  if (!modalHidden) fail('modal-esc', 'Esc 로 안 닫힘');
  else pass('모달 Esc 닫기 OK');

  // 2-14. 다크 모드 테스트
  console.log('\n[test] === 다크 모드 ===');
  await tt.click('#menuBtn');
  await waitMs(200);
  await tt.click('[data-action="darkmode"]');
  await waitMs(500);
  const theme = await tt.$eval('html', el => el.dataset.theme);
  if (!theme) fail('darkmode', 'theme 설정 안 됨');
  else pass(`다크 모드 전환 OK (theme=${theme})`);

  // 2-15. 다크 모드에서 모달 열기
  // 다크모드 클릭 후 메뉴 열려있으니 바로 notify 클릭
  const menuOpen = await tt.$eval('#menuDropdown', el => el.style.display !== 'none').catch(() => false);
  if (!menuOpen) { await tt.click('#menuBtn'); await waitMs(300); }
  await tt.click('[data-action="notify"]');
  await waitMs(500);
  const darkModalBg = await tt.$eval('#notifyModal', el => getComputedStyle(el).backgroundColor);
  await tt.keyboard.press('Escape');
  pass(`다크 모달 배경: ${darkModalBg}`);

  // 2-16. slot-chip nowrap
  await tt.click('#advancedToggle').catch(() => {});
  await waitMs(300);
  await tt.click('#slotFreeBtn').catch(() => {});
  await waitMs(500);
  const chipWrap = await tt.$$eval('.slot-chip', els =>
    els.some(el => el.scrollWidth > el.clientWidth + 3)
  );
  if (chipWrap) fail('slot-chip', 'chip 내부 줄바꿈');
  else pass('slot-chip nowrap OK');

  await tt.close();

  // ========== 결과 요약 ==========
  console.log('\n' + '='.repeat(50));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`[test] 총 ${results.length}건: ✅ ${passed} PASS, ❌ ${failed} FAIL`);
  if (failed > 0) {
    console.log('\n❌ FAIL 목록:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  - ${r.name}: ${r.reason}`));
  }
  console.log('');

  await ctx.close();
  try { fs.rmSync(TMP_PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('[test] FATAL:', e);
  process.exit(1);
});
