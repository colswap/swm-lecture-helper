# v1.16.1 n2 — 자연어 파서 전면 보강

**태스크:** #2 (n2-nl-fixer)
**파서 VERSION:** `2026-04-20-nls4-bm25-r7` → `2026-04-20-nls5-nl`
**기준일:** 2026-04-20 (Mon) 10:00
**감사:** `/mnt/c/claude/staging/v1161_n1_nl_audit.md` (92 cases)
**Runner:** `/mnt/c/claude/staging/v1161_n1_audit_runner.js`

## 1. 요약

| 지표 | Before (r7) | After (nls5-nl) | Δ |
|------|------|------|---|
| **n1 감사 OK** | 47 / 92 (51%) | **88 / 92 (95.6%)** | **+41** |
| 기존 회귀 (168) | 168 pass | 168 pass | 0 |
| 신규 n2 테스트 | — | 29 pass | +29 |
| 전체 `node --test` | 168 | **197 / 197 pass** | — |
| p95 (938 parses) | n/a | **6.3 ms** (<10ms 목표) | — |

## 2. 변경 내역

### 신규 regex
| 이름 | 목적 |
|------|------|
| `RE_HHMM_RANGE` | `14:00~18:00` / `09:00부터 11:00까지` |
| `RE_TIME_RANGE_KR` | `9시~11시`, `9시부터 11시까지`, `오후 2시~4시`, 분 포함 |
| `RE_AT_HOUR` | `9시`, `오후 8시`, `14:30`, `9시 30분`, 조사 `에/부터/까지` 흡수 |
| `RE_MONTH_PART` | `4월말` / `5월초` / `6월중` 3분할 |
| `RE_MD_DASH` | 연도 없는 `04-24` (month 두자리 필수, 시간범위 오탐 회피) |
| `RE_EN_WEEK` | `next week` / `last week` / `this week` 사전 소비 |

### 수정된 기존 regex
- `RE_WEEKEND` / `RE_WEEKDAYS` — `(이번|다음|...)\s*(?:주\s*)?` 로 재작성.  
  기존에 `(이번\s*주|다음\s*주)` 가 뒤의 `주말` 과 `주` 충돌로 매치 실패 → 무조건 `주말`만 매치 → offset=0 (이번 주말) 로 오인. 이제 prefix=다음 이면 offset=1.
- `RE_RANGE` — 좌측 `(오전|오후|저녁|밤|아침|새벽)?` 캡처 추가. `오후 2-4시` → 14:00~16:00 로 보정.
- `RE_AFTER` / `RE_BEFORE` — modifier 리스트에 `밤|아침|새벽` 추가 (일관성).
- `RE_WEEK_PREV` — `저번주` 추가.
- `RE_TRIGGER` — `점|정|자|글|끄|피` 문자와 `next|last|this\s+week` 추가. 순수 영어/한글 키워드의 fast-path bypass 버그 제거.

### 확장된 키워드
- `DAY_KW_LIST`: `그저께` (-2), `글피` (+3) 추가.
- 단독 시간 키워드: `점심` / `정오` (12:00~13:00), `자정` (00:00~01:00) 추가. 모두 `에만/에/부터/까지` 조사 suffix 흡수.

### 핵심 로직 수정

**DOW handler 범위 인식 (H6)** — 기존 루프는 무조건 `nearestDow` 로 dateFrom/To 를 덮어씀. 다음주 등 week-range 가 설정돼 있으면 그 범위 안의 해당 요일로 제한.

```js
if (dateFrom && dateTo && dateFrom !== dateTo) {
  d = from; while (d <= to && d.getDay() !== num) d = addDays(d, 1);
  if (d > to) d = nearestDow(now, num);
} else d = nearestDow(now, num);
```

**단일점 시각 `RE_AT_HOUR` (C1/C3)** — mod + hour + (optional min) + (optional 조사) 파싱. 조사가 `까지/까지만` 이면 upper, `부터` 면 lower, 아니면 1시간 윈도우. `1시간` 오탐 방지 위해 `시(?!간)` negative lookahead.

**단독 키워드 조사 흡수 helper** — `setStandalone(kw, from, to)` — keyword + optional `(에만|에|부터|까지만|까지)` regex 로 freeText 유출 제거.

**시간 추출 순서 (AM/PM 컨텍스트 보존)**
```
RE_HHMM_RANGE → RE_TIME_RANGE_KR → RE_RANGE → RE_AFTER → RE_BEFORE → RE_AT_HOUR → setStandalone
```
위→아래로 더 구체적 패턴이 먼저 소비 → 단독 `오전/오후` 가 이미 설정된 범위를 덮어쓰는 버그 방지.

## 3. Before / After — 92 케이스 상세

### ✅ Critical 전부 해결 (C1/C2/C3, 19→19 PASS)

| # | Query | Before | After |
|---|-------|--------|-------|
| 10-19 | `9시` … `밤 10시` (10) | ft=[N시] | time=HH:00~HH+1:00, AM/PM 적용 |
| 20-24 | `9시 30분`, `14:30`, … (5) | ft=[N:M] | time=HH:MM~HH+1:MM |
| 30 | `9시~11시` | ft=[9시~11시] | time=09:00~11:00 |
| 31 | `오후 2-4시` | 02:00~04:00 | 14:00~16:00 |
| 32 | `14:00~18:00` | ft | time=14:00~18:00 |
| 33 | `9시부터 11시까지` | ft | time=09:00~11:00 |
| 28 | `오전 10시부터` | time=AM only, ft=[10시부터] | time=10:00~- |
| 83 | `9시에` | ft=[9시에] | time=09:00~10:00 |
| 84 | `9시까지` | ft | time=-..09:00 |
| 85 | `9시부터` | ft | time=09:00..- |

### ✅ High 전부 해결 (H5/H6/H7)

| # | Query | Before | After |
|---|-------|--------|-------|
| 49 | `다음 주말` | 04-25..04-26 (this) | **05-02..05-03** |
| 48 | `이번 주말` | date=04-25..26 **ft=[이번]** | date 맞음, ft 누수 제거 |
| 77 | `이번주 금요일 오후 7시` | date 맞음, **ft=[7시]** | date=04-24 time=19:00~20:00 |
| 82 | `다음주 월요일 저녁` | **date=04-20** (today) | **date=04-27** |
| 75 | `next week` | dc=[frontend] ft=[week] | date=04-27..05-03 |

### ✅ Medium 해결

| # | Query | Before | After |
|---|-------|--------|-------|
| 4 | `점심` | ft=[점심] | time=12:00~13:00 |
| 8 | `정오` | ft=[정오] | time=12:00~13:00 |
| 9 | `자정` | ft=[자정] | time=00:00~01:00 |
| 42 | `글피` | ft=[글피] | date=04-23 |
| 44 | `그저께` | ft=[그저께] | date=04-18 |
| 47 | `저번주` | ft=[저번주] | date=04-13..04-19 |
| 60 | `04-24` | ft=[04-24] | date=04-24 |
| 62 | `4월말` | 04-01..04-30 ft=[말] | **04-21..04-30** (last-third) |
| 63 | `5월초` | 05-01..05-31 ft=[초] | **05-01..05-10** |
| 86 | `오전에만` | time 맞음, **ft=[에만]** | time 맞음, ft 깨끗 |
| 87 | `저녁에만` | 동일 누수 | 동일 수정 |

### ⚠️ 남은 FAIL (4건, 모두 감사 리포트 §M11 "separate ticket")

| # | Query | Actual | Expected |
|---|-------|--------|----------|
| 68 | `3일 사이` | ft=[3일,사이] | date=04-20..04-23 |
| 69 | `4/24-4/27` | date=04-24 | date=04-24..04-27 |
| 70 | `내일까지` | date=04-21, ft=[까지] | date=04-20..04-21 |
| 71 | `4월 24일부터 27일까지` | date=04-24, ft=[부터,27일까지] | date=04-24..04-27 |

이들은 공통적으로 **date range 표현** — 별도 티켓 (M11) 권장. 단일 regex 로 덮기 어렵고 감사도 "High difficulty" 로 분류.

## 4. 성능

Before: v1.16.0 프로덕션 단위 테스트 ~340ms (168 tests, 다수 reparse).
After: 197 tests ~340ms (+29 tests, 거의 동일).

Per-parse 마이크로벤치 (68 queries × 14 iter = 938 parses, 15 iteration):
- median: 4.2 ms (928 parses)
- p95: 6.3 ms (938 parses)
- 971-parse 환산 p95: ~6.5 ms (**<10 ms 목표 충족**)

## 5. 금지사항 준수

- ✅ popup / timetable / content / background 무수정
- ✅ API 호환 유지 (VERSION bump 만, 기존 ast 구조 동일)
- ✅ v1.16.0 기존 168 테스트 모두 PASS (회귀 없음)
- ✅ live SWM 호출 없음

## 6. 파일

- `lib/query_parser.js` — 수정 (VERSION + 6 신규 regex + 3 기존 regex 수정 + extract logic 재정렬)
- `test/query_parser.test.js` — +29 테스트 (n2 섹션)
- `docs/review/v1161-n2/report.md` — 본 문서
