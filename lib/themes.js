// SWM Lecture Helper — 팔레트 테마 시스템 (v1.15.0 J2)
//
// 기본 (default), 벚꽃 (sakura), 파스텔 (pastel), 다크 플랜 (night) 4개.
// :root 에 data-palette 속성 세팅 → tokens.css 의 [data-palette="..."] 블록이
// --cat-*-bg/fg 를 오버라이드.
// 다크모드 (data-theme="dark") 와 독립적으로 동작 — 중첩 가능.
//
// storage.settings.palette 에 선택 저장. 다른 페이지에서 바뀌면 storage 이벤트로 동기.

(function () {
  'use strict';

  const ATTR = 'data-palette';
  const DEFAULT = 'default';

  // ─── Palette 정의 ───
  // 각 테마는 blockBg/blockFg (시간표 블록) + tagBg/tagFg (카드 배지) 18쌍.
  // 기본 테마는 "reset" 역할 — tokens.css 의 :root 기본값 사용 (override 없음).
  const LIST = [
    {
      id: 'default',
      label: '기본',
      emoji: '',
      description: '선명한 표준 색',
      preview: ['#D50000', '#F4511E', '#0B8043', '#039BE5', '#3F51B5'],
    },
    {
      id: 'sakura',
      label: '벚꽃',
      emoji: '🌸',
      description: '부드러운 분홍 톤',
      preview: ['#EC4899', '#F472B6', '#F9A8D4', '#FBCFE8', '#F0ABFC'],
    },
    {
      id: 'pastel',
      label: '파스텔',
      emoji: '🧁',
      description: '연하고 차분한 색',
      preview: ['#FECACA', '#FDE68A', '#A7F3D0', '#BAE6FD', '#DDD6FE'],
    },
    {
      id: 'night',
      label: '다크 플랜',
      emoji: '🌌',
      description: '네온 톤, 다크 모드 추천',
      preview: ['#FF2975', '#FFD319', '#05FFA1', '#01CDFE', '#B967FF'],
    },
  ];

  const VERSION = '2026-04-20';

  function applyAttr(id) {
    const pal = id && id !== DEFAULT ? id : null;
    if (pal) document.documentElement.setAttribute(ATTR, pal);
    else document.documentElement.removeAttribute(ATTR);
  }

  async function getCurrent() {
    try {
      const { settings = {} } = await chrome.storage.local.get('settings');
      return settings.palette || DEFAULT;
    } catch {
      return DEFAULT;
    }
  }

  async function apply(id) {
    const valid = LIST.some(t => t.id === id);
    const next = valid ? id : DEFAULT;
    applyAttr(next);
    try {
      if (window.SWM && typeof window.SWM.saveSettings === 'function') {
        await window.SWM.saveSettings({ palette: next });
      } else {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, palette: next } });
      }
    } catch (e) {
      console.error('themes apply error', e);
    }
    return next;
  }

  // 다른 페이지에서 팔레트 변경 시 동기 적용
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = changes.settings.newValue?.palette;
    if (typeof next === 'string') applyAttr(next);
  });

  async function init() {
    const id = await getCurrent();
    applyAttr(id);
  }
  init();

  window.SWM_THEMES = { VERSION, list: LIST, apply, getCurrent };
})();
