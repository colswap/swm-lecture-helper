// welcome.js — 최소 로직: onboardingSeen 플래그 + 저장된 테마 반영.

(async function () {
  try {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const mode = settings.themeMode || 'auto';
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = mode === 'dark' || (mode === 'auto' && prefersDark) ? 'dark' : 'light';
    document.documentElement.dataset.theme = effective;
  } catch {}

  // v1.16.2: 버전 배지 manifest 자동 동기화 — 하드코딩 회귀 차단.
  try {
    const version = chrome.runtime.getManifest().version;
    const hero = document.getElementById('heroVersion');
    if (hero) hero.textContent = `v${version}`;
    const foot = document.getElementById('footVersion');
    if (foot) foot.textContent = `v${version} · SWM Lecture Helper`;
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
