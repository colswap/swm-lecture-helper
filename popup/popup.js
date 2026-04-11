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
  const syncDetailBtn = document.getElementById('syncDetailBtn');
  const syncInfo = document.getElementById('syncInfo');

  // --- 초기화 ---
  async function init() {
    allLectures = await SWM.getLectures();
    favorites = await SWM.getFavorites();

    const meta = await SWM.getMeta();
    if (meta.lastFullSync) {
      const ago = timeAgo(new Date(meta.lastFullSync));
      syncInfo.textContent = `${Object.keys(allLectures).length}개 | ${ago}`;
    } else {
      syncInfo.textContent = '동기화 필요';
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

    // 즐겨찾기 탭이면 즐겨찾기만
    if (currentTab === 'favorites') {
      lectures = lectures.filter(l => favorites.includes(l.sn));
    }

    // 키워드 검색
    if (query) {
      lectures = lectures.filter(l => {
        const searchable = [
          l.title, l.mentor, l.categoryNm, l.description, l.location
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(query);
      });
    }

    // 날짜 필터
    if (date) {
      lectures = lectures.filter(l => l.lecDate === date);
    }

    // 상태 필터
    if (status) {
      lectures = lectures.filter(l => l.status === status);
    }

    // 카테고리 필터
    if (category) {
      lectures = lectures.filter(l => l.category === category);
    }

    // 장소 필터
    if (location === 'online') {
      lectures = lectures.filter(l => l.isOnline === true);
    } else if (location === 'offline') {
      lectures = lectures.filter(l => l.detailFetched && l.isOnline === false);
    }

    // 정렬: 날짜 내림차순, 같으면 sn 내림차순
    lectures.sort((a, b) => {
      if (a.lecDate && b.lecDate) {
        const cmp = b.lecDate.localeCompare(a.lecDate);
        if (cmp !== 0) return cmp;
      }
      return (parseInt(b.sn) || 0) - (parseInt(a.sn) || 0);
    });

    currentResults = lectures;
    renderResults(lectures);
  }

  // --- 렌더링 ---
  function renderResults(lectures) {
    resultCount.textContent = `${lectures.length}건`;

    if (lectures.length === 0) {
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <div class="icon">📭</div>
          <div class="msg">${currentTab === 'favorites' ? '즐겨찾기가 없습니다' : '검색 결과가 없습니다'}</div>
          <div class="msg" style="font-size:11px;margin-top:4px;color:#bbb">
            ${Object.keys(allLectures).length === 0 ? '먼저 "전체 동기화"를 실행하세요' : ''}
          </div>
        </div>`;
      return;
    }

    resultsDiv.innerHTML = lectures.map(l => {
      const isFav = favorites.includes(l.sn);
      const isSpecial = l.category === 'MRC020';
      const catLabel = isSpecial ? '특강' : '멘토링';
      const catClass = isSpecial ? 'special' : 'free';

      // 메타 태그
      const tags = [];
      if (l.lecDate) tags.push(formatDate(l.lecDate));
      if (l.lecTime) tags.push(l.lecTime);
      if (l.detailFetched && l.location) {
        const locClass = l.isOnline ? 'online' : 'offline';
        const locLabel = l.isOnline ? '비대면' : '대면';
        tags.push(`<span class="tag ${locClass}">${locLabel}: ${l.location}</span>`);
      }
      if (l.mentor) tags.push(l.mentor);
      if (l.count?.max) tags.push(`${l.count.current || '?'}/${l.count.max}명`);
      if (l.status === 'A') {
        tags.push('<span class="tag open">접수중</span>');
      } else if (l.status === 'C') {
        tags.push('<span class="tag closed">마감</span>');
      }

      // 제목에서 카테고리 접두사 제거
      let displayTitle = l.title || '';
      displayTitle = displayTitle.replace(/^\[[^\]]+\]\s*/, '');

      return `
        <div class="lecture-item" data-sn="${l.sn}">
          <button class="fav-btn ${isFav ? 'active' : ''}" data-sn="${l.sn}" title="즐겨찾기">
            ${isFav ? '★' : '☆'}
          </button>
          <div class="lecture-title">
            <span class="cat ${catClass}">${catLabel}</span>
            <span class="name">${escapeHtml(displayTitle)}</span>
          </div>
          <div class="lecture-meta">${tags.join(' · ')}</div>
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
        url: `https://swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`
      });
    }
  });

  // swmaestro.ai 탭 찾기 (아무 페이지든 OK)
  async function findSwmTab() {
    // 현재 탭 먼저 확인
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.url?.includes('swmaestro.ai')) return active;

    // 모든 탭에서 swmaestro.ai 탭 찾기
    const tabs = await chrome.tabs.query({ url: 'https://swmaestro.ai/*' });
    return tabs[0] || null;
  }

  // 전체 동기화
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = '동기화 중...';

    const tab = await findSwmTab();
    if (!tab) {
      syncBtn.textContent = 'swmaestro.ai를 아무 페이지나 열어주세요';
      setTimeout(() => { syncBtn.textContent = '전체 동기화'; syncBtn.disabled = false; }, 2500);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC' });
      if (response?.success) {
        syncBtn.textContent = `완료! ${response.count}개`;
        allLectures = await SWM.getLectures();
        const meta = await SWM.getMeta();
        syncInfo.textContent = `${Object.keys(allLectures).length}개 | 방금`;
        doSearch();
      } else {
        syncBtn.textContent = '실패 (로그인 확인)';
      }
    } catch (e) {
      syncBtn.textContent = 'swmaestro.ai 페이지를 새로고침 해주세요';
    }

    setTimeout(() => { syncBtn.textContent = '전체 동기화'; syncBtn.disabled = false; }, 2500);
  });

  // 상세 수집
  syncDetailBtn.addEventListener('click', async () => {
    // 현재 검색 결과에서 detailFetched가 false인 것들
    const needDetail = currentResults.filter(l => !l.detailFetched).map(l => l.sn);

    if (needDetail.length === 0) {
      syncDetailBtn.textContent = '수집할 항목 없음';
      setTimeout(() => { syncDetailBtn.textContent = '상세 수집'; }, 1500);
      return;
    }

    syncDetailBtn.disabled = true;
    syncDetailBtn.textContent = `수집 중... (${needDetail.length}개)`;

    const tab = await findSwmTab();
    if (!tab) {
      syncDetailBtn.textContent = 'swmaestro.ai 필요';
      setTimeout(() => { syncDetailBtn.textContent = '상세 수집'; syncDetailBtn.disabled = false; }, 2000);
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_DETAILS', sns: needDetail });
      syncDetailBtn.textContent = `완료! ${response?.count || 0}개`;
      allLectures = await SWM.getLectures();
      doSearch();
    } catch (e) {
      syncDetailBtn.textContent = '페이지 새로고침 필요';
    }

    setTimeout(() => {
      syncDetailBtn.textContent = '상세 수집';
      syncDetailBtn.disabled = false;
    }, 2500);
  });

  // 동기화 상태 수신
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYNC_STATUS') {
      syncBtn.textContent = msg.status;
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
