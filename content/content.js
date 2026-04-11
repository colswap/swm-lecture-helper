// content.js — swmaestro.ai 전체에서 동작. 동기화 + 파싱.

(function() {
  'use strict';

  // ★ 메시지 리스너를 제일 먼저 등록 (절대 실패하지 않는 동기 코드)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FULL_SYNC') {
      fullSync(status => {
        chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status }).catch(() => {});
      }).then(result => {
        sendResponse({ success: !!result, count: result ? Object.keys(result).length : 0 });
      }).catch(e => {
        console.error('SWM Helper: fullSync error', e);
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    if (msg.type === 'FETCH_DETAILS') {
      fetchDetails(msg.sns, status => {
        chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status }).catch(() => {});
      }).then(count => {
        sendResponse({ success: true, count });
      }).catch(e => {
        console.error('SWM Helper: fetchDetails error', e);
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    if (msg.type === 'PING') {
      sendResponse({ alive: true });
    }
  });

  console.log('SWM Helper: content script loaded on', location.href);

  // --- 함수 정의 ---

  function parseCurrentPage() {
    const lectures = {};
    const rows = document.querySelectorAll('table.t tbody tr');

    rows.forEach(row => {
      const titleCell = row.querySelector('td.tit');
      if (!titleCell) return;

      const link = titleCell.querySelector('a[href*="view.do"]');
      if (!link) return;

      const snMatch = link.href.match(/qustnrSn=(\d+)/);
      if (!snMatch) return;
      const sn = snMatch[1];

      const title = link.textContent.trim();
      const catMatch = title.match(/^\[([^\]]+)\]/);
      let category = '', categoryNm = '';
      if (catMatch) {
        categoryNm = catMatch[1];
        category = categoryNm.includes('특강') ? 'MRC020' : 'MRC010';
      }

      const statusEl = titleCell.querySelector('.color-red') || titleCell.querySelector('.ab');
      const statusText = statusEl?.textContent?.trim() || '';
      const status = statusText.includes('접수중') ? 'A' : 'C';

      const pcCells = row.querySelectorAll('td.pc_only');
      let regPeriod = '', lecDate = '', lecTime = '', countCurrent = 0, countMax = 0;
      let approval = '', mentor = '', regDate = '';

      if (pcCells.length >= 8) {
        const regLink = pcCells[1]?.querySelector('a');
        regPeriod = (regLink || pcCells[1])?.textContent?.replace(/\s+/g, ' ')?.trim() || '';

        const dateCell = pcCells[2];
        if (dateCell) {
          const dateText = dateCell.textContent.replace(/\s+/g, ' ').trim();
          const dateM = dateText.match(/(\d{4}-\d{2}-\d{2})\(.\)/);
          const timeM = dateText.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
          lecDate = dateM ? dateM[1] : '';
          lecTime = timeM ? `${timeM[1]} ~ ${timeM[2]}` : '';
        }

        const countText = pcCells[3]?.textContent?.replace(/\s+/g, '')?.trim() || '';
        const cM = countText.match(/(\d+)\/(\d+)/);
        if (cM) { countCurrent = parseInt(cM[1]); countMax = parseInt(cM[2]); }

        approval = pcCells[4]?.textContent?.trim() || '';
        mentor = pcCells[6]?.textContent?.trim() || '';
        regDate = pcCells[7]?.textContent?.trim() || '';
      }

      lectures[sn] = {
        sn, title, category, categoryNm, status, mentor,
        regPeriod, lecDate, lecTime,
        count: { current: countCurrent, max: countMax },
        approval, regDate
      };
    });

    return lectures;
  }

  function parseCalendarData() {
    const lectures = {};
    const scripts = document.querySelectorAll('script');

    for (const script of scripts) {
      const text = script.textContent;
      if (!text.includes('resultList.push')) continue;

      const pattern = /resultList\.push\(\s*\{([^}]+)\}\s*\)/g;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const block = match[1];
        const titleMatch = block.match(/"subjectTitle"\s*:\s*"([^"]+)"/);
        const dateMatch = block.match(/"date"\s*:\s*"([^"]+)"/);
        const urlMatch = block.match(/"url"\s*:\s*"([^"]+)"/);
        const catMatch = block.match(/"category"\s*:\s*"([^"]+)"/);
        const catNmMatch = block.match(/"categoryNm"\s*:\s*"([^"]+)"/);

        if (titleMatch && urlMatch) {
          const snMatch = urlMatch[1].match(/qustnrSn=(\d+)/);
          if (snMatch) {
            const sn = snMatch[1];
            lectures[sn] = {
              sn,
              title: titleMatch[1],
              lecDate: dateMatch ? dateMatch[1] : '',
              category: catMatch ? catMatch[1] : '',
              categoryNm: catNmMatch ? catNmMatch[1] : ''
            };
          }
        }
      }
    }

    return lectures;
  }

  function parseTableFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const lectures = {};
    const rows = doc.querySelectorAll('table.t tbody tr');

    rows.forEach(row => {
      const titleCell = row.querySelector('td.tit');
      if (!titleCell) return;

      const link = titleCell.querySelector('a[href*="view.do"]');
      if (!link) return;

      const snMatch = link.getAttribute('href')?.match(/qustnrSn=(\d+)/);
      if (!snMatch) return;
      const sn = snMatch[1];

      const title = link.textContent.trim();
      const catMatch = title.match(/^\[([^\]]+)\]/);
      let category = '', categoryNm = '';
      if (catMatch) {
        categoryNm = catMatch[1];
        category = categoryNm.includes('특강') ? 'MRC020' : 'MRC010';
      }

      const statusEl = titleCell.querySelector('.color-red') || titleCell.querySelector('.ab');
      const statusText = statusEl?.textContent?.trim() || '';
      const status = statusText.includes('접수중') ? 'A' : 'C';

      const pcCells = row.querySelectorAll('td.pc_only');
      let regPeriod = '', lecDate = '', lecTime = '';
      let countCurrent = 0, countMax = 0, approval = '', mentor = '', regDate = '';

      if (pcCells.length >= 8) {
        const regLink = pcCells[1]?.querySelector('a');
        regPeriod = (regLink || pcCells[1])?.textContent?.replace(/\s+/g, ' ')?.trim() || '';

        const dateText = pcCells[2]?.textContent?.replace(/\s+/g, ' ')?.trim() || '';
        const dateM = dateText.match(/(\d{4}-\d{2}-\d{2})\(.\)/);
        const timeM = dateText.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
        lecDate = dateM ? dateM[1] : '';
        lecTime = timeM ? `${timeM[1]} ~ ${timeM[2]}` : '';

        const countText = pcCells[3]?.textContent?.replace(/\s+/g, '')?.trim() || '';
        const cM = countText.match(/(\d+)\/(\d+)/);
        if (cM) { countCurrent = parseInt(cM[1]); countMax = parseInt(cM[2]); }

        approval = pcCells[4]?.textContent?.trim() || '';
        mentor = pcCells[6]?.textContent?.trim() || '';
        regDate = pcCells[7]?.textContent?.trim() || '';
      }

      lectures[sn] = {
        sn, title, category, categoryNm, status, mentor,
        regPeriod, lecDate, lecTime,
        count: { current: countCurrent, max: countMax },
        approval, regDate
      };
    });

    return lectures;
  }

  function getTotalPages(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    let max = 1;
    doc.querySelectorAll('.pagination li a').forEach(a => {
      const onclick = a.getAttribute('onclick') || '';
      const m = onclick.match(/(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    return max;
  }

  async function fullSync(statusCallback) {
    const baseUrl = '/sw/mypage/mentoLec/list.do?menuNo=200046&pageIndex=';
    let allLectures = {};

    statusCallback?.('동기화 시작...');
    const firstResp = await fetch(baseUrl + '1');
    const firstHtml = await firstResp.text();

    if (firstHtml.includes('잘못된 접근') || firstHtml.includes('forLogin.do')) {
      statusCallback?.('로그인 필요');
      return null;
    }

    const totalPages = getTotalPages(firstHtml);
    Object.assign(allLectures, parseTableFromHTML(firstHtml));
    statusCallback?.(`1/${totalPages} 페이지`);

    for (let page = 2; page <= totalPages; page++) {
      await new Promise(r => setTimeout(r, 500));
      const resp = await fetch(baseUrl + page);
      const html = await resp.text();
      if (html.includes('잘못된 접근')) break;
      Object.assign(allLectures, parseTableFromHTML(html));
      statusCallback?.(`${page}/${totalPages} 페이지`);
    }

    await SWM.saveLectures(allLectures);
    const meta = await SWM.getMeta();
    meta.lastFullSync = new Date().toISOString();
    meta.knownLectureSns = Object.keys(allLectures);
    await SWM.saveMeta(meta);

    statusCallback?.(`완료! ${Object.keys(allLectures).length}개`);
    return allLectures;
  }

  async function fetchDetails(sns, statusCallback) {
    let done = 0;
    for (const sn of sns) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const resp = await fetch(`/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`);
        const html = await resp.text();
        if (html.includes('잘못된 접근')) break;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const groups = doc.querySelectorAll('.bbs-view-new .top .group');
        const info = {};
        groups.forEach(g => {
          const key = g.querySelector('.t')?.textContent?.trim();
          const val = g.querySelector('.c')?.textContent?.trim();
          if (key && val) info[key] = val;
        });

        const loc = info['장소'] || '';
        const isOnline = /온라인|비대면|ZOOM|Zoom|Webex|화상|Google Meet|Teams|줌/i.test(loc);
        const description = doc.querySelector('.bbs-view-new .cont')?.textContent?.trim()?.substring(0, 500) || '';

        await SWM.saveLecture(sn, { location: loc, isOnline, description, detailFetched: true });
        done++;
        statusCallback?.(`상세 ${done}/${sns.length}`);
      } catch (e) {
        console.error(`SWM Helper: detail ${sn} error`, e);
      }
    }
    return done;
  }

  // --- ★ 초기화 (try-catch로 감싸서 실패해도 리스너는 살아있음) ---

  (async () => {
    try {
      // 목록 페이지면 현재 페이지 파싱
      if (location.href.includes('mentoLec/list.do')) {
        const calendarData = parseCalendarData();
        const currentPageData = parseCurrentPage();

        if (Object.keys(calendarData).length > 0) {
          await SWM.saveLectures(calendarData);
        }
        if (Object.keys(currentPageData).length > 0) {
          await SWM.saveLectures(currentPageData);
        }
        console.log(`SWM Helper: ${Object.keys(currentPageData).length} rows + ${Object.keys(calendarData).length} calendar items parsed`);
      }

      // 로그인 상태 감지 → 자동 동기화
      const isLoggedIn = !!document.querySelector('a[href*="logout.do"]');
      if (isLoggedIn) {
        const meta = await SWM.getMeta();
        const lectures = await SWM.getLectures();
        const hoursSinceSync = meta.lastFullSync
          ? (Date.now() - new Date(meta.lastFullSync).getTime()) / (60 * 60 * 1000)
          : Infinity;

        if (Object.keys(lectures).length === 0 || hoursSinceSync > 1) {
          console.log('SWM Helper: 로그인 감지, 자동 동기화 시작');
          await fullSync(status => console.log('SWM Helper:', status));
        } else {
          console.log(`SWM Helper: 동기화 불필요 (${Object.keys(lectures).length}개, ${hoursSinceSync.toFixed(1)}h 전)`);
        }
      } else {
        console.log('SWM Helper: 로그인 안 됨, 동기화 스킵');
      }
    } catch (e) {
      console.error('SWM Helper: 초기화 에러', e);
    }
  })();

})();
