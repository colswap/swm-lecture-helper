# v1.16.0 Query Parser — i5 → i6 Before/After

작성: builder-parser-v2-i6 · 2026-04-20
기준 데이터: `swm_0412_all.json` + `swm_0414_all.json` dedupe **113 건**
NOW: `2026-04-14 12:00` (이번주 = 04-13..04-19)
이전 버전: `2026-04-19-nls3` · 신규 버전: `2026-04-20-nls4-bm25`

## 1. F1~F10 회귀 비교

| # | Query | Before (nls3) | After (nls4) | Δ | 비고 |
|---|---|---|---|---|---|
| F1 | `김멘토` | **30 hit** | **1 hit** | -29 | 완료조건 #1 ✓ (목표 1~2) |
| F2 | `이세진` | 27 hit | 1 hit | -26 | 흩어진 자모 매치 차단 |
| F3 | `이멘토님` | 6 hit | 0 hit | -6 | 4글자 모두 동일 토큰 요구 → 0. fixture 외 실데이터 검증 필요. |
| F4 | `김 멘토` | 30 hit | 30 hit | 0 | "멘토" 단독 → categoryNm "멘토 특강/자유 멘토링" 매치. 컨텍스트 없이 분리 불가; 별도 이슈. |
| F5 | `벡엔드` | 0 hit | **36 hit** | +36 | 완료조건 #2 ✓ (JW 0.861 → derivedCat:backend) |
| F6 | `AI 파인튜딩` | 1 hit | 58 hit | +57 | "파인튜닝" alias 추가 + JW 0.96 매치. AI 강의 전체로 확장. 파인튜닝 강의 포함 ✓ |
| F7 | `@김-홍길동` | 0 hit | 0 hit | 0 | 멘토명 fallback — out of scope (i6) |
| F8 | `AI` | 58 hit (날짜순) | 58 hit (rank) | order | rank() opt-in 도입; popup/timetable caller 가 rank 호출. unit test 가 BM25 desc 정렬 + top1 score > 0 검증. |
| F9 | `Agentic AI` | 58 hit | 58 hit | 0 | F8 와 동일 derivedCat → 동일 결과셋. rank() 호출 시 freeText 가 비어 score=0 균일. |
| F10 | `창업 IR` | 0 hit (freeText) | 0 hit | 0 | DERIVED_ALIAS 가 두 토큰 모두 startup 으로 collapse — 별도 IR-specific filter 필요 (out of scope) |

### 핵심 성과
- **F1 30→1** (false positive 폭주 해결)
- **F5 0→36** (오타 recall 회복)
- **F8 rank() 옵트인** (BM25 score 정렬 + 상위 강의 의도 일치)

## 2. Bench p95 (1000 mixed queries)

| Metric | nls3 | nls4-bm25 | Δ |
|---|---|---|---|
| p50 | 0.232ms | 0.197ms | -0.035 |
| p95 | 0.493ms | 0.395ms | -0.098 |
| p99 | 1.359ms | 1.093ms | -0.266 |

n_lec = 113. **목표 p95 < 10ms (971건 환산 ≈ 3.4ms) 달성.** 회귀 없음 — 오히려 약간 빠름 (bounded fuzzy 가 매칭 실패 시 short-circuit 더 빠름).

## 3. API 변경

| 항목 | 변경 |
|---|---|
| `VERSION` | `'2026-04-19-nls3'` → `'2026-04-20-nls4-bm25'` |
| `parse(raw, opts)` | 시그니처 동일. JW typo 승격 추가 (Korean ≥2자 freeText → 알리아스 매칭 ≥0.85). |
| `apply(ast, lectures)` | 시그니처 동일. `buildKoreanFuzzy` 가 `\S*` bounded — 동일-토큰 내 매치만 인정. |
| `rank(ast, lectures, opts?)` | **신규.** `opts.rank=true` → `[{lec, score}]` BM25 desc 정렬. `false`/생략 → `apply()` 와 동일한 lectures 배열. |
| `buildKoreanFuzzy(kw)` | 유지(deprecated 의미 — 회귀 방지로 bounded `\S*` 적용). 외부 caller 동작 호환. |
| `stringify`, `isEmpty`, `hasKorean` | 변경 없음. |

## 4. 알고리즘 노트

### Bounded fuzzy
- 이전: `김.*멘.*토` → 2KB description 의 흩어진 한글 매치 → false positive 폭주
- 이후: `김\S*멘\S*토` → 단일 whitespace-delimited 토큰 내에서만 매치
- "컴터" → "컴퓨터공학" recall 보존 (single-token).

### Jaro-Winkler (NFD 자모)
- `String.prototype.normalize('NFD')` 로 한글 syllable → 초/중/종성 분리.
- 1-자모 오타 ("벡엔드" 의 ㅔ↔ㅐ) 가 score 0.85+ 로 잡힘.
- vocab: DERIVED_ALIAS / LOCATION_ALIAS / STATUS_ALIAS 의 한글 키 (≥2자) 만.
- 1글자 토큰은 promote 안 함 (selectivity 보호).

### BM25 rank
- k1=1.5, b=0.75 (표준값).
- 필드 가중치: title×3, mentor×2, categoryNm×2, description×1.
- 토큰화: `\p{L}\p{N}` 단어 + 한글 2-gram (부분 매치 recall).
- query 당 in-memory 인덱스 빌드 (113건 × ~4토큰 ≈ <2ms).

## 5. 테스트 요약

- 기존 146 tests + i6 신규 13 tests = **총 159 tests pass**.
- 신규 fixture (`fpLectures`): 6건 — false-positive trap (fp1) + 정상 케이스 5건.
- F1/F2/F5/F6/F8 별 regression guard 추가.
- `rank()` 시그니처/동작 검증 (4건).

## 6. 호출부 변경

| 파일 | 변경 |
|---|---|
| `popup/popup.js:134` | `apply(ast, lectures)` → `rank(ast, lectures, {rank:true}).map(r => r.lec)` |
| `timetable/timetable.js:204` | 동일 |

기존 sort/render 로직 무변경 — popup 의 날짜+시간 정렬은 그대로 동작 (BM25 score 는 미사용이지만 향후 score-aware UI 확장 경로 확보).

## 7. 잔여 / 후속

- **F4 `김 멘토`**: 두 토큰 분리 후 substring 폭주. categoryNm 의 "멘토 특강" 자체가 90% 강의에 포함되어 selectivity 낮음. 처리는 다음 마이너에서 (예: 토큰 길이 1 freeText 의 hay 매치 시 mentor field 우선).
- **F7 `@김-홍길동`**: 멘토 매칭 fallback 미구현 (out of scope).
- **F10 `창업 IR`**: 두 토큰 모두 startup alias → collapse. IR-specific filter 별도.
- **벤치 데이터**: 113건은 i5 가 확보한 dump. 971건 캐시는 i2 작업 완료 후 재벤치 권장.
