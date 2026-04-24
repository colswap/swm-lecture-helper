// detail.js — 상세 페이지 자동 파싱 + 캐시 저장

function extractReadableText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  clone.querySelectorAll('p').forEach(p => p.append('\n\n'));
  return clone.textContent
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

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
    const contEl = document.querySelector('.bbs-view-new .cont');
    const description = contEl ? extractReadableText(contEl).substring(0, 500) : '';

    const statusText = info['상태'] || '';
    const status = statusText.includes('접수중') ? 'A' : 'C';

    const lecDateRaw = info['강의날짜'] || '';
    // content.js 에 정의된 extractLecDateTime 재사용 (1자리 시각 / 한국어 시/분 / 오전·오후 지원).
    // 구버전 2자리 강제 regex 는 "9:00 ~ 10:00" 을 파싱 실패시켜 list 파서의 올바른 값을
    // 빈 문자열로 덮어쓰는 regression 을 유발 — v1.16.0 headline fix 의 정면 모순이라 핫픽스.
    const parsed = (window.SWM && window.SWM.extractLecDateTime)
      ? window.SWM.extractLecDateTime(lecDateRaw)
      : { lecDate: '', lecTime: '' };

    const title = info['모집 명'] || '';
    const mentor = info['작성자'] || '';
    const regPeriod = info['접수 기간'] || '';

    // 개설 승인 여부 — 상세 페이지의 `.top .group` 안에서만 노출.
    // true: 승인 완료(개설 확정) / false: 미승인 / null: 정보 없음
    const approvedRaw = info['개설 승인'];
    const isApproved = approvedRaw === 'OK' ? true : (approvedRaw != null ? false : null);

    // count 는 list 데이터(current/max 다 있음)가 더 정확하므로 건드리지 않음.
    // lecDate/lecTime 은 파싱 성공한 경우에만 포함 — 실패 시 list 파서 값 보존.
    const data = {
      sn, title, status, location: loc, isOnline, description,
      mentor, regPeriod, detailFetched: true,
      isApproved,
    };
    if (parsed.lecDate) data.lecDate = parsed.lecDate;
    if (parsed.lecTime) data.lecTime = parsed.lecTime;

    await SWM.saveLecture(sn, data);
    console.log(`SWM Helper: detail page ${sn} cached`, { location: loc, isOnline });
  } catch (e) {
    console.error('SWM Helper: detail.js error', e);
  }
})();
