// SWM Modal — showConfirm / showAlert (native confirm/alert 대체)
// tokens.css 변수 (--background, --foreground, --primary, --destructive, --border,
// --popover, --popover-foreground, --muted, --muted-foreground, --radius-*) 사용.
// 다크모드 + 팔레트 테마 4종 호환. popup / timetable 양쪽에서 동일 API.
(function () {
  const HOST_ID = 'swm-modal-host';

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
    injectStylesOnce();
    return host;
  }

  function injectStylesOnce() {
    if (document.getElementById('swm-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'swm-modal-styles';
    style.textContent = `
      .swm-modal-backdrop {
        position: fixed; inset: 0;
        background: rgba(15, 23, 42, 0.55);
        z-index: 10000;
        animation: swm-modal-fade 120ms ease-out;
      }
      .swm-modal {
        position: fixed; top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 360px; max-width: calc(100vw - 24px);
        background: var(--popover, var(--background, #fff));
        color: var(--popover-foreground, var(--foreground, #0f172a));
        border-radius: var(--radius-lg, 12px);
        box-shadow: var(--shadow-xl, 0 20px 45px rgba(0,0,0,0.25));
        z-index: 10001;
        display: flex; flex-direction: column;
        overflow: hidden;
        animation: swm-modal-pop 140ms cubic-bezier(0.2, 0.8, 0.4, 1);
      }
      .swm-modal-header {
        padding: 14px 18px 6px;
        font-size: 14.5px; font-weight: 700;
        color: var(--popover-foreground, var(--foreground, #0f172a));
      }
      .swm-modal-body {
        padding: 4px 18px 14px;
        font-size: 13px; line-height: 1.5;
        color: var(--popover-foreground, var(--foreground, #334155));
        white-space: pre-wrap; word-break: break-word;
      }
      .swm-modal-footer {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 10px 14px;
        border-top: 1px solid var(--border, #e2e8f0);
        background: var(--muted, #f8fafc);
      }
      .swm-modal-btn {
        min-width: 72px;
        padding: 7px 14px;
        font-size: 12.5px; font-weight: 600;
        border-radius: var(--radius-md, 8px);
        border: 1px solid var(--border, #e2e8f0);
        background: var(--background, #fff);
        color: var(--foreground, #0f172a);
        cursor: pointer;
        transition: background 120ms, border-color 120ms;
      }
      .swm-modal-btn:hover { background: var(--muted, #f1f5f9); }
      .swm-modal-btn:focus-visible {
        outline: 2px solid var(--ring, var(--primary, #2563eb));
        outline-offset: 2px;
      }
      .swm-modal-btn-primary {
        background: var(--primary, #2563eb);
        color: var(--primary-foreground, #fff);
        border-color: var(--primary, #2563eb);
      }
      .swm-modal-btn-primary:hover { filter: brightness(0.94); background: var(--primary, #2563eb); }
      .swm-modal-btn-danger {
        background: var(--destructive, #dc2626);
        color: var(--destructive-foreground, #fff);
        border-color: var(--destructive, #dc2626);
      }
      .swm-modal-btn-danger:hover { filter: brightness(0.94); background: var(--destructive, #dc2626); }
      @keyframes swm-modal-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes swm-modal-pop  { from { opacity: 0; transform: translate(-50%, -48%) scale(0.97) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
    `;
    document.head.appendChild(style);
  }

  function openModal({ title, body, buttons }) {
    const host = ensureHost();
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'swm-modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'swm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      const headerEl = title
        ? `<div class="swm-modal-header">${escapeHtml(title)}</div>`
        : '';
      modal.innerHTML =
        headerEl +
        `<div class="swm-modal-body">${escapeHtml(body)}</div>` +
        `<div class="swm-modal-footer"></div>`;

      const footer = modal.querySelector('.swm-modal-footer');
      const btnEls = [];
      buttons.forEach((b, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swm-modal-btn' + (b.variant ? ' swm-modal-btn-' + b.variant : '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => close(b.value));
        footer.appendChild(btn);
        btnEls.push(btn);
      });

      const prevFocus = document.activeElement;
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') {
          const primary = btnEls.find(el => el.classList.contains('swm-modal-btn-primary') || el.classList.contains('swm-modal-btn-danger'));
          if (primary) { e.preventDefault(); primary.click(); }
        } else if (e.key === 'Tab') {
          // simple focus trap
          const focusables = btnEls;
          if (focusables.length === 0) return;
          const idx = focusables.indexOf(document.activeElement);
          if (idx === -1) { focusables[0].focus(); e.preventDefault(); return; }
          const next = e.shiftKey ? (idx - 1 + focusables.length) % focusables.length
                                  : (idx + 1) % focusables.length;
          focusables[next].focus();
          e.preventDefault();
        }
      }
      function onBackdropClick() { close(false); }

      function close(value) {
        document.removeEventListener('keydown', onKey, true);
        backdrop.removeEventListener('click', onBackdropClick);
        host.removeChild(backdrop);
        host.removeChild(modal);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch {}
        resolve(value);
      }

      host.appendChild(backdrop);
      host.appendChild(modal);
      document.addEventListener('keydown', onKey, true);
      backdrop.addEventListener('click', onBackdropClick);
      const primaryBtn = btnEls.find(el =>
        el.classList.contains('swm-modal-btn-primary') || el.classList.contains('swm-modal-btn-danger')
      ) || btnEls[0];
      if (primaryBtn) setTimeout(() => primaryBtn.focus(), 0);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showConfirm(opts) {
    const o = opts || {};
    return openModal({
      title: o.title || '확인',
      body: o.body || '',
      buttons: [
        { label: o.cancelLabel || '취소', value: false },
        {
          label: o.confirmLabel || '확인',
          value: true,
          variant: o.danger ? 'danger' : 'primary',
        },
      ],
    });
  }

  function showAlert(opts) {
    const o = typeof opts === 'string' ? { body: opts } : (opts || {});
    return openModal({
      title: o.title || '알림',
      body: o.body || '',
      buttons: [{ label: o.okLabel || '확인', value: true, variant: 'primary' }],
    });
  }

  window.SWMModal = { showConfirm, showAlert };
})();
