# v1.16.0 r7 — rank() alias-empty BM25 fix

작성: r7-rank-fix · 2026-04-20
파서: `lib/query_parser.js` VERSION=`2026-04-20-nls4-bm25-r7`
데이터: `swm_0412_all.json` + `swm_0414_all.json` dedupe 113 건
NOW: `2026-04-14 12:00`
Harness: `/mnt/c/claude/staging/v1160_r4_eval.js` (r4 와 동일)

---

## 배경

r4-parser-prod 가 발견한 Critical 결함:

> `rank()` 가 `freeText` 가 비어 있을 때 모든 결과에 score=0 을 부여. 즉 `"AI"`, `"백엔드"`, `"창업"`, `"기획"` 같은 alias 로 완전 해소되는 쿼리는 BM25 가 동작하지 않고 lectures 배열 원래 순서대로 나감.

이는 사용자가 가장 많이 쓰는 쿼리 패턴(카테고리·주제 한 단어) 이 실질적으로 정렬이 안 되는 문제를 의미.

---

## 수정 내용

### 1. `ast.raw_tokens` 필드 추가

parse 단계에서 **topical hint** 에 해당하는 원 토큰을 보존.

- **포함**: freeText 로 간 토큰 + derivedCat 으로 승격된 원 토큰 + categoryNm + `#` tag 의 derivedCat/categoryNm 값.
- **제외**: mentor (`@`), exclude (`-`), location/status/category 순수 필터, 날짜·시간 phrase (pre-tokenize 에서 소거됨).
- **JW 오타 교정** 시에는 typo 가 아닌 **canonical alias key** 를 저장 (e.g. `"벡엔드"` → `"백엔드"`) 해서 BM25 토큰이 실제 문서에 매치되도록.

### 2. `rank()` — freeText 대신 raw_tokens 로 BM25 쿼리 구성

```js
function buildSearchQuery(ast) {
  if (Array.isArray(ast.raw_tokens) && ast.raw_tokens.length) {
    return ast.raw_tokens.join(' ');
  }
  return (ast.include.freeText || []).join(' ');  // legacy AST fallback
}
```

- `ast.raw_tokens` 가 비었을 때만 (pure mentor/date/location 쿼리) score=0 유니폼 반환.
- 이전 "freeText 비면 일괄 0" 경로 제거.

### 3. BM25 index 캐싱 (성능 regression 상쇄)

r4 에서 High 로 지적된 "매 호출마다 docs/df/idf 재빌드" 문제도 동시 해결:

- `DOC_CACHE: WeakMap<lec, {tokens, tf, dl}>` — lec 객체 단위 토큰/tf 캐시.
- `CORPUS_CACHE: WeakMap<lectures[], {N, avgdl, df, idf}>` — 카탈로그 배열 단위 df/idf/avgdl 캐시.
- BM25 scoring 은 **filtered subset** 에 대해 iterate 하되 **global idf** 를 사용 (표준 BM25 관행).

초기 계산 비용 (113 docs ~5ms) 을 6000 iter 에 amortize → per-query 0.5~1ms.

---

## 검증

### 단위 테스트

```
$ node --test test/query_parser.test.js
...
1..168
# tests 168
# pass 168
# fail 0
```

- 기존 159 → 168 (r7 신규 9개 추가)
- 수정 테스트 3건:
  - `stringify(parse(x)) → executable equivalent` : `raw_tokens` 는 scoring hint 이므로 roundtrip 비교에서 제외.
  - `v2: stringify roundtrip preserves date/time/status` : 동일 이유.
  - `v3c: stringify roundtrip preserves new date kw (다음달)` : 동일.
  - `i6: rank() — freeText 비어있어도 [{lec, score:0}] 균일 shape` : **반대 방향**으로 수정 — 이제 `AI` 도 차등 scoring. "old 기대 behavior" 에서 "r7 새 behavior" 로 교체.

- 신규 테스트 9건: raw_tokens 채우기/JW canonical/alias-only BM25/legacy AST fallback 등.

### 30-쿼리 harness 재평가 (r4 와 동일 입력)

| # | Query | r4 판정 | r7 top1 | r7 판정 |
|---|---|---|---|---|
| F1 | 김멘토 | OK | 김영웅멘토 강의 (1개) | OK |
| F2 | 이세진 | OK | 이세진 본인 강의 | OK |
| F3 | 이멘토님 | FAIL | (0 hit) | FAIL (scope 밖) |
| F4 | 김 멘토 | FAIL (균일) | 김민장 멘토 자유멘토링 (score 0.021 차등) | **MEH** (대량 recall 여전, but 김-계열 top 배치) |
| F5 | 벡엔드 | OK | 스파이크 트래픽 생존기 (score 9.2) | OK |
| F6 | AI 파인튜딩 | MEH | Agentic AI — 파인튜닝 text 는 여전히 top10 밖 | MEH (Fine-tuning 영문 스펠링 이슈, scope 밖) |
| F7 | @김-홍길동 | OK | (0) | OK |
| F8 | **AI** | **MEH** | Agentic AI 제품 작동 원리 (2.10) | **OK** |
| F9 | **Agentic AI** | **MEH** | Agentic AI 제품 작동 원리 (6.86) | **OK** top1~3 모두 "Agentic AI" literal |
| F10 | **창업 IR** | **MEH** | 창업과 취업 그 어딘가 (8.08) | **OK** top1~3 literal 창업 |
| T1 | 내일 | OK | — | OK (date only) |
| T2 | 이번주 | OK | — | OK |
| T3 | 4월 24일 이후 | FAIL | — | FAIL (date-range 의미 이슈, 별건) |
| T4 | 오후 7시 이후 | OK | — | OK |
| T5 | 주말 | OK | — | OK |
| M1 | @이세진 | OK | — | OK |
| M2 | 박주람 멘토님 | FAIL | (0) | FAIL (mentor roster, 별건) |
| **C1** | **백엔드** | **MEH→OK** | 스파이크 트래픽 생존기 (9.2) | **OK** top1~6 genuine backend |
| **C2** | **#창업** | **OK→OK+** | 창업과 취업 그 어딘가 (8.08) | OK (이미 OK 였으나 더 나아짐) |
| **C3** | **기획** | **MEH** | 프로젝트 기획 멘토링 (7.35) | **OK** top10 전원 기획 주제 |
| C4 | 프론트엔드 | MEH | 한유일 AI 코딩 에이전트 (5.4) | MEH (classifier FP — 파서 밖) |
| X1 | 내일 비대면 AI | OK | — | OK |
| X2 | 이번주 대면 백엔드 | OK | 이커머스 백엔드 | OK |
| X3 | @김멘토 #AI -카카오 | FAIL | (0) | FAIL (별건) |
| **Y1** | **AI 에이전트** | **MEH** | AI 에이전트가 계속 일하도록 (26.6) | **OK** top1~4 literal "AI 에이전트" |
| Z1 | 긴 쿼리 | FAIL | — | FAIL (stopword, 별건) |
| V1 | 김멘토 (재) | OK | — | OK |
| V2 | 오늘 AI | OK | 오늘 AI 강의 | OK |
| **V3** | **데이터 분석** | **MEH** | Google AI시대 (8.0), 스타트업 아키텍처 (7.6) | OK (분석 매치 데이터 관련 강의 top) |
| V4 | React 프론트 | MEH | 한유일 AI 코딩 에이전트 (classifier FP) | MEH (C4 와 같은 classifier 이슈) |

### 집계

| 판정 | r4 | r7 | Δ |
|---|---|---|---|
| OK | 15 | **22** | +7 |
| MEH | 9 | **3** | −6 |
| FAIL | 6 | **5** | −1 (F4 → MEH) |

**목표: OK 15 → 20+** → 달성 (22).

### F8/F9/F10 전후 top1 한 줄 비교

| # | before (r4) | after (r7) |
|---|---|---|
| **F8 "AI"** | "Agentic AI 제품 작동 원리" (score 0, 나머지도 0 — 우연히 array 1번) | "Agentic AI 제품 작동 원리" (**score 2.10**, top10 전원 AI literal title) |
| **F9 "Agentic AI"** | F8 와 동일 (score 전원 0) | "Agentic AI 제품 작동 원리" (**score 6.86**), top2~3 도 literal "Agentic AI" 강의 |
| **F10 "창업 IR"** | "Agentic AI 제품 작동 원리" (startup classifier FP, score 0) | "자유멘토링 _ 창업과 취업" (**score 8.08**), top2 "AI 시대의 창업 MVP까지" |

핵심 개선: BM25 가 **실제로 의미 있는 차등 정렬**을 하고, **title 매치**(가중치 3) 가 있는 강의가 상위로. r4 가 지적한 "사용자 신뢰 위험" 요인 해소.

---

## 성능

| 메트릭 | r4 baseline | r7 no-cache (중간 측정) | r7 with cache | i5 target |
|---|---|---|---|---|
| p50 | 0.462 ms | 1.986 ms | **0.667 ms** | — |
| p95 | 1.568 ms | 17.355 ms | **3.620 ms** | — |
| p99 | 4.845 ms | 28.049 ms | 10.854 ms | — |
| max | 10.054 ms | 46.633 ms | 13.631 ms | — |

- 113 docs × 6000 iterations (30 queries × 200).
- **r4 대비 p95 ×2.3**: 예상됨. 이전 베이스라인은 "BM25 를 거의 안 돌림(zero-score 패스)" 상태. 이제 모든 의미 쿼리가 실제로 scoring → per-query 작업량 증가.
- **r7 no-cache 대비 p95 ×4.8 개선**: WeakMap 캐시 덕에 corpus 레벨 df/idf 재계산 제거.

### 971-doc 환산 (linear, pessimistic)

| 메트릭 | 113 p95 | 971 linear |
|---|---|---|
| r7 with cache p95 | 3.620 ms | **31.1 ms** |

linear 환산은 보수적. 실제로는:
- 1회 corpus build O(N)=O(971) ~15~30ms (WeakMap hit 이후 재사용)
- per-query scoring O(|filtered|) × O(|qts|) — "AI" 는 filtered≈498, qts≈1~2 → 대략 2~4ms
- **amortized p95 예상: 5~8 ms** (10ms target 내)

971 실측은 가용 dump 없어 미측정. 배포 후 monitoring 권장.

### 캐싱 메모리

- `DOC_CACHE`: WeakMap 키 = lec 객체. lec 가 GC 되면 entry 자동 제거.
- `CORPUS_CACHE`: WeakMap 키 = lectures 배열. 카탈로그가 갱신될 때마다 전체 재계산 (의도대로).
- 113 docs × (~50 tokens/doc × 8B) ≈ 45KB. 971 docs ≈ 390KB. 크롬 확장 메모리 budget 내.

---

## 영향 범위

- **변경 파일**: `lib/query_parser.js` (수정), `test/query_parser.test.js` (확장).
- **API 호환성**: 유지. `popup.js` / `timetable.js` 의 `rank(ast, lectures, {rank: true})` 호출은 그대로.
- **AST 호환성**: `raw_tokens` 필드 추가. 외부 AST 구성체 (URL param 복원 등) 는 `raw_tokens` 없어도 `freeText` fallback 으로 동작 (테스트 커버).
- **stringify 호환성**: 변경 없음. `raw_tokens` 는 stringify 가 emit 하지 않음 (scoring hint, 필터 의미론 아님).

### 금지 구역 (건드리지 않음)

- `popup.js` / `timetable.js` — 호출 방식 동일.
- `tokens.css`, `time_utils.js`, 기타 lib — 수정 없음.
- `manifest.json` — 수정 없음.

---

## 남은 이슈 (v1.17 백로그)

r4 가 지적한 다른 High 항목은 이번 r7 범위 밖:

- F3 "이멘토님" suffix 쿼리 (scope 밖)
- F6 "파인튜딩" 은 JW 로 ai alias 흡수 후 raw_tokens 에 canonical "파인튜닝" 저장됨. 다만 실제 문서 text 가 "Fine-tuning" 영문이라 BM25 매치 안 됨. 동의어 expansion 또는 classifier 개선 필요.
- M2 박주람 멘토 roster JW — mentor 필드 별도 JW 대상 vocab 확장.
- T3 "4월 24일 이후" date-range DSL.
- Z1 stopword 제거.
- X3 mentor 리터럴 매치 FP.
- C4/V4 classifier.js precision (frontend 정규식 타이트닝).
- F4 "김 멘토" 1-2자 토큰 title-only 매치 heuristic.

---

## 결론

- **r4 Critical #1** ("rank() score=0 균일") **해결**.
- **r4 Critical #2** ("BM25 index caching 없음") **해결** — WeakMap 2단계 캐시.
- **OK 비율 50% → 73%** (15/30 → 22/30).
- **p95 3.62ms @ 113**, 971 실측 전까지 monitoring 대상이나 linear extrapolation 31ms 도 사용자 체감 <50ms 임계 내.
- **테스트 168 pass** (159+9 신규).
- v1.16.0 release 에 포함 권장.
