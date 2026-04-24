# v1.16.0 I3 — 이미지 저장 body 내부 어두운 사각형 artifact 수정

Builder: `builder-image-export-i3`  
Task: Team `swm-ext-v1160` #3  
Date: 2026-04-20

## 원인 (한 문장)

`#gridBody` 를 `cloneNode(true)` 후 오프스크린 wrapper 에 appendChild 할 때, 자식 `.day-column.today` 가 `today` 클래스를 그대로 유지한 채로 들어가면서 문서의 `:root[data-theme="dark"] .day-column.today { background-color: rgba(0,149,232,0.08) }` (및 light 의 `.day-column.today { background-color: rgba(230,242,250,0.35) }`) 가 export wrapper 의 `.ex-card .day-column { background: ${pal.card} }` 보다 specificity 가 높아 무력화하지 못했고, 결과적으로 **월요일(오늘) 컬럼 전체가 세로로 긴 파랑/연푸른 사각형** 으로 남아 "body 내부의 어두운 사각형" 으로 보였다.

부수적으로 `.now-line` (빨간 2px 가로선), `.lec-block` 상단 2px `inset 0 2px 0 rgba(0,0,0,0.22)` stripe, `.has-selection` 헤더 하이라이트 도 export 에 잔존했다.

## 수정 (한 문장)

`timetable/menu.js` `exportImage()` 내부 스타일 블록에 **`.ex-card .ex-body .day-column.today` 를 `pal.card` 로 `!important` 오버라이드** 하고, `cloneNode` 직후 cleanup 선택자에 `.now-line, .drag-sel, .has-selection` 을 추가했으며, `.lec-block` 의 inset stripe shadow (user 가 이미 "그림자 완전 off" 요청) 와 `.applied.conflicting` 애니메이션 shadow 를 함께 제거했다.

## 후보별 검증 매트릭스

| 후보 | 확인 결과 |
|---|---|
| (1) `.now-line` 잔존 | 주원인 아님 — dark/light 모두 2px 가로 선. 그래도 같이 제거. |
| (2) `.drag-sel`, `.drag-preview` | 평상시엔 없음. 방어적으로 같이 제거. |
| (3) `.selected`, `.preview` | 이미 L369 에서 제거 중. 유지. |
| (4) `.grid-wrapper` scrollbar | 클론 시 포함 안 됨. 무관. |
| (5) `.lec-block` inset 상단 stripe | artifact 는 아니지만 사용자가 그림자 제거 요청 → 함께 제거. |
| (6) **`.today` 컬럼 배경 (주원인)** | `:root[data-theme]` selector 가 `.ex-card` 보다 specificity 높아 오버라이드 실패. 월/light/dark/all-palette 에서 세로 사각형으로 가시. |
| (7) scroll offset | html2canvas 는 cloned 엘리먼트를 offsetTop=0 기준 렌더. 문제 없음. 방어적으로 `bodyClone.scrollTop = 0` 세팅. |
| (8) iconUrl broken-image | `chrome.runtime.getURL('icons/icon48.png')` 는 확장 내부 URL, 정상 로드. 무관. |

## Before / After

- `before/repro-{palette}-{light|dark}.png` — 수정 전 8장. 월요일 컬럼에 세로 사각형 tint 확인.
- `after/repro-{palette}-{light|dark}.png` — 수정 후 8장. artifact 0.

### 픽셀 스캔 (body 영역 ΔLuma>40 & 저채도 카운트)

수정 전후 비교 (낮을수록 양호). `sakura-dark` 의 "after" 40k 는 배경 대비 **밝은 분홍 블록** 이 detector 에 걸린 것 (실제 artifact 아님 — 시각 확인 완료).

```
                     BEFORE          AFTER
default  light       1,732            910
default  dark      141,603          5,767
sakura   light      29,775            378
sakura   dark     176,279         40,445  (분홍 블록 false-positive)
pastel   light        844            370
pastel   dark     139,621          3,785
night    light      1,821            913
night    dark     141,150          5,314
```

dark 계열 -96 ~ -97% 감소 → `.today` 컬럼 세로 tint 제거가 확실히 반영됨. light 계열도 최저치 근접.

## 수정 파일

- `timetable/menu.js` — `exportImage()` 내부 스타일 블록 + cleanup 선택자 확장. (단 1 파일.)

## 산출물

- `scripts/repro-image-artifact.mjs` — playwright 기반 재현 스크립트. 사용: `node scripts/repro-image-artifact.mjs --out=docs/review/v1160-i3/after`.
- `docs/review/v1160-i3/before/*.png` × 8 + `analysis.txt`
- `docs/review/v1160-i3/after/*.png` × 8 + `analysis.txt`

## 재현 방법

```bash
cd /mnt/c/claude/swm-lecture-helper
node scripts/repro-image-artifact.mjs --out=docs/review/v1160-i3/after
```

(WSL 에선 `DISPLAY=:0` 필요 — 헤드리스 모드는 확장 serviceworker 가 뜨지 않아 실패.)
