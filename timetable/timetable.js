// SWM 시간표 뷰 — 사이드바는 팝업과 동일한 검색/렌더 로직, 메인은 주간 그리드

(async function () {
  'use strict';

  // 그리드 시간 범위 (08:00 ~ 23:00)
  const START_HOUR = 8;
  const END_HOUR = 23;
  const HOUR_PX = 52;
  const baseMin = START_HOUR * 60;

  let allLectures = {};
  let favorites = [];
  let currentTab = 'search';
  let weekStart = mondayOf(new Date());

  // B-2: 시간대 선택
  // key: 'YYYY-MM-DD', value: [{startMin, endMin}]
  const selectedSlots = new Map();
  let advancedMode = false; // 상세검색 모드 (드래그/슬롯 필터 활성 여부)
  const SLOT_SNAP_MIN = 10; // 10분 단위 스냅

  const el = id => document.getElementById(id);
  const searchInput = el('searchInput');
  const filterDateStart = el('filterDateStart');
  const filterDateEnd = el('filterDateEnd');
  const clearDateRange = el('clearDateRange');
  const filterStatus = el('filterStatus');
  const filterCategory = el('filterCategory');
  const filterLocation = el('filterLocation');
  const onlyFreeSlot = el('onlyFreeSlot');
  const thisWeekOnly = el('thisWeekOnly');
  const showFavsOnGrid = el('showFavsOnGrid');
  const resultsDiv = el('results');
  const resultCount = el('resultCount');
  const headerStats = el('headerStats');
  const dayHeaders = el('dayHeaders');
  const gridBody = el('gridBody');
  const weekLabel = el('weekLabel');
  const previewInfo = el('hoverPreviewInfo');
  const popover = el('popover');
  const syncBtn = el('syncBtn');
  const syncAllBtn = el('syncAllBtn');

  // ─── 헤더 통계 (팝업과 동일) ───
  function updateHeaderStats() {
    const openCount = Object.values(allLectures).filter(l => l.status === 'A').length;
    const appliedCount = Object.values(allLectures).filter(l => l.applied).length;
    headerStats.textContent = `접수중 ${openCount} · 즐겨찾기 ${favorites.length} · 내 신청 ${appliedCount}`;
  }

  // ─── 검색/필터 ───
  function runSearch() {
    const query = searchInput.value.trim().toLowerCase();
    const dateStart = filterDateStart.value;
    const dateEnd = filterDateEnd.value;
    const status = filterStatus.value;
    const category = filterCategory.value;
    const location = filterLocation.value;
    const slotSearchActive = advancedMode && selectedSlots.size > 0;

    let lectures = Object.values(allLectures);

    // 탭별 필터
    if (currentTab === 'favorites') {
      lectures = lectures.filter(l => favorites.includes(l.sn));
    } else if (currentTab === 'applied') {
      lectures = lectures.filter(l => l.applied === true);
    }

    // 키워드 (제목·멘토·분류·설명·장소)
    if (query) {
      lectures = lectures.filter(l => {
        const searchable = [l.title, l.mentor, l.categoryNm, l.description, l.location]
          .filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(query);
      });
    }

    // 날짜 범위 필터 (B-1): start~end 지정 시 해당 범위만. 둘 중 하나만 지정 시 open-ended.
    if (dateStart || dateEnd) {
      lectures = lectures.filter(l => {
        if (!l.lecDate) return false;
        if (dateStart && l.lecDate < dateStart) return false;
        if (dateEnd && l.lecDate > dateEnd) return false;
        return true;
      });
    } else if (currentTab === 'search' && !slotSearchActive) {
      const today = fmtISO(new Date());
      lectures = lectures.filter(l => !l.lecDate || l.lecDate >= today);
    }

    // 나머지 필터: 검색 탭에서만
    if (currentTab === 'search') {
      if (status) lectures = lectures.filter(l => l.status === status);
      if (category) lectures = lectures.filter(l => l.category === category);
      if (location === 'online') lectures = lectures.filter(l => l.isOnline === true);
      else if (location === 'offline') lectures = lectures.filter(l => l.detailFetched && l.isOnline === false);
      // 접수중 필터 시: 이미 시작한 강연 제외
      if (status === 'A') lectures = lectures.filter(l => !hasStarted(l));
    }

    // 시간표 전용 토글
    if (thisWeekOnly.checked && !slotSearchActive) {
      const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));
      lectures = lectures.filter(l => l.lecDate && weekISO.includes(l.lecDate));
    }
    if (onlyFreeSlot.checked) {
      lectures = lectures.filter(isFreeForMe);
    }

    // B-2: 슬롯 선택 검색
    if (slotSearchActive) {
      lectures = lectures.filter(l => matchesSelectedSlots(l));
    }

    // 정렬: 강의 날짜+시간 오름차순
    lectures.sort((a, b) => {
      const ak = a.lecDate ? `${a.lecDate} ${a.lecTime || ''}` : '\uffff';
      const bk = b.lecDate ? `${b.lecDate} ${b.lecTime || ''}` : '\uffff';
      const cmp = ak.localeCompare(bk);
      if (cmp !== 0) return cmp;
      return (parseInt(a.sn) || 0) - (parseInt(b.sn) || 0);
    });

    renderResults(lectures);
  }

  function isFreeForMe(candidate) {
    const range = parseTimeRange(candidate.lecTime);
    if (!range || !candidate.lecDate) return true;
    const myBlocks = Object.values(allLectures)
      .filter(l => l.applied && l.lecDate === candidate.lecDate && l.lecTime && l.sn !== candidate.sn)
      .map(l => parseTimeRange(l.lecTime))
      .filter(Boolean);
    return myBlocks.every(b => !overlaps(b, range));
  }

  function matchesSelectedSlots(l) {
    if (!l.lecDate || !l.lecTime) return false;
    const slots = selectedSlots.get(l.lecDate);
    if (!slots || slots.length === 0) return false;
    const r = parseTimeRange(l.lecTime);
    if (!r) return false;
    // 완전 포함 (강연 시간이 선택 슬롯 안에 전부 들어가는 경우만)
    return slots.some(s => s.startMin <= r.startMin && s.endMin >= r.endMin);
  }

  // ─── 카드 렌더 (팝업과 동일 구조) ───
  const starFilled = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
  const starEmpty = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

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

    resultsDiv.innerHTML = lectures.map(l => {
      const isFav = favorites.includes(l.sn);
      const isSpecial = l.category === 'MRC020';
      const catLabel = isSpecial ? '특강' : '멘토링';
      const catClass = isSpecial ? 'special' : 'free';

      let displayTitle = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');

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
        metaBits.push(`<button class="fav-btn ${isFav ? 'on' : ''}" data-sn="${l.sn}" title="즐겨찾기">${isFav ? starFilled : starEmpty}</button>`);
      }

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

  // ─── 그리드 렌더 ───
  function renderGridSkeleton() {
    dayHeaders.innerHTML = '<div></div>' + Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const isToday = fmtISO(d) === fmtISO(new Date());
      const isWeekend = i >= 5;
      const cls = [isToday ? 'today' : '', isWeekend ? 'weekend' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}">${fmtDayHeader(d)}</div>`;
    }).join('');

    const labels = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      labels.push(`<div class="time-slot" style="height:${HOUR_PX}px">${String(h).padStart(2, '0')}:00</div>`);
    }
    const colHeight = (END_HOUR - START_HOUR + 1) * HOUR_PX;
    gridBody.innerHTML = `<div class="time-labels" style="height:${colHeight}px">${labels.join('')}</div>` +
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const isToday = fmtISO(d) === fmtISO(new Date());
        return `<div class="day-column${isToday ? ' today' : ''}" data-date="${fmtISO(d)}" style="height:${colHeight}px"></div>`;
      }).join('');
  }

  function dayColEl(dateStr) {
    return gridBody.querySelector(`.day-column[data-date="${dateStr}"]`);
  }

  function blockPos(range) {
    const top = Math.max(0, (range.startMin - baseMin) / 60) * HOUR_PX;
    const height = Math.max(20, (range.endMin - range.startMin) / 60 * HOUR_PX);
    return { top, height };
  }

  function appliedInWeek() {
    const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));
    return Object.values(allLectures).filter(l => l.applied && l.lecDate && weekISO.includes(l.lecDate));
  }

  function favoritesInWeek() {
    const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));
    const favSet = new Set(favorites);
    return Object.values(allLectures).filter(l =>
      favSet.has(l.sn) && !l.applied && l.lecDate && weekISO.includes(l.lecDate)
    );
  }

  function renderFavoriteBlocks() {
    gridBody.querySelectorAll('.lec-block.favorite').forEach(e => e.remove());
    if (!showFavsOnGrid.checked) return;
    favoritesInWeek().forEach(l => {
      const range = parseTimeRange(l.lecTime);
      if (!range) return;
      const col = gridBody.querySelector(`.day-column[data-date="${l.lecDate}"]`);
      if (!col) return;
      const { top, height } = blockPos(range);
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const block = document.createElement('div');
      block.className = 'lec-block favorite';
      block.dataset.sn = l.sn;
      block.style.top = top + 'px';
      block.style.height = height + 'px';
      block.innerHTML = `
        <div class="bt">★ ${escapeHtml(title)}</div>
        <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))}${l.mentor ? ' · ' + escapeHtml(l.mentor) : ''}</div>`;
      block.addEventListener('click', e => { e.stopPropagation(); showPopover(l, block); });
      col.appendChild(block);
    });
  }

  function renderAppliedBlocks() {
    gridBody.querySelectorAll('.lec-block.applied').forEach(e => e.remove());
    appliedInWeek().forEach(l => {
      const range = parseTimeRange(l.lecTime);
      if (!range) return;
      const col = dayColEl(l.lecDate);
      if (!col) return;
      const { top, height } = blockPos(range);
      const isSpecial = l.category === 'MRC020';
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const block = document.createElement('div');
      block.className = `lec-block applied ${isSpecial ? 'special' : 'free'}`;
      block.dataset.sn = l.sn;
      block.style.top = top + 'px';
      block.style.height = height + 'px';
      block.innerHTML = `
        <div class="bt">${escapeHtml(title)}</div>
        <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))} · ${escapeHtml(l.mentor || '')}</div>`;
      block.addEventListener('click', e => { e.stopPropagation(); showPopover(l, block); });
      col.appendChild(block);
    });
  }

  function clearPreviewBlocks() {
    gridBody.querySelectorAll('.lec-block.preview').forEach(e => e.remove());
    gridBody.querySelectorAll('.lec-block.applied.conflicting').forEach(e => e.classList.remove('conflicting'));
    previewInfo.textContent = '';
    previewInfo.className = 'preview-info';
  }

  function renderPreview(candidate) {
    clearPreviewBlocks();
    const range = parseTimeRange(candidate.lecTime);
    if (!range || !candidate.lecDate) {
      previewInfo.textContent = '시간/날짜 미정';
      return;
    }
    const col = dayColEl(candidate.lecDate);
    if (!col) {
      previewInfo.textContent = `다른 주 (${candidate.lecDate})`;
      return;
    }
    const sameDayApplied = appliedInWeek().filter(l =>
      l.lecDate === candidate.lecDate && l.lecTime && l.sn !== candidate.sn
    );
    const conflicts = sameDayApplied.filter(l => overlaps(parseTimeRange(l.lecTime), range));
    const hasConflict = conflicts.length > 0;
    const { top, height } = blockPos(range);
    const title = (candidate.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const block = document.createElement('div');
    block.className = `lec-block preview${hasConflict ? ' conflict' : ''}`;
    block.style.top = top + 'px';
    block.style.height = height + 'px';
    block.innerHTML = `
      <div class="bt">${escapeHtml(title)}</div>
      <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))}</div>`;
    col.appendChild(block);
    conflicts.forEach(c => {
      const existing = col.querySelector(`.lec-block.applied[data-sn="${c.sn}"]`);
      if (existing) existing.classList.add('conflicting');
    });
    previewInfo.textContent = hasConflict ? `⚠ ${conflicts.length}건과 시간 겹침` : '✓ 겹치지 않음';
    previewInfo.className = 'preview-info ' + (hasConflict ? 'conflict' : 'free');
  }

  // ─── Popover (재작업) ───
  const popoverBackdrop = el('popoverBackdrop');
  let currentPopoverSn = null;

  function svgIcon(d, opts = {}) {
    const fill = opts.fill || 'none';
    return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2">${d}</svg>`;
  }
  const ICON = {
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  };

  function showPopover(lec, anchor) {
    currentPopoverSn = lec.sn;
    const isSpecial = lec.category === 'MRC020';
    el('popoverCat').textContent = isSpecial ? '특강' : '멘토링';
    el('popoverCat').className = 'cat ' + (isSpecial ? 'special' : 'free');
    el('popoverTitle').textContent = (lec.title || '').replace(/^\[[^\]]+\]\s*/, '');

    // 메타 영역 (아이콘 + 라인)
    const rows = [];
    if (lec.lecDate || lec.lecTime) {
      const dt = [lec.lecDate ? formatLongDate(lec.lecDate) : '', lec.lecTime || ''].filter(Boolean).join(' · ');
      rows.push(`<div class="meta-row">${svgIcon(ICON.cal)}<span>${escapeHtml(dt)}</span></div>`);
    }
    if (lec.mentor || lec.count?.max) {
      const parts = [];
      if (lec.mentor) parts.push(escapeHtml(lec.mentor));
      if (lec.count?.max) parts.push(`${lec.count.current ?? '?'}/${lec.count.max}명`);
      rows.push(`<div class="meta-row">${svgIcon(ICON.user)}<span>${parts.join(' · ')}</span></div>`);
    }
    if (lec.detailFetched && lec.location) {
      rows.push(`<div class="meta-row">${svgIcon(ICON.pin)}<span>${lec.isOnline ? '비대면' : '대면'} · ${escapeHtml(lec.location)}</span></div>`);
    }
    const badges = [];
    if (lec.status === 'A') badges.push('<span class="tag open">접수중</span>');
    else if (lec.status === 'C') badges.push('<span class="tag closed">마감</span>');
    if (lec.applied) badges.push('<span class="applied-badge">✓ 신청 완료</span>');
    if (badges.length) rows.push(`<div class="meta-row"><div class="badges">${badges.join('')}</div></div>`);
    el('popoverMeta').innerHTML = rows.join('');

    // 본문
    const desc = (lec.description || '').trim();
    const descEl = el('popoverDesc');
    if (desc) {
      descEl.textContent = desc;
      descEl.classList.remove('empty');
    } else {
      descEl.textContent = '(설명 없음)';
      descEl.classList.add('empty');
    }

    // 즐겨찾기 버튼 상태
    refreshPopoverFavBtn();

    // 액션
    el('popoverOpen').onclick = () => {
      chrome.tabs.create({
        url: `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${lec.sn}&menuNo=200046`
      });
    };

    updateActionButtons(lec);
    el('popoverApply').onclick = () => onApplyClick(lec);
    el('popoverCancel').onclick = () => onCancelClick(lec);
    // applied 인데 applySn 모르면 백그라운드 스크래핑
    if (lec.applied && !lec.applySn) fetchApplySn(lec.sn);

    // 위치
    popover.style.transform = '';
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const popW = 380;
      const popH = 400; // 추정치, max-height 80vh
      let left = rect.right + 10;
      let top = rect.top;
      if (left + popW > window.innerWidth - 12) left = Math.max(12, rect.left - popW - 10);
      if (top + popH > window.innerHeight - 12) top = Math.max(12, window.innerHeight - popH - 12);
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    } else {
      popover.style.left = '50%';
      popover.style.top = '50%';
      popover.style.transform = 'translate(-50%, -50%)';
    }
    popover.classList.add('show');
    popoverBackdrop.classList.add('show');
  }

  function hidePopover() {
    popover.classList.remove('show');
    popoverBackdrop.classList.remove('show');
    currentPopoverSn = null;
  }

  function refreshPopoverFavBtn() {
    if (!currentPopoverSn) return;
    const isFav = favorites.includes(currentPopoverSn);
    const btn = el('popoverFav');
    btn.classList.toggle('on', isFav);
    el('popoverFavLabel').textContent = isFav ? '즐겨찾기 해제' : '즐겨찾기';
  }

  el('popoverClose').addEventListener('click', hidePopover);
  popoverBackdrop.addEventListener('click', hidePopover);
  el('popoverFav').addEventListener('click', async () => {
    if (!currentPopoverSn) return;
    const newFavs = await SWM.toggleFavorite(currentPopoverSn);
    favorites = newFavs;
    refreshPopoverFavBtn();
    updateHeaderStats();
    runSearch();
  });

  function formatLongDate(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const [y, m, d] = s.split('-').map(Number);
    const wdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dt = new Date(y, m - 1, d);
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} (${wdays[dt.getDay()]})`;
  }

  // ─── 신청 / 취소 액션 ───

  function updateActionButtons(lec) {
    const applyBtn = el('popoverApply');
    const cancelBtn = el('popoverCancel');
    const today = fmtISO(new Date());
    const slotsOpen = (lec.count?.current ?? 0) < (lec.count?.max ?? 0);
    const isOpen = lec.status === 'A' && slotsOpen && !hasStarted(lec);
    const isCancellable = lec.applied && lec.lecDate && lec.lecDate > today;

    applyBtn.style.display = (!lec.applied && isOpen) ? 'inline-flex' : 'none';
    cancelBtn.style.display = isCancellable ? 'inline-flex' : 'none';
    cancelBtn.disabled = !lec.applySn;
    cancelBtn.title = lec.applySn ? '신청 취소' : '신청 번호 확인 중…';
    el('popoverCancelLabel').textContent = '신청 취소';
  }

  async function onApplyClick(lec) {
    if (!lec) return;
    const cleanTitle = (lec.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const loc = lec.location ? `\n장소: ${lec.location}` : '';
    const ok = confirm(
      `이 강연을 지금 신청합니다.\n\n` +
      `${cleanTitle}\n${lec.lecDate || ''} ${lec.lecTime || ''}${loc}\n\n진행할까요?`
    );
    if (!ok) return;

    const applyBtn = el('popoverApply');
    applyBtn.disabled = true;
    el('popoverApplyLabel').textContent = '신청 중…';
    const r = await sendToSwm({
      type: 'APPLY',
      sn: lec.sn,
      applyCnt: lec.count?.max ?? '',
      appCnt: lec.count?.current ?? 0,
    });
    applyBtn.disabled = false;
    el('popoverApplyLabel').textContent = '즉시 신청';

    if (r.noTab) return toast('swmaestro.ai 탭을 먼저 여세요', 'error');
    if (r.loginRequired) return toast('로그인 만료. 사이트에서 다시 로그인 필요', 'error');
    if (r.resultCode === 'success') {
      toast('신청 완료', 'success');
      await setLectureApplied(lec.sn, true);
    } else if (r.resultCode === 'error') {
      toast('이미 신청된 강연', 'warn');
      await setLectureApplied(lec.sn, true);
    } else {
      toast(`실패: ${r.msg || r.error || '알 수 없는 오류'}`, 'error');
    }
  }

  async function onCancelClick(lec) {
    if (!lec) return;
    if (!lec.applySn) return toast('신청 번호 로딩 중. 잠시 후 다시 시도', 'warn');
    const cleanTitle = (lec.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const ok = confirm(
      `이 강연의 신청을 취소합니다.\n\n` +
      `${cleanTitle}\n${lec.lecDate || ''} ${lec.lecTime || ''}\n\n진행할까요?`
    );
    if (!ok) return;

    const cancelBtn = el('popoverCancel');
    cancelBtn.disabled = true;
    el('popoverCancelLabel').textContent = '취소 중…';
    const r = await sendToSwm({ type: 'CANCEL_APPLY', sn: lec.sn, applySn: lec.applySn });
    cancelBtn.disabled = false;
    el('popoverCancelLabel').textContent = '신청 취소';

    if (r.noTab) return toast('swmaestro.ai 탭을 먼저 여세요', 'error');
    if (r.loginRequired) return toast('로그인 만료. 사이트에서 다시 로그인 필요', 'error');
    if (r.resultCode === 'success' && r.cancelAt === 'Y') {
      toast('취소 완료', 'success');
      await setLectureApplied(lec.sn, false);
    } else if (r.resultCode === 'success' && r.cancelAt === 'N') {
      toast('강의 날짜가 지나 취소 불가', 'warn');
    } else {
      toast(`실패: ${r.msg || r.error || '알 수 없는 오류'}`, 'error');
    }
  }

  async function setLectureApplied(sn, applied) {
    const all = await SWM.getLectures();
    if (!all[sn]) return;
    const next = { ...all[sn], applied };
    if (!applied) delete next.applySn;
    all[sn] = next;
    await chrome.storage.local.set({ lectures: all });
    // 현재 팝오버에 떠 있으면 버튼 상태 갱신 (위치 유지)
    if (currentPopoverSn === sn) updateActionButtons(next);
  }

  async function fetchApplySn(sn) {
    const r = await sendToSwm({ type: 'GET_APPLY_SN', sn });
    if (r?.applySn) {
      const all = await SWM.getLectures();
      if (all[sn]) {
        all[sn].applySn = r.applySn;
        await chrome.storage.local.set({ lectures: all });
      }
    }
  }

  async function sendToSwm(message) {
    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*'],
    });
    const tab = tabs[0];
    if (!tab) return { noTab: true };
    try {
      const r = await chrome.tabs.sendMessage(tab.id, message);
      return r || { error: 'no_response' };
    } catch (e) {
      return { noTab: true };
    }
  }

  function toast(text, level = 'success') {
    const t = el('popoverToast');
    t.textContent = text;
    t.className = 'popover-toast ' + level;
    t.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
  }

  // ─── 이벤트 ───
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 200);
  });
  [filterDateStart, filterDateEnd, filterStatus, filterCategory, filterLocation, onlyFreeSlot, thisWeekOnly]
    .forEach(i => i.addEventListener('change', runSearch));
  showFavsOnGrid.addEventListener('change', renderFavoriteBlocks);
  clearDateRange.addEventListener('click', () => {
    filterDateStart.value = '';
    filterDateEnd.value = '';
    runSearch();
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      runSearch();
    });
  });

  // 카드: 호버 프리뷰 + 클릭 팝오버 + 별 토글
  resultsDiv.addEventListener('mouseover', e => {
    const item = e.target.closest('.lecture-item');
    if (!item) return;
    const l = allLectures[item.dataset.sn];
    if (l) renderPreview(l);
  });
  resultsDiv.addEventListener('mouseleave', clearPreviewBlocks);
  resultsDiv.addEventListener('click', e => {
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      e.stopPropagation();
      SWM.toggleFavorite(favBtn.dataset.sn).then(newFavs => {
        favorites = newFavs;
        updateHeaderStats();
        runSearch();
      });
      return;
    }
    const item = e.target.closest('.lecture-item');
    if (item) {
      const l = allLectures[item.dataset.sn];
      if (l) showPopover(l, item);
    }
  });

  // ─── B-2: 드래그 셀렉트 ───
  let dragState = null; // {colEl, dateStr, startY, currentY, shift}

  function yToMin(y) {
    const raw = baseMin + (y / HOUR_PX) * 60;
    const snapped = Math.round(raw / SLOT_SNAP_MIN) * SLOT_SNAP_MIN;
    return Math.max(baseMin, Math.min(snapped, (END_HOUR + 1) * 60));
  }
  function minToY(min) {
    return Math.max(0, (min - baseMin) / 60) * HOUR_PX;
  }

  function addSlot(dateStr, startMin, endMin) {
    startMin = Math.max(baseMin, startMin);
    endMin = Math.min((END_HOUR + 1) * 60, endMin);
    if (startMin >= endMin) return;
    // 항상 기존 슬롯에 추가 (하루에 여러 바 허용)
    const existing = (selectedSlots.get(dateStr) || []).slice();
    existing.push({ startMin, endMin });
    existing.sort((a, b) => a.startMin - b.startMin);
    const merged = [];
    for (const s of existing) {
      if (merged.length && merged[merged.length - 1].endMin >= s.startMin) {
        merged[merged.length - 1].endMin = Math.max(merged[merged.length - 1].endMin, s.endMin);
      } else {
        merged.push({ ...s });
      }
    }
    selectedSlots.set(dateStr, merged);
  }

  function clearDragPreview() {
    gridBody.querySelectorAll('.drag-sel.drag-preview').forEach(e => e.remove());
  }
  function renderDragPreview() {
    clearDragPreview();
    if (!dragState) return;
    const startY = Math.min(dragState.startY, dragState.currentY);
    const endY = Math.max(dragState.startY, dragState.currentY);
    const block = document.createElement('div');
    block.className = 'drag-sel drag-preview';
    block.style.top = startY + 'px';
    block.style.height = (endY - startY) + 'px';
    dragState.colEl.appendChild(block);
  }

  function renderSlotBlocks() {
    gridBody.querySelectorAll('.drag-sel:not(.drag-preview)').forEach(e => e.remove());
    if (!advancedMode) return; // 상세검색 OFF 면 그리드에 블록 안 그림
    for (const [dateStr, slots] of selectedSlots) {
      const col = gridBody.querySelector(`.day-column[data-date="${dateStr}"]`);
      if (!col) continue;
      slots.forEach(s => {
        const b = document.createElement('div');
        b.className = 'drag-sel';
        b.dataset.date = dateStr;
        b.dataset.start = s.startMin;
        b.dataset.end = s.endMin;
        b.title = '우클릭으로 이 슬롯 제거';
        b.style.top = minToY(s.startMin) + 'px';
        b.style.height = (minToY(s.endMin) - minToY(s.startMin)) + 'px';
        col.appendChild(b);
      });
    }
  }

  // 우클릭으로 슬롯 제거
  gridBody.addEventListener('contextmenu', e => {
    const block = e.target.closest('.drag-sel:not(.drag-preview)');
    if (!block) return;
    e.preventDefault();
    const { date, start, end } = block.dataset;
    const arr = selectedSlots.get(date) || [];
    const next = arr.filter(s => !(s.startMin === +start && s.endMin === +end));
    if (next.length === 0) selectedSlots.delete(date);
    else selectedSlots.set(date, next);
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  function updateDayHeaderSelection() {
    const kids = Array.from(dayHeaders.children).slice(1);
    kids.forEach((k, i) => {
      const dateStr = fmtISO(addDays(weekStart, i));
      const active = advancedMode && selectedSlots.has(dateStr);
      k.classList.toggle('has-selection', active);
    });
  }

  const wdayShort = ['일', '월', '화', '수', '목', '금', '토'];
  function renderSlotBar() {
    const bar = el('slotBar');
    if (!advancedMode) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';
    const chips = [];
    const sortedDates = [...selectedSlots.keys()].sort();
    for (const dateStr of sortedDates) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const w = wdayShort[new Date(y, m - 1, d).getDay()];
      for (const s of selectedSlots.get(dateStr)) {
        const isFull = s.startMin === baseMin && s.endMin === (END_HOUR + 1) * 60;
        const label = isFull
          ? `${m}/${d}(${w}) 종일`
          : `${m}/${d}(${w}) ${minToHHMM(s.startMin)}~${minToHHMM(s.endMin)}`;
        chips.push(`<span class="slot-chip" data-date="${dateStr}" data-start="${s.startMin}" data-end="${s.endMin}">${label}<span class="x" title="제거">✕</span></span>`);
      }
    }
    el('slotChips').innerHTML = chips.join('');
  }

  // 드래그 이벤트 (상세검색 모드 ON 일 때만)
  gridBody.addEventListener('mousedown', e => {
    if (!advancedMode) return;
    const col = e.target.closest('.day-column');
    if (!col || e.target !== col) return;
    e.preventDefault();
    const rect = col.getBoundingClientRect();
    const y = e.clientY - rect.top;
    dragState = {
      colEl: col,
      dateStr: col.dataset.date,
      startY: y,
      currentY: y,
    };
    document.body.classList.add('dragging');
    renderDragPreview();
  });

  document.addEventListener('mousemove', e => {
    if (!dragState) return;
    const rect = dragState.colEl.getBoundingClientRect();
    dragState.currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    renderDragPreview();
  });

  document.addEventListener('mouseup', () => {
    if (!dragState) return;
    const startY = Math.min(dragState.startY, dragState.currentY);
    const endY = Math.max(dragState.startY, dragState.currentY);
    document.body.classList.remove('dragging');
    clearDragPreview();
    if (Math.abs(endY - startY) >= 4) {
      addSlot(dragState.dateStr, yToMin(startY), yToMin(endY));
      renderSlotBar();
      renderSlotBlocks();
      updateDayHeaderSelection();
      runSearch();
    }
    dragState = null;
  });

  // 요일 헤더 클릭 → 그 요일 전체 토글 (상세검색 모드 ON 일 때만)
  dayHeaders.addEventListener('click', e => {
    if (!advancedMode) return;
    const cell = e.target.closest('.day-headers > div');
    if (!cell) return;
    const kids = Array.from(dayHeaders.children);
    const idx = kids.indexOf(cell);
    if (idx <= 0) return;
    const dateStr = fmtISO(addDays(weekStart, idx - 1));
    const existing = selectedSlots.get(dateStr);
    const isFullDay = existing && existing.length === 1 &&
      existing[0].startMin === baseMin &&
      existing[0].endMin === (END_HOUR + 1) * 60;
    if (isFullDay) {
      selectedSlots.delete(dateStr);
    } else {
      selectedSlots.set(dateStr, [{ startMin: baseMin, endMin: (END_HOUR + 1) * 60 }]);
    }
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  // 칩 × 클릭으로 개별 해제
  el('slotChips').addEventListener('click', e => {
    const x = e.target.closest('.x');
    if (!x) return;
    const chip = x.closest('.slot-chip');
    const { date, start, end } = chip.dataset;
    const arr = selectedSlots.get(date) || [];
    const next = arr.filter(s => !(s.startMin === +start && s.endMin === +end));
    if (next.length === 0) selectedSlots.delete(date);
    else selectedSlots.set(date, next);
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  el('slotClearBtn').addEventListener('click', () => {
    selectedSlots.clear();
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  // 내 빈 시간 전체 선택 — 이번 주 7일 각각 [base~end] 에서 신청 강연 시간 차감
  function subtractIntervals(base, holes) {
    let result = base.slice();
    for (const h of holes) {
      const next = [];
      for (const r of result) {
        if (h.endMin <= r.startMin || h.startMin >= r.endMin) {
          next.push(r);
        } else if (h.startMin <= r.startMin && h.endMin >= r.endMin) {
          // 전체 잘림
        } else if (h.startMin > r.startMin && h.endMin < r.endMin) {
          next.push({ startMin: r.startMin, endMin: h.startMin });
          next.push({ startMin: h.endMin, endMin: r.endMin });
        } else if (h.startMin <= r.startMin) {
          next.push({ startMin: h.endMin, endMin: r.endMin });
        } else {
          next.push({ startMin: r.startMin, endMin: h.endMin });
        }
      }
      result = next.filter(r => r.startMin < r.endMin);
    }
    return result;
  }

  el('slotFreeBtn').addEventListener('click', () => {
    const FULL = { startMin: baseMin, endMin: (END_HOUR + 1) * 60 };
    for (let i = 0; i < 7; i++) {
      const dateStr = fmtISO(addDays(weekStart, i));
      const myBlocks = Object.values(allLectures)
        .filter(l => l.applied && l.lecDate === dateStr && l.lecTime)
        .map(l => parseTimeRange(l.lecTime))
        .filter(Boolean)
        .map(r => ({
          startMin: Math.max(baseMin, r.startMin),
          endMin: Math.min((END_HOUR + 1) * 60, r.endMin),
        }))
        .filter(r => r.startMin < r.endMin);
      const free = subtractIntervals([FULL], myBlocks);
      if (free.length > 0) selectedSlots.set(dateStr, free);
      else selectedSlots.delete(dateStr); // 하루 종일 신청이면 빈 시간 없음
    }
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  // 상세검색 토글
  el('advancedToggle').addEventListener('click', () => {
    advancedMode = !advancedMode;
    el('advancedToggle').classList.toggle('on', advancedMode);
    el('advancedToggle').textContent = advancedMode
      ? '상세검색 종료'
      : '상세검색 (시간대 선택)';
    renderSlotBar();
    renderSlotBlocks();
    updateDayHeaderSelection();
    runSearch();
  });

  // 주 네비
  function updateWeekLabel() {
    const end = addDays(weekStart, 6);
    weekLabel.textContent = `${fmtISO(weekStart).replace(/-/g, '.')} ~ ${fmtISO(end).replace(/-/g, '.')}`;
  }
  function rerenderAll() {
    renderGridSkeleton();
    renderFavoriteBlocks();
    renderAppliedBlocks();
    renderSlotBlocks();
    updateDayHeaderSelection();
    renderSlotBar();
    runSearch();
    updateWeekLabel();
    updateHeaderStats();
  }
  el('prevWeek').onclick = () => { weekStart = addDays(weekStart, -7); rerenderAll(); };
  el('nextWeek').onclick = () => { weekStart = addDays(weekStart, 7); rerenderAll(); };
  el('todayBtn').onclick = () => { weekStart = mondayOf(new Date()); rerenderAll(); };

  // 키보드
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { weekStart = addDays(weekStart, -7); rerenderAll(); }
    if (e.key === 'ArrowRight') { weekStart = addDays(weekStart, 7); rerenderAll(); }
    if (e.key === 't' || e.key === 'T') { weekStart = mondayOf(new Date()); rerenderAll(); }
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
    if (e.key === 'Escape') { hidePopover(); }
  });

  // ─── Cross-document storage 동기화 ───
  // popup 에서 ★ 토글하거나 sync 후 lectures 변경 시 자동 리프레시
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let needRender = false;
    if (changes.lectures) {
      allLectures = changes.lectures.newValue || {};
      needRender = true;
    }
    if (changes.favorites) {
      favorites = changes.favorites.newValue || [];
      needRender = true;
      refreshPopoverFavBtn();
    }
    if (needRender) {
      updateHeaderStats();
      renderFavoriteBlocks();
      renderAppliedBlocks();
      runSearch();
    }
  });

  // ─── 동기화 버튼 (팝업 로직 재사용) ───
  async function findSwmTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.url?.includes('swmaestro.ai')) return active;
    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*']
    });
    return tabs[0] || null;
  }

  async function triggerSync(button, statusFilter) {
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.textContent = '동기화 중...';
    const tab = await findSwmTab();
    console.log('[SWM] findSwmTab result:', tab ? { id: tab.id, url: tab.url, status: tab.status } : null);
    if (!tab) {
      button.textContent = 'swmaestro.ai 탭을 여세요';
      setTimeout(() => { button.innerHTML = originalHTML; button.disabled = false; }, 2500);
      return;
    }
    try {
      // 60초 timeout — content.js 응답 없으면 자동 실패 (무한 대기 방지)
      const timeoutMs = 180000; // 3분
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      if (response?.success) {
        button.textContent = `완료! ${response.count}개`;
        allLectures = await SWM.getLectures();
        favorites = await SWM.getFavorites();
        rerenderAll();
      } else {
        console.warn('[SWM timetable] sync fail:', response);
        button.textContent = response?.error ? '실패 (상세 콘솔)' : '실패 (로그인 확인)';
      }
    } catch (e) {
      console.error('[SWM timetable] sync error:', e);
      const msg = String(e.message || e);
      if (msg.includes('Could not establish connection') || msg.includes('Receiving end')) {
        button.textContent = 'swmaestro 탭 새로고침 필요';
      } else if (msg.includes('timeout')) {
        button.textContent = '시간 초과 (60초)';
      } else {
        button.textContent = '오류 발생';
      }
    }
    setTimeout(() => { button.innerHTML = originalHTML; button.disabled = false; }, 2500);
  }
  syncBtn.addEventListener('click', () => triggerSync(syncBtn, 'A'));
  syncAllBtn.addEventListener('click', () => triggerSync(syncAllBtn, ''));

  // sync 상태 라벨 업데이트 (content script가 보내는 중간 상태)
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'SYNC_STATUS') syncBtn.textContent = msg.status;
  });

  // ─── 유틸 ───
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    return dateStr;
  }

  // ─── 시작 ───
  allLectures = await SWM.getLectures();
  favorites = await SWM.getFavorites();
  rerenderAll();

})();
