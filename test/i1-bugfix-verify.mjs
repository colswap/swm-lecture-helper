import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const htmlPath = path.resolve('timetable/timetable.html');
const url = pathToFileURL(htmlPath).href;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[cerror]', m.text()); });

await page.addInitScript(() => {
  const noop = () => {};
  const store = {};
  globalThis.chrome = {
    runtime: { id: 'test', onMessage: { addListener: noop }, sendMessage: noop, getManifest: () => ({ version: '0.0.0-test' }) },
    storage: {
      local: {
        get: (k, cb) => cb ? cb({}) : Promise.resolve({}),
        set: (v, cb) => { Object.assign(store, v); cb && cb(); return Promise.resolve(); },
        remove: (k, cb) => { cb && cb(); return Promise.resolve(); },
        onChanged: { addListener: noop },
      },
      onChanged: { addListener: noop },
    },
    tabs: { query: (_q, cb) => cb && cb([]), sendMessage: noop },
  };
});

await page.goto(url);
await page.waitForTimeout(500);

// dismiss any coachmark overlay so we can click the button
await page.evaluate(() => {
  document.querySelectorAll('.coachmark-root, .coachmark-backdrop').forEach(el => el.remove());
});

const btn = await page.$('#queryHelp');
const pop = await page.$('#queryHelpPopover');
if (!btn || !pop) {
  console.log('FAIL: missing button or popover');
  await browser.close();
  process.exit(1);
}

const hiddenBefore = await pop.evaluate(el => el.hidden);
// Click via DOM dispatch to bypass playwright's pointer-event stability guard (backdrop residue).
await btn.evaluate(el => el.click());
await page.waitForTimeout(200);
const hiddenAfter = await pop.evaluate(el => el.hidden);
// sanity: check that the button is NOT nested in the summary anymore
const btnParentTag = await btn.evaluate(el => el.parentElement && el.parentElement.tagName);
const btnInsideSummary = await btn.evaluate(el => !!el.closest('summary'));
console.log('btn parent tag:', btnParentTag, '| btn inside <summary>?', btnInsideSummary);

const hoverShadow = await page.evaluate(() => {
  const el = document.createElement('div');
  el.className = 'lec-block';
  el.setAttribute('data-cat', 'ai');
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '100px';
  el.style.height = '40px';
  document.body.appendChild(el);
  el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  const cs = getComputedStyle(el, ':hover');
  const baseShadow = getComputedStyle(el).boxShadow;
  return { baseShadow };
});

console.log('hiddenBefore:', hiddenBefore, '→ hiddenAfter:', hiddenAfter);
console.log('lec-block base boxShadow:', hoverShadow.baseShadow);
console.log(hiddenBefore === true && hiddenAfter === false ? 'PASS: ? button toggles popover' : 'FAIL: popover did not toggle');

await browser.close();
