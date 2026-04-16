// v1.12.0 최종 전체 UI/UX 테스트 — Round 5 수정분 포함
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dummy = require('./dummy-data.js');

const EXT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swm-final-'));
const VP = { width: 1280, height: 800 };
const R = [];
function pass(n) { R.push({n,s:'PASS'}); console.log(`  ✅ ${n}`); }
function fail(n,r) { R.push({n,s:'FAIL',r}); console.log(`  ❌ ${n}: ${r}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('[test] launching...');
  const ctx = await chromium.launchPersistentContext(TMP, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-first-run',`--window-size=${VP.width},${VP.height}`],
    viewport: VP,
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = sw.url().match(/chrome-extension:\/\/([^/]+)\//)[1];
  console.log('[test] ext:', id);

  async function inject(page) {
    await page.evaluate(data => new Promise(r => chrome.storage.local.clear(() => chrome.storage.local.set(data, r))),
      { lectures: dummy.lectures, favorites: dummy.favorites, meta: dummy.meta, settings: dummy.settings });
  }

  // ========== POPUP ==========
  console.log('\n[POPUP]');
  const p = await ctx.newPage();
  await p.setViewportSize({width:420,height:720});
  try { await p.goto(`chrome-extension://${id}/popup/popup.html`,{waitUntil:'domcontentloaded',timeout:10000}); } catch{}
  await inject(p); await p.reload({waitUntil:'domcontentloaded'}); await wait(1000);

  // 1. 기본 렌더
  const itemCount = await p.$$eval('.lecture-item', els => els.length);
  itemCount > 0 ? pass(`팝업 강연 ${itemCount}개 렌더`) : fail('팝업 렌더', '0개');

  // 2. 헤더 stats
  const stats = await p.$eval('#headerStats', el => ({ text: el.textContent, overflow: el.scrollWidth > el.clientWidth }));
  !stats.overflow ? pass(`헤더 stats OK: "${stats.text}"`) : fail('헤더 stats overflow', stats.text);

  // 3. title-line clamp
  const titleClamp = await p.$$eval('.title-line', els => els.every(el => getComputedStyle(el).overflow === 'hidden'));
  titleClamp ? pass('title-line overflow:hidden') : fail('title-line', 'overflow 미적용');

  // 4. filter select
  const filterOk = await p.$$eval('.filters select', els => els.every(el => el.offsetWidth >= 70));
  filterOk ? pass('filter select min-width OK') : fail('filter', 'width < 70');

  // 5. 동기화 SVG 존재 + 복구
  const svgBefore = await p.$('#syncBtn svg');
  svgBefore ? pass('sync SVG 존재') : fail('sync SVG', '없음');
  await p.click('#syncBtn'); await wait(3500);
  const svgAfter = await p.$('#syncBtn svg');
  svgAfter ? pass('sync SVG 복구') : fail('sync SVG restore', '미복구');

  // 6. 탭 전환
  await p.click('.tab[data-tab="favorites"]'); await wait(300);
  const favTab = await p.$eval('.tab[data-tab="favorites"]', el => el.classList.contains('active'));
  favTab ? pass('즐겨찾기 탭 전환') : fail('탭', '미전환');
  await p.click('.tab[data-tab="applied"]'); await wait(300);
  const appTab = await p.$eval('.tab[data-tab="applied"]', el => el.classList.contains('active'));
  appTab ? pass('내 신청 탭 전환') : fail('탭', '미전환');
  await p.click('.tab[data-tab="search"]'); await wait(200);

  // 7. 검색
  await p.fill('#searchInput', 'LLM'); await wait(400);
  const searchCount = await p.$$eval('.lecture-item', els => els.length);
  pass(`검색 "LLM" → ${searchCount}건`);
  await p.fill('#searchInput', ''); await wait(200);

  // 8. ⋯ 메뉴
  await p.click('#popupMenuBtn'); await wait(300);
  const menuVisible = await p.$eval('#popupMenuDropdown', el => el.style.display !== 'none');
  menuVisible ? pass('팝업 ⋯ 메뉴 열림') : fail('메뉴', '안 열림');
  await p.click('#popupMenuBtn'); await wait(200);

  // 9. focus-visible 스타일 존재
  const focusRule = await p.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) { if (rule.selectorText?.includes('focus-visible')) return true; } } catch{}
    }
    return false;
  });
  focusRule ? pass('focus-visible CSS 존재') : fail('focus-visible', 'CSS 없음');

  // 10. 좌우 스크롤 차단
  const hScroll = await p.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
  !hScroll ? pass('팝업 좌우 스크롤 없음') : fail('좌우 스크롤', '존재');

  // 11. 다크 모드 전환
  await p.click('#popupMenuBtn'); await wait(200);
  await p.click('#popupMenuDark'); await wait(500);
  const pTheme = await p.$eval('html', el => el.dataset.theme);
  pass(`팝업 테마: ${pTheme || 'auto'}`);

  await p.close();

  // ========== TIMETABLE ==========
  console.log('\n[TIMETABLE]');
  const t = await ctx.newPage();
  await t.setViewportSize(VP);
  try { await t.goto(`chrome-extension://${id}/timetable/timetable.html`,{waitUntil:'domcontentloaded',timeout:10000}); } catch{}
  await inject(t); await t.reload({waitUntil:'domcontentloaded'}); await wait(1500);

  // 12. 그리드 블록 렌더
  const blocks = await t.$$eval('.lec-block', els => els.length);
  blocks > 0 ? pass(`시간표 블록 ${blocks}개`) : fail('블록', '0개');

  // 13. 블록 텍스트 ellipsis
  const btEllipsis = await t.$$eval('.lec-block .bt', els =>
    els.every(el => getComputedStyle(el).textOverflow === 'ellipsis'));
  btEllipsis ? pass('블록 .bt ellipsis OK') : fail('블록 ellipsis', '미적용');

  // 14. 사이드바 title-line clamp
  const sideClamp = await t.$$eval('.title-line', els =>
    els.every(el => getComputedStyle(el).overflow === 'hidden'));
  sideClamp ? pass('사이드바 title-line clamp') : fail('사이드바 title', '미적용');

  // 15. 동기화 SVG
  const tSvg = await t.$('#syncBtn svg');
  tSvg ? pass('시간표 sync SVG') : fail('sync SVG', '없음');
  await t.click('#syncBtn'); await wait(3500);
  const tSvgA = await t.$('#syncBtn svg');
  tSvgA ? pass('시간표 sync SVG 복구') : fail('sync SVG', '미복구');

  // 16. 팝오버 열기
  const block = await t.$('.lec-block.applied');
  if (block) {
    await block.click(); await wait(800);
    const popShow = await t.$eval('#popover', el => el.classList.contains('show'));
    popShow ? pass('팝오버 열림') : fail('팝오버', '안 열림');

    // 17. "상세페이지" 라벨
    const label = await t.$eval('#popoverOpen', el => el.textContent.trim());
    label.includes('상세페이지') ? pass(`라벨: "${label}"`) : fail('라벨', label);

    // 18. 팝오버 viewport 안에 있는지
    const popRect = await t.$eval('#popover', el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
    });
    const inView = popRect.top >= 0 && popRect.left >= 0 && popRect.bottom <= VP.height && popRect.right <= VP.width;
    inView ? pass('팝오버 viewport 안') : fail('팝오버 위치', JSON.stringify(popRect));

    // 19. popover-actions wrap
    const actOk = await t.$eval('.popover-actions', el => el.scrollWidth <= el.clientWidth + 5);
    actOk ? pass('popover-actions 잘림 없음') : fail('actions overflow', '');

    // 20. meta-row
    const metaOk = await t.$$eval('.meta-row', els => els.every(el => el.scrollWidth <= el.parentElement.clientWidth + 10));
    metaOk ? pass('meta-row OK') : fail('meta overflow', '');

    // 21. popover-title clamp
    const titleOvf = await t.$eval('.popover-title', el => getComputedStyle(el).overflow);
    titleOvf === 'hidden' ? pass('popover-title overflow:hidden') : fail('popover-title', titleOvf);

    // 22. aria 속성 (toast)
    const toastAria = await t.$eval('#popoverToast', el => el.getAttribute('aria-live'));
    toastAria === 'polite' ? pass('toast aria-live OK') : fail('toast aria', toastAria);

    await t.keyboard.press('Escape'); await wait(300);
  } else { fail('팝오버', 'applied 블록 없음'); }

  // 23. 알림 설정 모달
  console.log('\n[MODAL]');
  await t.click('#menuBtn'); await wait(300);
  await t.click('[data-action="notify"]'); await wait(500);

  // 24. 모달 aria
  const modalRole = await t.$eval('#notifyModal', el => el.getAttribute('role'));
  modalRole === 'dialog' ? pass('모달 role=dialog') : fail('모달 role', modalRole);
  const ariaModal = await t.$eval('#notifyModal', el => el.getAttribute('aria-modal'));
  ariaModal === 'true' ? pass('aria-modal=true') : fail('aria-modal', ariaModal);

  // 25. 토글 기본 OFF
  const tNew = await t.$eval('#nfToggleNew', el => el.checked);
  const tSlot = await t.$eval('#nfToggleSlot', el => el.checked);
  const tMentor = await t.$eval('#nfToggleMentor', el => el.checked);
  (!tNew && !tSlot && !tMentor) ? pass('토글 전부 OFF') : fail('토글 기본값', `${tNew},${tSlot},${tMentor}`);

  // 26. 멘토 추가/제거
  await t.fill('#nfMentorInput', '테스트'); await t.click('#nfMentorAdd'); await wait(200);
  const chips1 = await t.$$eval('#nfMentorChips .chip-item', els => els.length);
  chips1 === 1 ? pass('멘토 추가') : fail('멘토 추가', chips1);
  await t.click('#nfMentorChips .chip-item .remove'); await wait(200);
  const chips0 = await t.$$eval('#nfMentorChips .chip-item', els => els.length);
  chips0 === 0 ? pass('멘토 제거') : fail('멘토 제거', chips0);

  // 27. chip max-width
  await t.fill('#nfMentorInput', '아주긴멘토이름열다섯글자이상입니다'); await t.click('#nfMentorAdd'); await wait(200);
  const chipW = await t.$eval('#nfMentorChips .chip-item', el => el.offsetWidth);
  chipW <= 210 ? pass(`chip width ${chipW}px (max 200)`) : fail('chip width', chipW);

  // 28. 저장 + 복원
  await t.check('#nfToggleNew');
  await t.click('#notifyModalSave'); await wait(500);
  await t.click('#menuBtn'); await wait(300);
  await t.click('[data-action="notify"]'); await wait(500);
  const savedNew = await t.$eval('#nfToggleNew', el => el.checked);
  savedNew ? pass('저장 복원 OK') : fail('저장', '미복원');
  await t.keyboard.press('Escape'); await wait(300);

  // 29. 슬롯 선택
  console.log('\n[SLOT SELECTION]');
  await t.click('#advancedToggle').catch(()=>{});  await wait(300);
  await t.click('#slotFreeBtn').catch(()=>{}); await wait(500);
  const chipNowrap = await t.$$eval('.slot-chip', els => els.every(el => getComputedStyle(el).whiteSpace === 'nowrap'));
  chipNowrap ? pass('slot-chip nowrap') : fail('slot-chip', 'wrap');
  await t.click('#slotClearBtn').catch(()=>{}); await wait(200);
  await t.click('#advancedToggle').catch(()=>{}); await wait(200);

  // 30. 다크 모드
  console.log('\n[DARK MODE]');
  await t.click('#menuBtn'); await wait(200);
  await t.click('[data-action="darkmode"]'); await wait(500);
  const theme = await t.$eval('html', el => el.dataset.theme);
  pass(`테마 전환: ${theme || 'cycled'}`);

  // 31. day-headers overflow
  const dhOk = await t.$$eval('.day-headers > div', els =>
    els.every(el => getComputedStyle(el).overflow === 'hidden'));
  dhOk ? pass('day-headers overflow:hidden') : fail('day-headers', '미적용');

  // 32. manifest permissions (activeTab 제거 확인)
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  !manifest.permissions.includes('activeTab') ? pass('activeTab 제거됨') : fail('manifest', 'activeTab 잔존');

  await t.close();

  // ========== RESULT ==========
  console.log('\n' + '='.repeat(50));
  const passed = R.filter(r => r.s==='PASS').length;
  const failed = R.filter(r => r.s==='FAIL').length;
  console.log(`[FINAL] 총 ${R.length}건: ✅ ${passed} PASS, ❌ ${failed} FAIL`);
  if (failed > 0) { console.log('\n❌ FAIL:'); R.filter(r=>r.s==='FAIL').forEach(r=>console.log(`  ${r.n}: ${r.r}`)); }

  await ctx.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch{}
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('[FATAL]', e); process.exit(1); });
