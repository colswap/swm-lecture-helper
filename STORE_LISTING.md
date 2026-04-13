# Chrome Web Store Listing — SWM Lecture Helper

This file is the copy-paste source for the Chrome Web Store submission form. Not user-facing docs.

---

## 한국어

### 짧은 설명 (Summary, 132자 이내)

> SW마에스트로 멘토링/특강 강연을 빠르게 검색·필터링하고, 즐겨찾기와 신청 현황까지 한눈에 관리하는 보조 도구.

### 상세 설명 (Detailed Description)

```
SW마에스트로(swmaestro.ai) 멘토링/특강 게시판을 위한 Chrome 확장 프로그램입니다.
700개 이상의 강연을 빠르게 검색하고, 비대면/대면 필터링하고, 즐겨찾기와 신청 현황을 한 눈에 관리할 수 있습니다.

■ 주요 기능
- 키워드 검색 (강연 제목 · 멘토명 · 설명)
- 다중 필터: 날짜, 접수 상태, 분류(자유 멘토링/멘토 특강), 장소(비대면/대면)
- ★ 즐겨찾기로 관심 강연 모아보기
- "내 신청" 탭에서 내가 신청한 강연만 모아보기
- 30분 주기 백그라운드 동기화 + 새 강연 등장 시 알림
- 모든 데이터 로컬 저장 (외부 전송 없음)

■ 사용 방법
1. swmaestro.ai 에 로그인
2. 확장 아이콘 클릭 → "접수중 동기화" 버튼 (최초 1회)
3. 검색창에 키워드 입력 또는 필터 조합으로 탐색
4. ★ 버튼으로 즐겨찾기, "내 신청" 탭에서 신청 내역 확인

■ 권한 사용 이유
- swmaestro.ai 도메인 접근: 강연 목록 및 상세 정보 수집 (로그인된 본인 계정 한정)
- storage: 수집 데이터를 로컬 저장
- alarms: 백그라운드 주기 동기화
- notifications: 새 강연 등록 알림
- tabs: swmaestro.ai 탭 식별

■ 개인정보
수집된 모든 데이터는 브라우저의 chrome.storage.local 에만 저장되며 외부로 전송되지 않습니다.
전체 정책: https://github.com/colswap/swm-lecture-helper/blob/main/PRIVACY.md

오픈소스: https://github.com/colswap/swm-lecture-helper
```

---

## English

### Short summary (132 chars)

> Fast search and filters for SW Maestro mentoring/lectures. Track favorites and your applications in one place.

### Detailed description

```
SWM Lecture Helper is a Chrome extension for the SW Maestro (swmaestro.ai) mentoring/lecture board.
It makes it easy to search, filter, favorite, and track applications across 700+ lectures.

■ Features
- Keyword search across title, mentor, and description
- Filters: date, registration status, category, online/offline
- Star lectures as favorites
- "My Applications" tab shows only lectures you have applied to
- Background sync every 30 minutes with desktop notifications for new lectures
- All data stored locally — nothing transmitted externally

■ How to use
1. Sign in to swmaestro.ai
2. Click the extension icon → "접수중 동기화" (first time)
3. Search by keyword or apply filters
4. ★ to favorite; switch tabs to see favorites or your applications

■ Permissions
- swmaestro.ai access: Fetch lecture list and detail pages under your logged-in account
- storage: Save fetched data locally
- alarms: Schedule background sync
- notifications: Alert you when new lectures appear
- tabs: Locate an open swmaestro.ai tab

■ Privacy
All data is stored only in chrome.storage.local. Nothing is sent to any remote server.
Full policy: https://github.com/colswap/swm-lecture-helper/blob/main/PRIVACY.md

Source: https://github.com/colswap/swm-lecture-helper
```

---

## Single-purpose statement (required by Chrome Web Store)

> The extension has a single purpose: to enhance browsing the SW Maestro lecture board at swmaestro.ai by caching lecture data locally and providing fast search, filtering, favorites, and an applied-lecture view.

## Category

Productivity

## Language support

Primary: Korean (ko). Also English (en).
