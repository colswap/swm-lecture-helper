// 시간표 ⋯ 메뉴 — iCal / 인쇄 / 알림 설정 / 초기화

(function () {
  'use strict';

  // ─── 메뉴 토글 ───
  function bindMenu() {
    const btn = document.getElementById('menuBtn');
    const dd = document.getElementById('menuDropdown');
    if (!btn || !dd) return;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = dd.style.display === 'none';
      dd.style.display = open ? 'block' : 'none';
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', e => {
      if (!dd.contains(e.target) && e.target !== btn) {
        dd.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dd.style.display !== 'none') {
        dd.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });

    dd.addEventListener('click', async e => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;
      // 다크모드는 메뉴 닫지 말고 그 자리에서 순환
      if (action === 'darkmode') return;
      dd.style.display = 'none';
      if (action === 'ical') await exportICal();
      else if (action === 'image') await exportImage();
      else if (action === 'gcal-applied') await bulkGcalApplied();
      else if (action === 'sync') clickSyncButton('syncBtn');
      else if (action === 'syncAll') clickSyncButton('syncAllBtn');
      else if (action === 'notify') openNotifyModal();
      else if (action === 'palette') {
        if (window.SWMMenuCommon?.openThemeModal) window.SWMMenuCommon.openThemeModal();
      }
      else if (action === 'replay-tour') {
        if (typeof window.SWM_START_TIMETABLE_TOUR === 'function') window.SWM_START_TIMETABLE_TOUR();
      }
      else if (action === 'reset') await resetData();
    });

    // 다크모드 토글 바인딩
    const darkItem = document.getElementById('menuDarkMode');
    const darkLabel = document.getElementById('darkModeLabel');
    if (window.SWMMenuCommon && darkItem && darkLabel) {
      window.SWMMenuCommon.bindDarkModeMenuItem(darkItem, darkLabel);
    }
  }

  // ─── iCal 내보내기 (RFC 5545) ───
  // 시간대 Asia/Seoul. 신청 강연(applied + lecDate + lecTime) 만 대상.
  function icalEscape(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function fmtICalLocal(dateStr, hhmm) {
    // dateStr: YYYY-MM-DD, hhmm: "HH:MM"
    const [y, m, d] = dateStr.split('-');
    const [h, mi] = hhmm.split(':');
    return `${y}${m}${d}T${h}${mi}00`;
  }

  // dateStr: YYYY-MM-DD, totalMin: minutes since start of day (may exceed 1440 for overnight).
  // endMin=1440 ("24:00") 또는 그 이상은 lecDate + (totalMin/1440) 일로 normalize.
  function fmtICalLocalMin(dateStr, totalMin) {
    if (!dateStr || !Number.isFinite(totalMin)) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const base = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayOffset = Math.floor(totalMin / (24 * 60));
    const minOfDay = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(minOfDay / 60);
    const mi = minOfDay % 60;
    const eventDate = new Date(base);
    eventDate.setDate(base.getDate() + dayOffset);
    const pad = (x) => String(x).padStart(2, '0');
    return `${eventDate.getFullYear()}${pad(eventDate.getMonth() + 1)}${pad(eventDate.getDate())}T${pad(h)}${pad(mi)}00`;
  }

  function fmtICalUtcNow() {
    const n = new Date();
    const pad = x => String(x).padStart(2, '0');
    return `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`;
  }

  // 75-octet line folding (RFC 5545 3.1)
  function foldLine(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let buf = '';
    let bufBytes = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (bufBytes + b > 74) {
        out.push(buf);
        buf = ' ' + ch;
        bufBytes = 1 + b;
      } else {
        buf += ch;
        bufBytes += b;
      }
    }
    if (buf) out.push(buf);
    return out.join('\r\n');
  }

  function lecHashForICal(l) {
    const s = [l.title, l.lecDate, l.lecTime, l.location, l.mentor, l.description || '']
      .map(v => String(v || '')).join('|');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  // Google Calendar template URL 빌더 (timetable.js 의 buildGcalTemplateUrl 과 동일 로직).
  // menu.js 는 별도 scope 라 중복 정의 (lib/gcal_util.js 로 추출은 v1.17.x).
  function buildGcalUrl(lec) {
    if (!lec.lecDate || !lec.lecTime || !window.SWM_TIME) return null;
    const range = window.SWM_TIME.parseTimeRange(lec.lecTime);
    if (!range) return null;
    const [Y, M, D] = lec.lecDate.split('-').map(Number);
    const startLocal = new Date(Y, M - 1, D, 0, 0, 0, 0);
    startLocal.setMinutes(startLocal.getMinutes() + range.startMin);
    const endLocal = new Date(Y, M - 1, D, 0, 0, 0, 0);
    endLocal.setMinutes(endLocal.getMinutes() + range.endMin);
    const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const title = (lec.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${fmt(startLocal)}/${fmt(endLocal)}`,
    });
    if (lec.location) params.set('location', lec.location);
    const descLines = [];
    if (lec.mentor) descLines.push(`멘토: ${lec.mentor}`);
    if (lec.categoryNm) descLines.push(`분류: ${lec.categoryNm}`);
    descLines.push(`https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${lec.sn}&menuNo=200046`);
    params.set('details', descLines.join('\n'));
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  // 신청 강의 전체를 Gcal 에 push — 이미 push 된 것은 제외.
  // Idempotency: chrome.storage.local.gcalPushedSns (string[]) 에 마커. Template URL 방식이라
  // 실제 Gcal 상태와 동기화는 불가 — 사용자가 "저장" 을 누르지 않아도 pushed 로 마킹됨.
  // 사용자가 명시적으로 reset 하려면 Console 에서 pushedSns 제거 가능.
  async function bulkGcalApplied() {
    const { lectures = {}, gcalPushedSns = [] } =
      await chrome.storage.local.get(['lectures', 'gcalPushedSns']);
    const pushed = new Set(gcalPushedSns);
    const applied = Object.values(lectures).filter(l => l.applied && l.lecDate && l.lecTime);
    const pending = applied.filter(l => !pushed.has(l.sn));

    if (applied.length === 0) {
      await window.SWMModal.showAlert({ title: '캘린더 추가', body: '신청한 강의가 없습니다.' });
      return;
    }
    if (pending.length === 0) {
      await window.SWMModal.showAlert({
        title: '캘린더 추가',
        body: `신청 강의 ${applied.length}개 전부 이미 캘린더에 추가 기록됨.\n\n다시 추가하려면 "기록 초기화" (Console: ${'await chrome.storage.local.remove("gcalPushedSns")'})`,
      });
      return;
    }

    const ok = await window.SWMModal.showConfirm({
      title: '캘린더에 신청 강의 추가',
      body: `${pending.length}개 강의 (이미 추가된 ${pushed.size}개 제외).\n\n각 강의마다 새 탭이 열리고, 각 탭에서 "저장" 버튼을 눌러야 실제 추가됩니다.\n\n진행할까요?`,
      confirmLabel: `${pending.length}개 열기`,
    });
    if (!ok) return;

    // 브라우저 팝업 차단 우려: 동시 10개 이상 탭 열기 금지. 순차 + 500ms 간격.
    const newSet = new Set(pushed);
    let opened = 0;
    for (const lec of pending) {
      const url = buildGcalUrl(lec);
      if (!url) continue;
      chrome.tabs.create({ url, active: false });
      newSet.add(lec.sn);
      opened++;
      await new Promise(r => setTimeout(r, 500));
    }
    await chrome.storage.local.set({ gcalPushedSns: Array.from(newSet) });
    await window.SWMModal.showAlert({
      title: '캘린더 추가 탭 열림',
      body: `${opened}개 탭 열림. 각 탭에서 "저장" 클릭해야 실제로 캘린더에 추가됩니다.\n\n추후 같은 강의는 중복 제외됩니다.`,
    });
  }

  async function exportICal() {
    const { lectures = {}, swmIcsSequences = {} } =
      await chrome.storage.local.get(['lectures', 'swmIcsSequences']);
    const applied = Object.values(lectures).filter(l => l.applied && l.lecDate && l.lecTime);

    if (applied.length === 0) {
      await window.SWMModal.showAlert({ title: 'iCal 내보내기', body: '내보낼 신청 강연이 없습니다.' });
      return;
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SWM Lecture Helper//KO',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Seoul',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:KST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];

    const now = fmtICalUtcNow();
    const seqs = { ...swmIcsSequences };
    for (const l of applied) {
      // v1.16.1: parseTimeRange 로 일원화 (이전: inline regex, 24:00 overnight 때
      // DTEND<DTSTART 의 invalid VEVENT 생성 버그). endMin>=1440 이면 fmtICalLocalMin
      // 이 다음 날로 자동 roll-over 하므로 Google Calendar 에서 정상 복원.
      const r = window.parseTimeRange ? window.parseTimeRange(l.lecTime) : null;
      if (!r) continue;
      const dtStart = fmtICalLocalMin(l.lecDate, r.startMin);
      const dtEnd = fmtICalLocalMin(l.lecDate, r.endMin);
      if (!dtStart || !dtEnd) continue;
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const categoryNm = l.categoryNm || (l.category === 'MRC020' ? '특강' : '멘토링');
      const summary = `[${categoryNm}] ${title}`;
      const descParts = [];
      if (l.mentor) descParts.push(`멘토: ${l.mentor}`);
      if (l.count?.max) descParts.push(`인원: ${l.count.current ?? '?'}/${l.count.max}`);
      if (l.description) descParts.push('', l.description);
      descParts.push('', `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${l.sn}&menuNo=200046`);
      const desc = descParts.join('\n');

      // SEQUENCE 증분: 강연 데이터 hash 가 바뀌면 +1 → Google Calendar 재import 시 업데이트 인식
      const hash = lecHashForICal(l);
      const prev = seqs[l.sn];
      if (!prev) seqs[l.sn] = { seq: 0, hash };
      else if (prev.hash !== hash) seqs[l.sn] = { seq: prev.seq + 1, hash };
      const sequence = seqs[l.sn].seq;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:swm-${l.sn}@swm-lecture-helper`);
      lines.push(`DTSTAMP:${now}`);
      lines.push(`SEQUENCE:${sequence}`);
      lines.push(`LAST-MODIFIED:${now}`);
      lines.push(`DTSTART;TZID=Asia/Seoul:${dtStart}`);
      lines.push(`DTEND;TZID=Asia/Seoul:${dtEnd}`);
      lines.push(foldLine(`SUMMARY:${icalEscape(summary)}`));
      if (l.location) lines.push(foldLine(`LOCATION:${icalEscape(l.location)}`));
      lines.push(foldLine(`DESCRIPTION:${icalEscape(desc)}`));
      lines.push(`URL:https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${l.sn}&menuNo=200046`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');

    await chrome.storage.local.set({
      swmIcsSequences: seqs,
      lastIcsExportAt: Date.now(),
    });

    const text = lines.join('\r\n');
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swm-lectures-${fmtICalUtcNow().slice(0, 8)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // html2canvas 는 194KB — "이미지로 저장" 처음 클릭 시만 dynamic script load.
  let _h2cLoadPromise = null;
  function loadHtml2Canvas() {
    if (typeof html2canvas === 'function') return Promise.resolve();
    if (_h2cLoadPromise) return _h2cLoadPromise;
    _h2cLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('lib/html2canvas.min.js');
      s.onload = () => resolve();
      s.onerror = () => { _h2cLoadPromise = null; reject(new Error('h2c load failed')); };
      document.head.appendChild(s);
    });
    return _h2cLoadPromise;
  }

  // ─── 이미지 저장 (N11) ───
  // 디자인: 헤더 (아이콘 + 타이틀 28px + 기간 14px) + 그리드 카드 + 푸터 (v · 생성시각).
  // 팔레트 v3 solid 유지, 블록 상단 2px 짙은 stripe (inset shadow), 외곽 40px, 그리드선 1px.
  function prettyPeriod(weekText) {
    // weekText: "2026.04.19 ~ 2026.04.25" → "2026년 4월 19일 ~ 4월 25일"
    const m = String(weekText).match(/(\d{4})\.(\d{1,2})\.(\d{1,2})\s*~\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (!m) return '';
    const [, y1, m1, d1, y2, m2, d2] = m;
    const right = (y1 === y2)
      ? `${parseInt(m2, 10)}월 ${parseInt(d2, 10)}일`
      : `${y2}년 ${parseInt(m2, 10)}월 ${parseInt(d2, 10)}일`;
    return `${y1}년 ${parseInt(m1, 10)}월 ${parseInt(d1, 10)}일 ~ ${right}`;
  }
  function fmtGenerated(d) {
    const pad = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function exportImage() {
    try {
      await loadHtml2Canvas();
    } catch (_) {
      showToast('이미지 렌더러 로드 실패', 'error');
      return;
    }
    if (typeof html2canvas !== 'function') {
      showToast('이미지 렌더러 로드 실패', 'error');
      return;
    }
    const headers = document.getElementById('dayHeaders');
    const body = document.getElementById('gridBody');
    if (!headers || !body) {
      showToast('시간표가 아직 로드되지 않았어요', 'error');
      return;
    }
    const dd = document.getElementById('menuDropdown');
    if (dd) dd.style.display = 'none';

    const weekText = (document.getElementById('weekLabel')?.textContent || '').trim();
    const periodText = prettyPeriod(weekText) || weekText || '주간 시간표';
    const generated = fmtGenerated(new Date());
    const version = (chrome.runtime?.getManifest?.() || {}).version || '1.16.0';
    let iconUrl = '';
    try { iconUrl = chrome.runtime.getURL('icons/icon48.png'); } catch (_) { /* noop */ }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const pal = isDark ? {
      pageBg: '#0f172a', card: '#111b2e', titleFg: '#f1f5f9', subFg: '#94a3b8',
      mutedFg: '#64748b', border: '#1e293b', divider: '#1e293b',
      primary: '#0095e8', todayBg: 'rgba(0,149,232,0.12)',
    } : {
      pageBg: '#ffffff', card: '#ffffff', titleFg: '#0f172a', subFg: '#475569',
      mutedFg: '#64748b', border: '#e5e7eb', divider: '#eef2f7',
      primary: '#006EB7', todayBg: 'rgba(0,110,183,0.06)',
    };

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed; left: -99999px; top: 0;
      width: 1240px; padding: 40px;
      background: ${pal.pageBg}; box-sizing: border-box;
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      color: ${pal.titleFg};
      -webkit-font-smoothing: antialiased;
    `;
    wrapper.innerHTML = `
      <style>
        .ex-root { color: ${pal.titleFg}; }
        .ex-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
        .ex-head-left { display: flex; align-items: center; gap: 14px; }
        .ex-logo { width: 44px; height: 44px; border-radius: 10px; display: block; box-shadow: 0 1px 2px rgba(15,23,42,0.08); }
        .ex-title-group { display: flex; flex-direction: column; gap: 3px; }
        .ex-title { font-size: 28px; font-weight: 700; letter-spacing: -0.6px; line-height: 1.15; color: ${pal.titleFg}; }
        .ex-period { font-size: 14px; font-weight: 400; letter-spacing: -0.1px; color: ${pal.subFg}; }
        .ex-head-right { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; text-align: right; }
        .ex-kicker { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: ${pal.mutedFg}; font-weight: 700; }
        .ex-weektag { font-size: 13px; color: ${pal.primary}; font-weight: 600; font-variant-numeric: tabular-nums; }

        .ex-card {
          border: 1px solid ${pal.border};
          border-radius: 12px;
          overflow: hidden;
          background: ${pal.card};
        }
        .ex-card .day-headers {
          background: ${pal.card};
          border-bottom: 1px solid ${pal.border};
        }
        .ex-card .day-headers > div {
          color: ${pal.titleFg};
          font-weight: 600;
          font-size: 13px;
          letter-spacing: -0.1px;
          border-right: 1px solid ${pal.divider};
          padding: 12px 6px;
        }
        .ex-card .day-headers > div.weekend { color: ${pal.mutedFg}; font-weight: 500; }
        .ex-card .day-headers > div.today {
          color: ${pal.primary};
          background: ${pal.todayBg};
          font-weight: 700;
        }
        .ex-card .time-labels { background: ${pal.card}; border-right: 1px solid ${pal.border}; }
        .ex-card .time-slot { color: ${pal.mutedFg}; border-top: 1px solid ${pal.divider}; font-size: 10px; }
        .ex-card .day-column { border-right: 1px solid ${pal.divider}; background: ${pal.card}; }
        .ex-card .day-column:last-child { border-right: 0; }

        /* 블록: v3 solid 유지. hover/transform/stripe 모두 제거 — 그림자 완전 off. */
        .ex-card .lec-block {
          box-shadow: none !important;
          transform: none !important;
          filter: none !important;
          transition: none !important;
          animation: none !important;
        }
        .ex-card .lec-block:hover { box-shadow: none !important; }
        .ex-card .lec-block.applied.conflicting { animation: none !important; box-shadow: none !important; }
        /* 본문 day-column 의 today 배경은 외부 timetable.css 가 :root[data-theme] 로 주입 →
           export 맥락에선 "어두운 세로 사각형" 처럼 보임. 여기서 !important 로 무력화. */
        .ex-card .ex-body .day-column,
        .ex-card .ex-body .day-column.today {
          background: ${pal.card} !important;
          background-color: ${pal.card} !important;
        }
        .ex-card .day-headers > div.has-selection,
        .ex-card .day-headers > div.today.has-selection {
          background: ${pal.todayBg} !important;
          border-bottom: 0 !important;
        }
        .ex-card .now-line,
        .ex-card .drag-sel,
        .ex-card .selected,
        .ex-card .preview,
        .ex-card .drag-preview,
        .ex-card .slot-bar,
        .ex-card .slot-divider,
        .ex-card .slot-chip { display: none !important; }

        .ex-foot {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 20px; padding-top: 14px;
          border-top: 1px solid ${pal.border};
          font-size: 11px; color: ${pal.mutedFg};
        }
        .ex-foot-brand { font-weight: 600; color: ${pal.subFg}; letter-spacing: -0.1px; }
        .ex-foot-meta { font-variant-numeric: tabular-nums; }
      </style>
      <div class="ex-root">
        <div class="ex-head">
          <div class="ex-head-left">
            ${iconUrl ? `<img class="ex-logo" src="${iconUrl}" alt="" />` : ''}
            <div class="ex-title-group">
              <div class="ex-title">SW마에스트로 시간표</div>
              <div class="ex-period">${escapeHtml(periodText)}</div>
            </div>
          </div>
          <div class="ex-head-right">
            <div class="ex-kicker">Weekly Schedule</div>
            <div class="ex-weektag">${escapeHtml(weekText || '')}</div>
          </div>
        </div>
        <div class="ex-card">
          <div class="ex-headers"></div>
          <div class="ex-body"></div>
        </div>
        <div class="ex-foot">
          <div class="ex-foot-brand">SWM Lecture Helper</div>
          <div class="ex-foot-meta">v${escapeHtml(version)} · generated ${escapeHtml(generated)}</div>
        </div>
      </div>
    `;
    wrapper.querySelector('.ex-headers').appendChild(headers.cloneNode(true));
    const bodyClone = body.cloneNode(true);
    // scroll offset 가 cloneNode 상으론 0 이지만, 일부 렌더러가 source 상태를 참조할 여지 차단.
    bodyClone.scrollTop = 0;
    wrapper.querySelector('.ex-body').appendChild(bodyClone);
    // hover/preview/선택/drag/now-line/slot 아티팩트 제거 (클래스 ∪ 요소 단위)
    wrapper.querySelectorAll(
      '.now-line, .drag-sel, .drag-preview, .selected, .preview, .slot-bar, .slot-divider, .slot-chip'
    ).forEach(n => n.remove());
    // 헤더 day-selection 잔존 (시간 지정 검색 모드) 도 export 에선 지움
    wrapper.querySelectorAll('.day-headers > div.has-selection').forEach(n => n.classList.remove('has-selection'));
    document.body.appendChild(wrapper);

    // 생성 중 스피너 토스트 — 메인스레드 블로킹(500-1500ms) 동안 사용자 피드백.
    // scale=2 고정은 Retina 가 아닌 디스플레이에서 불필요하게 2× 시간/메모리 소비 → devicePixelRatio 로 조정.
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    showPersistentToast('📸 이미지 생성 중...');
    try {
      const canvas = await html2canvas(wrapper, {
        backgroundColor: pal.pageBg,
        scale: dpr,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('toBlob 실패');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `swm-timetable-${fmtICalUtcNow().slice(0, 8)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      let clipOk = false;
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          clipOk = true;
        }
      } catch (_) { /* noop */ }
      hidePersistentToast();
      showToast(clipOk ? '이미지 저장 + 클립보드 복사 완료' : '이미지 저장 완료');
    } catch (e) {
      hidePersistentToast();
      showToast('이미지 저장 실패: ' + (e?.message || e), 'error');
    } finally {
      wrapper.remove();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showToast(text, level = 'success') {
    const t = document.getElementById('popoverToast');
    if (!t) {
      // popoverToast 엘리먼트 부재 시 커스텀 모달 fallback
      if (window.SWMModal) window.SWMModal.showAlert({ body: text });
      return;
    }
    const textEl = document.getElementById('popoverToastText') || t;
    const closeEl = document.getElementById('popoverToastClose');
    textEl.textContent = text;
    t.className = 'popover-toast ' + level;
    t.style.display = 'flex';
    if (closeEl && !closeEl._bound) {
      closeEl.addEventListener('click', () => { t.style.display = 'none'; });
      closeEl._bound = true;
    }
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { t.style.display = 'none'; }, 10000);
  }

  // 진행 상태 토스트 — autohide 없이 명시적 hidePersistentToast() 호출까지 유지.
  let _persistentToastTimer = null;
  function showPersistentToast(text) {
    const t = document.getElementById('popoverToast');
    if (!t) return;
    if (_persistentToastTimer) { clearTimeout(_persistentToastTimer); _persistentToastTimer = null; }
    t.textContent = text;
    t.className = 'popover-toast loading';
    t.style.display = 'block';
  }
  function hidePersistentToast() {
    const t = document.getElementById('popoverToast');
    if (!t) return;
    if (_persistentToastTimer) { clearTimeout(_persistentToastTimer); _persistentToastTimer = null; }
    t.style.display = 'none';
  }

  // 메뉴에서 '새로고침' / '전량 재동기화' → 기존 sync 버튼 프로그래매틱 클릭
  function clickSyncButton(id) {
    const btn = document.getElementById(id);
    if (btn) btn.click();
  }

  // ─── 알림 설정 ───
  // 기본 OFF — 사용자가 명시적으로 켜야 알림 발송 (방해 최소화)
  const DEFAULT_SETTINGS = {
    notifyNewLecture: false,
    notifySlotOpen: false,
    notifyMentorMatch: false,
    watchedMentors: [],
    keywords: [],
  };

  async function openNotifyModal() {
    const { settings = {} } = await chrome.storage.local.get('settings');
    const merged = { ...DEFAULT_SETTINGS, ...settings };

    const backdrop = document.getElementById('notifyModalBackdrop');
    const modal = document.getElementById('notifyModal');
    const chipWrap = document.getElementById('nfMentorChips');
    const input = document.getElementById('nfMentorInput');
    const addBtn = document.getElementById('nfMentorAdd');

    document.getElementById('nfToggleNew').checked = !!merged.notifyNewLecture;
    document.getElementById('nfToggleSlot').checked = !!merged.notifySlotOpen;
    document.getElementById('nfToggleMentor').checked = !!merged.notifyMentorMatch;

    let mentors = Array.isArray(merged.watchedMentors) ? [...merged.watchedMentors] : [];

    function renderMentorChips() {
      chipWrap.innerHTML = '';
      mentors.forEach((m, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip-item';
        chip.innerHTML = `${escapeHtml(m)}<span class="remove" title="제거">×</span>`;
        chip.querySelector('.remove').onclick = () => {
          mentors.splice(i, 1);
          renderMentorChips();
        };
        chipWrap.appendChild(chip);
      });
    }

    function addMentor() {
      const v = input.value.trim();
      if (!v) return;
      if (!mentors.includes(v)) mentors.push(v);
      input.value = '';
      renderMentorChips();
      input.focus();
    }

    function onEsc(e) { if (e.key === 'Escape') close(); }

    function close() {
      backdrop.style.display = 'none';
      modal.style.display = 'none';
      document.removeEventListener('keydown', onEsc);
    }

    async function save() {
      const patch = {
        notifyNewLecture: document.getElementById('nfToggleNew').checked,
        notifySlotOpen: document.getElementById('nfToggleSlot').checked,
        notifyMentorMatch: document.getElementById('nfToggleMentor').checked,
        watchedMentors: mentors,
      };
      if (window.SWM && typeof window.SWM.saveSettings === 'function') {
        await window.SWM.saveSettings(patch);
      } else {
        await chrome.storage.local.set({ settings: { ...merged, ...patch } });
      }
      close();
    }

    renderMentorChips();
    backdrop.style.display = 'block';
    modal.style.display = 'flex';
    input.focus();

    document.getElementById('notifyModalClose').onclick = close;
    document.getElementById('notifyModalCancel').onclick = close;
    backdrop.onclick = close;
    document.getElementById('notifyModalSave').onclick = save;
    addBtn.onclick = addMentor;
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addMentor(); } };
    document.addEventListener('keydown', onEsc);
  }

  // ─── 데이터 초기화 ───
  async function resetData() {
    const ok = await window.SWMModal.showConfirm({
      title: '데이터 초기화',
      body: '모든 캐시된 강연 데이터·즐겨찾기·설정이 삭제됩니다. 진행할까요?',
      confirmLabel: '초기화',
      cancelLabel: '취소',
      danger: true,
    });
    if (!ok) return;
    await chrome.storage.local.clear();
    await window.SWMModal.showAlert({
      title: '초기화 완료',
      body: '모든 데이터가 삭제되었습니다. 페이지를 다시 로드합니다.',
    });
    location.reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMenu);
  } else {
    bindMenu();
  }
})();
