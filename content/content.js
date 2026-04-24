// content.js — swmaestro.ai 전체에서 동작. 동기화 + 파싱.

(function() {
  'use strict';

  // SWM 목록/상세의 "강의날짜" 셀을 date+time 으로 파싱.
  // v1.16.1: 파싱 로직을 lib/time_utils.js 의 SWM_TIME.extractLecDateTime 으로
  // 집약했다 (manifest 의 content_scripts.js 에 lib/time_utils.js 가 추가됨).
  // 기존 호출부 ({lecDate, lecTime} 두 필드만 사용) 호환을 위해 wrapper 로 남김.
  function extractLecDateTime(raw) {
    const T = (typeof window !== 'undefined') ? window.SWM_TIME : null;
    if (T && typeof T.extractLecDateTime === 'function') {
      const r = T.extractLecDateTime(raw);
      return { lecDate: r.lecDate || '', lecTime: r.lecTime || '' };
    }
    // Fallback — lib/time_utils.js 미로드. manifest 미갱신 상태 대비용 방어.
    return { lecDate: '', lecTime: '' };
  }

  // detail.js 와 로직 공유 (manifest load 순서 lib/time_utils.js → content.js → detail.js 보장).
  // 같은 content script isolated world 라 window.SWM 공유 가능.
  if (typeof window !== 'undefined') {
    window.SWM = window.SWM || {};
    window.SWM.extractLecDateTime = extractLecDateTime;
  }

  function extractReadableText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('p').forEach(p => p.append('\n\n'));
    return clone.textContent
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

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
          failedPages: result ? (result.__failedPages || 0) : 0,
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
      return;
    }

    if (msg.type === 'PEEK_FIRST_PAGE') {
      // 가벼운 polling: 첫 페이지(regDate DESC)만 fetch + 파싱
      // 신규 강연 / 멘토 매치 알림 검증용
      peekFirstPage(msg.statusFilter ?? 'A')
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.type === 'APPLY') {
      applyLecture(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.type === 'CANCEL_APPLY') {
      cancelApplyLecture(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.type === 'GET_APPLY_SN') {
      scrapeApplySn(msg.sn).then(sendResponse).catch(e => sendResponse({ error: e.message }));
      return true;
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
          const parsed = extractLecDateTime(dateText);
          lecDate = parsed.lecDate;
          lecTime = parsed.lecTime;
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
        const parsed = extractLecDateTime(dateText);
        lecDate = parsed.lecDate;
        lecTime = parsed.lecTime;

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

  async function fetchWithRetry(url, init = {}, { retries = 2, baseMs = 400 } = {}) {
    const merged = { credentials: 'same-origin', ...init };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, merged);
        // 429 Too Many Requests / 5xx 는 backoff
        if (resp.status === 429 || resp.status >= 500) {
          const retryAfter = parseInt(resp.headers.get('Retry-After') || '0', 10) * 1000;
          if (attempt < retries) {
            const jitter = Math.random() * baseMs;
            await new Promise(r => setTimeout(r, (retryAfter || baseMs * Math.pow(2, attempt)) + jitter));
            continue;
          }
          // 재시도 고갈 후에도 5xx/429 면 throw — silent-skip 으로 인한 fullSync 조기 종료 방지.
          // apply/cancel 처럼 retries=0 인 호출자는 여기서 throw 하지 않음 (아래 attempt < retries 가
          // 계속 false 지만 continue 가 실행되지 않으므로). retries>=1 인 목록 조회만 throw 대상.
          if (retries > 0) {
            const err = new Error(`HTTP ${resp.status} after ${retries} retries`);
            err.status = resp.status;
            err.transient = true;
            throw err;
          }
        }
        return resp;
      } catch (e) {
        // 네트워크 에러도 retry
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, baseMs * Math.pow(2, attempt) + Math.random() * baseMs));
          continue;
        }
        throw e;
      }
    }
  }

  async function applyLecture({ sn, applyCnt, appCnt }) {
    const body = new URLSearchParams({
      qustnrSn: String(sn),
      applyCnt: String(applyCnt ?? ''),
      appCnt: String(appCnt ?? 0),
    });
    // Apply/Cancel: retries=0. 상태변경 호출이 5xx 로 실패 시 자동 재시도는 의도치 않은
    // 이중 신청 위험 (실제 적용됐으나 응답 drop). 사용자 수동 재시도가 더 안전 + SWM 서버 친화.
    const resp = await fetchWithRetry('/sw/mypage/mentoLec/apply.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    }, { retries: 0 });
    if (isLoginRedirect(resp)) return { loginRequired: true };
    try {
      const data = await resp.json();
      return { resultCode: data.resultCode, msg: data.msg };
    } catch (e) {
      return { error: 'parse_failed' };
    }
  }

  async function cancelApplyLecture({ sn, applySn }) {
    const body = new URLSearchParams({
      id: String(applySn),
      qustnrSn: String(sn),
      gubun: 'mentoLec',
    });
    // retries=0 이유: applyLecture 참고. 취소는 멱등하지만, 사용자 의도 분명치 않은 상황에서
    // silent retry 는 UX 혼동 유발.
    const resp = await fetchWithRetry('/sw/mypage/userAnswer/cancel.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    }, { retries: 0 });
    if (isLoginRedirect(resp)) return { loginRequired: true };
    try {
      const data = await resp.json();
      return { resultCode: data.resultCode, cancelAt: data.cancelAt, msg: data.msg };
    } catch (e) {
      return { error: 'parse_failed' };
    }
  }

  async function scrapeApplySn(targetSn) {
    // userAnswer/history.do 에서 delDate('{applySn}','{qustnrSn}','mentoLec') 패턴으로 추출
    for (let page = 1; page <= 5; page++) {
      const resp = await fetchWithRetry(`/sw/mypage/userAnswer/history.do?menuNo=200047&pageIndex=${page}`);
      if (isLoginRedirect(resp)) return { loginRequired: true };
      const html = await resp.text();
      const re = /delDate\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,\s*'mentoLec'\s*\)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (m[2] === String(targetSn)) return { applySn: m[1] };
      }
      // 다음 페이지 존재 여부 — regex + DOM fallback (페이지네이션 마크업 변종 대응)
      if (!hasNextPage(html, page)) break;
    }
    return { applySn: null };
  }

  function hasNextPage(html, currentPage) {
    // 1) 관대한 regex 패턴 — pageIndex=N 형태(숫자/문자열/스크립트 보간 모두 허용)가 현재 페이지보다 큰 값으로 존재하는지
    const re = /pageIndex\s*=\s*['"]?(\d+)['"]?/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const p = parseInt(m[1], 10);
      if (Number.isFinite(p) && p > currentPage) return true;
    }
    // 2) "다음"/">" 링크 + fn_* 스크립트 핸들러 변종
    if (/(다음\s*페이지|>\s*다음|next[_\s-]?page|fn_link_page|fn_egov_link_page)/i.test(html)) return true;
    // 3) DOM 기반 fallback — 페이지네이션 컨테이너에 .next/.on+형제 노드 유무로 판단
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const pg = doc.querySelector('.paginate, .pagination, .pagenate, .paging, nav[role="navigation"]');
      if (pg) {
        if (pg.querySelector('a.next, a.nextPage, a[class*="next"], a[title*="다음"]')) return true;
        const onEl = pg.querySelector('.on, .active, strong');
        if (onEl && onEl.nextElementSibling && onEl.nextElementSibling.tagName === 'A') return true;
      }
    } catch (_) { /* noop */ }
    return false;
  }

  async function peekFirstPage(statusFilter = 'A') {
    // regDate DESC 정렬로 첫 페이지만 가져와 신규 감지용으로 파싱
    const url = `${buildListUrl(1, statusFilter)}&regDateOrder=DESC`;
    try {
      const resp = await fetchWithRetry(url);
      if (isLoginRedirect(resp)) return { loginRequired: true };
      const html = await resp.text();
      const lectures = parseTableFromHTML(html);
      return { ok: true, lectures };
    } catch (e) {
      return { error: e.message };
    }
  }

  async function fetchListPage(page, statusFilter) {
    try {
      const resp = await fetchWithRetry(buildListUrl(page, statusFilter));
      if (isLoginRedirect(resp)) return { loginRequired: true };
      const html = await resp.text();
      return { data: parseTableFromHTML(html) };
    } catch (e) {
      // transient 네트워크 실패는 호출자(fullSync)가 done 로 마킹하지 않도록 error 로 노출.
      return { error: e.message, transient: !!e.transient, status: e.status };
    }
  }

  async function fetchAppliedSns() {
    // 내 접수내역 페이지(/sw/mypage/userAnswer/history.do)에서 신청한 강연 수집.
    // v1.16.1+: sn 만 아니라 **lecDate + lecTime + title + author** 도 함께 뽑아서,
    // 해당 강의가 current sync scope(접수중 list) 밖이라 상세 fetch 실패해도 블록 렌더링 보장.
    // 접수취소된 행은 제외.
    // 반환: [{sn, lecDate, lecTime, title, mentor, isApproved}] — sn 만 반환하던 이전 API 와 호환 위해
    // 호출부에서 .map(x => x.sn) 으로 순회 가능하되, object 전체로도 사용.
    const applied = new Map(); // sn → partial lecture data
    const MAX_PAGES = 20;
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const resp = await fetchWithRetry(`/sw/mypage/userAnswer/history.do?menuNo=200047&pageIndex=${page}`);
        if (isLoginRedirect(resp)) return null;
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('tbody tr');
        let added = 0;
        rows.forEach(row => {
          const link = row.querySelector('td.tit a[href*="mentoLec/view.do"]');
          if (!link) return;
          const m = (link.getAttribute('href') || '').match(/qustnrSn=(\d+)/);
          if (!m) return;
          const sn = m[1];
          const tds = row.querySelectorAll('td');

          // 접수취소 체크
          let cancelled = false;
          tds.forEach(td => {
            const t = (td.textContent || '').replace(/\s+/g, ' ').trim();
            if (t === '접수취소' || t.includes('접수취소')) cancelled = true;
          });
          if (cancelled) return;

          // 소마캘린더 방식: tds[2]=title, tds[3]=author, tds[4]=date+time, tds[7]=isApproved
          // 컬럼 순서는 SWM 테이블 고정(2024~). 변형 시 파싱 실패해도 sn 만 추가는 유지.
          const data = { sn };
          const title = tds[2] ? (tds[2].textContent || '').replace(/\s+/g, ' ').trim() : '';
          if (title) data.title = title;
          const author = tds[3] ? (tds[3].textContent || '').trim() : '';
          if (author) data.mentor = author;
          const dateTimeRaw = tds[4] ? (tds[4].textContent || '').trim() : '';
          if (dateTimeRaw && window.SWM && window.SWM.extractLecDateTime) {
            const parsed = window.SWM.extractLecDateTime(dateTimeRaw);
            if (parsed.lecDate) data.lecDate = parsed.lecDate;
            if (parsed.lecTime) data.lecTime = parsed.lecTime;
          }
          const approvalText = tds[7] ? (tds[7].textContent || '').trim() : '';
          if (approvalText === 'OK') data.isApproved = true;
          else if (approvalText && approvalText !== '-') data.isApproved = false;

          applied.set(sn, data);
          added++;
        });
        if (added === 0 && rows.length === 0) break;
        if (rows.length < 10) break;
      } catch (e) {
        console.error('SWM Helper: fetchAppliedSns error', e);
        break;
      }
    }
    return Array.from(applied.values());
  }

  // concurrency=3: SWM 서버 부담 완화 (예전 4 → 3). 간헐 5xx 관찰되어 하향.
  // 실측상 전체 fullSync 는 retry 감소로 비슷하거나 오히려 빠름.
  async function fullSync({ statusFilter = 'A', concurrency = 3, statusCallback } = {}) {
    // listLectures: status 필터에 해당하는 표 데이터 (상세 수집 대상)
    // calendarData: 모든 달의 캘린더 파편 (SN+날짜+제목 일부만, 상세 수집 제외)
    const listLectures = {};
    const scopeLabel = statusFilter === 'A' ? '접수중' : statusFilter === 'C' ? '마감' : '전체';
    const MAX_PAGES = 300;
    // 루프 전체에 걸친 누적 실패 페이지 수 — retry 에서 복구된 페이지는 제외할 수 없으나
    // (페이지 번호 단위 재시도가 아닌 루프 복귀 방식이므로) transient 루프 tick 카운트로 근사.
    let failedPages = 0;

    statusCallback?.(`${scopeLabel} 동기화 시작...`);

    let page = 1;
    let done = false;
    while (!done && page <= MAX_PAGES) {
      const batch = [];
      for (let i = 0; i < concurrency && page + i <= MAX_PAGES; i++) {
        batch.push(fetchListPage(page + i, statusFilter));
      }
      const results = await Promise.all(batch);

      let transientFailure = false;
      for (const r of results) {
        if (r.loginRequired) {
          statusCallback?.('로그인 필요');
          return null;
        }
        // transient 실패(5xx/429/네트워크)는 done 마킹 금지 — 다음 루프에서 재시도하고
        // 사용자에게는 완료 토스트 대신 경고 상태를 남긴다.
        if (r.error) { transientFailure = true; failedPages++; continue; }
        const rowCount = Object.keys(r.data).length;
        Object.assign(listLectures, r.data);
        if (rowCount < 10) done = true;
      }
      if (transientFailure) {
        statusCallback?.(`${scopeLabel} 일부 페이지 네트워크 오류 — 잠시 후 재시도`);
        await new Promise(r => setTimeout(r, 800));
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
      await fetchDetailsBatch(needDetail, { concurrency: 3, statusCallback });
    }

    // 내 신청내역 동기화 — 단일 read/write로 배치 처리.
    // v1.16.1+: fetchAppliedSns 가 [{sn, lecDate, lecTime, title, mentor, isApproved}] 반환.
    // sync scope 밖 과거 강의라도 history 페이지 partial data 로 lecTime 보존 → 블록 렌더 가능.
    statusCallback?.('신청내역 확인 중...');
    const appliedRows = await fetchAppliedSns();
    if (appliedRows !== null) {
      const appliedSet = new Set(appliedRows.map(r => r.sn));
      const all = await SWM.getLectures();
      let changed = false;
      for (const sn of Object.keys(all)) {
        const wantApplied = appliedSet.has(sn);
        if (!!all[sn].applied !== wantApplied) {
          all[sn] = { ...all[sn], applied: wantApplied };
          changed = true;
        }
      }
      for (const row of appliedRows) {
        const prev = all[row.sn] || {};
        // history row 를 조건부 overlay — truthy 값만 덮어쓴다 (r1-H2).
        // spread 로 전체 덮어쓰면 row.lecTime 이 빈 문자열일 때 prev 의 올바른 값을
        // 지워버릴 수 있음. fetchAppliedSns 가 조건부 할당이라 실제 발생은 드물지만
        // 방어적으로 필드별 체크.
        const merged = { ...prev, sn: row.sn, applied: true };
        if (row.lecDate) merged.lecDate = row.lecDate;
        if (row.lecTime) merged.lecTime = row.lecTime;
        if (row.title) merged.title = row.title;
        if (row.mentor) merged.mentor = row.mentor;
        if (row.isApproved != null) merged.isApproved = row.isApproved;
        all[row.sn] = merged;
        changed = true;
      }
      if (changed) await SWM.replaceLectures(all);

      // applied + 즐겨찾기 상세 재fetch — isApproved/location/count 최신화.
      // 즐겨찾기는 sync scope 밖(마감 등) 이라도 detail 이 있어야 "개설 확정" 배지가 뜸.
      // 같은 tick 의 needDetail 은 이미 위에서 돌았으므로 제외.
      const favs = await SWM.getFavorites();
      const alreadyFetched = new Set(needDetail);
      const targets = [...new Set([
        ...appliedRows.map(r => r.sn),
        ...favs,
      ])].filter(sn => !alreadyFetched.has(sn));
      if (targets.length > 0) {
        statusCallback?.(`신청·즐겨찾기 상세 ${targets.length}개 재수집 중...`);
        await fetchDetailsBatch(targets, { concurrency: 3, statusCallback });
      }
    }

    const meta = await SWM.getMeta();
    meta.lastFullSync = new Date().toISOString();
    meta.lastSyncScope = statusFilter || 'all';
    const final = await SWM.getLectures();
    meta.knownLectureSns = Object.keys(final);
    await SWM.saveMeta(meta);

    const finalMsg = failedPages > 0
      ? `완료! ${scopeLabel} ${Object.keys(listLectures).length}개 · ${failedPages}페이지 실패`
      : `완료! ${scopeLabel} ${Object.keys(listLectures).length}개`;
    statusCallback?.(finalMsg);
    // 호출자가 실패 카운트를 읽을 수 있도록 return 객체에 메타 동봉.
    // 기존 호출자(background peek→FULL)는 truthy 체크만 하므로 호환 유지.
    Object.defineProperty(listLectures, '__failedPages', { value: failedPages, enumerable: false });
    return listLectures;
  }

  async function fetchOneDetail(sn) {
    try {
      const resp = await fetchWithRetry(
        `/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`
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
      const contEl = doc.querySelector('.bbs-view-new .cont');
      const description = contEl ? extractReadableText(contEl).substring(0, 500) : '';

      // 강의날짜/시간 추출 (시간표용 — 마감 강연 applied 도 블록으로 표시하려면 필수)
      const data = { location: loc, isOnline, description, detailFetched: true };
      const lecDateRaw = info['강의날짜'] || '';
      const parsedDT = extractLecDateTime(lecDateRaw);
      if (parsedDT.lecDate) data.lecDate = parsedDT.lecDate;
      if (parsedDT.lecTime) data.lecTime = parsedDT.lecTime;

      // 멘토/분류/상태 보조 (list 데이터 없을 때만 보충용)
      if (info['작성자']) data.mentor = info['작성자'];
      if (info['모집 명'] && !data.title) data.title = info['모집 명'];
      if (info['접수 기간']) data.regPeriod = info['접수 기간'];
      if (info['상태']) {
        data.status = info['상태'].includes('접수중') ? 'A' : 'C';
      }
      // 개설 승인 여부 (true=확정, false=미승인, null=정보 없음)
      const approvedRaw = info['개설 승인'];
      if (approvedRaw != null) data.isApproved = approvedRaw === 'OK';

      return { sn, data };
    } catch (e) {
      console.error(`SWM Helper: detail ${sn} error`, e);
      return { sn, error: e.message };
    }
  }

  async function fetchDetailsBatch(sns, { concurrency = 3, statusCallback } = {}) {
    let done = 0;
    const collected = {}; // per-chunk에서 모아 한번에 saveLectures
    for (let i = 0; i < sns.length; i += concurrency) {
      const chunk = sns.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(fetchOneDetail));
      for (const r of results) {
        if (r.loginRequired) {
          if (Object.keys(collected).length) await SWM.saveLectures(collected);
          return done;
        }
        if (r.data) {
          collected[r.sn] = r.data;
          done++;
        }
      }
      // 청크마다 배치 저장 → UI 에 점진적 반영 + 재시작 안전성
      if (Object.keys(collected).length) {
        await SWM.saveLectures(collected);
        for (const k of Object.keys(collected)) delete collected[k];
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
