// popup 과 timetable 메뉴 공유 유틸

(function () {
  // 이미 경고한 적 있으면 재경고 안 함 — 로그 스팸 방지.
  let _warnedNoTheme = false;
  function _warnNoTheme() {
    if (_warnedNoTheme) return;
    _warnedNoTheme = true;
    console.warn('[menu_common] SWMTheme not loaded — dark-mode menu inactive (check script load order)');
  }

  async function refreshDarkLabel(labelEl) {
    if (!labelEl) return;
    if (!window.SWMTheme) { _warnNoTheme(); return; }
    const mode = await window.SWMTheme.getMode();
    const prefix = window.SWMTheme.PREFIX || '테마';
    labelEl.textContent = `${prefix}: ${window.SWMTheme.LABELS[mode]}`;
  }

  async function bindDarkModeMenuItem(itemEl, labelEl) {
    if (!itemEl) return;
    if (!window.SWMTheme) { _warnNoTheme(); return; }
    await refreshDarkLabel(labelEl);
    // 중복 init 가드 — dataset.bound 로 한 번만 리스너 등록.
    // (storage.onChanged 리스너가 여러 번 등록되면 한 번 토글에 refreshDarkLabel 이 N 회 실행되고,
    //  click 리스너 중복은 단일 클릭에 cycleMode 를 연쇄 호출해 모드를 건너뛰게 한다.)
    if (itemEl.dataset.bound === '1') return;
    itemEl.dataset.bound = '1';
    itemEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.SWMTheme.cycleMode();
      await refreshDarkLabel(labelEl);
    });
    // 다른 페이지에서 변경 시 라벨 동기화 — 한 번만 등록.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      refreshDarkLabel(labelEl);
    });
  }

  // ─── 팔레트 테마 모달 (J2) ───
  // 5열×3행 프리뷰 그리드 = 15 칸. 테마의 5색 대표로 [5,5,5] 반복.
  // 현재 선택 테마는 카드 테두리 강조 + 버튼 "적용됨" 비활성화.
  function renderThemeModal() {
    const body = document.getElementById('themeModalBody');
    if (!body || !window.SWM_THEMES) return Promise.resolve();
    return window.SWM_THEMES.getCurrent().then(currentId => {
      body.innerHTML = '';
      window.SWM_THEMES.list.forEach(theme => {
        const card = document.createElement('div');
        card.className = 'theme-card' + (theme.id === currentId ? ' selected' : '');
        card.dataset.themeId = theme.id;

        const head = document.createElement('div');
        head.className = 'theme-card-head';
        if (theme.emoji) {
          const em = document.createElement('span');
          em.className = 'theme-card-emoji';
          em.textContent = theme.emoji;
          head.appendChild(em);
        }
        const title = document.createElement('span');
        title.className = 'theme-card-title';
        title.textContent = theme.label;
        head.appendChild(title);
        card.appendChild(head);

        const desc = document.createElement('div');
        desc.className = 'theme-card-desc';
        desc.textContent = theme.description;
        card.appendChild(desc);

        // 5열×3행 미니 시간표 프리뷰 — 15 블록
        const preview = document.createElement('div');
        preview.className = 'theme-card-preview';
        const colors = theme.preview || [];
        for (let i = 0; i < 15; i++) {
          const cell = document.createElement('span');
          cell.className = 'theme-card-preview-cell';
          cell.style.background = colors[i % colors.length] || 'var(--border)';
          preview.appendChild(cell);
        }
        card.appendChild(preview);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-card-apply' + (theme.id === currentId ? ' applied' : '');
        btn.textContent = theme.id === currentId ? '적용됨' : '적용하기';
        btn.disabled = theme.id === currentId;
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (theme.id === currentId) return;
          await window.SWM_THEMES.apply(theme.id);
          closeThemeModal();
        });
        card.appendChild(btn);

        // 카드 전체 클릭 시 미리보기(selected 클래스만) — 적용은 버튼으로
        card.addEventListener('click', () => {
          body.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
        body.appendChild(card);
      });
    });
  }

  function openThemeModal() {
    const backdrop = document.getElementById('themeModalBackdrop');
    const modal = document.getElementById('themeModal');
    if (!backdrop || !modal) return;
    renderThemeModal().then(() => {
      backdrop.classList.add('show');
      modal.classList.add('show');
      document.addEventListener('keydown', themeEscHandler);
    });
  }

  function closeThemeModal() {
    const backdrop = document.getElementById('themeModalBackdrop');
    const modal = document.getElementById('themeModal');
    if (backdrop) backdrop.classList.remove('show');
    if (modal) modal.classList.remove('show');
    document.removeEventListener('keydown', themeEscHandler);
  }

  function themeEscHandler(e) {
    if (e.key === 'Escape') closeThemeModal();
  }

  function bindThemeModal() {
    const backdrop = document.getElementById('themeModalBackdrop');
    const closeBtn = document.getElementById('themeModalClose');
    if (backdrop) backdrop.addEventListener('click', closeThemeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeThemeModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindThemeModal);
  } else {
    bindThemeModal();
  }

  window.SWMMenuCommon = {
    bindDarkModeMenuItem,
    refreshDarkLabel,
    openThemeModal,
    closeThemeModal,
  };
})();
