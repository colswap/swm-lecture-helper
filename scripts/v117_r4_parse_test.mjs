// extractLecDateTime 를 tds[4] 실제 DOMParser-후 textContent 후보값으로 직접 테스트.
// DOMParser 는 `&nbsp` (no semicolon) 를 NBSP (U+00A0) 로 resolve — chromium 확인됨.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('/mnt/c/claude/swm-lecture-helper/lib/time_utils.js');

// 실 raw HTML:  `2026-04-17(금)<br/>&nbsp21:30:00  ~ 23:30:00`
// DOMParser textContent: "2026-04-17(금) 21:30:00  ~ 23:30:00" (br → newline 또는 no depending context)
// 실제로는 원본 HTML에 tr 내부에 br 없고, 주로 whitespace + nbsp.

const cases = [
  // (label, raw)
  ['colon-HHMMSS',   '2026-04-17(금) 21:30:00 ~ 23:30:00'],
  ['with-newlines',  '2026-04-17(금)\n\t\t\t 21:30:00  ~ 23:30:00'],
  ['colon-HHMM',     '2026-04-17(금) 21:30 ~ 23:30'],
  ['no-nbsp',        '2026-04-17(금) 21:30:00 ~ 23:30:00'],
  ['raw-literal-nbsp', '2026-04-17(금)\n\n\n&nbsp21:30:00 ~ 23:30:00'],  // if DOMParser didn't resolve
  ['detail-style',  '2026-04-17 21:30 ~ 23:30'],
  ['14:00-16:00',   '2026-04-15 14:00 ~ 16:00'],
];

for (const [label, raw] of cases) {
  const r = T.extractLecDateTime(raw);
  const bytes = Array.from(raw).slice(0, 40).map(c => c.charCodeAt(0).toString(16)).join(' ');
  console.log(`${label.padEnd(20)} lecDate="${r.lecDate}" lecTime="${r.lecTime}"`);
  // console.log(`  bytes: ${bytes}`);
}
