// DOM-parser replay: load v117_r4_history_raw.html in chromium, run the EXACT parse
// content.js does, and dump tds[2..7] textContent + extractLecDateTime results.
// This confirms what content.js actually sees in production.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync('/mnt/c/claude/staging/v117_r4_history_raw.html', 'utf-8');
const timeUtils = fs.readFileSync('/mnt/c/claude/swm-lecture-helper/lib/time_utils.js', 'utf-8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: timeUtils });

const result = await page.evaluate(({ html }) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // replicate content.js: tbody tr iteration, filter by mentoLec/view.do link
  const allRows = doc.querySelectorAll('tbody tr');
  const out = [];
  allRows.forEach(row => {
    const link = row.querySelector('td.tit a[href*="mentoLec/view.do"]') ||
                 row.querySelector('a[href*="mentoLec/view.do"]');
    if (!link) return;
    const m = (link.getAttribute('href') || '').match(/qustnrSn=(\d+)/);
    if (!m) return;
    const sn = m[1];
    const tds = row.querySelectorAll('td');

    let cancelled = false;
    tds.forEach(td => {
      const t = (td.textContent || '').replace(/\s+/g, ' ').trim();
      if (t === '접수취소' || t.includes('접수취소')) cancelled = true;
    });

    const tdTexts = [];
    tds.forEach(td => { tdTexts.push(td.textContent || ''); });

    // extractLecDateTime
    const td4raw = tds[4] ? (tds[4].textContent || '').trim() : '';
    const parsed = window.SWM_TIME ? window.SWM_TIME.extractLecDateTime(td4raw) : null;

    out.push({
      sn, cancelled,
      tds_raw: tdTexts,
      td4_raw: td4raw,
      td4_raw_bytes: Array.from(td4raw).slice(0, 50).map(c => c.charCodeAt(0)),
      td4_parsed: parsed,
    });
  });
  return out;
}, { html });

await browser.close();

console.log(JSON.stringify(result, null, 2));
fs.writeFileSync('/mnt/c/claude/staging/v117_r4_dom_replay.json', JSON.stringify(result, null, 2), 'utf-8');
console.error(`[r4] wrote dom_replay.json — ${result.length} rows`);
