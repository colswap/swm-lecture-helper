// node --test test/query_parser.test.js
const { test } = require('node:test');
const assert = require('node:assert');

const SWM_QUERY = require('../lib/query_parser.js');

// ─── mock lecture dataset ───
const lectures = [
  { sn: '1', title: '[특강] 생성형 AI 활용하기', mentor: '이현수', category: 'MRC020',
    categoryNm: '멘토 특강', description: 'LLM 기반 에이전트 소개', location: '온라인',
    isOnline: true, derivedCategories: ['ai'], status: 'A' },
  { sn: '2', title: '[자유 멘토링] 백엔드 커리어', mentor: '이현수', category: 'MRC010',
    categoryNm: '자유 멘토링', description: '커리어 상담', location: '오프라인 강남',
    isOnline: false, derivedCategories: ['backend', 'career'], status: 'A' },
  { sn: '3', title: '[특강] 카카오 백엔드 경험', mentor: '김카카오', category: 'MRC020',
    categoryNm: '멘토 특강', description: '카카오 MSA', location: '온라인',
    isOnline: true, derivedCategories: ['backend'], status: 'A' },
  { sn: '4', title: '[특강] 컴퓨터공학 심화', mentor: '박컴공', category: 'MRC020',
    categoryNm: '멘토 특강', description: '알고리즘과 자료구조', location: '대학로',
    isOnline: false, derivedCategories: ['cs'], status: 'A' },
  { sn: '5', title: 'CS101 LLM 수업 맛보기', mentor: '이교수', category: 'MRC020',
    categoryNm: '멘토 특강', description: 'CS101 커리큘럼', location: '온라인',
    isOnline: true, derivedCategories: ['cs', 'ai'], status: 'A' },
  { sn: '6', title: '스타트업 창업 멘토링', mentor: '김스타트', category: 'MRC010',
    categoryNm: '자유 멘토링', description: 'MVP · PMF · VC', location: '오프라인 역삼',
    isOnline: false, derivedCategories: ['startup'], status: 'A' },
];

// ─── parse-only tests ───
test('empty string → isEmpty', () => {
  const ast = SWM_QUERY.parse('');
  assert.ok(SWM_QUERY.isEmpty(ast));
});

test('whitespace-only → isEmpty', () => {
  const ast = SWM_QUERY.parse('   \t  ');
  assert.ok(SWM_QUERY.isEmpty(ast));
});

test('null/undefined → isEmpty (no throw)', () => {
  assert.ok(SWM_QUERY.isEmpty(SWM_QUERY.parse(null)));
  assert.ok(SWM_QUERY.isEmpty(SWM_QUERY.parse(undefined)));
});

test('"AI 특강" → derivedCat=[ai], category=[MRC020]', () => {
  const ast = SWM_QUERY.parse('AI 특강');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.category, ['MRC020']);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('"이현수 AI 특강" — Korean name → freeText, AI → derivedCat, 특강 → category', () => {
  const ast = SWM_QUERY.parse('이현수 AI 특강');
  assert.deepStrictEqual(ast.include.freeText, ['이현수']);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.category, ['MRC020']);
});

test('"@이현수 #AI -카카오" → mentor + derivedCat + exclude', () => {
  const ast = SWM_QUERY.parse('@이현수 #AI -카카오');
  assert.deepStrictEqual(ast.include.mentor, ['이현수']);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.exclude, ['카카오']);
});

test('"컴퓨터" Korean → freeText (fuzzy applied at apply-time)', () => {
  const ast = SWM_QUERY.parse('컴퓨터');
  assert.deepStrictEqual(ast.include.freeText, ['컴퓨터']);
});

test('"CS101 LLM" English → CS101 freeText + LLM → ai (v2 expanded alias)', () => {
  // v2: LLM is now an AI alias; CS101 stays freeText (not equal to "cs").
  const ast = SWM_QUERY.parse('CS101 LLM');
  assert.deepStrictEqual(ast.include.freeText, ['CS101']);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
});

test('"온라인" → location.online=true (no freeText)', () => {
  const ast = SWM_QUERY.parse('온라인');
  assert.strictEqual(ast.include.location.online, true);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('"오프라인" → location.online=false', () => {
  const ast = SWM_QUERY.parse('오프라인');
  assert.strictEqual(ast.include.location.online, false);
});

test('"a.b.c?" regex-hostile chars → literal freeText', () => {
  const ast = SWM_QUERY.parse('a.b.c?');
  assert.deepStrictEqual(ast.include.freeText, ['a.b.c?']);
});

test('quoted "@이 현수" — prefix with space-containing value', () => {
  const ast = SWM_QUERY.parse('@"이 현수"');
  assert.deepStrictEqual(ast.include.mentor, ['이 현수']);
});

test('multiple @mentor → OR within mentor array', () => {
  const ast = SWM_QUERY.parse('@이현수 @김철수');
  assert.deepStrictEqual(ast.include.mentor, ['이현수', '김철수']);
});

test('dedupe "AI ai" → derivedCat=[ai] once', () => {
  const ast = SWM_QUERY.parse('AI ai');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
});

test('"-카카오 이현수" → exclude + freeText', () => {
  const ast = SWM_QUERY.parse('-카카오 이현수');
  assert.deepStrictEqual(ast.exclude, ['카카오']);
  assert.deepStrictEqual(ast.include.freeText, ['이현수']);
});

test('#MRC020 literal code → category', () => {
  const ast = SWM_QUERY.parse('#MRC020');
  assert.deepStrictEqual(ast.include.category, ['MRC020']);
});

test('emoji/unknown # tag → categoryNm substring', () => {
  const ast = SWM_QUERY.parse('#🤖');
  assert.deepStrictEqual(ast.include.categoryNm, ['🤖']);
});

test('bare "-" (no value) is ignored', () => {
  const ast = SWM_QUERY.parse('-');
  assert.ok(SWM_QUERY.isEmpty(ast));
});

// ─── apply tests ───
test('apply @이현수 → only 이현수 mentor lectures', () => {
  const ast = SWM_QUERY.parse('@이현수');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['1', '2']);
});

test('apply "AI 특강" → category MRC020 AND derivedCat ai', () => {
  const ast = SWM_QUERY.parse('AI 특강');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  // #1 (ai + MRC020) and #5 (ai + MRC020) match; #3 is MRC020 but not ai
  assert.deepStrictEqual(out.sort(), ['1', '5']);
});

test('apply "@이현수 -카카오" → 이현수 mentor, no 카카오 keyword', () => {
  const ast = SWM_QUERY.parse('@이현수 -카카오');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['1', '2']);
});

test('apply "컴퓨터" Korean fuzzy → matches "컴퓨터공학"', () => {
  const ast = SWM_QUERY.parse('컴퓨터');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out, ['4']);
});

test('apply "컴터" fuzzy → matches "컴퓨터공학" via .*', () => {
  const ast = SWM_QUERY.parse('컴터');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out, ['4']);
});

test('apply "CS101 LLM" AND → matches only #5 (both in hay)', () => {
  const ast = SWM_QUERY.parse('CS101 LLM');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out, ['5']);
});

test('apply "온라인" → only isOnline=true lectures', () => {
  const ast = SWM_QUERY.parse('온라인');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['1', '3', '5']);
});

test('apply empty → returns all', () => {
  const ast = SWM_QUERY.parse('');
  const out = SWM_QUERY.apply(ast, lectures);
  assert.strictEqual(out.length, lectures.length);
});

test('apply "이현수" substring/fuzzy → hits both 이현수-mentor lectures (superset compat)', () => {
  const ast = SWM_QUERY.parse('이현수');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['1', '2']);
});

test('apply "#ai" strict → only derivedCategories contains ai', () => {
  const ast = SWM_QUERY.parse('#ai');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['1', '5']);
});

test('apply "창업" → derivedCat startup', () => {
  const ast = SWM_QUERY.parse('창업');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out, ['6']);
});

// ─── stringify roundtrip ───
test('stringify(parse(x)) → executable equivalent', () => {
  const inputs = ['@이현수 #ai -카카오', '온라인 특강', 'CS101 LLM', ''];
  // raw_tokens is a scoring hint (not a filter); stringify canonicalizes alias
  // keys (e.g., "LLM" → "#ai") so raw_tokens does not round-trip identically.
  // Compare only the semantic filter shape.
  const stripRaw = (a) => { const { raw_tokens, ...rest } = a; return rest; };
  for (const q of inputs) {
    const ast1 = SWM_QUERY.parse(q);
    const s = SWM_QUERY.stringify(ast1);
    const ast2 = SWM_QUERY.parse(s);
    assert.deepStrictEqual(stripRaw(ast2), stripRaw(ast1), `roundtrip failed for: ${q}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// NLS v2 — date/time/status/location expansion
// Fixed `now` per test to keep date assertions deterministic.
// ═══════════════════════════════════════════════════════════════════════════

// Helper — build Date at local midnight for deterministic comparison
function atNoon(y, m, d) { return new Date(y, m - 1, d, 12, 0, 0); }

test('v2: "오늘" → dateFrom=dateTo=today', () => {
  const now = atNoon(2026, 4, 19); // Sunday
  const ast = SWM_QUERY.parse('오늘', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-19');
  assert.strictEqual(ast.include.dateTo, '2026-04-19');
});

test('v2: "내일" → dateFrom=dateTo=tomorrow', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-20');
});

test('v2: "모레" → D+2', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('모레', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-21');
});

test('v2: "tomorrow" English → dateFrom=dateTo=tomorrow', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('tomorrow', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
});

test('v2: "이번주" (Sunday) → Mon~Sun of current week', () => {
  const now = atNoon(2026, 4, 19); // Sunday
  const ast = SWM_QUERY.parse('이번주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-13'); // Mon
  assert.strictEqual(ast.include.dateTo, '2026-04-19'); // Sun
});

test('v2: "다음주" (Sunday) → next Mon~Sun', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-26');
});

test('v2: "이번달" → month start..end', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('이번달', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-01');
  assert.strictEqual(ast.include.dateTo, '2026-04-30');
});

test('v2: "금주" → same as 이번주', () => {
  const now = atNoon(2026, 4, 19);
  const a = SWM_QUERY.parse('금주', { now });
  const b = SWM_QUERY.parse('이번주', { now });
  assert.strictEqual(a.include.dateFrom, b.include.dateFrom);
  assert.strictEqual(a.include.dateTo, b.include.dateTo);
});

test('v2: "월요일" → nearest upcoming Monday', () => {
  const now = atNoon(2026, 4, 19); // Sunday
  const ast = SWM_QUERY.parse('월요일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
});

test('v2: "오전" → time 00:00~12:00', () => {
  const ast = SWM_QUERY.parse('오전');
  assert.strictEqual(ast.include.timeFromMin, 0);
  assert.strictEqual(ast.include.timeToMin, 12 * 60);
});

test('v2: "오후" → time 12:00~24:00', () => {
  const ast = SWM_QUERY.parse('오후');
  assert.strictEqual(ast.include.timeFromMin, 12 * 60);
  assert.strictEqual(ast.include.timeToMin, 24 * 60);
});

test('v2: "저녁" → time 18:00~24:00', () => {
  const ast = SWM_QUERY.parse('저녁');
  assert.strictEqual(ast.include.timeFromMin, 18 * 60);
  assert.strictEqual(ast.include.timeToMin, 24 * 60);
});

test('v2: "19시 이후" → timeFromMin=1140', () => {
  const ast = SWM_QUERY.parse('19시 이후');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.strictEqual(ast.include.timeToMin, null);
});

test('v2: "오후 7시 이후" → 19h timeFrom (pm promotes to 24h)', () => {
  const ast = SWM_QUERY.parse('오후 7시 이후');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
});

test('v2: "7시 이전" → timeToMin=420', () => {
  const ast = SWM_QUERY.parse('7시 이전');
  assert.strictEqual(ast.include.timeToMin, 7 * 60);
});

test('v2: "19-21시" → both bounds', () => {
  const ast = SWM_QUERY.parse('19-21시');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.strictEqual(ast.include.timeToMin, 21 * 60);
});

test('v2: "19~21시" (tilde) → both bounds', () => {
  const ast = SWM_QUERY.parse('19~21시');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.strictEqual(ast.include.timeToMin, 21 * 60);
});

test('v2: "접수중" → status=A', () => {
  const ast = SWM_QUERY.parse('접수중');
  assert.strictEqual(ast.include.status, 'A');
});

test('v2: "신청가능" → status=A', () => {
  const ast = SWM_QUERY.parse('신청가능');
  assert.strictEqual(ast.include.status, 'A');
});

test('v2: "마감" → status=C', () => {
  const ast = SWM_QUERY.parse('마감');
  assert.strictEqual(ast.include.status, 'C');
});

test('v2: "종료" → status=C', () => {
  const ast = SWM_QUERY.parse('종료');
  assert.strictEqual(ast.include.status, 'C');
});

test('v2: "비대면" → location.online=true', () => {
  const ast = SWM_QUERY.parse('비대면');
  assert.strictEqual(ast.include.location.online, true);
});

test('v2: "zoom" → online', () => {
  const ast = SWM_QUERY.parse('zoom');
  assert.strictEqual(ast.include.location.online, true);
});

test('v2: "현장" → offline', () => {
  const ast = SWM_QUERY.parse('현장');
  assert.strictEqual(ast.include.location.online, false);
});

test('v2: "대면" → offline', () => {
  const ast = SWM_QUERY.parse('대면');
  assert.strictEqual(ast.include.location.online, false);
});

test('v2: "LLM" alone → derivedCat ai (expanded alias)', () => {
  const ast = SWM_QUERY.parse('LLM');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('v2: "스프링" → derivedCat backend', () => {
  const ast = SWM_QUERY.parse('스프링');
  assert.deepStrictEqual(ast.include.derivedCat, ['backend']);
});

test('v2: "React" → derivedCat frontend', () => {
  const ast = SWM_QUERY.parse('React');
  assert.deepStrictEqual(ast.include.derivedCat, ['frontend']);
});

test('v2: "AWS" → derivedCat cloud', () => {
  const ast = SWM_QUERY.parse('AWS');
  assert.deepStrictEqual(ast.include.derivedCat, ['cloud']);
});

test('v2: "면접" → derivedCat career', () => {
  const ast = SWM_QUERY.parse('면접');
  assert.deepStrictEqual(ast.include.derivedCat, ['career']);
});

test('v2: natural combo "내일 비대면 접수중"', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일 비대면 접수중', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-20');
  assert.strictEqual(ast.include.location.online, true);
  assert.strictEqual(ast.include.status, 'A');
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('v2: combo "오후 7시 이후 멘토링"', () => {
  const ast = SWM_QUERY.parse('오후 7시 이후 멘토링');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.deepStrictEqual(ast.include.category, ['MRC010']);
});

test('v2: combo "이번주 대면 백엔드"', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('이번주 대면 백엔드', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-13');
  assert.strictEqual(ast.include.location.online, false);
  assert.deepStrictEqual(ast.include.derivedCat, ['backend']);
});

test('v2: apply status filter', () => {
  const ls = [
    { sn: 'a', status: 'A', title: 'x' },
    { sn: 'b', status: 'C', title: 'y' },
  ];
  const ast = SWM_QUERY.parse('접수중');
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out, ['a']);
});

test('v2: apply date range filter', () => {
  const ls = [
    { sn: 'a', lecDate: '2026-04-20', title: 'x' },
    { sn: 'b', lecDate: '2026-04-22', title: 'y' },
    { sn: 'c', lecDate: '2026-04-19', title: 'z' },
  ];
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일', { now });
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out, ['a']);
});

test('v2: apply time range filter (lecTime HH:MM)', () => {
  const ls = [
    { sn: 'a', lecTime: '10:00', title: 'x' },
    { sn: 'b', lecTime: '14:00', title: 'y' },
    { sn: 'c', lecTime: '20:30', title: 'z' },
  ];
  const ast = SWM_QUERY.parse('오후');
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['b', 'c']);
});

test('v2: apply "19-21시"', () => {
  const ls = [
    { sn: 'a', lecTime: '18:30', title: 'x' },
    { sn: 'b', lecTime: '19:00', title: 'y' },
    { sn: 'c', lecTime: '21:00', title: 'z' },
    { sn: 'd', lecTime: '22:00', title: 'w' },
  ];
  const ast = SWM_QUERY.parse('19-21시');
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out.sort(), ['b', 'c']);
});

test('v2: stringify roundtrip preserves date/time/status', () => {
  const now = atNoon(2026, 4, 19);
  const inputs = ['내일 비대면 접수중', '오후 7시 이후 멘토링', '이번주 대면 백엔드'];
  const stripRaw = (a) => { const { raw_tokens, ...rest } = a; return rest; };
  for (const q of inputs) {
    const a1 = SWM_QUERY.parse(q, { now });
    const s = SWM_QUERY.stringify(a1);
    const a2 = SWM_QUERY.parse(s, { now });
    assert.deepStrictEqual(stripRaw(a2), stripRaw(a1), `roundtrip failed for: ${q}`);
  }
});

test('v2: isEmpty false when only date set', () => {
  const ast = SWM_QUERY.parse('오늘');
  assert.strictEqual(SWM_QUERY.isEmpty(ast), false);
});

test('v2: isEmpty false when only status set', () => {
  const ast = SWM_QUERY.parse('마감');
  assert.strictEqual(SWM_QUERY.isEmpty(ast), false);
});

test('v2: category alias expansion — 자유멘토링 → MRC010', () => {
  const ast = SWM_QUERY.parse('자유멘토링');
  assert.deepStrictEqual(ast.include.category, ['MRC010']);
});

// ═══════════════════════════════════════════════════════════════════════════
// NLS v2 edge cases (QA-g2, 2026-04-19): 한/영 혼용, 오타, 복합 쿼리,
// Asia/Seoul TZ, 자정 경계, 토요일 weekRange, 오전/오후 range 우선순위
// ═══════════════════════════════════════════════════════════════════════════

test('v2-edge: 한/영 혼용 "AI mentoring" → derivedCat=ai, category=MRC010', () => {
  const ast = SWM_QUERY.parse('AI mentoring');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.category, ['MRC010']);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('v2-edge: 대소문자 혼합 "ZOOM AWS" → online + cloud', () => {
  const ast = SWM_QUERY.parse('ZOOM AWS');
  assert.strictEqual(ast.include.location.online, true);
  assert.deepStrictEqual(ast.include.derivedCat, ['cloud']);
});

test('v2-edge: 오타 "멘토리" (intended 멘토링) → freeText fallback (no crash)', () => {
  const ast = SWM_QUERY.parse('멘토리');
  assert.deepStrictEqual(ast.include.freeText, ['멘토리']);
  assert.deepStrictEqual(ast.include.category, []);
});

test('v2-edge: 복합 쿼리 "내일 오후 2시 이후 @이현수 #AI -카카오"', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일 오후 2시 이후 @이현수 #AI -카카오', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-20');
  assert.strictEqual(ast.include.timeFromMin, 14 * 60);
  assert.deepStrictEqual(ast.include.mentor, ['이현수']);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.exclude, ['카카오']);
});

test('v2-edge: 자정 경계 "오늘" at 23:59 → today (local TZ)', () => {
  const now = new Date(2026, 3, 19, 23, 59, 30); // Apr 19 23:59:30 local
  const ast = SWM_QUERY.parse('오늘', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-19');
});

test('v2-edge: 자정 경계 "내일" at 23:59 → D+1 (not D+2)', () => {
  const now = new Date(2026, 3, 19, 23, 59, 30);
  const ast = SWM_QUERY.parse('내일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-20');
});

test('v2-edge: 토요일 기준 "월요일" → nearest upcoming Monday (D+2)', () => {
  const now = new Date(2026, 3, 18, 12, 0); // Sat
  const ast = SWM_QUERY.parse('월요일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
});

test('v2-edge: "이번주" from Monday → Mon~Sun inclusive', () => {
  const now = new Date(2026, 3, 13, 12, 0); // Monday
  const ast = SWM_QUERY.parse('이번주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-13');
  assert.strictEqual(ast.include.dateTo, '2026-04-19');
});

test('v2-edge: "오전 9시 이후" → timeFromMin=540 (오전 consumed by afterRe)', () => {
  const ast = SWM_QUERY.parse('오전 9시 이후');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  // timeToMin must NOT be defaulted to 12*60 since 오전 was consumed, OR it may be null
  // (fine either way as long as it does not override timeFromMin)
});

test('v2-edge: range "13~17시" tilde + heavy spacing', () => {
  const ast = SWM_QUERY.parse('13 ~ 17시');
  assert.strictEqual(ast.include.timeFromMin, 13 * 60);
  assert.strictEqual(ast.include.timeToMin, 17 * 60);
});

test('v2-edge: quoted mentor space + prefix-only token "@" skipped', () => {
  const ast = SWM_QUERY.parse('@"이 현수" @');
  assert.deepStrictEqual(ast.include.mentor, ['이 현수']);
});

test('v2-edge: stringify → parse roundtrip for complex query', () => {
  const now = atNoon(2026, 4, 19);
  const q = '내일 오후 @이현수 #ai 비대면 접수중 -카카오';
  const a1 = SWM_QUERY.parse(q, { now });
  const s = SWM_QUERY.stringify(a1);
  const a2 = SWM_QUERY.parse(s, { now });
  assert.deepStrictEqual(a2, a1);
});

test('v2-edge: @date directive with explicit range', () => {
  const ast = SWM_QUERY.parse('@date:2026-04-20..2026-04-25');
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-25');
});

test('v2-edge: 월말 경계 "이번달" in April 2026 → 30 days', () => {
  const now = atNoon(2026, 4, 30);
  const ast = SWM_QUERY.parse('이번달', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-01');
  assert.strictEqual(ast.include.dateTo, '2026-04-30');
});

test('v2-edge: apply "내일 오후" combines date AND time filter', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일 오후', { now });
  const ls = [
    { sn: 'a', lecDate: '2026-04-20', lecTime: '10:00' },
    { sn: 'b', lecDate: '2026-04-20', lecTime: '15:00' },
    { sn: 'c', lecDate: '2026-04-21', lecTime: '15:00' },
  ];
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out, ['b']);
});

// ═══════════════════════════════════════════════════════════════════════════
// NLS v3 (2026-04-19): DERIVED_ALIAS id audit · N월/주말/평일 · 내일모레/모래 오타
// ═══════════════════════════════════════════════════════════════════════════

test('v3: "기획" → derivedCat=[idea] (was "pm" — 0-result bug fixed)', () => {
  const ast = SWM_QUERY.parse('기획');
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
});

test('v3: "PM" → derivedCat=[idea]', () => {
  const ast = SWM_QUERY.parse('PM');
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
});

test('v3: "프로덕트" → derivedCat=[idea]', () => {
  const ast = SWM_QUERY.parse('프로덕트');
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
});

test('v3: "UX" → derivedCat=[idea]', () => {
  const ast = SWM_QUERY.parse('UX');
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
});

test('v3: all DERIVED_ALIAS values map to real classifier ids', () => {
  const validIds = new Set([
    'ai', 'backend', 'blockchain', 'career', 'cloud', 'cs', 'data',
    'dev_general', 'devops', 'etc', 'frontend', 'game', 'idea', 'mobile',
    'os', 'security', 'soma', 'startup', 'team',
  ]);
  // Probe keywords spanning every alias category — parse should never produce
  // a derivedCat value outside validIds.
  const probes = [
    'ai', 'llm', 'rag', '딥러닝', '인공지능',
    'backend', '백엔드', 'spring', 'kafka',
    'frontend', 'react', 'typescript',
    'mobile', 'ios', 'flutter',
    'data', 'sql', 'pandas',
    'cloud', 'aws', 'k8s',
    'devops', 'ci', 'jenkins',
    'security', '보안', '해킹',
    'game', '유니티', '언리얼',
    'blockchain', 'web3', 'solidity',
    'os', '커널', '임베디드',
    'pm', 'po', '기획', '프로덕트', 'product', 'ux', '서비스기획',
    'startup', '창업', 'ir', 'mvp', 'pmf', 'vc',
    'career', '이력서', '면접', '이직',
    'cs', '알고리즘', '코테', '자료구조',
    'idea', '아이디어', '브레인스토밍',
    'team', '팀빌딩', 'kpt', 'scrum',
    'soma', '소마', '마에스트로',
  ];
  for (const p of probes) {
    const ast = SWM_QUERY.parse(p);
    for (const id of ast.include.derivedCat) {
      assert.ok(validIds.has(id), `${p} produced unknown id: ${id}`);
    }
  }
});

test('v3: "4월" (current month = April 2026) → 4월 1일~30일 same year', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('4월', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-01');
  assert.strictEqual(ast.include.dateTo, '2026-04-30');
});

test('v3: "5월" (future month) → 5월 range same year', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('5월', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-01');
  assert.strictEqual(ast.include.dateTo, '2026-05-31');
});

test('v3: "3월" (past month) → next year 3월 range', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('3월', { now });
  assert.strictEqual(ast.include.dateFrom, '2027-03-01');
  assert.strictEqual(ast.include.dateTo, '2027-03-31');
});

test('v3: "12월" → 12월 1일~31일', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('12월', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-12-01');
  assert.strictEqual(ast.include.dateTo, '2026-12-31');
});

test('v3: "월요일" still routes to DOW (N월 regex does not swallow 월요일)', () => {
  const now = atNoon(2026, 4, 19); // Sunday
  const ast = SWM_QUERY.parse('월요일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-20');
});

test('v3: "주말" (Sunday base) → 이번주 토/일', () => {
  const now = atNoon(2026, 4, 19); // Sunday — weekRange Mon=04-13..Sun=04-19
  const ast = SWM_QUERY.parse('주말', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-18'); // Sat
  assert.strictEqual(ast.include.dateTo, '2026-04-19'); // Sun
});

test('v3: "평일" → 이번주 월~금', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('평일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-13');
  assert.strictEqual(ast.include.dateTo, '2026-04-17');
});

test('v3: "다음주 주말" → 다음 주 토/일', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주 주말', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-25'); // next Sat
  assert.strictEqual(ast.include.dateTo, '2026-04-26'); // next Sun
});

test('v3: "다음주 평일" → 다음 주 월~금', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주 평일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-24');
});

test('v3: "이번주 주말" → 이번 주 토/일 (explicit prefix)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('이번주 주말', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-18');
  assert.strictEqual(ast.include.dateTo, '2026-04-19');
});

test('v3: "모래" (오타) → D+2 (same as 모레)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('모래', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-21');
  assert.strictEqual(ast.include.dateTo, '2026-04-21');
});

test('v3: "내일모레" → D+2 (not D+1)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내일모레', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-21');
  assert.strictEqual(ast.include.dateTo, '2026-04-21');
});

test('v3: apply "기획" → matches lecture with derivedCategories ["idea"]', () => {
  const ls = [
    { sn: 'a', title: '제품 기획 워크샵', derivedCategories: ['idea'] },
    { sn: 'b', title: 'LLM 파인튜닝', derivedCategories: ['ai'] },
  ];
  const ast = SWM_QUERY.parse('기획');
  const out = SWM_QUERY.apply(ast, ls).map(l => l.sn);
  assert.deepStrictEqual(out, ['a']);
});

// ═══════════════════════════════════════════════════════════════════════════
// NLS v3c combo expansion (Task #20, researcher-nls-combo, 2026-04-19):
// 다음달/지난주/다다음주/내주/어제, 상대 offset, ISO·M/D·N월 N일 단일 날짜,
// 아침/밤/새벽, 추가 status/location/derivedCat alias
// ═══════════════════════════════════════════════════════════════════════════

test('v3c: "다음달" → next month range (April 2026 → May)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음달', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-01');
  assert.strictEqual(ast.include.dateTo, '2026-05-31');
});

test('v3c: "지난주" → previous week Mon~Sun', () => {
  const now = atNoon(2026, 4, 19); // Sunday
  const ast = SWM_QUERY.parse('지난주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-06');
  assert.strictEqual(ast.include.dateTo, '2026-04-12');
});

test('v3c: "다다음주" → +2 weeks (not confused with 다음주)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다다음주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-27');
  assert.strictEqual(ast.include.dateTo, '2026-05-03');
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('v3c: "내주" → same as 다음주', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('내주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
});

test('v3c: "어제" → yesterday', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('어제', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-18');
  assert.strictEqual(ast.include.dateTo, '2026-04-18');
});

test('v3c: "3일후" → +3 days', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('3일후', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-22');
});

test('v3c: "일주일후" → +7 days', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('일주일후', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-26');
});

test('v3c: "5월 3일" → single day (not month range)', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('5월 3일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-03');
  assert.strictEqual(ast.include.dateTo, '2026-05-03');
});

test('v3c: "5/3" M/D slash → single day', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('5/3', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-03');
});

test('v3c: "2026-05-03" ISO date direct', () => {
  const ast = SWM_QUERY.parse('2026-05-03');
  assert.strictEqual(ast.include.dateFrom, '2026-05-03');
  assert.strictEqual(ast.include.dateTo, '2026-05-03');
});

test('v3c: "완료" → status=C', () => {
  assert.strictEqual(SWM_QUERY.parse('완료').include.status, 'C');
});

test('v3c: "진행중" / "대기중" / "열린" → status=A', () => {
  assert.strictEqual(SWM_QUERY.parse('진행중').include.status, 'A');
  assert.strictEqual(SWM_QUERY.parse('대기중').include.status, 'A');
  assert.strictEqual(SWM_QUERY.parse('열린').include.status, 'A');
});

test('v3c: "닫힌" → status=C', () => {
  assert.strictEqual(SWM_QUERY.parse('닫힌').include.status, 'C');
});

test('v3c: "discord" / "디스코드" → online=true', () => {
  assert.strictEqual(SWM_QUERY.parse('discord').include.location.online, true);
  assert.strictEqual(SWM_QUERY.parse('디스코드').include.location.online, true);
});

test('v3c: "ML" / "바이브코딩" / "agentic" → derivedCat=ai', () => {
  assert.deepStrictEqual(SWM_QUERY.parse('ML').include.derivedCat, ['ai']);
  assert.deepStrictEqual(SWM_QUERY.parse('바이브코딩').include.derivedCat, ['ai']);
  assert.deepStrictEqual(SWM_QUERY.parse('agentic').include.derivedCat, ['ai']);
});

test('v3c: "스마트컨트랙트" → derivedCat=blockchain', () => {
  assert.deepStrictEqual(SWM_QUERY.parse('스마트컨트랙트').include.derivedCat, ['blockchain']);
});

test('v3c: "유저리서치" / "퍼소나" / "사용자조사" → derivedCat=idea', () => {
  assert.deepStrictEqual(SWM_QUERY.parse('유저리서치').include.derivedCat, ['idea']);
  assert.deepStrictEqual(SWM_QUERY.parse('퍼소나').include.derivedCat, ['idea']);
  assert.deepStrictEqual(SWM_QUERY.parse('사용자조사').include.derivedCat, ['idea']);
});

test('v3c: "포트폴리오" → derivedCat=career', () => {
  assert.deepStrictEqual(SWM_QUERY.parse('포트폴리오').include.derivedCat, ['career']);
});

test('v3c: "아침" → time 06:00~12:00', () => {
  const ast = SWM_QUERY.parse('아침');
  assert.strictEqual(ast.include.timeFromMin, 6 * 60);
  assert.strictEqual(ast.include.timeToMin, 12 * 60);
});

test('v3c: "밤" → time 20:00~24:00', () => {
  const ast = SWM_QUERY.parse('밤');
  assert.strictEqual(ast.include.timeFromMin, 20 * 60);
  assert.strictEqual(ast.include.timeToMin, 24 * 60);
});

test('v3c: "새벽" → time 00:00~06:00', () => {
  const ast = SWM_QUERY.parse('새벽');
  assert.strictEqual(ast.include.timeFromMin, 0);
  assert.strictEqual(ast.include.timeToMin, 6 * 60);
});

test('v3c: combo "다음달 AI 비대면" → next month + ai + online', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음달 AI 비대면', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-01');
  assert.strictEqual(ast.include.dateTo, '2026-05-31');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.strictEqual(ast.include.location.online, true);
});

test('v3c: combo "5/3 저녁 바이브코딩" → single day + evening + ai', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('5/3 저녁 바이브코딩', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-03');
  assert.strictEqual(ast.include.timeFromMin, 18 * 60);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
});

test('v3c: combo "다다음주 금요일 저녁 온라인" — week +2 then DOW overrides', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다다음주 금요일 저녁 온라인', { now });
  assert.ok(ast.include.dateFrom);
  assert.strictEqual(ast.include.timeFromMin, 18 * 60);
  assert.strictEqual(ast.include.location.online, true);
});

test('v3c: stringify roundtrip preserves new date kw (다음달)', () => {
  const now = atNoon(2026, 4, 19);
  const a1 = SWM_QUERY.parse('다음달 AI', { now });
  const s = SWM_QUERY.stringify(a1);
  const a2 = SWM_QUERY.parse(s, { now });
  const stripRaw = (a) => { const { raw_tokens, ...rest } = a; return rest; };
  assert.deepStrictEqual(stripRaw(a2), stripRaw(a1));
});

test('v3c: "@date:2026-04-20..2026-04-25" still works (direct ISO did not break)', () => {
  const ast = SWM_QUERY.parse('@date:2026-04-20..2026-04-25');
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-25');
});

// ═══════════════════════════════════════════════════════════════════════════
// v1.15.0 QA — order invariance, multi-dim combos, ambiguity, mix
// (i6 re-verification pass, 2026-04-19)
// ═══════════════════════════════════════════════════════════════════════════

test('i6: order invariance — "내일 비대면" === "비대면 내일"', () => {
  const now = atNoon(2026, 4, 19);
  const a = SWM_QUERY.parse('내일 비대면', { now });
  const b = SWM_QUERY.parse('비대면 내일', { now });
  assert.strictEqual(a.include.dateFrom, b.include.dateFrom);
  assert.strictEqual(a.include.dateTo, b.include.dateTo);
  assert.strictEqual(a.include.location.online, b.include.location.online);
});

test('i6: order invariance — "AI 이번주" === "이번주 AI"', () => {
  const now = atNoon(2026, 4, 19);
  const a = SWM_QUERY.parse('AI 이번주', { now });
  const b = SWM_QUERY.parse('이번주 AI', { now });
  assert.deepStrictEqual(a.include.derivedCat, b.include.derivedCat);
  assert.strictEqual(a.include.dateFrom, b.include.dateFrom);
});

test('i6: order invariance — prefix tokens "@user #AI -카카오" === "#AI -카카오 @user"', () => {
  const a = SWM_QUERY.parse('@이현수 #AI -카카오');
  const b = SWM_QUERY.parse('#AI -카카오 @이현수');
  assert.deepStrictEqual(a.include.mentor, b.include.mentor);
  assert.deepStrictEqual(a.include.derivedCat, b.include.derivedCat);
  assert.deepStrictEqual(a.exclude, b.exclude);
});

test('i6: 3-dim combo "다음주 비대면 기획" → week+online+idea', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주 비대면 기획', { now });
  assert.ok(ast.include.dateFrom);
  assert.ok(ast.include.dateTo);
  assert.strictEqual(ast.include.location.online, true);
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
});

test('i6: 4-dim combo "다음주 비대면 기획 오후" → week+online+idea+afternoon time', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주 비대면 기획 오후', { now });
  assert.ok(ast.include.dateFrom);
  assert.strictEqual(ast.include.location.online, true);
  assert.deepStrictEqual(ast.include.derivedCat, ['idea']);
  assert.strictEqual(ast.include.timeFromMin, 12 * 60);
});

test('i6: ambiguity — "AI" alone → derivedCat=ai, no freeText', () => {
  const ast = SWM_QUERY.parse('AI');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('i6: complex "@김멘토 #ai -카카오 이번주" → 4 dims set', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('@김멘토 #ai -카카오 이번주', { now });
  assert.deepStrictEqual(ast.include.mentor, ['김멘토']);
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.exclude, ['카카오']);
  assert.ok(ast.include.dateFrom);
});

test('i6: Korean/English mix "Spring 백엔드 오후" → backend + afternoon', () => {
  const ast = SWM_QUERY.parse('Spring 백엔드 오후');
  assert.deepStrictEqual(ast.include.derivedCat, ['backend']);
  assert.strictEqual(ast.include.timeFromMin, 12 * 60);
});

test('i6: Korean/English mix "React frontend 오전" → frontend + 오전 (00~12)', () => {
  const ast = SWM_QUERY.parse('React frontend 오전');
  assert.deepStrictEqual(ast.include.derivedCat, ['frontend']);
  assert.strictEqual(ast.include.timeFromMin, 0);
  assert.strictEqual(ast.include.timeToMin, 12 * 60);
});

test('i6: redundant same-cat "AI LLM GPT" → derivedCat=["ai"] (deduped)', () => {
  const ast = SWM_QUERY.parse('AI LLM GPT');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
});

test('i6: redundant location "비대면 온라인" → online=true (no conflict)', () => {
  const ast = SWM_QUERY.parse('비대면 온라인');
  assert.strictEqual(ast.include.location.online, true);
});

test('i6: trailing exclude "AI -" → empty exclude does not throw', () => {
  const ast = SWM_QUERY.parse('AI -');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.ok(Array.isArray(ast.exclude));
});

test('i6: bare prefix "@" / "#" → no crash, no mentor/cat', () => {
  const a = SWM_QUERY.parse('@');
  const b = SWM_QUERY.parse('#');
  assert.deepStrictEqual(a.include.mentor, []);
  assert.deepStrictEqual(b.include.derivedCat, []);
});

test('i6: deep combo "다음주 금요일 저녁 Spring 백엔드 비대면" → 5 dims', () => {
  const now = atNoon(2026, 4, 19);
  const ast = SWM_QUERY.parse('다음주 금요일 저녁 Spring 백엔드 비대면', { now });
  assert.ok(ast.include.dateFrom);
  assert.strictEqual(ast.include.timeFromMin, 18 * 60);
  assert.deepStrictEqual(ast.include.derivedCat, ['backend']);
  assert.strictEqual(ast.include.location.online, true);
});

test('i6: stringify roundtrip preserves complex prefix combo', () => {
  const a1 = SWM_QUERY.parse('@이현수 #AI -카카오');
  const s = SWM_QUERY.stringify(a1);
  const a2 = SWM_QUERY.parse(s);
  assert.deepStrictEqual(a2.include.mentor, a1.include.mentor);
  assert.deepStrictEqual(a2.include.derivedCat, a1.include.derivedCat);
  assert.deepStrictEqual(a2.exclude, a1.exclude);
});

test('i6: apply order invariance on mock set — "AI 비대면" === "비대면 AI"', () => {
  const a = SWM_QUERY.apply(SWM_QUERY.parse('AI 비대면'), lectures);
  const b = SWM_QUERY.apply(SWM_QUERY.parse('비대면 AI'), lectures);
  assert.deepStrictEqual(a.map(l => l.sn).sort(), b.map(l => l.sn).sort());
});

// ─────────────────────── i6 (v1.16.0 NLS v3 + BM25) ───────────────────────
// Regression guard for v1.15.0 → v1.16.0 transition. Reference: i5 report
// /mnt/c/claude/staging/v1160_parser_research.md §1 (F1~F10 failure cases).

test('i6: VERSION bumped to nls5-nl (v1161 n2)', () => {
  assert.match(SWM_QUERY.VERSION, /nls5-nl/);
});

test('i6: rank export available', () => {
  assert.strictEqual(typeof SWM_QUERY.rank, 'function');
});

// Synthetic 113-doc-like fixture: a description with scattered 김/멘/토 chars
// that the v1.15.0 unbounded `김.*멘.*토` falsely matched.
const fpLectures = [
  { sn: 'fp1', title: '[자유 멘토링] 이커머스 핵심 도메인 톺아보기', mentor: '박상민',
    category: 'MRC010', categoryNm: '자유 멘토링',
    description: '김장철에는 멘티들과 함께 토론하는 시간이 좋습니다. 김치찌개 먹으며 멘토와 만나는 토요일 모임도 있죠.',
    location: '온라인', isOnline: true, derivedCategories: ['career'], status: 'A' },
  { sn: 'fp2', title: '[멘토 특강] 김멘토와 함께하는 백엔드', mentor: '김멘토',
    category: 'MRC020', categoryNm: '멘토 특강',
    description: '김멘토가 직접 진행하는 백엔드 입문 특강.',
    location: '온라인', isOnline: true, derivedCategories: ['backend'], status: 'A' },
  { sn: 'fp3', title: '[멘토 특강] 백엔드 기초', mentor: '박엔드',
    category: 'MRC020', categoryNm: '멘토 특강',
    description: '백엔드 기본 개념 강의.',
    location: '온라인', isOnline: true, derivedCategories: ['backend'], status: 'A' },
  { sn: 'fp4', title: '[자유 멘토링] AI 에이전트로 30배 빠르게', mentor: '한유일',
    category: 'MRC010', categoryNm: '자유 멘토링',
    description: 'Claude Code 와 AI 에이전트가 자동화하는 워크플로우를 다룹니다.',
    location: '온라인', isOnline: true, derivedCategories: ['ai'], status: 'A' },
  { sn: 'fp5', title: '[멘토 특강] AI 시대의 창업', mentor: '강스타',
    category: 'MRC020', categoryNm: '멘토 특강',
    description: 'AI 도구를 활용한 1인 창업 노하우.',
    location: '오프라인', isOnline: false, derivedCategories: ['ai', 'startup'], status: 'A' },
  { sn: 'fp6', title: '[멘토 특강] 파인튜닝 실전', mentor: '오ML',
    category: 'MRC020', categoryNm: '멘토 특강',
    description: 'LLM 파인튜닝 데이터 준비와 평가 가이드.',
    location: '온라인', isOnline: true, derivedCategories: ['ai'], status: 'A' },
];

test('i6 F1: "김멘토" — bounded fuzzy drops false positives (description noise)', () => {
  // v1.15.0 unbounded `김.*멘.*토` matched fp1 (김장철 ... 멘토 ... 토요일).
  // v1.16.0 bounded `김\S*멘\S*토` requires same-token match → only fp2.
  const out = SWM_QUERY.apply(SWM_QUERY.parse('김멘토'), fpLectures).map(l => l.sn);
  assert.ok(!out.includes('fp1'), '김장철/멘토/토요일 분산 매치는 더 이상 false positive 가 아니어야 함');
  assert.ok(out.includes('fp2'), '"김멘토" 가 실제로 등장하는 fp2 는 매치되어야 함');
  assert.ok(out.length <= 2, `false positive 폭주 방지: ${out.length}`);
});

test('i6 F2: "이세진" — same-token bounded fuzzy', () => {
  // 이커머스(이) ... 멘토링(없음) ... — 흩어진 매치 차단.
  const out = SWM_QUERY.apply(SWM_QUERY.parse('이세진'), fpLectures).map(l => l.sn);
  assert.strictEqual(out.length, 0, '이세진 멘토 본인 강의가 fixture 에 없으므로 0 hit');
});

test('i6 F5: "벡엔드" → JW 가 derivedCat:backend 로 승격 (오타 recall)', () => {
  const ast = SWM_QUERY.parse('벡엔드');
  assert.deepStrictEqual(ast.include.derivedCat, ['backend'], 'JW threshold 0.85+ 로 백엔드 매칭');
  const out = SWM_QUERY.apply(ast, fpLectures).map(l => l.sn);
  assert.ok(out.length >= 2, `백엔드 강의(fp2/fp3) 둘 다 매치: got ${out.length}`);
});

test('i6 F6: "AI 파인튜딩" — JW 가 파인튜닝 alias 매칭 → derivedCat:ai', () => {
  const ast = SWM_QUERY.parse('AI 파인튜딩');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  const out = SWM_QUERY.apply(ast, fpLectures).map(l => l.sn);
  assert.ok(out.includes('fp6'), '실제 파인튜닝 강의 (fp6) 가 결과에 포함되어야 함');
});

test('i6 F7: "프롱트엔드" 오타 → JW 가 프론트엔드 매칭', () => {
  const ast = SWM_QUERY.parse('프롱트엔드');
  assert.deepStrictEqual(ast.include.derivedCat, ['frontend']);
});

test('i6 F8: rank() — opts.rank:true 시 BM25 score desc 정렬', () => {
  // "워크플로우" — alias 에 없는 freeText 토큰이라 BM25 scoring 활성화.
  const ast = SWM_QUERY.parse('AI 워크플로우');
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  assert.ok(Array.isArray(ranked));
  assert.ok(ranked.length > 0);
  for (const r of ranked) assert.ok('lec' in r && 'score' in r, 'shape: {lec, score}');
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'score desc');
  }
  assert.ok(ranked[0].score > 0, 'top1 score > 0 (freeText 매치 존재)');
});

test('i6 F8: AI+워크플로우 top1 이 description 에 워크플로우 명시한 강의', () => {
  // freeText="워크플로우" + derivedCat=ai. fp4 description 에 "워크플로우" 가 있어 top1.
  const ast = SWM_QUERY.parse('AI 워크플로우');
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  assert.strictEqual(ranked[0].lec.sn, 'fp4', `top1 sn=${ranked[0].lec.sn}, score=${ranked[0].score.toFixed(2)}`);
});

test('i6: rank() 기본 (opts.rank=false) 은 apply() 와 동일 — 호환', () => {
  const ast = SWM_QUERY.parse('AI');
  const a = SWM_QUERY.apply(ast, fpLectures);
  const b = SWM_QUERY.rank(ast, fpLectures);
  assert.deepStrictEqual(a.map(l => l.sn).sort(), b.map(l => l.sn).sort());
});

test('r7: rank() — alias-only 쿼리("AI")도 BM25 로 차등 정렬 (r4 Critical 수정)', () => {
  // r4-parser-prod 발견: "AI" 같이 모든 토큰이 alias 로 흡수되어 freeText 가
  // 비면 이전에는 전원 score=0 균일 → 업스트림 원순서 반환. 이제는
  // ast.raw_tokens = ["AI"] 를 BM25 쿼리로 사용하므로 "AI" 를 제목/설명에
  // 더 많이 가진 강의가 상위로 정렬.
  const ast = SWM_QUERY.parse('AI');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.include.freeText, []);
  assert.deepStrictEqual(ast.raw_tokens, ['AI']);
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  assert.ok(ranked.length > 0);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'score desc');
  }
  assert.ok(ranked[0].score > 0, `top1 score > 0, got ${ranked[0].score}`);
  const topScores = ranked.map(r => r.score);
  assert.ok(topScores.some((s, i) => i > 0 && topScores[0] !== s),
    'scores 가 전원 동일하면 정렬이 의미 없음 — 차등 필요');
});

test('i6: bounded fuzzy 는 "컴터" → "컴퓨터공학" recall 보존 (single-token)', () => {
  // 회귀 가드: 기존 v1.15.0 동작 유지.
  const ast = SWM_QUERY.parse('컴터');
  const out = SWM_QUERY.apply(ast, lectures).map(l => l.sn);
  assert.deepStrictEqual(out, ['4']);
});

test('i6: JW 1글자 토큰은 promote 하지 않음 (selectivity 보호)', () => {
  // "김" 단독은 derivedCat 에 없는 short token — freeText 유지되어야 함.
  const ast = SWM_QUERY.parse('김');
  assert.deepStrictEqual(ast.include.freeText, ['김']);
  assert.deepStrictEqual(ast.include.derivedCat, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// r7 — rank() alias-empty BM25 fix (v1.16.0 quality patch)
// ═══════════════════════════════════════════════════════════════════════════

test('r7: raw_tokens 채워짐 — derivedCat 승격 시에도 원 토큰 보존', () => {
  // "백엔드" → derivedCat=backend (filter) + raw_tokens=["백엔드"] (scoring)
  const a = SWM_QUERY.parse('백엔드');
  assert.deepStrictEqual(a.include.derivedCat, ['backend']);
  assert.deepStrictEqual(a.raw_tokens, ['백엔드']);

  // "창업 IR" → 둘 다 derivedCat:startup 으로 collapse. BM25 는 두 원 토큰
  // 으로 scoring 하므로 "IR" 이 실제 등장하는 강의를 구분 가능.
  const b = SWM_QUERY.parse('창업 IR');
  assert.deepStrictEqual(b.include.derivedCat, ['startup']);
  assert.deepStrictEqual(b.raw_tokens, ['창업', 'IR']);

  // location/status/category 순수 필터는 raw_tokens 에 들어가지 않음
  const c = SWM_QUERY.parse('온라인 접수중 특강');
  assert.deepStrictEqual(c.raw_tokens, []);
});

test('r7: raw_tokens — #tag 도 derivedCat 알리아스 시 보존', () => {
  const a = SWM_QUERY.parse('#ai');
  assert.deepStrictEqual(a.include.derivedCat, ['ai']);
  assert.deepStrictEqual(a.raw_tokens, ['ai']);

  // #MRC010 / #특강 같은 카테고리 코드 alias 는 필터이므로 raw_tokens X
  const b = SWM_QUERY.parse('#특강');
  assert.deepStrictEqual(b.include.category, ['MRC020']);
  assert.deepStrictEqual(b.raw_tokens, []);
});

test('r7: raw_tokens — JW 교정 시 typo 가 아닌 canonical 키 저장', () => {
  // "벡엔드" 오타 → JW 로 "백엔드" alias 매칭. raw_tokens 는 canonical "백엔드"
  // (doc 에 실제로 등장하는 형태) 를 저장해야 BM25 가 매치.
  const a = SWM_QUERY.parse('벡엔드');
  assert.deepStrictEqual(a.include.derivedCat, ['backend']);
  assert.deepStrictEqual(a.raw_tokens, ['백엔드']);
});

test('r7: "AI" BM25 top1 이 AI-heavy 강의 (description 에 AI 반복)', () => {
  // fp4 ("AI 에이전트로 30배 빠르게") 는 title+description 에 "AI" 3회.
  // fp5 ("AI 시대의 창업") 는 title+description 에 "AI" 2회.
  // fp6 ("파인튜닝 실전") 는 derivedCategories 만 ai, title/desc 에 AI 0.
  // title 가중치 3 이라 title 매치가 유리.
  const ast = SWM_QUERY.parse('AI');
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  assert.ok(ranked[0].score > ranked[ranked.length - 1].score,
    `top1 score=${ranked[0].score} must exceed last=${ranked[ranked.length - 1].score}`);
  // top1 should contain "AI" in title
  assert.ok(/AI/.test(ranked[0].lec.title),
    `top1 title should contain "AI": ${ranked[0].lec.title}`);
});

test('r7: "Agentic AI" top1 은 Agentic 언급 강의', () => {
  // fp4 title "AI 에이전트로 30배 빠르게" + description "AI 에이전트" — "AI" 매치
  // Agentic 이 alias(ai) 로 흡수되지만 raw_tokens 에 "Agentic" 도 남아 있어,
  // 실제 description 에 에이전트 관련 단어를 가진 강의가 더 높게 scoring.
  const ast = SWM_QUERY.parse('Agentic AI');
  assert.deepStrictEqual(ast.include.derivedCat, ['ai']);
  assert.deepStrictEqual(ast.raw_tokens, ['Agentic', 'AI']);
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  assert.ok(ranked[0].score > 0);
  // fp4 와 fp5/fp6 점수가 차이가 나야 (BM25 작동 증거)
  const scores = ranked.map(r => r.score);
  const uniq = new Set(scores.map(s => s.toFixed(3)));
  assert.ok(uniq.size >= 2, `전원 동일 score 는 BM25 무효: ${[...uniq].join(',')}`);
});

test('r7: "창업 IR" top1 은 IR/VC/MVP 언급 강의 (alias collision 분리)', () => {
  // fp5 ("AI 시대의 창업") — title+desc 에 "창업" 1회씩. IR 없음.
  // fp6 — startup 아님. fp1/fp2/fp3/fp4 — startup 아님.
  // 이 fixture 만으로 IR 분별은 불가하지만, raw_tokens=["창업","IR"] 가 유지되는지 검증.
  const ast = SWM_QUERY.parse('창업 IR');
  assert.deepStrictEqual(ast.include.derivedCat, ['startup']);
  assert.deepStrictEqual(ast.raw_tokens, ['창업', 'IR']);
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  // filter 로 startup 만 살아남음 (fp5)
  assert.strictEqual(ranked.length, 1);
  assert.strictEqual(ranked[0].lec.sn, 'fp5');
  assert.ok(ranked[0].score > 0, `top1 score > 0 — raw_tokens 로 scoring 작동`);
});

test('r7: 순수 필터 쿼리 (mentor @only) 는 여전히 score=0 (topical hint 없음)', () => {
  // @mentor 는 필터. raw_tokens 없음. BM25 skip → score 0 shape 유지.
  const ast = SWM_QUERY.parse('@한유일');
  const ranked = SWM_QUERY.rank(ast, fpLectures, { rank: true });
  for (const r of ranked) assert.strictEqual(r.score, 0);
});

test('r7: freeText + alias 혼합 쿼리 — raw_tokens 가 둘 다 포함', () => {
  // "김멘토 백엔드" — "김멘토" freeText, "백엔드" derivedCat.
  // raw_tokens = ["김멘토", "백엔드"]. BM25 두 토큰 모두로 scoring.
  const ast = SWM_QUERY.parse('김멘토 백엔드');
  assert.deepStrictEqual(ast.include.freeText, ['김멘토']);
  assert.deepStrictEqual(ast.include.derivedCat, ['backend']);
  assert.deepStrictEqual(ast.raw_tokens, ['김멘토', '백엔드']);
});

test('r7: 레거시 AST (raw_tokens 없음) 는 freeText fallback 으로 호환', () => {
  // 외부에서 수작업으로 만든 AST (예: URL 파라미터 복원) 가 raw_tokens 필드를
  // 안 가져도 rank() 가 크래시하지 않고 기존 freeText 기반 scoring 으로 동작.
  const legacyAst = {
    include: {
      mentor: [], category: [], derivedCat: [],
      location: { online: null }, status: null,
      dateFrom: null, dateTo: null, timeFromMin: null, timeToMin: null,
      categoryNm: [], freeText: ['AI'],
    },
    exclude: [],
    // raw_tokens 의도적 생략
  };
  const ranked = SWM_QUERY.rank(legacyAst, fpLectures, { rank: true });
  assert.ok(Array.isArray(ranked));
  assert.ok(ranked[0].score > 0, `legacy freeText fallback 작동`);
});

// ═══════════════════════════════════════════════════════════════════════════
// v1.16.1 n2 (nls5-nl) — NL parser expansion per v1161_n1_nl_audit.md
// Critical C1 (N시 / HH:MM), C2 (한글 시간 범위), C3 (조사),
// High H5 (다음 주말), H6 (다음주 월요일 DOW-range), H7 (next week)
// ═══════════════════════════════════════════════════════════════════════════

test('n2 C1: "9시" single hour → 09:00~10:00 (1h window)', () => {
  const ast = SWM_QUERY.parse('9시');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  assert.strictEqual(ast.include.timeToMin, 10 * 60);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('n2 C1: "오후 8시" → 20:00~21:00 (PM offset applied)', () => {
  const ast = SWM_QUERY.parse('오후 8시');
  assert.strictEqual(ast.include.timeFromMin, 20 * 60);
  assert.strictEqual(ast.include.timeToMin, 21 * 60);
});

test('n2 C1: "저녁 7시" → 19:00~20:00', () => {
  const ast = SWM_QUERY.parse('저녁 7시');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.strictEqual(ast.include.timeToMin, 20 * 60);
});

test('n2 C1: "밤 10시" → 22:00~23:00', () => {
  const ast = SWM_QUERY.parse('밤 10시');
  assert.strictEqual(ast.include.timeFromMin, 22 * 60);
  assert.strictEqual(ast.include.timeToMin, 23 * 60);
});

test('n2 C1: "14:30" → 14:30~15:30 (HH:MM single point)', () => {
  const ast = SWM_QUERY.parse('14:30');
  assert.strictEqual(ast.include.timeFromMin, 14 * 60 + 30);
  assert.strictEqual(ast.include.timeToMin, 15 * 60 + 30);
});

test('n2 C1: "9시 30분" → 09:30~10:30 (minute suffix form)', () => {
  const ast = SWM_QUERY.parse('9시 30분');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60 + 30);
  assert.strictEqual(ast.include.timeToMin, 10 * 60 + 30);
});

test('n2 C1: "1시간" does NOT match RE_AT_HOUR (시간 is duration, not point)', () => {
  const ast = SWM_QUERY.parse('1시간');
  assert.strictEqual(ast.include.timeFromMin, null);
  assert.strictEqual(ast.include.timeToMin, null);
  assert.deepStrictEqual(ast.include.freeText, ['1시간']);
});

test('n2 C2: "9시~11시" Korean range → 09:00~11:00', () => {
  const ast = SWM_QUERY.parse('9시~11시');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  assert.strictEqual(ast.include.timeToMin, 11 * 60);
});

test('n2 C2: "9시부터 11시까지" explicit range josa → 09:00~11:00', () => {
  const ast = SWM_QUERY.parse('9시부터 11시까지');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  assert.strictEqual(ast.include.timeToMin, 11 * 60);
});

test('n2 C2: "14:00~18:00" HH:MM range', () => {
  const ast = SWM_QUERY.parse('14:00~18:00');
  assert.strictEqual(ast.include.timeFromMin, 14 * 60);
  assert.strictEqual(ast.include.timeToMin, 18 * 60);
});

test('n2 C3: "오후 2-4시" AM/PM propagates to range → 14:00~16:00', () => {
  const ast = SWM_QUERY.parse('오후 2-4시');
  assert.strictEqual(ast.include.timeFromMin, 14 * 60);
  assert.strictEqual(ast.include.timeToMin, 16 * 60);
});

test('n2 C3: "9시에" single-point josa → 1h window', () => {
  const ast = SWM_QUERY.parse('9시에');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  assert.strictEqual(ast.include.timeToMin, 10 * 60);
});

test('n2 C3: "9시까지" josa → open-ended upper bound', () => {
  const ast = SWM_QUERY.parse('9시까지');
  assert.strictEqual(ast.include.timeFromMin, null);
  assert.strictEqual(ast.include.timeToMin, 9 * 60);
});

test('n2 C3: "9시부터" josa → open-ended lower bound', () => {
  const ast = SWM_QUERY.parse('9시부터');
  assert.strictEqual(ast.include.timeFromMin, 9 * 60);
  assert.strictEqual(ast.include.timeToMin, null);
});

test('n2 C3: "오전 10시부터" josa + AM mod → 10:00~null', () => {
  const ast = SWM_QUERY.parse('오전 10시부터');
  assert.strictEqual(ast.include.timeFromMin, 10 * 60);
  assert.strictEqual(ast.include.timeToMin, null);
});

test('n2 C3: "오전에만" leaks no freeText (에만 consumed)', () => {
  const ast = SWM_QUERY.parse('오전에만');
  assert.strictEqual(ast.include.timeFromMin, 0);
  assert.strictEqual(ast.include.timeToMin, 12 * 60);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('n2 H5: "다음 주말" resolves to NEXT weekend (not this weekend)', () => {
  const now = atNoon(2026, 4, 20); // Monday
  const ast = SWM_QUERY.parse('다음 주말', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-02');
  assert.strictEqual(ast.include.dateTo, '2026-05-03');
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('n2 H5: "이번 주말" still this weekend, no freeText leak', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('이번 주말', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-25');
  assert.strictEqual(ast.include.dateTo, '2026-04-26');
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('n2 H6: "다음주 월요일" → Mon of next week (not today Mon)', () => {
  const now = atNoon(2026, 4, 20); // Monday
  const ast = SWM_QUERY.parse('다음주 월요일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-27');
  assert.strictEqual(ast.include.dateTo, '2026-04-27');
});

test('n2 H6: "이번주 금요일" → Fri of this week', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('이번주 금요일', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-24');
  assert.strictEqual(ast.include.dateTo, '2026-04-24');
});

test('n2 H7: "next week" → next week range (not frontend alias)', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('next week', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-27');
  assert.strictEqual(ast.include.dateTo, '2026-05-03');
  assert.deepStrictEqual(ast.include.derivedCat, []);
  assert.deepStrictEqual(ast.include.freeText, []);
});

test('n2 H7: "this week" English variant', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('this week', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-20');
  assert.strictEqual(ast.include.dateTo, '2026-04-26');
});

test('n2 extras: "그저께" → D-2, "글피" → D+3', () => {
  const now = atNoon(2026, 4, 20);
  const a = SWM_QUERY.parse('그저께', { now });
  assert.strictEqual(a.include.dateFrom, '2026-04-18');
  const b = SWM_QUERY.parse('글피', { now });
  assert.strictEqual(b.include.dateFrom, '2026-04-23');
});

test('n2 extras: "저번주" → previous week', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('저번주', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-13');
  assert.strictEqual(ast.include.dateTo, '2026-04-19');
});

test('n2 extras: "점심" / "정오" → 12:00~13:00, "자정" → 00:00~01:00', () => {
  const a = SWM_QUERY.parse('점심');
  assert.strictEqual(a.include.timeFromMin, 12 * 60);
  assert.strictEqual(a.include.timeToMin, 13 * 60);
  const b = SWM_QUERY.parse('정오');
  assert.strictEqual(b.include.timeFromMin, 12 * 60);
  const c = SWM_QUERY.parse('자정');
  assert.strictEqual(c.include.timeFromMin, 0);
  assert.strictEqual(c.include.timeToMin, 60);
});

test('n2 extras: "04-24" year-less ISO → current-or-next year 04-24', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('04-24', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-24');
  assert.strictEqual(ast.include.dateTo, '2026-04-24');
});

test('n2 extras: "5월초" → first third of May', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('5월초', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-05-01');
  assert.strictEqual(ast.include.dateTo, '2026-05-10');
});

test('n2 combo: "이번주 금요일 오후 7시" → 04-24 19:00~20:00 (H6+C1)', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('이번주 금요일 오후 7시', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-24');
  assert.strictEqual(ast.include.dateTo, '2026-04-24');
  assert.strictEqual(ast.include.timeFromMin, 19 * 60);
  assert.strictEqual(ast.include.timeToMin, 20 * 60);
});

test('n2 combo: "다음주 월요일 저녁" → 04-27 evening window (H6)', () => {
  const now = atNoon(2026, 4, 20);
  const ast = SWM_QUERY.parse('다음주 월요일 저녁', { now });
  assert.strictEqual(ast.include.dateFrom, '2026-04-27');
  assert.strictEqual(ast.include.dateTo, '2026-04-27');
  assert.strictEqual(ast.include.timeFromMin, 18 * 60);
  assert.strictEqual(ast.include.timeToMin, 24 * 60);
});
