# SWM Lecture Helper

SW마에스트로 (swmaestro.ai) 멘토링/특강 게시판을 위한 Chrome 확장 프로그램.

700개 이상의 강연을 빠르게 검색하고, 비대면/대면으로 필터링하고, 즐겨찾기와 신청 현황을 한 눈에 관리할 수 있습니다.

## 기능

- **빠른 검색** — 강연 제목, 멘토명, 설명에서 키워드 검색
- **다중 필터** — 날짜, 접수 상태(접수중/마감), 분류(멘토특강/자유멘토링), 장소(비대면/대면)
- **즐겨찾기** — ★ 버튼으로 관심 강연 저장, "즐겨찾기" 탭에서 모아보기
- **내 신청** — 내가 접수한 강연을 "내 신청" 탭에서 한눈에 확인 (과거 포함)
- **자동 동기화** — 30분 주기 백그라운드 sync + 새 강연 등장 시 데스크톱 알림
- **장소 자동 수집** — 상세 페이지 정보(비대면: ZOOM 등) 기본 동기화에 포함

## 설치

### Chrome Web Store (준비 중)

### 개발자 모드 (직접 로드)

1. 저장소 클론 또는 다운로드
   ```
   git clone https://github.com/colswap/swm-lecture-helper.git
   ```
2. Chrome에서 `chrome://extensions` 열기
3. 우측 상단 **개발자 모드** ON
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. `swm-lecture-helper` 폴더 선택

## 사용법

1. [swmaestro.ai 멘토링 페이지](https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046)에 로그인
2. 확장 아이콘 클릭 → **접수중 동기화** (최초 1회, 이후 자동)
3. 검색창/필터로 강연 탐색
4. ★ 으로 즐겨찾기, 탭 전환으로 **즐겨찾기** / **내 신청** 보기

## 개인정보 · 보안

모든 데이터는 브라우저의 `chrome.storage.local` 에만 저장되며 외부 서버로 전송되지 않습니다. 자세한 정책은 [PRIVACY.md](./PRIVACY.md).

## 기술 스택

- Chrome Extension Manifest V3
- Vanilla JS (프레임워크 없음)
- `chrome.storage.local`, `chrome.alarms`, `chrome.notifications`

## 기여

버그 리포트나 제안은 [Issues](https://github.com/colswap/swm-lecture-helper/issues)로 남겨주세요.

## 라이선스

MIT
