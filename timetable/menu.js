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
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      if (!dd.contains(e.target) && e.target !== btn) dd.style.display = 'none';
    });

    dd.addEventListener('click', async e => {
      const item = e.target.closest('.menu-item');
      if (!item) return;
      const action = item.dataset.action;
      // 다크모드는 메뉴 닫지 말고 그 자리에서 순환
      if (action === 'darkmode') return;
      dd.style.display = 'none';
      if (action === 'ical') await exportICal();
      else if (action === 'print') doPrint();
      else if (action === 'notify') openNotifyModal();
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

  async function exportICal() {
    const { lectures = {} } = await chrome.storage.local.get('lectures');
    const applied = Object.values(lectures).filter(l => l.applied && l.lecDate && l.lecTime);

    if (applied.length === 0) {
      alert('내보낼 신청 강연이 없습니다.');
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
    for (const l of applied) {
      const range = l.lecTime.match(/(\d{1,2}:\d{2})[^\d]+(\d{1,2}:\d{2})/);
      if (!range) continue;
      const [, start, end] = range;
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const categoryNm = l.categoryNm || (l.category === 'MRC020' ? '특강' : '멘토링');
      const summary = `[${categoryNm}] ${title}`;
      const descParts = [];
      if (l.mentor) descParts.push(`멘토: ${l.mentor}`);
      if (l.count?.max) descParts.push(`인원: ${l.count.current ?? '?'}/${l.count.max}`);
      if (l.description) descParts.push('', l.description);
      descParts.push('', `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${l.sn}&menuNo=200046`);
      const desc = descParts.join('\n');

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:swm-${l.sn}@swm-lecture-helper`);
      lines.push(`DTSTAMP:${now}`);
      lines.push(`DTSTART;TZID=Asia/Seoul:${fmtICalLocal(l.lecDate, start)}`);
      lines.push(`DTEND;TZID=Asia/Seoul:${fmtICalLocal(l.lecDate, end)}`);
      lines.push(foldLine(`SUMMARY:${icalEscape(summary)}`));
      if (l.location) lines.push(foldLine(`LOCATION:${icalEscape(l.location)}`));
      lines.push(foldLine(`DESCRIPTION:${icalEscape(desc)}`));
      lines.push(`URL:https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${l.sn}&menuNo=200046`);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');

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

  // ─── 인쇄 ───
  function doPrint() { window.print(); }

  // ─── 알림 설정 ───
  // 기본 OFF — 사용자가 명시적으로 켜야 알림 발송 (방해 최소화)
  const DEFAULT_SETTINGS = {
    notifyNewLecture: false,
    notifySlotOpen: false,
    notifyMentorMatch: false,
    watchedMentors: [],
    keywords: [],
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
      const next = {
        ...merged,
        notifyNewLecture: document.getElementById('nfToggleNew').checked,
        notifySlotOpen: document.getElementById('nfToggleSlot').checked,
        notifyMentorMatch: document.getElementById('nfToggleMentor').checked,
        watchedMentors: mentors,
      };
      await chrome.storage.local.set({ settings: next });
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
    if (!confirm('모든 캐시된 강연 데이터·즐겨찾기·설정이 삭제됩니다. 진행할까요?')) return;
    await chrome.storage.local.clear();
    alert('초기화 완료. 페이지를 다시 로드합니다.');
    location.reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMenu);
  } else {
    bindMenu();
  }
})();
