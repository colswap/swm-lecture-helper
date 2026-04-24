// welcome.js — 최소 로직: onboardingSeen 플래그 + 저장된 테마 반영.

(async function () {
  try {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const mode = settings.themeMode || 'auto';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = mode === 'dark' || (mode === 'auto' && prefersDark) ? 'dark' : 'light';
    document.documentElement.dataset.theme = effective;
  } catch {}

  const tourBtn = document.getElementById('startTourBtn');
  if (tourBtn) {
    tourBtn.addEventListener('click', async () => {
      try {
        if (chrome.storage && chrome.storage.session) {
          await chrome.storage.session.set({ forceCoachmark: true });
        }
      } catch {}
      try {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, onboardingSeen: false } });
      } catch {}
      let opened = false;
      try {
        if (chrome.action && typeof chrome.action.openPopup === 'function') {
          await chrome.action.openPopup();
          opened = true;
        }
      } catch {}
      if (!opened) {
        const msg = '확장 아이콘(주소창 오른쪽)을 눌러주세요 — 열리면 자동으로 가이드가 시작됩니다.';
        if (window.SWMModal && typeof window.SWMModal.showAlert === 'function') {
          await window.SWMModal.showAlert({ title: '안내', body: msg });
        } else {
          alert(msg);
        }
      }
    });
  }
})();
