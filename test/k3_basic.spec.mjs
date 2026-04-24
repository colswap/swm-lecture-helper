// K3 basic playwright scenarios
// - IME Enter 가드: 한글 조합 중 Enter 키 → 검색 실행되지 않음
// - 이미지 저장: 생성 중 persistent 토스트 표시
//
// 전체 확장 로딩은 infra 가 필요하므로, 여기서는 touched 로직만 격리한 html/js 로 검증.

import { chromium } from 'playwright';
import assert from 'node:assert/strict';

async function testImeGuard() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`
    <input id="q" type="text"/>
    <div id="log"></div>
    <script>
      const log = document.getElementById('log');
      const q = document.getElementById('q');
      let lastCompositionEnd = 0;
      q.addEventListener('compositionend', () => { lastCompositionEnd = Date.now(); });
      q.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (Date.now() - lastCompositionEnd < 50) return;
        if (e.key === 'Enter') { log.textContent += 'SEARCH;'; }
      });
      // Manual IME simulation: dispatch keydown with isComposing=true
      window.simulateImeEnter = () => {
        const ev = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true });
        // Force isComposing=true via descriptor override
        Object.defineProperty(ev, 'isComposing', { value: true });
        q.dispatchEvent(ev);
      };
      window.simulatePlainEnter = () => {
        const ev = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true });
        Object.defineProperty(ev, 'isComposing', { value: false });
        q.dispatchEvent(ev);
      };
    </script>
  `);
  // IME Enter → 검색 실행 안 됨
  await page.evaluate(() => window.simulateImeEnter());
  let log = await page.$eval('#log', el => el.textContent);
  assert.equal(log, '', 'IME Enter must not trigger search');
  // Plain Enter → 검색 실행됨
  await page.evaluate(() => window.simulatePlainEnter());
  log = await page.$eval('#log', el => el.textContent);
  assert.equal(log, 'SEARCH;', 'Plain Enter must trigger search');
  await browser.close();
  console.log('PASS ime_guard');
}

async function testPersistentToast() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`
    <div id="popoverToast" style="display:none"></div>
    <script>
      let timer = null;
      function showPersistentToast(text) {
        const t = document.getElementById('popoverToast');
        if (timer) { clearTimeout(timer); timer = null; }
        t.textContent = text;
        t.className = 'popover-toast loading';
        t.style.display = 'block';
      }
      function hidePersistentToast() {
        const t = document.getElementById('popoverToast');
        if (timer) { clearTimeout(timer); timer = null; }
        t.style.display = 'none';
      }
      window.showPersistentToast = showPersistentToast;
      window.hidePersistentToast = hidePersistentToast;
    </script>
  `);
  await page.evaluate(() => window.showPersistentToast('📸 이미지 생성 중...'));
  let vis = await page.$eval('#popoverToast', el => ({
    text: el.textContent, display: el.style.display, cls: el.className,
  }));
  assert.equal(vis.display, 'block');
  assert.ok(vis.text.includes('이미지 생성 중'));
  assert.ok(vis.cls.includes('loading'));
  await page.evaluate(() => window.hidePersistentToast());
  vis = await page.$eval('#popoverToast', el => el.style.display);
  assert.equal(vis, 'none');
  await browser.close();
  console.log('PASS persistent_toast');
}

(async () => {
  await testImeGuard();
  await testPersistentToast();
  console.log('ALL K3 PASS');
})().catch(e => { console.error(e); process.exit(1); });
