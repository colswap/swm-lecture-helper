# Chrome Web Store Listing — SWM Lecture Helper (v1.11.0)

개발자 콘솔에 붙여넣는 복사본. 사용자용 문서 아님.

---

## 한국어

### 짧은 설명 (Summary, 132자 이내)

> SW마에스트로 멘토링·특강을 풀탭 시간표로 한눈에. 검색·필터·즐겨찾기·팝오버 즉시 신청·취소까지 통합.

### 상세 설명 (Detailed Description)

```
SW마에스트로(swmaestro.ai) 연수생을 위한 Chrome 확장 프로그램입니다.
멘토링/특강 게시판을 주간 시간표 뷰로 한눈에 보고, 검색·필터·즐겨찾기를
통합 관리하며, 강연 상세 팝오버에서 바로 신청·취소까지 가능합니다.

■ 주요 기능

[팝업 — 빠른 조회]
- 키워드 검색 (강연 제목·멘토명·설명·장소)
- 다중 필터: 날짜 범위(A~B), 접수 상태, 분류(멘토 특강/자유 멘토링), 장소(비대면/대면)
- 3개 탭: 검색 / 즐겨찾기 / 내 신청
- ★ 즐겨찾기 토글로 관심 강연 모아보기
- 장소 정보 자동 수집 (비대면: Zoom/Webex 등, 대면 주소)
- 이미 시작한 강연은 접수중 탭에서 자동 제외

[풀탭 시간표]
- 주간 캘린더 뷰 (월~일 × 08:00~24:00, 10분 단위)
- 신청 강연 블록 표시 + 즐겨찾기 반투명 오버레이 (토글)
- 강연 블록 클릭 → 팝오버: 카테고리/시간/장소/멘토/설명/인원
- 팝오버에서 "즉시 신청" / "신청 취소" 바로 실행 (사이트 왕복 불필요)
- 드래그로 시간대 선택 → 해당 시간에 가능한 강연만 필터
- "내 빈 시간 전체" 버튼으로 신청 강연 제외한 빈 슬롯 자동 선택
- 요일 헤더 클릭 → 그 요일 종일 토글
- 선택한 슬롯 우클릭 → 개별 제거
- 날짜 범위 (A~B) 필터, "이번 주" 빠른 토글

[내보내기 · 인쇄]
- iCal (.ics) 다운로드 → Google/Apple 캘린더로 import (Asia/Seoul 시간대)
- 인쇄 · PDF 저장 (시간표만 깔끔 출력)

[테마]
- 다크 모드 (시스템 / 라이트 / 다크 순환)

[백그라운드 · 알림]
- 30분 주기 자동 동기화 (swmaestro.ai 탭 열려 있을 때)
- ⋯ 메뉴 → "알림 설정" 에서 원하는 알림만 켜기 (기본 OFF)
  - 새 강연 등장 시 데스크톱 알림
  - 즐겨찾기 강연에 빈자리 발생 시 알림
  - 관심 멘토의 새 강연 등장 시 알림 (멘토 이름 직접 등록)

■ 사용 방법

1. swmaestro.ai 에 로그인
2. 확장 아이콘 클릭 → "접수중 동기화" 버튼 (최초 1회, 이후 30분 자동)
3. 팝업에서 검색·필터, 또는 "시간표" 버튼으로 풀탭 시간표 열기
4. 강연 블록/카드 클릭 → 팝오버에서 즉시 신청·취소

■ 권한 사용 이유

- swmaestro.ai 도메인 접근: 강연 목록·상세 정보 수집 (로그인된 본인 계정 범위 내)
- storage: 수집 데이터를 브라우저 로컬 (chrome.storage.local) 에 저장
- alarms: 30분 주기 백그라운드 동기화
- notifications: 새 강연·빈자리·멘토 매치 데스크톱 알림
- tabs / activeTab: swmaestro.ai 탭 식별 및 콘텐츠 스크립트 통신

■ 개인정보

모든 데이터는 브라우저의 chrome.storage.local 에만 저장되며 외부 서버로
전송되지 않습니다. 확장 제거 또는 "데이터 초기화" 메뉴로 언제든 삭제
가능합니다. 상세 정책은 스토어 내 "개인정보 처리방침" 링크를 참조하세요.

※ 본 확장은 SW마에스트로 공식 도구가 아니며, 개인 보조용 비영리 도구입니다.
   사이트 이용약관 범위 내에서만 동작합니다.
```

---

## English

### Short summary (132 chars)

> SW Maestro lecture helper: full-tab calendar, powerful search/filters, instant apply/cancel from popover.

### Detailed description

```
SWM Lecture Helper is a Chrome extension for the SW Maestro (swmaestro.ai)
mentoring/lecture board. It gives you a weekly calendar view, rich search
and filters, favorites, and instant apply/cancel from a lecture popover —
all without leaving your current page.

■ Features

[Popup — Quick Browse]
- Keyword search (title, mentor name, description, location)
- Multi-filters: date range (A~B), registration status, category, offline/online
- 3 tabs: Search / Favorites / Applied
- ★ favorite toggle
- Auto-collect location info (Zoom/Webex URL for online, address for offline)
- Auto-hide lectures that already started (Accepting tab)

[Full-tab Timetable]
- Weekly calendar view (Mon–Sun × 08:00–24:00, 10-min grid)
- Applied lectures as colored blocks; favorites as semi-transparent overlay
- Click a block → popover with full details (category, time, location, mentor, description, capacity)
- Instant apply / cancel buttons inside the popover (no round-trip to site)
- Drag on grid to select time windows → filter lectures fitting your slots
- "All my free slots" auto-select (skips applied lectures)
- Day-header click toggles entire day; right-click a slot to remove
- Date range (A~B) filter, "This week" quick toggle

[Export · Print]
- iCal (.ics) download → import to Google / Apple Calendar (Asia/Seoul)
- Clean print / save as PDF

[Theme]
- Dark mode (system / light / dark cycle)

[Background · Notifications]
- 30-min auto sync (when swmaestro.ai tab is open)
- ⋯ menu → "Notifications" to enable only what you want (all OFF by default)
  - New lecture added
  - Favorite lecture slot opens
  - Watched mentor posts new lecture (enter mentor names yourself)

■ How to use

1. Sign in to swmaestro.ai
2. Click extension icon → "접수중 동기화" (first time; auto every 30 min after)
3. Search in popup or click "시간표" to open the full-tab calendar
4. Click a lecture block/card → apply/cancel directly from the popover

■ Permissions

- swmaestro.ai host access: Fetch lecture list and detail pages (within your logged-in account scope)
- storage: Save fetched data in chrome.storage.local
- alarms: 30-min background sync
- notifications: Desktop alerts
- tabs / activeTab: Locate an open swmaestro.ai tab

■ Privacy

All data is stored only in chrome.storage.local. Nothing is transmitted to any
external server. Remove the extension or use "Reset Data" menu to delete all
stored data. See the Privacy Policy linked on this store listing for details.

※ This extension is not an official SW Maestro product. It is a personal,
  non-commercial companion tool operating strictly within the site's terms.
```

---

## Single-purpose statement (Chrome Web Store 필수)

> The extension has a single purpose: to enhance browsing the SW Maestro lecture board at swmaestro.ai by providing local-cached search, filters, a weekly calendar view, favorites, applied-lecture tracking, and convenient apply/cancel from a lecture popover.

## Category

Productivity

## Language support

Primary: Korean (ko). Secondary: English (en).

## What's New (v1.11.0 변경사항 요약)

```
v1.11.0 주요 업데이트
- 팝오버에서 바로 신청 / 취소 (사이트 왕복 불필요)
- 풀탭 시간표 + 드래그 시간대 선택 검색
- "내 빈 시간 전체" 자동 선택
- 날짜 범위 (A~B) 필터
- 다크 모드 (시스템/라이트/다크)
- iCal 내보내기 + 인쇄/PDF
- 이미 시작한 강연 자동 제외
- 즐겨찾기 그리드 반투명 표시 토글
```
