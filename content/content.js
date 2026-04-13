// content.js — swmaestro.ai 전체에서 동작. 동기화 + 파싱.

(function() {
  'use strict';

  // ★ 메시지 리스너를 제일 먼저 등록 (절대 실패하지 않는 동기 코드)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FULL_SYNC') {
      const opts = {
        statusFilter: msg.statusFilter ?? 'A',
        statusCallback: status => {
          chrome.runtime.sendMessage({ type: 'SYNC_STATUS', status }).catch(() => {});
        },
      };
      fullSync(opts).then(result => {
        sendResponse({
          success: !!result,
          count: result ? Object.keys(result).length : 0,
          statusFilter: opts.statusFilter,
        });
      }).catch(e => {
        console.error('SWM Helper: fullSync error', e);
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

  function isLoginRedirect(resp) {
    // 세션 만료 시 swmaestro는 forLogin.do 로 302 리다이렉트.
    // fetch의 resp.url 이 바뀌었는지로 판정 (HTML 문자열 매칭은 false positive 다발).
    return resp.url.includes('forLogin.do') || resp.url.includes('loginForward');
  }

  function buildListUrl(page, statusFilter) {
    const params = new URLSearchParams({
      menuNo: '200046',
      pageIndex: String(page),
    });
    if (statusFilter) params.set('searchStatMentolec', statusFilter);
    return `/sw/mypage/mentoLec/list.do?${params}`;
  }

  async function fetchListPage(page, statusFilter) {
    const resp = await fetch(buildListUrl(page, statusFilter), { credentials: 'same-origin' });
    if (isLoginRedirect(resp)) return { loginRequired: true };
    const html = await resp.text();
    return { data: parseTableFromHTML(html) };
  }

  async function fullSync({ statusFilter = 'A', concurrency = 4, statusCallback } = {}) {
    // listLectures: status 필터에 해당하는 표 데이터 (상세 수집 대상)
    // calendarData: 모든 달의 캘린더 파편 (SN+날짜+제목 일부만, 상세 수집 제외)
    const listLectures = {};
    const scopeLabel = statusFilter === 'A' ? '접수중' : statusFilter === 'C' ? '마감' : '전체';
    const MAX_PAGES = 300;

    statusCallback?.(`${scopeLabel} 동기화 시작...`);

    let page = 1;
    let done = false;
    while (!done && page <= MAX_PAGES) {
      const batch = [];
      for (let i = 0; i < concurrency && page + i <= MAX_PAGES; i++) {
        batch.push(fetchListPage(page + i, statusFilter));
      }
      const results = await Promise.all(batch);

      for (const r of results) {
        if (r.loginRequired) {
          statusCallback?.('로그인 필요');
          return null;
        }
        const rowCount = Object.keys(r.data).length;
        Object.assign(listLectures, r.data);
        if (rowCount < 10) done = true;
      }

      page += concurrency;
      statusCallback?.(`${scopeLabel} ${Math.min(page - 1, MAX_PAGES)}페이지 (누적 ${Object.keys(listLectures).length}개)`);
    }

    // 저장은 SWM.saveLectures 가 SN 단위로 얕은 merge 해준다.
    // 캘린더(부분 메타) 를 먼저 저장한 뒤, list(전체 필드)로 덮어쓰는 순서가 안전.
    const calendarData = parseCalendarData();
    if (Object.keys(calendarData).length > 0) {
      await SWM.saveLectures(calendarData);
    }
    await SWM.saveLectures(listLectures);

    // 상세 수집: list 에 포함된(= 이번 sync 스코프) SN 중 아직 detailFetched 안 된 것만.
    // calendar 로만 들어온 과거 항목은 제외.
    const stored = await SWM.getLectures();
    const needDetail = Object.keys(listLectures).filter(sn => !stored[sn]?.detailFetched);
    if (needDetail.length > 0) {
      statusCallback?.(`${scopeLabel} 상세 수집 중 (${needDetail.length}개)...`);
      await fetchDetailsBatch(needDetail, { concurrency: 4, statusCallback });
    }

    const meta = await SWM.getMeta();
    meta.lastFullSync = new Date().toISOString();
    meta.lastSyncScope = statusFilter || 'all';
    const final = await SWM.getLectures();
    meta.knownLectureSns = Object.keys(final);
    await SWM.saveMeta(meta);

    statusCallback?.(`완료! ${scopeLabel} ${Object.keys(listLectures).length}개`);
    return listLectures;
  }

  async function fetchOneDetail(sn) {
    try {
      const resp = await fetch(
        `/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`,
        { credentials: 'same-origin' }
      );
      if (isLoginRedirect(resp)) return { loginRequired: true };
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
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
      return { sn, data: { location: loc, isOnline, description, detailFetched: true } };
    } catch (e) {
      console.error(`SWM Helper: detail ${sn} error`, e);
      return { sn, error: e.message };
    }
  }

  async function fetchDetailsBatch(sns, { concurrency = 4, statusCallback } = {}) {
    let done = 0;
    for (let i = 0; i < sns.length; i += concurrency) {
      const chunk = sns.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(fetchOneDetail));
      for (const r of results) {
        if (r.loginRequired) return done;
        if (r.data) {
          await SWM.saveLecture(r.sn, r.data);
          done++;
        }
      }
      statusCallback?.(`상세 ${done}/${sns.length}`);
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
          console.log('SWM Helper: 로그인 감지, 자동 동기화 시작 (접수중)');
          await fullSync({
            statusFilter: 'A',
            statusCallback: status => console.log('SWM Helper:', status),
          });
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
