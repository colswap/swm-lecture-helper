// popup 과 timetable 메뉴 공유 유틸

(function () {
  async function refreshDarkLabel(labelEl) {
    if (!labelEl || !window.SWMTheme) return;
    const mode = await window.SWMTheme.getMode();
    const prefix = window.SWMTheme.PREFIX || '테마';
    labelEl.textContent = `${prefix}: ${window.SWMTheme.LABELS[mode]}`;
  }

  async function bindDarkModeMenuItem(itemEl, labelEl) {
    if (!itemEl) return;
    await refreshDarkLabel(labelEl);
    itemEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.SWMTheme.cycleMode();
      await refreshDarkLabel(labelEl);
    });
    // 다른 페이지에서 변경 시 라벨 동기화
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      refreshDarkLabel(labelEl);
    });
  }

  window.SWMMenuCommon = { bindDarkModeMenuItem, refreshDarkLabel };
})();
