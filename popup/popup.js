// popup.js — 검색, 필터, 즐겨찾기

(async function() {
  'use strict';

  let allLectures = {};
  let favorites = [];
  let currentTab = 'search';
  let currentResults = [];

  // --- DOM 요소 ---
  const searchInput = document.getElementById('searchInput');
  const filterDate = document.getElementById('filterDate');
  const filterStatus = document.getElementById('filterStatus');
  const filterCategory = document.getElementById('filterCategory');
  const filterLocation = document.getElementById('filterLocation');
  const resultsDiv = document.getElementById('results');
  const resultCount = document.getElementById('resultCount');
  const syncBtn = document.getElementById('syncBtn');
  const syncAllBtn = document.getElementById('syncAllBtn');
  const headerStats = document.getElementById('headerStats');

  // --- 초기화 ---
  function updateHeaderStats() {
    const openCount = Object.values(allLectures).filter(l => l.status === 'A').length;
    const appliedCount = Object.values(allLectures).filter(l => l.applied).length;
    const favCount = favorites.length;
    headerStats.textContent = `접수중 ${openCount} · 즐겨찾기 ${favCount} · 내 신청 ${appliedCount}`;
  }

  async function init() {
    allLectures = await SWM.getLectures();
    favorites = await SWM.getFavorites();

    const meta = await SWM.getMeta();
    if (meta.lastFullSync) {
      updateHeaderStats();
    } else {
      headerStats.textContent = '동기화 필요';
    }

    doSearch();
  }

  // --- 검색 & 필터 ---
  function doSearch() {
    const query = searchInput.value.trim().toLowerCase();
    const date = filterDate.value;
    const status = filterStatus.value;
    const category = filterCategory.value;
    const location = filterLocation.value;

    let lectures = Object.values(allLectures);

    // 탭별 필터
    if (currentTab === 'favorites') {
      lectures = lectures.filter(l => favorites.includes(l.sn));
    } else if (currentTab === 'applied') {
      lectures = lectures.filter(l => l.applied === true);
    }

    // 키워드 검색은 모든 탭 공통
    if (query) {
      lectures = lectures.filter(l => {
        const searchable = [
          l.title, l.mentor, l.categoryNm, l.description, l.location
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(query);
      });
    }

    // 날짜 필터: 특정 날짜 선택시 모든 탭에 적용. 비어있을 때는 검색 탭에서만 "오늘 이후" 적용.
    if (date) {
      lectures = lectures.filter(l => l.lecDate === date);
    } else if (currentTab === 'search') {
      const today = new Date().toISOString().slice(0, 10);
      lectures = lectures.filter(l => !l.lecDate || l.lecDate >= today);
    }

    // 상태/분류/장소 필터는 검색 탭에서만 적용. 즐겨찾기/내 신청 탭은 전체 표시.
    if (currentTab === 'search') {
      if (status) lectures = lectures.filter(l => l.status === status);
      if (category) lectures = lectures.filter(l => l.category === category);
      if (location === 'online') lectures = lectures.filter(l => l.isOnline === true);
      else if (location === 'offline') lectures = lectures.filter(l => l.detailFetched && l.isOnline === false);
    }

    // 정렬: 강의 날짜+시간 오름차순 (가까운 순). 날짜 없는 항목은 맨 뒤.
    lectures.sort((a, b) => {
      const ak = a.lecDate ? `${a.lecDate} ${a.lecTime || ''}` : '\uffff';
      const bk = b.lecDate ? `${b.lecDate} ${b.lecTime || ''}` : '\uffff';
      const cmp = ak.localeCompare(bk);
      if (cmp !== 0) return cmp;
      return (parseInt(a.sn) || 0) - (parseInt(b.sn) || 0);
    });

    currentResults = lectures;
    renderResults(lectures);
  }

  // --- 렌더링 ---
  function renderResults(lectures) {
    resultCount.textContent = `${lectures.length}건`;

    if (lectures.length === 0) {
      const emptyMsg =
        currentTab === 'favorites' ? '즐겨찾기가 없습니다' :
        currentTab === 'applied' ? '신청한 강연이 없습니다' :
        '검색 결과가 없습니다';
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <div class="msg">${emptyMsg}</div>
          <div class="msg" style="font-size:11px;margin-top:4px;color:#bbb">
            ${Object.keys(allLectures).length === 0 ? '먼저 "접수중 동기화"를 실행하세요' : ''}
          </div>
        </div>`;
      return;
    }

    const starSvgFilled = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const starSvgEmpty = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

    resultsDiv.innerHTML = lectures.map(l => {
      const isFav = favorites.includes(l.sn);
      const isSpecial = l.category === 'MRC020';
      const catLabel = isSpecial ? '특강' : '멘토링';
      const catClass = isSpecial ? 'special' : 'free';

      // 제목에서 카테고리 접두사 제거
      let displayTitle = l.title || '';
      displayTitle = displayTitle.replace(/^\[[^\]]+\]\s*/, '');

      // 메타 라인: 카테고리 · 날짜 · 시간 · 멘토 · 인원 · [즐겨찾기 or 신청뱃지]
      const metaBits = [];
      metaBits.push(`<span class="cat ${catClass}">${catLabel}</span>`);
      if (l.lecDate) metaBits.push(`<span class="date">${formatDate(l.lecDate)}</span>`);
      if (l.lecTime) metaBits.push(`<span>${escapeHtml(l.lecTime)}</span>`);
      if (l.mentor || l.count?.max) {
        metaBits.push('<span class="sep">·</span>');
        if (l.mentor) metaBits.push(`<span>${escapeHtml(l.mentor)}</span>`);
        if (l.mentor && l.count?.max) metaBits.push('<span class="sep">·</span>');
        if (l.count?.max) metaBits.push(`<span class="count">${l.count.current ?? '?'}/${l.count.max}명</span>`);
      }
      metaBits.push('<span class="spacer"></span>');
      if (l.applied) {
        metaBits.push('<span class="applied-badge">신청</span>');
      } else {
        metaBits.push(`<button class="fav-btn ${isFav ? 'on' : ''}" data-sn="${l.sn}" title="즐겨찾기">${isFav ? starSvgFilled : starSvgEmpty}</button>`);
      }

      // 태그 라인: 장소 + 상태
      const tags = [];
      if (l.detailFetched && l.location) {
        const locClass = l.isOnline ? 'online' : 'offline';
        const locLabel = l.isOnline ? '비대면' : '대면';
        tags.push(`<span class="tag ${locClass}">${locLabel} ${escapeHtml(l.location)}</span>`);
      }
      if (l.status === 'A') tags.push('<span class="tag open">접수중</span>');
      else if (l.status === 'C') tags.push('<span class="tag closed">마감</span>');

      const itemClass = `lecture-item${l.applied ? ' applied' : ''}`;
      return `
        <div class="${itemClass}" data-sn="${l.sn}" ${l.applied ? 'title="신청한 강연"' : ''}>
          <div class="meta-line">${metaBits.join('')}</div>
          <div class="title-line">${escapeHtml(displayTitle)}</div>
          <div class="tags-line">${tags.join('')}</div>
        </div>`;
    }).join('');
  }

  // --- 이벤트 핸들러 ---

  // 검색/필터 변경
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 200);
  });
  filterDate.addEventListener('change', doSearch);
  filterStatus.addEventListener('change', doSearch);
  filterCategory.addEventListener('change', doSearch);
  filterLocation.addEventListener('change', doSearch);

  // 탭 전환
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      doSearch();
    });
  });

  // 강연 클릭 → 상세 페이지 열기
  resultsDiv.addEventListener('click', e => {
    const item = e.target.closest('.lecture-item');
    const favBtn = e.target.closest('.fav-btn');

    if (favBtn) {
      e.stopPropagation();
      const sn = favBtn.dataset.sn;
      SWM.toggleFavorite(sn).then(newFavs => {
        favorites = newFavs;
        doSearch(); // re-render
      });
      return;
    }

    if (item) {
      const sn = item.dataset.sn;
      chrome.tabs.create({
        url: `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`
      });
    }
  });

  // swmaestro.ai 탭 찾기 (www 포함, 아무 페이지든 OK)
  async function findSwmTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.url?.includes('swmaestro.ai')) return active;

    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*']
    });
    return tabs[0] || null;
  }

  async function triggerSync(button, originalLabel, statusFilter) {
    button.disabled = true;
    button.textContent = '동기화 중...';

    const tab = await findSwmTab();
    if (!tab) {
      button.textContent = 'swmaestro.ai 탭을 여세요';
      setTimeout(() => { button.textContent = originalLabel; button.disabled = false; }, 2500);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter });
      if (response?.success) {
        button.textContent = `완료! ${response.count}개`;
        allLectures = await SWM.getLectures();
        updateHeaderStats();
        doSearch();
      } else {
        button.textContent = '실패 (로그인 확인)';
      }
    } catch (e) {
      button.textContent = '페이지 새로고침 필요';
    }

    setTimeout(() => { button.textContent = originalLabel; button.disabled = false; }, 2500);
  }

  syncBtn.addEventListener('click', () => triggerSync(syncBtn, '접수중 동기화', 'A'));
  syncAllBtn.addEventListener('click', () => triggerSync(syncAllBtn, '마감 포함', ''));

  document.getElementById('openTimetableBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('timetable/timetable.html') });
  });

  // 동기화 상태 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYNC_STATUS') {
      syncBtn.textContent = msg.status;
    }
  });

  // Cross-document storage 변경 자동 반영
  // (timetable 에서 ★ 토글 / sync 진행 시 즉시 popup UI 업데이트)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (changes.lectures) {
      allLectures = changes.lectures.newValue || {};
      changed = true;
    }
    if (changes.favorites) {
      favorites = changes.favorites.newValue || [];
      changed = true;
    }
    if (changed) {
      updateHeaderStats();
      doSearch();
    }
  });

  // --- 유틸리티 ---
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    }
    return dateStr;
  }

  function timeAgo(date) {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  }

  // --- 시작 ---
  await init();

})();
