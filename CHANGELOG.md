# Changelog

## v1.16.1 — 2026-04-24

### 🐛 Critical — 신청 블록 stale lecTime 복구
- 과거 sync 에서 오매칭된 `00:00 ~ HH:MM` / `30:00 ~ ...` 값이 storage 에 박혀 신청 강의가 시간표에서 사라지거나 하루종일 블록으로 뜨던 문제 해결.
- `content.js` applied merge: fresh history row 를 prev 위로 overlay (이전엔 `if (!prev.lecTime)` guard 가 stale 값을 절대 덮어쓰지 않음).
- `background/service-worker.js` onInstalled: v1.16.1 마이그레이션 추가 — `h1>23` 또는 `00:00~H≥10:00` 패턴의 lecTime 자동 reset → 다음 sync 에서 재파싱·healing.
- `lib/time_utils.js` normalizeRangeText: SWM history 페이지 `HH:MM:SS` 포맷 strip 추가 (`21:30:00 ~ 23:30:00` → `21:30 ~ 23:30`).
- `test/time_utils.test.js`: 실 fetch 데이터 기반 회귀 10+ 건 추가 (121/121 PASS).

### ✨ 기능 보강
- **개설 확정 배지** (`✅ 개설 확정` / `⏳ 미승인`) 를 즐겨찾기 강연에도 표시. fullSync 에서 applied + 즐겨찾기 전부 상세 재fetch → `isApproved` 최신화.
- **Google 캘린더 1클릭 추가**: 팝오버 버튼 "캘린더 추가" + ⋯ 메뉴 "캘린더 추가 (신청 전체)". Template URL 방식 (OAuth 불필요), 브라우저 새 탭에서 Gcal 이벤트 생성 UI 자동 채움.
- Gcal 버튼 아이콘·사이즈 통일 (기본 `.btn` 기준).

### 🐛 시간 파싱 회귀 수정 (v1.16.1 초기 작업)
- **"00:00 ~ 16:00" 하루 꽉참 버그** 완전 해소. SWM detail 페이지의 `14:00시 ~ 16:00시` 형식이 과거 파서에서 `00:00 ~ 16:00` 로 오염돼 16h 블록 생성 → 그리드 오버플로우. parser 통합으로 차단 + blockPos guard (duration > 14h → skip + warn).
- **24:00 end-time 발산 12건** 수정. `content.js` 와 `time_utils.js` 가 `00:00` vs `24:00` 로 다르게 처리해 iCal export 가 깨짐. 단일 source of truth 로 통합 (`lib/time_utils.js`).
- **`.applied.special` 다크 그린 레거시 제거**. 카테고리 팔레트가 구분 담당.

### ✨ 파서 기능 확장 (9 sharp bug 수정)
- 영문 AM/PM postfix: `2:00 PM ~ 5:00 PM` / `9am~11am` / `7:30pm` 지원
- 한국어 시간 표현: `저녁 7시~9시`, `밤 11시~1시`, `아침 9시~11시`, `새벽 2시~4시`
- `오전 9시~12시` end=12 는 정오 정상 유지 (이전 15h 블록 생성 버그)
- `N시 반` → `N:30`, `N시 정각` → `N:00`, `N시부터 M시까지` → `N:00 ~ M:00`

### 🛡️ 렌더 가드
- `blockPos`: 9 guard (null, NaN, 음수, 역순, duration > 14h, overflow clamp)
- `parseTimeRange` boundary: `h≤23/27`, `duration≤14h` (이전 `h≤29/≤16h` 는 과도하게 관대)
- 침묵 실패 제거: 모든 invalid input 에 `console.warn` 출력

### 🔧 구조 정비
- `extractLecDateTime` 중복 제거: `lib/time_utils.js` 단일 구현, `content/content.js` 는 wrapper
- `manifest.json content_scripts` 에 `lib/time_utils.js` 추가 (로드 순서: storage → time_utils → content → detail)
- `timetable/menu.js` iCal regex 제거 → `parseTimeRange` 재사용 (overnight/24:00 export 정상화)
- `lib/query_parser.js` `parseTimeToMin` 제거 → `parseTimeRange` 로 start/end 분리 비교
- 즐겨찾기 블록 ★ 클릭 → 즉시 해제 (v1.16.0 에서 첫 도입, 유지)

### 📊 품질
- `test/time_utils.test.js`: 26 → 108 (+9 sharp bug regression guard + a1 대표 24 + a2 실데이터 20)
- 전체 테스트 322/322 PASS
- 실 SWM 870 raw 재파싱: 870/870 성공 (100%), 24:00 발산 0
- 렌더 시나리오 S1~S6 전수 PASS

---

## v1.16.0 — 2026-04-20

### 🐛 Critical 수정
- **시간 파싱 97.5% → 100%** (789/789). `9:00 ~ 10:00` 처럼 1자리 시각이 파싱 실패하던 `content.js` regex 를 `time_utils` 공유 로직으로 교체. 4/23 이정영·박주람·이세진 멘토 강연 포함 regression 해소.
- **쿼리 파서 v2 (BM25 + Jaro-Winkler)**. `buildKoreanFuzzy` 가 2KB description 에 `김.*멘.*토` 정규식을 적용해 "김멘토" 검색이 30건의 false positive 를 반환하던 v1.15.0 regression 수정. 이제 관련도 랭킹 + 오타 허용.
- **저장소 race condition** — 병렬 `saveSettings` / `toggleFavorite` 시 데이터 손실. `lib/storage.js` 에 모듈 레벨 queue 도입, 병렬 호출 직렬화.
- **WCAG 색대비 Critical 8건** — default/sakura 팔레트의 saturated bg × white fg 조합을 dark fg 로 swap. Critical 0건 달성.
- **이미지 저장 artifact** — `.day-column.today` bg 가 export wrapper 의 card bg 를 override 하던 문제 수정.

### ✨ UX 개선
- **코치마크 전면 재설계** — 팝업 5 step + 시간표 4 step 분리. 실제 UI 흐름 반영 ("시간 지정 토글" 같은 오해 표현 제거).
- **네이티브 `confirm/alert` → 커스텀 모달** (`lib/modal.js`). 다크모드 + 4 팔레트 호환.
- **팝업 메뉴에 팔레트 테마 항목 추가** — 이제 팝업에서도 테마 변경 가능.
- **Sync 토스트 persist** — 2.5s 자동 사라짐 → 10s + 닫기 버튼.
- **결과 카드 키보드 접근성** — Tab focus + Enter/Space 클릭.
- **IME 한글 조합 중 Enter 차단** — 미완성 쿼리 검색 방지.
- **이미지 저장 로딩 UI** — 생성 중 토스트 표시 + devicePixelRatio 적용.

### 🎨 팔레트 조화
- 4 테마 × 19 카테고리 = 76 셀 전부 고유.
- **Default** → Google Calendar 공식 팔레트 (11 API + Material 보강).
- **Sakura** → Gridfiti Cherry Blossom + Tailwind pink/rose/fuchsia.
- **Pastel** → Tailwind 200 scale (WCAG AA 19/19 PASS ★).
- **Night** → VaporWave + Cyberpunk 2077 + Synthwave.

### 🔧 기타
- 시간표 `?` 버튼 클릭 불가 수정 (`<summary>` 내부 배치 충돌 해소).
- 그림자 전면 제거 (블록/hover/applied 모두 flat).
- 페이지네이션 파싱 regex 보강 (multi-page sync 안정화).
- `fetchWithRetry` 5xx silent skip → 재시도 + 경고.
- `storage.onChanged` 리렌더 전 popover 자동 닫힘.
- Dark mode 리스너 중복 등록 가드.
- **BM25 alias-only 쿼리 랭킹 회복** — "AI", "백엔드", "창업 IR" 같은 카테고리 쿼리도 관련도 순 정렬 (v1.15.0 의 score=0 균일 regression 해소).
- **상세 페이지 시간 파싱 regression fix** — i2 의 1자리 시각 지원을 `content/detail.js` 에도 적용.
- **Storage quota 초과 알림** — 전수 `chrome.storage.local.set` 을 `safeSet` wrapper 경유. 실패 시 토스트.
- **Lectures 저장 race 제거** — `timetable.js` / `content.js` 의 whole-object write 3 경로를 `SWM.saveLecture` / `replaceLectures` patch API 로 이전.
- **fullSync 부분 실패 UI** — "완료! N개 · M페이지 실패" 노출.
- **자연어 시간 파서 전면 보강** (nls5-nl, 92 테스트 47→88 OK). 지원 신규 표현:
  - `9시`, `오후 8시`, `9시 30분`, `14:30` (단독 시각 → 1시간 윈도우)
  - `9시~11시`, `오전 9시부터 11시까지`, `14:00~18:00` (한글 범위 + AM/PM 상속)
  - `저녁 7시에`, `9시까지`, `9시부터` (조사)
  - `다음 주말` vs `이번 주말` 구분, `다음주 월요일` 정상 처리
  - 점심/정오/자정/그저께/글피/저번주/`4월말` 등 추가
  - `그제` alias, 영어 `monday`/`friday`/`weekend`, `7 pm`/`9am` am/pm 시간, `4/24-4/27`/`내일까지`/`4월 24일부터 5월 1일까지` 날짜 범위

### 📊 통계
- 빌드: **186KB** (v1.15.0 대비 +7KB — BM25/JW 파서 + 커스텀 모달 등 신규 코드)
- 테스트: **159/159 pass** (query_parser) + **7/7 pass** (storage race) + **22/22 pass** (time_utils)
- 코치마크 step: 팝업 5 + 시간표 4 = 9 스텝

---

## v1.15.0 — 2026-04-19
- NLS (자연어 검색) 2-layer hybrid 파서
- Coachmark (4-step popup 온보딩 투어)
- 4 팔레트 테마 시스템 (default · sakura · pastel · night)
- 18색 카테고리 분류기

## v1.14.1 — 2026-04-18
- shadcn-inspired 디자인 토큰
- Badge/Switch primitive
- 다크 모드 parity

## v1.11.0 ~ v1.13.x
- 초기 팝오버 신청/취소, 주간 시간표, 즐겨찾기
