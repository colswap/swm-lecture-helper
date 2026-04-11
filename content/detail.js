// detail.js — 상세 페이지 자동 파싱 + 캐시 저장

(async function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const sn = params.get('qustnrSn');
  if (!sn) return;

  try {
    const groups = document.querySelectorAll('.bbs-view-new .top .group');
    const info = {};
    groups.forEach(g => {
      const key = g.querySelector('.t')?.textContent?.trim();
      const val = g.querySelector('.c')?.textContent?.trim();
      if (key && val) info[key] = val;
    });

    const loc = info['장소'] || '';
    const isOnline = /온라인|비대면|ZOOM|Zoom|Webex|화상|Google Meet|Teams|줌/i.test(loc);
    const description = document.querySelector('.bbs-view-new .cont')?.textContent?.trim()?.substring(0, 500) || '';

    const statusText = info['상태'] || '';
    const status = statusText.includes('접수중') ? 'A' : 'C';

    const lecDateRaw = info['강의날짜'] || '';
    const dateMatch = lecDateRaw.match(/(\d{4}\.\d{2}\.\d{2})/);
    const timeMatch = lecDateRaw.match(/(\d{2}:\d{2})시?\s*~\s*(\d{2}:\d{2})/);
    const lecDate = dateMatch ? dateMatch[1].replace(/\./g, '-') : '';
    const lecTime = timeMatch ? `${timeMatch[1]} ~ ${timeMatch[2]}` : '';

    const countText = info['모집인원'] || '';
    const countMatch = countText.match(/(\d+)/);
    const countMax = countMatch ? parseInt(countMatch[1]) : 0;

    const title = info['모집 명'] || '';
    const mentor = info['작성자'] || '';
    const regPeriod = info['접수 기간'] || '';

    const data = {
      sn, title, status, location: loc, isOnline, description,
      lecDate, lecTime, count: { max: countMax },
      mentor, regPeriod, detailFetched: true
    };

    await SWM.saveLecture(sn, data);
    console.log(`SWM Helper: detail page ${sn} cached`, { location: loc, isOnline });
  } catch (e) {
    console.error('SWM Helper: detail.js error', e);
  }
})();
