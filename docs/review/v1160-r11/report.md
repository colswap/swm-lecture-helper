# v1.16.0 — R11 Final Fixer 리포트

> Fixer: r11-final-fixer · 작성일 2026-04-20
> 대상: R10 Critical 2 + 선별 High (r9 H2, r10 H5)
> 범위: lib/storage.js, lib/menu_common.js, popup/popup.js, timetable/timetable.js, content/content.js, test/ (신규 quota 테스트)
> 금지 구역 준수: lib/query_parser.js (r7 완결), lib/tokens.css (k1), lib/coachmark.js/.css (v1.16.1 백로그), manifest.json (1.16.0 고정)

---

## 체크리스트

### ✅ R11-1. Storage quota silent fail (r10 Critical 1)
- `lib/storage.js` 에 `safeSet(obj)` wrapper 도입 — `chrome.storage.local.set` 예외를 catch → `/QUOTA|quota/i` 분류 → `window.SWM_showStorageError(msg)` 훅 호출.
- 2초 쿨다운 (`_lastQuotaToastAt`) 로 연속 실패 시 토스트 중복 방지.
- 래퍼 내 모든 write 경로를 `safeSet` 경유로 이전: `saveLectures:76`, `saveLecture:89`, `replaceLectures:100`, `toggleFavorite:125`, `saveSettings:155`, `saveMeta:177`.
- UI 훅: `popup/popup.js:519` 와 `timetable/timetable.js:932` 에 `window.SWM_showStorageError = (msg) => toast(msg, 'error', { duration:15000 })` 등록.
- 사용자 메시지: `"저장 용량 초과 — 오래된 캐시 정리 필요"` / `"저장 실패 — 잠시 후 재시도"`.

### ✅ R11-2. Wrapper bypass race (r10 Critical 2)
- `timetable/timetable.js:884` (setLectureApplied) whole-object write → `SWM.saveLecture(sn, patch)` — `_saveQueue` + fresh-read+merge 경유.
- `timetable/timetable.js:892` (fetchApplySn) → `SWM.saveLecture(sn, { applySn })`.
- `content/content.js:574` (applied 동기화 후 전체 교체) → 신규 `SWM.replaceLectures(all)` — `_saveQueue` 공유.
- 추가 변경: `saveLectures` / `saveLecture` / `saveMeta` 모두 `_saveQueue` 로 이전 — 기존에는 settings/favorites 만 직렬화 → 이제 lectures 쓰기도 settings 쓰기와 **단일 큐 공유**.
- 결과: content.js fullSync 중 timetable.js apply 클릭이 발생해도 신규 SN 이 덮어쓰기로 유실되지 않음.

### ✅ R11-3. menu_common silent no-op (r9 H2)
- `lib/menu_common.js` 에 `_warnedNoTheme` 플래그 + `_warnNoTheme()` 헬퍼 추가.
- `refreshDarkLabel` / `bindDarkModeMenuItem` 에서 `window.SWMTheme` 미로드 시 `console.warn('[menu_common] SWMTheme not loaded — dark-mode menu inactive (check script load order)')` 로 1회 경고 후 silent return.
- 1회 가드로 로그 스팸 방지.

### ✅ R11-4. fullSync partial fail 토스트 (r10 H5)
- `content/content.js` fullSync 루프에 `failedPages` 카운터 추가 (transient error per page 누적).
- 완료 statusCallback: `failedPages > 0` 이면 `"완료! 접수중 2145개 · 3페이지 실패"` 형식.
- `FULL_SYNC` sendResponse 에 `failedPages` 필드 추가.
- `timetable/timetable.js:1664` triggerSync: `response.failedPages > 0` 이면 버튼 텍스트 `"완료! N개 · M페이지 실패"`.
- `popup/popup.js:547` triggerSync: 토스트 메시지 동일 패턴, level `'warn'`.
- `listLectures.__failedPages` 은 non-enumerable 로 첨부 → 기존 `Object.keys(result).length` 집계 영향 없음 (background peek→FULL 호출자 호환 유지).

---

## 검증

### 테스트 결과
```
node --test test/*.test.js test/*.spec.mjs
# tests 209
# pass  209
# fail  0
```
- 기존 test/storage.test.js (8건) — PASS 유지 (saveSettings/toggleFavorite race 회귀 없음).
- 신규 test/storage_quota.test.js (7건):
  - `safeSet: QUOTA_BYTES → 훅 호출`
  - `saveLectures: quota 실패 시 토스트 훅 + 조용히 반환`
  - `saveSettings: other write 실패 시에도 훅 호출`
  - `safeSet: 2초 쿨다운 — 중복 토스트 억제`
  - `saveLecture: 큐 직렬화 — 정상 경로`
  - `saveLecture + saveLectures 혼합 병렬 — 큐 공유로 덮어쓰기 없음` (R11-2 회귀 테스트)
  - `replaceLectures: 전체 교체도 큐 경유 + quota 감지`

### Grep 검증
`chrome.storage.local.set` 사용 현황 (앱 코드, scripts/node_modules 제외):
- ✅ R11-2 타겟 3개소 전부 제거: `timetable.js:884, 892` + `content.js:574` → wrapper 경유.
- 잔존 직접 write (R11 범위 밖, 문서화):
  - `lib/storage.js:36` — safeSet 구현부 (유일한 허용 직접 호출)
  - `lib/theme.js:34`, `lib/themes.js:76`, `timetable/menu.js:548`, `welcome.js:22` — settings 직접 write (r10 M7 / v1.16.1 백로그)
  - `lib/coachmark.js:314` — markSeen (v1.16.1 innerHTML 백로그 번들)
  - `popup.js:53`, `timetable.js:1842` — lastUserActivity 타임스탬프 (데이터 정합성 무관)
  - `timetable.js:1392, 1435` — slotPresets (별도 key, lectures race 밖)
  - `background/service-worker.js:159` — peek 실패 fallback (race window 좁음, r10 에서 Critical 지정 없음)

### 회귀 리스크
- `saveLecture` 가 기존에는 `_saveQueue` 밖 → 큐 내부로 이동. `saveSettings` / `saveLectures` 와 병렬 시 순차 처리되어 latency 약간 증가 가능 (직렬화 한 tick 추가, ~5-15ms). 데이터 정합성 이익이 훨씬 큼.
- `setLectureApplied` 에서 `applySn: null` 로 patch — 기존 `delete next.applySn` 와 동등 (`if (!lec.applySn)` 체크에 null/undefined 모두 falsy).
- `FULL_SYNC` response.failedPages 필드 추가는 additive — 기존 호출자(popup, timetable, service-worker peek→FULL) 모두 `response?.success` / `response.count` 만 읽어 호환.

---

## 변경 파일 요약

| 파일 | 변경 내용 |
|---|---|
| `lib/storage.js` | `safeSet` 도입, 모든 set 경유, saveLecture/saveLectures/saveMeta 를 `_saveQueue` 로 이전, 신규 `replaceLectures` 추가 |
| `lib/menu_common.js` | `_warnNoTheme` 1회 경고, refreshDarkLabel/bindDarkModeMenuItem 가드 분리 |
| `content/content.js` | fullSync `failedPages` 집계, completion message, response.failedPages 노출, content.js:574 → `SWM.replaceLectures` |
| `timetable/timetable.js` | setLectureApplied / fetchApplySn → `SWM.saveLecture`, triggerSync 토스트에 failedPages, `SWM_showStorageError` 훅 노출 |
| `popup/popup.js` | triggerSync 토스트에 failedPages, `SWM_showStorageError` 훅 노출 |
| `test/storage_quota.test.js` | 신규 — 7 케이스 (quota, race, 쿨다운, replaceLectures) |

---

## 완료 조건
- [x] R11-1 ~ R11-4 모두 반영
- [x] `node --test` 209/209 PASS (신규 7 + 기존 202)
- [x] grep 검증: wrapper 경유만 (lectures race 경로 3개소 제거)
- [x] 금지 구역 (query_parser, tokens, coachmark, manifest) 무변경
