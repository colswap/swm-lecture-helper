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
      dd.style.display = 'none';
      const action = item.dataset.action;
      if (action === 'ical') await exportICal();
      else if (action === 'print') doPrint();
      else if (action === 'notify') openNotifyModal();
      else if (action === 'reset') await resetData();
    });
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

  // ─── 알림 설정 (Phase E placeholder) ───
  function openNotifyModal() {
    alert('알림 설정 UI 는 곧 추가됩니다. 현재는 service-worker 에 기본 신규 강연 알림만 동작.');
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
