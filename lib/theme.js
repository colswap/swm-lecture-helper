// 다크모드 — auto/light/dark 3모드 순환. settings.themeMode 에 저장.

(function () {
  const MODES = ['auto', 'light', 'dark'];
  const LABELS = { auto: '시스템', light: '라이트', dark: '다크' };

  function resolveMode(mode) {
    if (mode === 'dark' || mode === 'light') return mode;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyResolved(mode) {
    const effective = resolveMode(mode);
    document.documentElement.dataset.theme = effective;
  }

  async function getMode() {
    try {
      const { settings = {} } = await chrome.storage.local.get('settings');
      return settings.themeMode || 'auto';
    } catch {
      return 'auto';
    }
  }

  async function setMode(mode) {
    try {
      const { settings = {} } = await chrome.storage.local.get('settings');
      settings.themeMode = mode;
      await chrome.storage.local.set({ settings });
    } catch (e) {
      console.error('theme setMode error', e);
    }
  }

  async function cycleMode() {
    const current = await getMode();
    const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    await setMode(next);
    applyResolved(next);
    return next;
  }

  // 시스템 변경 감지 — mode 가 'auto' 일 때만 즉시 반영
  function onSystemChange() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = async () => {
      const mode = await getMode();
      if (mode === 'auto') applyResolved(mode);
    };
    mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
  }

  // storage 변경 감지 — 다른 페이지(팝업/시간표) 에서 테마 바뀌면 동기
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const next = changes.settings.newValue?.themeMode;
    if (next) applyResolved(next);
  });

  // 초기 적용
  async function init() {
    const mode = await getMode();
    applyResolved(mode);
    onSystemChange();
  }
  init();

  // 외부에서 접근 가능하게 글로벌 노출
  window.SWMTheme = { getMode, setMode, cycleMode, applyResolved, LABELS, MODES };
})();
