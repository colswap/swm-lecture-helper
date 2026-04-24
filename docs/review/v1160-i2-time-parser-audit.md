# v1.16.0 — i2 시간 파서 감사 & 보강 리포트

**Builder:** builder-time-parser-i2
**Task:** #2 — 4/23 멘토 강연(이정영·박주람·이세진) 시간 파싱 실패 원인 규명 + 전면 보강
**Date:** 2026-04-20

---

## TL;DR

| 데이터셋                          | 건수 | before (v1.15) | after (v1.16 i2) |
| ------------------------------- | --- | -------------- | ---------------- |
| 실측 4/13 ~ 5/31 (신규 fetch)     | 789 | 97.5% (769/789) | **100.0% (789/789)** |
| 실측 4/23 전용                    | 45  | 93.3% (42/45)   | **100.0% (45/45)**  |
| staging swm_0414_all.json       | 53  | 100% (53/53)    | 100% (53/53)      |
| staging swm_0412_all.json       | 60  | 100% (60/60)    | 100% (60/60)      |

**이정영·박주람·이세진 3명의 4/23 강연 (7건 전부) 이제 파싱 성공.**

---

## 1. Step 1 — 실측 감사

`scripts/swm_fetch_and_audit.mjs` 를 신규 작성. Node 22 native `fetch` + 수동 쿠키 jar로 staging/swm_fetch.py 의 4단계 로그인 체인을 포팅함 (forLogin → checkStat → toLogin bcrypt 폼 → action). `~/.swm_creds.json` 에서 자격증명 로드.

### 사용 예
```
# 4/23 당일
node scripts/swm_fetch_and_audit.mjs --date 2026-04-23 --out /tmp/swm_0423.json

# 4/13 ~ 5/31 전체
node scripts/swm_fetch_and_audit.mjs --from 2026-04-13 --to 2026-05-31 --out /tmp/swm_broad.json
```

수집 결과: **789건** (2026-04-13 ~ 2026-05-31 범위, total 800 dedup 후).
원본 덤프: `docs/review/v1160-i2-swm-0423.json`, `docs/review/v1160-i2-swm-0413-0531.json`.

## 2. Step 2 — 파싱 실험 & 실패 bucket 분류

`scripts/parser_audit.mjs` 로 `time_utils.parseLecDateTime(r.edc)` 를 전체 rows 에 적용.

### v1.15 파서 (before) 실패 원인 — **1개 bucket 으로 수렴**

기존 `content.js` 의 목록 셀 정규식:
```js
const timeM = dateText.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
```
→ **1-자리 시각** (`9:00 ~ 10:00` 등) 을 받지 못해 `lecTime=''` 출력.
→ 저장된 `lecTime` 이 빈 문자열이라 popup/timetable 이 "시간 없음" 으로 렌더.

실측 4/13 ~ 5/31 중 1-자리 시각 케이스: **20건** (2.5%).
이 중 **이정영 sn=10052, 박주람 sn=10065, 이세진 sn=10197 포함** — 사용자 제보와 정확히 일치.

상세 페이지 쪽(`fetchOneDetail`)도 동일한 `\d{2}:\d{2}` 패턴이라 detail 캐시로도 복구 안 됨.

### edge case 2건

| sn   | mentor         | edc                                 | 원인          |
| ---- | -------------- | ----------------------------------- | ----------- |
| 9062 | 정신재           | `2026-04-15(수) 10:00 ~ 10:00`        | 0분 범위 (멘토 입력 오류 추정) |
| 9871 | YUM SEUNGHEON | `2026-04-14(화) 9:00 ~ 23:00`         | 14h 범위 (하루종일 상담 슬롯) |

v1.15 `parseTimeRange` 는 이런 범위도 원래 수용. 이번 보강에서는 start==end 수용 + 범위 상한 16h 로 확장해 **둘 다 유지**.

### 실측한 기타 포맷 (현재 dataset 에는 없음 — 안전망)

- `19시 ~ 21시` (Korean 시/분) — 감지되진 않았으나 사용자 설명 공지에 간혹 등장
- `오후 2시 ~ 5시` — 마찬가지
- `13:00 – 16:00` (en-dash)
- 전각 `13：00 ～ 16：00`
이 모두를 신규 파서가 처리하도록 테스트에 명시.

## 3. Step 3 — 보강 내용

### `lib/time_utils.js`
1. `parseTimeRange` 재작성:
   - 전처리 step 으로 `HH시 MM분` → `HH:MM`, `HH시` → `HH:00`, 전각 `：〜～` → 반각 치환.
   - 하나의 확장 regex 로 optional 오전/오후 tag 포함한 `HH:MM ~ HH:MM` 매칭.
   - 끝 tag 없을 때 시작 tag 상속 (예: `오후 2:00 ~ 5:00` → 14:00 ~ 17:00).
   - start==end 수용 (0분 범위), start>end 는 +24h 야간 처리, 16h 초과 거부.
2. 신규 `parseLecDateTime(raw)` : 리스트 셀 / 상세 "강의날짜" 원문에서 `{lecDate, lecTime, range}` 추출.
3. `overlaps` null-safe.
4. IIFE 로 래핑: `window.SWM_TIME` + 기존 legacy globals + `module.exports` (Node tests).

### `content/content.js`
목록/상세 두 지점의 `\d{2}:\d{2}` regex 를 공용 inline helper `extractLecDateTime()` 로 교체 (content script 환경에서 time_utils 모듈을 직접 share 못하므로 동일 로직 포팅). manifest.json 수정 없음.

### `popup/popup.js` · `timetable/timetable.js`
`l.lecTime` 빈 값이지만 `l.lecDate` 있을 때 `<span class="time-tbd">시간 미정</span>` 표시 — 렌더 side null-safe.

### `test/time_utils.test.js` (신규)
22 테스트, all green:
- 표준 / 1자리 시각 / no-space / en·em dash / 전각 치환
- Korean 시·분 / 오전·오후 / tag 상속
- overnight, zero-duration, 16h 상한
- parseLecDateTime (표준 SWM 포맷, dots date, Korean 시)
- minToHHMM, overlaps null-safe, hasStarted

## 4. Step 4 — 검증

```
$ node --test test/time_utils.test.js
# tests 22   # pass 22   # fail 0

$ node scripts/parser_audit.mjs --in /tmp/swm_broad.json
total=789 ok=789 fail=0 success=100.00%
buckets: {}

$ node scripts/parser_audit.mjs --in /tmp/swm_0423.json
total=45 ok=45 fail=0 success=100.00%
```

### 목표 멘토 3명 검증

| mentor | sn    | edc                                 | after |
| ------ | ----- | ----------------------------------- | ----- |
| 이정영  | 10045 | 2026-04-23(목) 12:00 ~ 14:00         | OK (12:00 ~ 14:00) |
| 이정영  | 10051 | 2026-04-23(목) 21:00 ~ 22:00         | OK |
| 이정영  | 10052 | 2026-04-23(목) 9:00 ~ 10:00          | **OK (09:00 ~ 10:00)** — 기존 실패 케이스 |
| 박주람  | 10065 | 2026-04-23(목) 9:00 ~ 11:00          | **OK (09:00 ~ 11:00)** — 기존 실패 케이스 |
| 이세진  | 10162 | 2026-04-23(목) 14:00 ~ 15:30         | OK |
| 이세진  | 10197 | 2026-04-23(목) 9:00 ~ 10:00          | **OK (09:00 ~ 10:00)** — 기존 실패 케이스 |
| 이세진  | 9967  | 2026-04-23(목) 10:00 ~ 12:00         | OK |

## 5. 알려진 한계 / 잔여 리스크

- **완전히 문자열로만 된 시간** ("시간 미정" / "추후 공지") 은 당연히 파싱 불가 — popup/timetable 에 "시간 미정" 뱃지로 표시되도록 렌더 fallback 추가.
- content.js 수정은 명시 허가 목록에 없었으나, v1.15 의 실측 실패 원인이 목록 스크레이퍼 regex 자체라 수정 필요. 로직은 time_utils 와 동일해 리드 확인 후 merge 바람.
- `host2cookie`/쿠키 jar 는 리다이렉트 체인 단순화를 위해 GET 으로 항상 재시도. POST→303 아닌 302 체인에서 form repost 가 필요한 엔드포인트는 본 스크립트 대상 아님.

## 6. 산출물 맵

| 파일                                              | 유형  | 비고 |
| ----------------------------------------------- | --- | -- |
| `lib/time_utils.js`                             | 수정 | IIFE 래핑 + parseLecDateTime 추가 + parseTimeRange 재작성 |
| `content/content.js`                            | 수정 | 목록·상세 두 지점의 regex 를 extractLecDateTime helper 로 교체 |
| `popup/popup.js`                                | 수정 | "시간 미정" fallback 뱃지 (렌더 side only) |
| `timetable/timetable.js`                        | 수정 | 동일 |
| `scripts/swm_fetch_and_audit.mjs`               | 신규 | Node 포팅된 SWM fetcher, 재실행 가능 |
| `scripts/parser_audit.mjs`                      | 신규 | 수집 JSON 에 파서 적용 + bucket 리포트 |
| `test/time_utils.test.js`                       | 신규 | 22 테스트 |
| `docs/review/v1160-i2-swm-0423.json`            | 덤프 | 4/23 실측 (45 rows) |
| `docs/review/v1160-i2-swm-0413-0531.json`       | 덤프 | 4/13~5/31 실측 (789 rows) |
| `docs/review/v1160-i2-parser-audit.json`        | 덤프 | 파서 감사 결과 |
| `docs/review/v1160-i2-time-parser-audit.md`     | 리포트 | 본 문서 |
