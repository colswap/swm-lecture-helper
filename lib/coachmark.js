// coachmark.js — zero-dep onboarding overlay (spotlight + bubble).
// Public API:
//   window.SWM_COACHMARK = { VERSION, start(steps, opts?), stop(), isActive(),
//                            isSeen(key), markSeen(key, value=true) }
// Step: { target: string(selector), title: string, body: string(html allowed),
//         arrow?: 'top'|'bottom'|'left'|'right' }
// Opts: { onComplete?: fn, onSkip?: fn }

(function () {
  'use strict';

  const VERSION = '2026-04-19';
  let active = null;

  class Coachmark {
    constructor(steps, opts = {}) {
      this.steps = Array.isArray(steps) ? steps.filter(Boolean) : [];
      this.opts = opts || {};
      this.i = 0;
      this.root = null;
      this.prevFocus = null;
      this.inertedEls = [];
      this.currentTarget = null;
      this._raf = 0;
      this._onReposition = this.reposition.bind(this);
      this._onKeydown = this.onKeydown.bind(this);
      this._finalized = false;
    }

    start() {
      if (!this.steps.length) { this._finalize('complete'); return; }
      this.prevFocus = document.activeElement;
      this._build();
      this._trapFocus();
      window.addEventListener('resize', this._onReposition);
      window.addEventListener('scroll', this._onReposition, true);
      this.render();
    }

    _build() {
      const root = document.createElement('div');
      root.className = 'coachmark-root';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'coachmarkTitle');
      root.setAttribute('aria-describedby', 'coachmarkBody');
      root.innerHTML = `
        <div class="coachmark-backdrop" data-cm-part="backdrop"></div>
        <div class="coachmark-spotlight" data-cm-part="spotlight"></div>
        <div class="coachmark-bubble" data-cm-part="bubble" data-arrow="bottom" tabindex="-1">
          <span class="coachmark-arrow" aria-hidden="true"></span>
          <h3 id="coachmarkTitle" class="coachmark-title"></h3>
          <div id="coachmarkBody" class="coachmark-body"></div>
          <div class="coachmark-footer">
            <span class="coachmark-progress" aria-hidden="true"></span>
            <span class="coachmark-counter" aria-live="polite"></span>
          </div>
          <div class="coachmark-actions">
            <button type="button" class="coachmark-btn coachmark-btn-ghost" data-cm="skip">건너뛰기</button>
            <span class="coachmark-actions-right">
              <button type="button" class="coachmark-btn coachmark-btn-secondary" data-cm="back">이전</button>
              <button type="button" class="coachmark-btn coachmark-btn-primary" data-cm="next">다음</button>
            </span>
          </div>
        </div>`;
      document.body.appendChild(root);

      this.root = root;
      this.elTitle = root.querySelector('#coachmarkTitle');
      this.elBody = root.querySelector('#coachmarkBody');
      this.elProgress = root.querySelector('.coachmark-progress');
      this.elCounter = root.querySelector('.coachmark-counter');
      this.elBubble = root.querySelector('.coachmark-bubble');
      this.elSpotlight = root.querySelector('.coachmark-spotlight');
      this.btnSkip = root.querySelector('[data-cm="skip"]');
      this.btnBack = root.querySelector('[data-cm="back"]');
      this.btnNext = root.querySelector('[data-cm="next"]');

      this.btnSkip.addEventListener('click', () => this.skip());
      this.btnBack.addEventListener('click', () => this.prev());
      this.btnNext.addEventListener('click', () => this.next());
      root.addEventListener('keydown', this._onKeydown);

      for (let k = 0; k < this.steps.length; k++) {
        const d = document.createElement('span');
        d.className = 'coachmark-dot';
        this.elProgress.appendChild(d);
      }
    }

    _trapFocus() {
      const kids = Array.from(document.body.children);
      for (const el of kids) {
        if (el === this.root) continue;
        if (!el.hasAttribute('inert')) {
          el.setAttribute('inert', '');
          this.inertedEls.push(el);
        }
      }
    }

    _releaseFocus() {
      for (const el of this.inertedEls) el.removeAttribute('inert');
      this.inertedEls = [];
    }

    onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); this.skip(); return; }
      if (e.key !== 'Tab') return;
      const f = this._focusables();
      if (!f.length) return;
      const cur = document.activeElement;
      const idx = f.indexOf(cur);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      } else {
        if (idx === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    }

    _focusables() {
      if (!this.elBubble) return [];
      const sel = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(this.elBubble.querySelectorAll(sel));
    }

    render() {
      const step = this.steps[this.i];
      if (!step) { this._finalize('complete'); return; }

      const target = step.target ? document.querySelector(step.target) : null;
      if (target) {
        let el = target.parentElement;
        while (el) {
          if (el.tagName === 'DETAILS' && !el.open) el.open = true;
          el = el.parentElement;
        }
      }
      if (!target || !this._isVisible(target)) {
        console.warn(`[coachmark] step ${this.i + 1}/${this.steps.length} skipped (target missing or hidden):`, step.target);
        this.advance(+1, { skipMissing: true });
        return;
      }

      this.currentTarget = target;
      this.elTitle.textContent = step.title || '';
      this.elBody.innerHTML = step.body || '';

      const dots = this.elProgress.querySelectorAll('.coachmark-dot');
      dots.forEach((d, k) => d.classList.toggle('is-active', k === this.i));
      this.elCounter.textContent = `${this.i + 1} / ${this.steps.length}`;

      this.btnBack.disabled = (this.i === 0);
      const isLast = (this.i === this.steps.length - 1);
      this.btnNext.textContent = isLast ? '완료' : '다음';
      this.btnNext.dataset.cm = isLast ? 'done' : 'next';

      this._position(target, step.arrow || 'bottom');

      requestAnimationFrame(() => {
        if (!this.btnNext) return;
        try { this.btnNext.focus({ preventScroll: true }); } catch { this.btnNext.focus(); }
      });
    }

    _isVisible(el) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return true;
    }

    _position(target, arrowPref) {
      const rect = target.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const PAD = 6;
      const GAP = 12;

      // Spotlight: clamp inside viewport
      const sx = Math.max(0, rect.left - PAD);
      const sy = Math.max(0, rect.top - PAD);
      const sw = Math.min(rect.width + PAD * 2, vw - sx);
      const sh = Math.min(rect.height + PAD * 2, vh - sy);
      const sp = this.elSpotlight.style;
      sp.setProperty('--cm-x', `${sx}px`);
      sp.setProperty('--cm-y', `${sy}px`);
      sp.setProperty('--cm-w', `${sw}px`);
      sp.setProperty('--cm-h', `${sh}px`);

      const BUBBLE_W = Math.min(380, vw - 24);
      const prevH = this.elBubble.offsetHeight || 0;
      const BUBBLE_H_EST = prevH > 60 ? prevH : 180;

      let arrow = arrowPref;
      const spaceBelow = vh - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const spaceRight = vw - rect.right - GAP;
      const spaceLeft = rect.left - GAP;

      if (arrow === 'bottom' && spaceBelow < BUBBLE_H_EST && spaceAbove >= BUBBLE_H_EST) arrow = 'top';
      else if (arrow === 'top' && spaceAbove < BUBBLE_H_EST && spaceBelow >= BUBBLE_H_EST) arrow = 'bottom';
      if ((arrow === 'left' || arrow === 'right')) {
        const need = BUBBLE_W;
        if (arrow === 'left' && spaceLeft < need && spaceRight >= need) arrow = 'right';
        else if (arrow === 'right' && spaceRight < need && spaceLeft >= need) arrow = 'left';
        if (spaceRight < need && spaceLeft < need) {
          arrow = spaceBelow >= spaceAbove ? 'bottom' : 'top';
        }
      }

      let bx, by;
      if (arrow === 'top' || arrow === 'bottom') {
        bx = rect.left + rect.width / 2 - BUBBLE_W / 2;
        bx = Math.max(8, Math.min(bx, vw - BUBBLE_W - 8));
        by = arrow === 'bottom' ? rect.bottom + GAP : Math.max(8, rect.top - GAP - BUBBLE_H_EST);
      } else {
        by = rect.top + rect.height / 2 - BUBBLE_H_EST / 2;
        by = Math.max(8, Math.min(by, vh - BUBBLE_H_EST - 8));
        bx = arrow === 'right' ? rect.right + GAP : Math.max(8, rect.left - GAP - BUBBLE_W);
      }

      this.elBubble.dataset.arrow = arrow;
      this.elBubble.style.setProperty('--cm-bx', `${bx}px`);
      this.elBubble.style.setProperty('--cm-by', `${by}px`);
      this.elBubble.style.setProperty('--cm-bw', `${BUBBLE_W}px`);

      requestAnimationFrame(() => {
        if (!this.elBubble) return;
        const realH = this.elBubble.offsetHeight;
        if (arrow === 'top') {
          const corrected = Math.max(8, rect.top - GAP - realH);
          this.elBubble.style.setProperty('--cm-by', `${corrected}px`);
        } else if (arrow === 'left' || arrow === 'right') {
          let ny = rect.top + rect.height / 2 - realH / 2;
          ny = Math.max(8, Math.min(ny, vh - realH - 8));
          this.elBubble.style.setProperty('--cm-by', `${ny}px`);
        }
        const arrowEl = this.elBubble.querySelector('.coachmark-arrow');
        if (!arrowEl) return;
        if (arrow === 'top' || arrow === 'bottom') {
          const ax = Math.max(14, Math.min(rect.left + rect.width / 2 - bx, BUBBLE_W - 14));
          arrowEl.style.setProperty('--cm-ax', `${ax}px`);
        } else {
          const ayRef = parseFloat(this.elBubble.style.getPropertyValue('--cm-by')) || by;
          const ay = Math.max(14, Math.min(rect.top + rect.height / 2 - ayRef, realH - 14));
          arrowEl.style.setProperty('--cm-ay', `${ay}px`);
        }
      });
    }

    reposition() {
      if (!this.currentTarget || !this.root) return;
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        const step = this.steps[this.i];
        if (!step) return;
        this._position(this.currentTarget, step.arrow || 'bottom');
      });
    }

    advance(delta) {
      const ni = this.i + delta;
      if (ni < 0) return;
      if (ni >= this.steps.length) { this._finalize('complete'); return; }
      this.i = ni;
      this.render();
    }

    next() { this.advance(+1); }
    prev() { this.advance(-1); }
    skip() { this._finalize('skip'); }

    _finalize(kind) {
      if (this._finalized) return;
      this._finalized = true;
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, true);
      this._releaseFocus();
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
      if (active === this) active = null;
      try {
        if (this.prevFocus && typeof this.prevFocus.focus === 'function') this.prevFocus.focus();
      } catch {}
      try {
        if (kind === 'complete') this.opts.onComplete?.();
        else if (kind === 'skip') this.opts.onSkip?.();
      } catch (e) { console.error('[coachmark] callback error', e); }
    }
  }

  function start(steps, opts) {
    if (active) active._finalize('skip');
    active = new Coachmark(steps, opts);
    active.start();
    return active;
  }
  function stop() { if (active) active._finalize('skip'); }
  function isActive() { return !!active; }

  async function _getSettings() {
    try {
      if (window.SWM && typeof window.SWM.getSettings === 'function') return await window.SWM.getSettings();
      const { settings = {} } = await chrome.storage.local.get('settings');
      return settings;
    } catch { return {}; }
  }
  async function _saveSettings(s) {
    try {
      if (window.SWM && typeof window.SWM.saveSettings === 'function') return await window.SWM.saveSettings(s);
      await chrome.storage.local.set({ settings: s });
    } catch {}
  }
  async function isSeen(key) {
    const s = await _getSettings();
    return !!s[key];
  }
  async function markSeen(key, value = true) {
    // SWM.saveSettings (v1.16.0+) 는 patch API — fresh-read 후 머지하므로 스냅샷 스프레드 불필요.
    if (window.SWM && typeof window.SWM.saveSettings === 'function') {
      await window.SWM.saveSettings({ [key]: value });
      return;
    }
    const s = await _getSettings();
    await _saveSettings({ ...s, [key]: value });
  }

  window.SWM_COACHMARK = { VERSION, start, stop, isActive, isSeen, markSeen };
})();
