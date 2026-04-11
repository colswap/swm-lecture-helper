// content.js — 목록 페이지 파싱 + 전체 동기화

(async function() {
  'use strict';

  // 현재 페이지의 테이블에서 강연 데이터 파싱
  function parseCurrentPage() {
    const lectures = {};
    const rows = document.querySelectorAll('.boardlist .t tbody tr, table.t tbody tr');

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;

      const titleCell = row.querySelector('td.tit');
      if (!titleCell) return;

      const link = titleCell.querySelector('a[href*="view.do"]');
      if (!link) return;

      const snMatch = link.href.match(/qustnrSn=(\d+)/);
      if (!snMatch) return;
      const sn = snMatch[1];

      // 제목
      const title = link.textContent.trim();

      // 카테고리 추출 (제목에서 [자유 멘토링] 또는 [멘토 특강] 등)
      const catMatch = title.match(/^\[([^\]]+)\]/);
      let category = '';
      let categoryNm = '';
      if (catMatch) {
        categoryNm = catMatch[1];
        category = categoryNm.includes('특강') ? 'MRC020' : 'MRC010';
      }

      // 상태
      const statusEl = titleCell.querySelector('.color-red') || titleCell.querySelector('.ab');
      const statusText = statusEl?.textContent?.trim() || '';
      const status = statusText.includes('접수중') ? 'A' : 'C';

      // PC 전용 셀들에서 데이터 추출
      const pcCells = row.querySelectorAll('td.pc_only');
      // pcCells 순서: NO, 접수기간, 진행날짜, 모집인원, 개설승인, 상태, 작성자, 등록일

      let regPeriod = '', lecDate = '', lecTime = '', countCurrent = 0, countMax = 0;
      let approval = '', mentor = '', regDate = '';

      if (pcCells.length >= 8) {
        // 접수기간 (두 번째 pc_only = index 1, 링크 안에 있음)
        const regLink = pcCells[1]?.querySelector('a');
        regPeriod = (regLink || pcCells[1])?.textContent?.replace(/\s+/g, ' ')?.trim() || '';

        // 진행날짜 + 시간
        const dateCell = pcCells[2];
        if (dateCell) {
          const dateText = dateCell.textContent.replace(/\s+/g, ' ').trim();
          const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})\(.\)/);
          const timeMatch = dateText.match(/(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/);
          lecDate = dateMatch ? dateMatch[1] : '';
          lecTime = timeMatch ? `${timeMatch[1]} ~ ${timeMatch[2]}` : '';
        }

        // 모집인원
        const countText = pcCells[3]?.textContent?.replace(/\s+/g, '')?.trim() || '';
        const countMatch = countText.match(/(\d+)\/(\d+)/);
        if (countMatch) {
          countCurrent = parseInt(countMatch[1]);
          countMax = parseInt(countMatch[2]);
        }

        // 개설승인
        approval = pcCells[4]?.textContent?.trim() || '';

        // 상태 (pcCells[5] — 중복이지만 확인용)

        // 작성자
        mentor = pcCells[6]?.textContent?.trim() || '';

        // 등록일
        regDate = pcCells[7]?.textContent?.trim() || '';
      }

      lectures[sn] = {
        sn,
        title,
        category,
        categoryNm,
        status,
        mentor,
        regPeriod,
        lecDate,
        lecTime,
        count: { current: countCurrent, max: countMax },
        approval,
        regDate
      };
    });

    return lectures;
  }

  // 캘린더 JS 데이터 파싱 (날짜 + 제목 + 카테고리 매핑)
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
            // 캘린더 데이터는 날짜+제목+카테고리만 있으므로 부분 업데이트
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

  // HTML 문자열에서 테이블 파싱 (전체 동기화용)
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

  // 페이지에 다음 페이지가 있는지 확인
  function hasNextPage(html) {
    return html.includes('다음') || /pageIndex=\d+.*?class=['"]\s*$/.test(html);
  }

  // 총 페이지 수 추출
  function getTotalPages(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const pageLinks = doc.querySelectorAll('.pagination li a[onclick*="pageIndex"]');
    let max = 1;
    pageLinks.forEach(a => {
      const m = a.getAttribute('onclick')?.match(/pageIndex.*?(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    });
    // 또는 "마지막" 링크에서
    const lastLink = doc.querySelector('.pagination li:last-child a');
    if (lastLink) {
      const m = lastLink.getAttribute('onclick')?.match(/(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1]));
    }
    return max;
  }

  // 전체 동기화
  async function fullSync(statusCallback) {
    const baseUrl = '/sw/mypage/mentoLec/list.do?menuNo=200046&pageIndex=';
    let page = 1;
    let allLectures = {};

    // 첫 페이지에서 총 페이지 수 확인
    statusCallback?.('동기화 시작...');
    const firstResp = await fetch(baseUrl + '1');
    const firstHtml = await firstResp.text();

    if (firstHtml.includes('잘못된 접근') || firstHtml.includes('forLogin.do')) {
      statusCallback?.('로그인 필요');
      return null;
    }

    const totalPages = getTotalPages(firstHtml);
    const firstLectures = parseTableFromHTML(firstHtml);
    Object.assign(allLectures, firstLectures);
    statusCallback?.(`1/${totalPages} 페이지 완료`);

    // 나머지 페이지
    for (page = 2; page <= totalPages; page++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const resp = await fetch(baseUrl + page);
        const html = await resp.text();
        if (html.includes('잘못된 접근')) break;
        const lectures = parseTableFromHTML(html);
        Object.assign(allLectures, lectures);
        statusCallback?.(`${page}/${totalPages} 페이지 완료`);
      } catch (e) {
        console.error(`SWM Helper: page ${page} fetch error`, e);
        break;
      }
    }

    // 저장
    await SWM.saveLectures(allLectures);
    const meta = await SWM.getMeta();
    meta.lastFullSync = new Date().toISOString();
    meta.knownLectureSns = Object.keys(allLectures);
    await SWM.saveMeta(meta);

    statusCallback?.(`완료! ${Object.keys(allLectures).length}개 강연 저장`);
    return allLectures;
  }

  // 상세 정보 일괄 수집 (sn 배열 입력)
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

        const location = info['장소'] || '';
        const isOnline = /온라인|비대면|ZOOM|Zoom|Webex|화상|Google Meet|Teams|줌/i.test(location);
        const description = doc.querySelector('.bbs-view-new .cont')?.textContent?.trim()?.substring(0, 500) || '';

        await SWM.saveLecture(sn, { location, isOnline, description, detailFetched: true });
        done++;
        statusCallback?.(`상세 ${done}/${sns.length}`);
      } catch (e) {
        console.error(`SWM Helper: detail ${sn} error`, e);
      }
    }
    return done;
  }

  // --- 초기 실행 ---

  // 1. 현재 페이지 파싱
  const currentPageData = parseCurrentPage();
  const calendarData = parseCalendarData();

  // 캘린더 데이터를 먼저 저장 (날짜 정보 포함)
  if (Object.keys(calendarData).length > 0) {
    await SWM.saveLectures(calendarData);
  }
  // 테이블 데이터 저장 (더 상세하므로 덮어씀)
  if (Object.keys(currentPageData).length > 0) {
    await SWM.saveLectures(currentPageData);
  }

  console.log(`SWM Helper: ${Object.keys(currentPageData).length} rows + ${Object.keys(calendarData).length} calendar items parsed`);

  // 2. 메시지 리스너 (팝업 ↔ content script 통신)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FULL_SYNC') {
      fullSync(status => {
        chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status });
      }).then(result => {
        sendResponse({ success: !!result, count: result ? Object.keys(result).length : 0 });
      });
      return true; // async response
    }

    if (msg.type === 'FETCH_DETAILS') {
      fetchDetails(msg.sns, status => {
        chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status });
      }).then(count => {
        sendResponse({ success: true, count });
      });
      return true;
    }

    if (msg.type === 'PING') {
      sendResponse({ alive: true });
      return;
    }
  });

})();
