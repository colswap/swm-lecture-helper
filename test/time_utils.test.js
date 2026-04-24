// node --test test/time_utils.test.js
const { test } = require('node:test');
const assert = require('node:assert');

const T = require('../lib/time_utils.js');

// ═══════════════════════════════════════════════════════════
// PART 1: 기존 26 테스트 (v1.16.0 이하 — 유지)
// ═══════════════════════════════════════════════════════════

// ─── parseTimeRange ───

test('parseTimeRange: standard 2-digit HH:MM ~ HH:MM', () => {
  assert.deepStrictEqual(T.parseTimeRange('13:00 ~ 16:00'), { startMin: 780, endMin: 960 });
});

test('parseTimeRange: 1-digit hour (이정영/박주람/이세진 4/23 회귀 케이스)', () => {
  assert.deepStrictEqual(T.parseTimeRange('9:00 ~ 10:00'), { startMin: 540, endMin: 600 });
  assert.deepStrictEqual(T.parseTimeRange('9:00 ~ 11:00'), { startMin: 540, endMin: 660 });
  assert.deepStrictEqual(T.parseTimeRange('9:30 ~ 11:30'), { startMin: 570, endMin: 690 });
});

test('parseTimeRange: no space around tilde', () => {
  assert.deepStrictEqual(T.parseTimeRange('13:00~16:00'), { startMin: 780, endMin: 960 });
});

test('parseTimeRange: en/em dash separator', () => {
  assert.deepStrictEqual(T.parseTimeRange('13:00 – 16:00'), { startMin: 780, endMin: 960 });
  assert.deepStrictEqual(T.parseTimeRange('13:00 — 16:00'), { startMin: 780, endMin: 960 });
  assert.deepStrictEqual(T.parseTimeRange('13:00 - 16:00'), { startMin: 780, endMin: 960 });
});

test('parseTimeRange: Korean 시/분 form', () => {
  assert.deepStrictEqual(T.parseTimeRange('19시 ~ 21시'), { startMin: 19 * 60, endMin: 21 * 60 });
  assert.deepStrictEqual(T.parseTimeRange('13시 30분 ~ 15시'), {
    startMin: 13 * 60 + 30,
    endMin: 15 * 60,
  });
  assert.deepStrictEqual(T.parseTimeRange('13시30분 ~ 15시30분'), {
    startMin: 13 * 60 + 30,
    endMin: 15 * 60 + 30,
  });
});

test('parseTimeRange: 오전/오후 prefix', () => {
  assert.deepStrictEqual(T.parseTimeRange('오후 2시 ~ 오후 5시'), {
    startMin: 14 * 60,
    endMin: 17 * 60,
  });
  // end without explicit ampm inherits start
  assert.deepStrictEqual(T.parseTimeRange('오후 2:00 ~ 5:00'), {
    startMin: 14 * 60,
    endMin: 17 * 60,
  });
  assert.deepStrictEqual(T.parseTimeRange('오전 9시 ~ 오후 12시'), {
    startMin: 9 * 60,
    endMin: 12 * 60,
  });
});

test('parseTimeRange: overnight (끝이 작으면 +24h)', () => {
  assert.deepStrictEqual(T.parseTimeRange('22:00 ~ 01:00'), {
    startMin: 22 * 60,
    endMin: 25 * 60,
  });
});

test('parseTimeRange: zero-duration (시작==끝) 는 받되 range 0', () => {
  assert.deepStrictEqual(T.parseTimeRange('10:00 ~ 10:00'), { startMin: 600, endMin: 600 });
});

test('parseTimeRange: 전일 범위 (16h 이내 허용)', () => {
  assert.deepStrictEqual(T.parseTimeRange('9:00 ~ 23:00'), { startMin: 540, endMin: 1380 });
});

test('parseTimeRange: >16h 범위는 거부 (오탐 방지)', () => {
  // 6:00 ~ 23:00 = 17h → 거부 (현재 정책). NBSP / 전각 정리 후 여전히 rejected.
  assert.strictEqual(T.parseTimeRange('6:00 ~ 23:00'), null);
});

test('parseTimeRange: null/undefined/empty → null', () => {
  assert.strictEqual(T.parseTimeRange(null), null);
  assert.strictEqual(T.parseTimeRange(undefined), null);
  assert.strictEqual(T.parseTimeRange(''), null);
  assert.strictEqual(T.parseTimeRange('시간 미정'), null);
});

test('parseTimeRange: 전각 물결/콜론 정규화', () => {
  assert.deepStrictEqual(T.parseTimeRange('13：00 ～ 16：00'), {
    startMin: 780,
    endMin: 960,
  });
});

// ─── parseLecDateTime ───

test('parseLecDateTime: SWM list edc string (표준)', () => {
  const r = T.parseLecDateTime('2026-04-14(화) 13:00 ~ 16:00');
  assert.strictEqual(r.lecDate, '2026-04-14');
  assert.strictEqual(r.lecTime, '13:00 ~ 16:00');
  assert.ok(r.range);
});

test('parseLecDateTime: 1-digit hour (target 회귀)', () => {
  const r = T.parseLecDateTime('2026-04-23(목) 9:00 ~ 10:00');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '09:00 ~ 10:00');
});

test('parseLecDateTime: date with dots', () => {
  const r = T.parseLecDateTime('2026.04.23 19:00~22:00');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '19:00 ~ 22:00');
});

test('parseLecDateTime: Korean 시', () => {
  const r = T.parseLecDateTime('2026-04-23(목) 19시 ~ 21시');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '19:00 ~ 21:00');
});

test('parseLecDateTime: 시간 없는 경우 lecDate 만', () => {
  const r = T.parseLecDateTime('2026-04-23(목)');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '');
  assert.strictEqual(r.range, null);
});

test('parseLecDateTime: 빈 입력 → 모든 필드 빈값', () => {
  const r = T.parseLecDateTime('');
  assert.deepStrictEqual(r, { lecDate: '', lecTime: '', range: null });
});

// ─── r6 detail.js regression guard ───

test('r6 regression: 1자리 시각이 포함된 detail raw → lecTime 정상', () => {
  const r = T.parseLecDateTime('2026-04-23(목) 9:00 ~ 10:00');
  assert.strictEqual(r.lecTime, '09:00 ~ 10:00');
  assert.ok(r.range);
});

test('r6 regression: 한국어 1자리 시/분 detail raw', () => {
  const r = T.parseLecDateTime('2026-04-20(월) 9시 ~ 11시');
  assert.strictEqual(r.lecTime, '09:00 ~ 11:00');
});

test('r6 regression: "시간 미정" 같은 미파싱 입력 → lecTime 빈 문자열 (호출자가 skip 판단)', () => {
  const r = T.parseLecDateTime('2026-04-23(목) 시간 미정');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '');
  assert.strictEqual(r.range, null);
});

test('Physical AI regression: detail page "HH:MM시 ~ HH:MM시" 형식 → lecTime 정상 (00:00 ~ 16:00 오염 방지)', () => {
  const r = T.parseLecDateTime('2026.04.18 14:00시 ~ 16:00시');
  assert.strictEqual(r.lecDate, '2026-04-18');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

// ─── overlaps / hasStarted / minToHHMM ───

test('overlaps: 겹치는 두 범위', () => {
  const a = T.parseTimeRange('13:00 ~ 15:00');
  const b = T.parseTimeRange('14:00 ~ 16:00');
  assert.strictEqual(T.overlaps(a, b), true);
});

test('overlaps: null-safe', () => {
  assert.strictEqual(T.overlaps(null, { startMin: 0, endMin: 60 }), false);
  assert.strictEqual(T.overlaps(undefined, undefined), false);
});

test('minToHHMM: 일반 / 한 자리수', () => {
  assert.strictEqual(T.minToHHMM(0), '00:00');
  assert.strictEqual(T.minToHHMM(60), '01:00');
  assert.strictEqual(T.minToHHMM(9 * 60 + 5), '09:05');
});

test('hasStarted: lecDate 없으면 false', () => {
  assert.strictEqual(T.hasStarted({}), false);
  assert.strictEqual(T.hasStarted({ lecDate: '', lecTime: '10:00 ~ 11:00' }), false);
});

// ═══════════════════════════════════════════════════════════
// PART 2: v1.16.1 신규 — 9 sharp bug regression guards + a1/a2 확장
// ═══════════════════════════════════════════════════════════

// ─── Sharp #1 — 영문 AM/PM postfix ───

test('#1 AM/PM postfix: "2:00 PM ~ 5:00 PM" → 14:00 ~ 17:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('2:00 PM ~ 5:00 PM'), { startMin: 14 * 60, endMin: 17 * 60 });
});

test('#1 AM/PM postfix: "9:00 AM ~ 12:00 PM" → 09:00 ~ 12:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('9:00 AM ~ 12:00 PM'), { startMin: 9 * 60, endMin: 12 * 60 });
});

test('#1 AM/PM postfix: 소문자 "2:00pm ~ 5:00pm"', () => {
  assert.deepStrictEqual(T.parseTimeRange('2:00pm ~ 5:00pm'), { startMin: 14 * 60, endMin: 17 * 60 });
});

test('#1 AM/PM postfix: 소문자 no-space "2pm~5pm"', () => {
  assert.deepStrictEqual(T.parseTimeRange('2pm~5pm'), { startMin: 14 * 60, endMin: 17 * 60 });
});

test('#1 AM/PM postfix: 9am~11am (no minutes)', () => {
  assert.deepStrictEqual(T.parseTimeRange('9am~11am'), { startMin: 9 * 60, endMin: 11 * 60 });
});

test('#1 AM/PM postfix: 12 AM = 자정 (midnight)', () => {
  assert.deepStrictEqual(T.parseTimeRange('12:00 AM ~ 1:00 AM'), { startMin: 0, endMin: 60 });
});

test('#1 AM/PM postfix: 12 PM = 정오 (noon)', () => {
  assert.deepStrictEqual(T.parseTimeRange('12:00 PM ~ 1:00 PM'), { startMin: 12 * 60, endMin: 13 * 60 });
});

test('#1 AM/PM postfix: 2:30pm 분 단위 포함', () => {
  assert.deepStrictEqual(T.parseTimeRange('2:30pm ~ 4:30pm'), { startMin: 14 * 60 + 30, endMin: 16 * 60 + 30 });
});

test('#1 AM/PM prefix form 계속 동작 (회귀 방지)', () => {
  assert.deepStrictEqual(T.parseTimeRange('PM 2:00 ~ PM 5:00'), { startMin: 14 * 60, endMin: 17 * 60 });
});

// ─── Sharp #2 — 24:00 정책 (표기 보존) ───

test('#2 24:00: parseTimeRange → endMin=1440', () => {
  assert.deepStrictEqual(T.parseTimeRange('22:00 ~ 24:00'), { startMin: 22 * 60, endMin: 24 * 60 });
  assert.deepStrictEqual(T.parseTimeRange('23:00 ~ 24:00'), { startMin: 23 * 60, endMin: 24 * 60 });
  assert.deepStrictEqual(T.parseTimeRange('22:30 ~ 24:00'), { startMin: 22 * 60 + 30, endMin: 24 * 60 });
});

test('#2 24:00: extractLecDateTime 는 "24:00" 표기 보존 (a2 실데이터 11건)', () => {
  const r = T.extractLecDateTime('2026-04-30(목) 22:00 ~ 24:00');
  assert.strictEqual(r.lecDate, '2026-04-30');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('#2 24:00: "22:30 ~ 24:00" a2 sn=10537', () => {
  const r = T.extractLecDateTime('2026-04-22(수) 22:30 ~ 24:00');
  assert.strictEqual(r.lecTime, '22:30 ~ 24:00');
});

test('#2 24:00: detail "HH:MM시" 변형도 보존 (sn=10087)', () => {
  const r = T.extractLecDateTime('2026.04.29 22:00시 ~ 24:00시');
  assert.strictEqual(r.lecDate, '2026-04-29');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('#2 minToHHMM: 1440 → "24:00" 보존', () => {
  assert.strictEqual(T.minToHHMM(24 * 60), '24:00');
});

// ─── Sharp #3 — "오전 9시 ~ 12시" = 09:00~12:00 ───

test('#3 오전 상속 12시 = noon (정오 유지)', () => {
  assert.deepStrictEqual(T.parseTimeRange('오전 9시 ~ 12시'), { startMin: 9 * 60, endMin: 12 * 60 });
});

test('#3 오전 10시 ~ 12시 (정오)', () => {
  assert.deepStrictEqual(T.parseTimeRange('오전 10시 ~ 12시'), { startMin: 10 * 60, endMin: 12 * 60 });
});

test('#3 오전 상속 12 회귀: extractLecDateTime 도 lecTime "09:00 ~ 12:00"', () => {
  const r = T.extractLecDateTime('2026-04-24(금) 오전 9시 ~ 12시');
  assert.strictEqual(r.lecTime, '09:00 ~ 12:00');
});

// ─── Sharp #4 — 저녁/밤/아침/새벽 prefix ───

test('#4 저녁 7시 ~ 9시 → 19:00~21:00 (PM 해석)', () => {
  assert.deepStrictEqual(T.parseTimeRange('저녁 7시 ~ 9시'), { startMin: 19 * 60, endMin: 21 * 60 });
});

test('#4 밤 11시 ~ 1시 → 23:00~25:00 (overnight)', () => {
  assert.deepStrictEqual(T.parseTimeRange('밤 11시 ~ 1시'), { startMin: 23 * 60, endMin: 25 * 60 });
});

test('#4 아침 9시 ~ 11시 → 09:00~11:00 (AM 해석)', () => {
  assert.deepStrictEqual(T.parseTimeRange('아침 9시 ~ 11시'), { startMin: 9 * 60, endMin: 11 * 60 });
});

test('#4 새벽 2시 ~ 4시 → 02:00~04:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('새벽 2시 ~ 4시'), { startMin: 2 * 60, endMin: 4 * 60 });
});

test('#4 extractLecDateTime: 저녁 prefix → lecTime "19:00 ~ 21:00"', () => {
  const r = T.extractLecDateTime('2026-04-25(토) 저녁 7시 ~ 9시');
  assert.strictEqual(r.lecDate, '2026-04-25');
  assert.strictEqual(r.lecTime, '19:00 ~ 21:00');
});

// ─── Sharp #7 — "N시 반" → ":30" ───

test('#7 반: "오후 2시 반 ~ 4시 반" → 14:30 ~ 16:30', () => {
  assert.deepStrictEqual(T.parseTimeRange('오후 2시 반 ~ 4시 반'), { startMin: 14 * 60 + 30, endMin: 16 * 60 + 30 });
});

test('#7 반: "2시 반 ~ 4시 반" → 02:30 ~ 04:30', () => {
  assert.deepStrictEqual(T.parseTimeRange('2시 반 ~ 4시 반'), { startMin: 2 * 60 + 30, endMin: 4 * 60 + 30 });
});

test('#7 반: "14시 반 ~ 16시 반" → 14:30 ~ 16:30', () => {
  assert.deepStrictEqual(T.parseTimeRange('14시 반 ~ 16시 반'), { startMin: 14 * 60 + 30, endMin: 16 * 60 + 30 });
});

test('#7 반: extractLecDateTime → lecTime 보존', () => {
  const r = T.extractLecDateTime('2026-04-25(토) 오후 2시 반 ~ 4시 반');
  assert.strictEqual(r.lecTime, '14:30 ~ 16:30');
});

// ─── Sharp #8 — "정각" strip ───

test('#8 정각: "오후 2시 정각 ~ 4시 정각" → 14:00 ~ 16:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('오후 2시 정각 ~ 4시 정각'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('#8 정각: "14:00 정각 ~ 16:00 정각" → 14:00 ~ 16:00 (HH:MM + 정각)', () => {
  assert.deepStrictEqual(T.parseTimeRange('14:00 정각 ~ 16:00 정각'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('#8 정각: extractLecDateTime 호환', () => {
  const r = T.extractLecDateTime('2026-04-25(토) 오후 2시 정각 ~ 4시 정각');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

// ─── Sharp #9 — "부터/까지" ───

test('#9 부터까지: "14시부터 16시까지" → 14:00 ~ 16:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('14시부터 16시까지'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('#9 부터까지: "오후 2시부터 4시까지" → 14:00 ~ 16:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('오후 2시부터 4시까지'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('#9 부터만 (까지 없음): "14시부터 16시" → 14:00 ~ 16:00', () => {
  assert.deepStrictEqual(T.parseTimeRange('14시부터 16시'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('#9 부터까지: extractLecDateTime 호환', () => {
  const r = T.extractLecDateTime('2026-04-25(토) 14시부터 16시까지');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

// ─── 복합 케이스 (여러 sharp bug 동시) ───

test('복합: "오후 2시 반부터 4시 반까지" → 14:30 ~ 16:30 (#7+#9)', () => {
  assert.deepStrictEqual(T.parseTimeRange('오후 2시 반부터 4시 반까지'), {
    startMin: 14 * 60 + 30, endMin: 16 * 60 + 30,
  });
});

test('복합: "저녁 7시 정각부터 9시까지" → 19:00 ~ 21:00 (#4+#8+#9)', () => {
  assert.deepStrictEqual(T.parseTimeRange('저녁 7시 정각부터 9시까지'), {
    startMin: 19 * 60, endMin: 21 * 60,
  });
});

// ─── a1 확장 — 대표 40개 ───

test('a1 1digit: "8:00 ~ 9:00" → 08:00 ~ 09:00', () => {
  const r = T.extractLecDateTime('8:00 ~ 9:00');
  assert.strictEqual(r.lecTime, '08:00 ~ 09:00');
});

test('a1 korean: "14시 ~ 16시" → 14:00 ~ 16:00', () => {
  const r = T.extractLecDateTime('14시 ~ 16시');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 korean: "9시 30분 ~ 11시" → 09:30 ~ 11:00', () => {
  const r = T.extractLecDateTime('9시 30분 ~ 11시');
  assert.strictEqual(r.lecTime, '09:30 ~ 11:00');
});

test('a1 korean: "오후 2시 ~ 4시" → 14:00 ~ 16:00', () => {
  const r = T.extractLecDateTime('오후 2시 ~ 4시');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 korean: "오전 9시 ~ 오후 1시" → 09:00 ~ 13:00', () => {
  const r = T.extractLecDateTime('오전 9시 ~ 오후 1시');
  assert.strictEqual(r.lecTime, '09:00 ~ 13:00');
});

test('a1 siSuffix: "14:00시 ~ 16:00시" Physical AI', () => {
  const r = T.extractLecDateTime('14:00시 ~ 16:00시');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 siSuffix: "14:00시~16:00시" no space', () => {
  assert.deepStrictEqual(T.parseTimeRange('14:00시~16:00시'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('a1 fullwidth: "14：00 ～ 16：00"', () => {
  assert.deepStrictEqual(T.parseTimeRange('14：00 ～ 16：00'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('a1 dash: en-dash / em-dash', () => {
  assert.deepStrictEqual(T.parseTimeRange('14:00–16:00'), { startMin: 14 * 60, endMin: 16 * 60 });
  assert.deepStrictEqual(T.parseTimeRange('14:00—16:00'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('a1 whitespace: 여러 공백 tolerance', () => {
  assert.deepStrictEqual(T.parseTimeRange('14:00  ~  16:00'), { startMin: 14 * 60, endMin: 16 * 60 });
  assert.deepStrictEqual(T.parseTimeRange('14:00\t~\t16:00'), { startMin: 14 * 60, endMin: 16 * 60 });
});

test('a1 garbage: "미정" / "TBD" / "시간 미정" → null', () => {
  assert.strictEqual(T.parseTimeRange('미정'), null);
  assert.strictEqual(T.parseTimeRange('TBD'), null);
  assert.strictEqual(T.parseTimeRange('시간 미정'), null);
});

test('a1 garbage: single time "14:00" → null (범위 아님)', () => {
  assert.strictEqual(T.parseTimeRange('14:00'), null);
});

test('a1 dateTime: "2026.04.18 14:00 ~ 16:00"', () => {
  const r = T.extractLecDateTime('2026.04.18 14:00 ~ 16:00');
  assert.strictEqual(r.lecDate, '2026-04-18');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 dateTime: "2026/04/23 14:00 ~ 16:00" slash date', () => {
  const r = T.extractLecDateTime('2026/04/23 14:00 ~ 16:00');
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 dateTime: 1자리 월/일 zero-pad "2026-4-3 14:00 ~ 16:00"', () => {
  const r = T.extractLecDateTime('2026-4-3 14:00 ~ 16:00');
  assert.strictEqual(r.lecDate, '2026-04-03');
});

test('a1 pathological: "14:60 ~ 16:00" → 분 >=60 거부', () => {
  assert.strictEqual(T.parseTimeRange('14:60 ~ 16:00'), null);
});

test('a1 pathological: "30:00 ~ 31:00" → h>29 거부', () => {
  assert.strictEqual(T.parseTimeRange('30:00 ~ 31:00'), null);
});

test('a1 pathological: "6:00 ~ 20:00" = 14h 경계 수용 (b2 cap)', () => {
  assert.deepStrictEqual(T.parseTimeRange('6:00 ~ 20:00'), { startMin: 6 * 60, endMin: 20 * 60 });
});

test('"6:00 ~ 22:00" = 16h (v1.16.1 관대 cap: 16h 까지 허용 — 시각 clamp 는 blockPos)', () => {
  assert.deepStrictEqual(T.parseTimeRange('6:00 ~ 22:00'), { startMin: 360, endMin: 1320 });
});

test('a1 pathological: HTML 오염 "<p>14:00 ~ 16:00</p>"', () => {
  const r = T.extractLecDateTime('<p>14:00 ~ 16:00</p>');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 realistic: "2026-04-18(토) 13시30분 ~ 15시30분"', () => {
  const r = T.extractLecDateTime('2026-04-18(토) 13시30분 ~ 15시30분');
  assert.strictEqual(r.lecDate, '2026-04-18');
  assert.strictEqual(r.lecTime, '13:30 ~ 15:30');
});

test('a1 realistic: 괄호 suffix "(zoom)" ignore', () => {
  const r = T.extractLecDateTime('2026-04-18(토) 오후 2시 ~ 4시 (zoom)');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a1 ampm: "12:00 AM ~ 1:00 AM" 자정', () => {
  const r = T.extractLecDateTime('12:00 AM ~ 1:00 AM');
  assert.strictEqual(r.lecTime, '00:00 ~ 01:00');
});

test('a1 ampm: "12:00 PM ~ 1:00 PM" 정오', () => {
  const r = T.extractLecDateTime('12:00 PM ~ 1:00 PM');
  assert.strictEqual(r.lecTime, '12:00 ~ 13:00');
});

// ─── a2 실데이터 대표 20개 (sn 기반) ───

test('a2 sn=10561 "2026-04-30(목) 22:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-30(목) 22:00 ~ 24:00');
  assert.strictEqual(r.lecDate, '2026-04-30');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 sn=10087 "2026-04-29(수) 22:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-29(수) 22:00 ~ 24:00');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 sn=10471 "2026-04-28(화) 22:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-28(화) 22:00 ~ 24:00');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 sn=9211 "2026-04-24(금) 22:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-24(금) 22:00 ~ 24:00');
  assert.strictEqual(r.lecDate, '2026-04-24');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 sn=10537 "2026-04-22(수) 22:30 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-22(수) 22:30 ~ 24:00');
  assert.strictEqual(r.lecTime, '22:30 ~ 24:00');
});

test('a2 sn=10424 "2026-04-22(수) 23:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-22(수) 23:00 ~ 24:00');
  assert.strictEqual(r.lecTime, '23:00 ~ 24:00');
});

test('a2 sn=10134 "2026-04-19(일) 23:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-19(일) 23:00 ~ 24:00');
  assert.strictEqual(r.lecTime, '23:00 ~ 24:00');
});

test('a2 sn=10129 "2026-04-18(토) 22:00 ~ 24:00"', () => {
  const r = T.extractLecDateTime('2026-04-18(토) 22:00 ~ 24:00');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 list 표준 HH:MM range (sn 임의)', () => {
  const r = T.extractLecDateTime('2026-05-06(수) 14:00 ~ 16:00');
  assert.strictEqual(r.lecDate, '2026-05-06');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a2 list 표준 19:00 ~ 22:00', () => {
  const r = T.extractLecDateTime('2026-05-08(금) 19:00 ~ 22:00');
  assert.strictEqual(r.lecTime, '19:00 ~ 22:00');
});

test('a2 detail "HH:MM시" 2026.05.06 10:00시 ~ 11:00시', () => {
  const r = T.extractLecDateTime('2026.05.06 10:00시 ~ 11:00시');
  assert.strictEqual(r.lecTime, '10:00 ~ 11:00');
});

test('a2 detail 20:00 ~ 22:00 detail', () => {
  const r = T.extractLecDateTime('2026.04.30 20:00시 ~ 22:00시');
  assert.strictEqual(r.lecTime, '20:00 ~ 22:00');
});

test('a2 detail overnight 22:00시 ~ 24:00시 sn=10087', () => {
  const r = T.extractLecDateTime('2026.04.29 22:00시 ~ 24:00시');
  assert.strictEqual(r.lecTime, '22:00 ~ 24:00');
});

test('a2 list edge NBSP-contaminated', () => {
  const raw = '2026-04-23(목) 14:00 ~ 16:00';
  const r = T.extractLecDateTime(raw);
  assert.strictEqual(r.lecDate, '2026-04-23');
  assert.strictEqual(r.lecTime, '14:00 ~ 16:00');
});

test('a2 list 18:00 ~ 20:00 평범한 저녁', () => {
  const r = T.extractLecDateTime('2026-05-12(화) 18:00 ~ 20:00');
  assert.strictEqual(r.lecTime, '18:00 ~ 20:00');
});

test('a2 list 09:00 ~ 10:30 아침 멘토링', () => {
  const r = T.extractLecDateTime('2026-04-17(금) 09:00 ~ 10:30');
  assert.strictEqual(r.lecTime, '09:00 ~ 10:30');
});

test('a2 list 15:00 ~ 17:00 오후', () => {
  const r = T.extractLecDateTime('2026-04-18(토) 15:00 ~ 17:00');
  assert.strictEqual(r.lecTime, '15:00 ~ 17:00');
});

test('a2 list end=24:00 with different start minute (22:30)', () => {
  // sn=10537 변형
  const r = T.extractLecDateTime('2026-04-22(수) 22:30 ~ 24:00');
  assert.strictEqual(r.range.endMin, 1440);
});

test('a2 list 11:00 ~ 13:00 점심 전후', () => {
  const r = T.extractLecDateTime('2026-04-30(목) 11:00 ~ 13:00');
  assert.strictEqual(r.lecTime, '11:00 ~ 13:00');
});

test('a2 list 16:00 ~ 18:00 늦은 오후', () => {
  const r = T.extractLecDateTime('2026-05-20(수) 16:00 ~ 18:00');
  assert.strictEqual(r.lecTime, '16:00 ~ 18:00');
});

// ─── Overnight / 다음날 roll-over (iCal 정합성) ───

test('overnight: "22:00 ~ 01:00" endMin=25h (iCal 경로가 +1day 해석)', () => {
  const r = T.parseTimeRange('22:00 ~ 01:00');
  assert.strictEqual(r.startMin, 22 * 60);
  assert.strictEqual(r.endMin, 25 * 60);
});

test('overnight: "23:00 ~ 02:00" endMin=26h', () => {
  const r = T.parseTimeRange('23:00 ~ 02:00');
  assert.strictEqual(r.endMin, 26 * 60);
});

test('24:00 정확히 1440: parseTimeRange 관점', () => {
  const r = T.parseTimeRange('22:00 ~ 24:00');
  assert.strictEqual(r.endMin, 24 * 60);
});

// ═══════════════════════════════════════════════════════════
// PART 3: v1.16.1 회귀 — 실 SWM 데이터 고정 테스트
// 실 fetch (2026-04-24) 로 얻은 6 건 history + 6 건 detail raw 를 동결.
// 이 셋이 깨지면 사용자 신청 블록이 timetable 에서 사라지거나 하루종일로 표시됨.
// ═══════════════════════════════════════════════════════════

// history 페이지 tds[4] — "2026-04-17(금) &nbsp21:30:00 ~ 23:30:00" 형태
const HISTORY_REAL = [
  { sn: '10032', raw: '2026-04-17(금) &nbsp21:30:00 ~ 23:30:00', expectDate: '2026-04-17', expectTime: '21:30 ~ 23:30' },
  { sn: '9652',  raw: '2026-04-14(화) &nbsp19:30:00 ~ 20:30:00', expectDate: '2026-04-14', expectTime: '19:30 ~ 20:30' },
  { sn: '9602',  raw: '2026-04-11(토) &nbsp13:00:00 ~ 15:00:00', expectDate: '2026-04-11', expectTime: '13:00 ~ 15:00' },
  { sn: '9338',  raw: '2026-04-15(수) &nbsp19:00:00 ~ 21:00:00', expectDate: '2026-04-15', expectTime: '19:00 ~ 21:00' },
  { sn: '9006',  raw: '2026-04-07(화) &nbsp19:00:00 ~ 21:00:00', expectDate: '2026-04-07', expectTime: '19:00 ~ 21:00' },
];

for (const { sn, raw, expectDate, expectTime } of HISTORY_REAL) {
  test(`real history sn=${sn}: HH:MM:SS + &nbsp literal → ${expectTime}`, () => {
    const r = T.extractLecDateTime(raw);
    assert.strictEqual(r.lecDate, expectDate);
    assert.strictEqual(r.lecTime, expectTime);
  });
}

// detail 페이지 강의날짜 — "2026.04.17 21:30시 ~ 23:30시" 형태
const DETAIL_REAL = [
  { sn: '10032', raw: '2026.04.17 21:30시 ~ 23:30시', expectDate: '2026-04-17', expectTime: '21:30 ~ 23:30' },
  { sn: '9652',  raw: '2026.04.14 19:30시 ~ 20:30시', expectDate: '2026-04-14', expectTime: '19:30 ~ 20:30' },
  { sn: '9602',  raw: '2026.04.11 13:00시 ~ 15:00시', expectDate: '2026-04-11', expectTime: '13:00 ~ 15:00' },
  { sn: '9247',  raw: '2026-04-15 · 14:00시  ~ 16:00시', expectDate: '2026-04-15', expectTime: '14:00 ~ 16:00' },
  { sn: '9993',  raw: '2026-04-20 · 19:30시  ~ 21:30시', expectDate: '2026-04-20', expectTime: '19:30 ~ 21:30' },
];

for (const { sn, raw, expectDate, expectTime } of DETAIL_REAL) {
  test(`real detail sn=${sn}: HH:MM시 + dot/dash date → ${expectTime}`, () => {
    const r = T.extractLecDateTime(raw);
    assert.strictEqual(r.lecDate, expectDate);
    assert.strictEqual(r.lecTime, expectTime);
  });
}

// v1.15.0 에서 오매칭되어 stale 로 박혀 있던 금지 패턴 — 절대 재생산 금지.
test('regression: "13:00:00 ~ 15:00:00" 는 00:00 으로 파싱되면 안됨', () => {
  const r = T.parseTimeRange('13:00:00 ~ 15:00:00');
  assert.strictEqual(r.startMin, 13 * 60);
  assert.strictEqual(r.endMin, 15 * 60);
});

test('regression: "19:00:00 ~ 21:00:00" 는 00:00 으로 파싱되면 안됨', () => {
  const r = T.parseTimeRange('19:00:00 ~ 21:00:00');
  assert.strictEqual(r.startMin, 19 * 60);
  assert.strictEqual(r.endMin, 21 * 60);
});

test('regression: "21:30:00 ~ 23:30:00" 는 30:00 으로 파싱되면 안됨', () => {
  const r = T.parseTimeRange('21:30:00 ~ 23:30:00');
  assert.strictEqual(r.startMin, 21 * 60 + 30);
  assert.strictEqual(r.endMin, 23 * 60 + 30);
});
