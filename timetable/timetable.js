// SWM 시간표 뷰

(async function () {
  'use strict';

  // 그리드 시간 범위 (08:00 ~ 23:00)
  const START_HOUR = 8;
  const END_HOUR = 23;
  const HOUR_PX = 52;
  const baseMin = START_HOUR * 60;

  let allLectures = {};
  let favorites = [];
  let weekStart = mondayOf(new Date()); // 이번 주 월요일

  // DOM
  const el = id => document.getElementById(id);
  const searchInput = el('searchInput');
  const filterStatus = el('filterStatus');
  const filterCategory = el('filterCategory');
  const filterLocation = el('filterLocation');
  const onlyFreeSlot = el('onlyFreeSlot');
  const thisWeekOnly = el('thisWeekOnly');
  const searchResults = el('searchResults');
  const searchCount = el('searchCount');
  const undatedSection = el('undatedSection');
  const undatedList = el('undatedList');
  const headerStats = el('headerStats');
  const dayHeaders = el('dayHeaders');
  const gridBody = el('gridBody');
  const weekLabel = el('weekLabel');
  const previewInfo = el('hoverPreviewInfo');
  const popover = el('popover');

  // ─── 렌더링 ───

  function renderGridSkeleton() {
    // day headers: 빈 time-col + 7일
    dayHeaders.innerHTML = '<div></div>' + Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      const isToday = fmtISO(d) === fmtISO(new Date());
      const isWeekend = i >= 5;
      const cls = [isToday ? 'today' : '', isWeekend ? 'weekend' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}">${fmtDayHeader(d)}</div>`;
    }).join('');

    // grid body: time labels + 7개 day columns
    const labels = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      labels.push(`<div class="time-slot" style="height:${HOUR_PX}px">${String(h).padStart(2, '0')}:00</div>`);
    }
    gridBody.innerHTML = `<div class="time-labels" style="height:${(END_HOUR - START_HOUR + 1) * HOUR_PX}px">${labels.join('')}</div>` +
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const isToday = fmtISO(d) === fmtISO(new Date());
        return `<div class="day-column${isToday ? ' today' : ''}" data-date="${fmtISO(d)}" style="height:${(END_HOUR - START_HOUR + 1) * HOUR_PX}px"></div>`;
      }).join('');
  }

  // 날짜의 day-column 엘리먼트
  function dayColEl(dateStr) {
    return gridBody.querySelector(`.day-column[data-date="${dateStr}"]`);
  }

  // 시간대별 위치 계산
  function blockPos(range) {
    const top = Math.max(0, (range.startMin - baseMin) / 60) * HOUR_PX;
    const height = Math.max(20, (range.endMin - range.startMin) / 60 * HOUR_PX);
    return { top, height };
  }

  function appliedInWeek() {
    const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));
    return Object.values(allLectures).filter(l =>
      l.applied && l.lecDate && weekISO.includes(l.lecDate)
    );
  }

  function renderAppliedBlocks() {
    // 기존 applied 블록 제거
    gridBody.querySelectorAll('.lec-block.applied').forEach(e => e.remove());

    const applied = appliedInWeek();
    applied.forEach(l => {
      const range = parseTimeRange(l.lecTime);
      if (!range) return; // lecTime 없는 항목은 그리드 밖
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
        <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))} · ${escapeHtml(l.mentor || '')}</div>
      `;
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

  // 후보 강연 프리뷰 렌더 + 충돌 체크
  function renderPreview(candidate) {
    clearPreviewBlocks();
    const range = parseTimeRange(candidate.lecTime);
    if (!range || !candidate.lecDate) {
      previewInfo.textContent = '시간/날짜 정보 없음';
      return;
    }
    const col = dayColEl(candidate.lecDate);
    if (!col) {
      previewInfo.textContent = `다른 주 (${candidate.lecDate})`;
      return;
    }

    // 같은 날짜의 applied 와 충돌 체크
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
      <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))}</div>
    `;
    col.appendChild(block);

    // 충돌 블록 외곽선 강조
    conflicts.forEach(c => {
      const existing = col.querySelector(`.lec-block.applied[data-sn="${c.sn}"]`);
      if (existing) existing.classList.add('conflicting');
    });

    previewInfo.textContent = hasConflict
      ? `⚠ ${conflicts.length}건과 시간 겹침`
      : '✓ 겹치지 않음';
    previewInfo.className = 'preview-info ' + (hasConflict ? 'conflict' : 'free');
  }

  // ─── 검색/필터 ───

  function matchesSearch(l) {
    const q = searchInput.value.trim().toLowerCase();
    const status = filterStatus.value;
    const category = filterCategory.value;
    const location = filterLocation.value;

    if (q) {
      const searchable = [l.title, l.mentor, l.categoryNm, l.description, l.location]
        .filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    if (status && l.status !== status) return false;
    if (category && l.category !== category) return false;
    if (location === 'online' && l.isOnline !== true) return false;
    if (location === 'offline' && !(l.detailFetched && l.isOnline === false)) return false;
    return true;
  }

  function isFreeForMe(candidate) {
    const range = parseTimeRange(candidate.lecTime);
    if (!range || !candidate.lecDate) return true; // 시간 미정은 체크 불가, 통과
    const myBlocks = Object.values(allLectures)
      .filter(l => l.applied && l.lecDate === candidate.lecDate && l.lecTime && l.sn !== candidate.sn)
      .map(l => parseTimeRange(l.lecTime))
      .filter(Boolean);
    return myBlocks.every(b => !overlaps(b, range));
  }

  function runSearch() {
    const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));

    let list = Object.values(allLectures).filter(matchesSearch);

    if (thisWeekOnly.checked) {
      list = list.filter(l => l.lecDate && weekISO.includes(l.lecDate));
    }
    if (onlyFreeSlot.checked) {
      list = list.filter(isFreeForMe);
    }

    // 정렬: 날짜 + 시간 오름차순
    list.sort((a, b) => {
      const ak = a.lecDate ? `${a.lecDate} ${a.lecTime || ''}` : '\uffff';
      const bk = b.lecDate ? `${b.lecDate} ${b.lecTime || ''}` : '\uffff';
      return ak.localeCompare(bk);
    });

    renderSearchCards(list);
  }

  function renderSearchCards(list) {
    searchCount.textContent = `${list.length}건`;

    const dated = list.filter(l => l.lecDate && l.lecTime);
    const undated = list.filter(l => !(l.lecDate && l.lecTime));

    const render = l => {
      const isSpecial = l.category === 'MRC020';
      const catLabel = isSpecial ? '특강' : '멘토링';
      const catClass = isSpecial ? 'special' : 'free';
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const locLabel = l.detailFetched && l.location
        ? (l.isOnline ? '비대면' : '대면') + ' ' + l.location
        : '';
      const timeDisplay = l.lecTime ? l.lecTime.replace(/\s*~\s*/, '~') : '시간 미정';
      const dateDisplay = l.lecDate ? l.lecDate.slice(5).replace('-', '/') : '';
      const metaItems = [
        `<span class="cat ${catClass}">${catLabel}</span>`,
        dateDisplay && `<span class="date">${dateDisplay}</span>`,
        `<span>${escapeHtml(timeDisplay)}</span>`,
        l.mentor && `<span>${escapeHtml(l.mentor)}</span>`,
        locLabel && `<span>${escapeHtml(locLabel)}</span>`,
      ].filter(Boolean).join(' · ');
      return `<div class="search-card${l.applied ? ' applied' : ''}" data-sn="${l.sn}">
        <div class="title">${escapeHtml(title)}</div>
        <div class="meta">${metaItems}</div>
      </div>`;
    };

    searchResults.innerHTML = dated.length ? dated.map(render).join('') : '<div style="padding:20px;text-align:center;color:#aaa;font-size:12px">조건에 맞는 강연이 없습니다</div>';
    if (undated.length) {
      undatedSection.style.display = '';
      undatedList.innerHTML = undated.map(render).join('');
    } else {
      undatedSection.style.display = 'none';
    }
  }

  // 검색 카드 호버 → 프리뷰
  function bindCardEvents(container) {
    container.addEventListener('mouseover', e => {
      const card = e.target.closest('.search-card');
      if (!card) return;
      const l = allLectures[card.dataset.sn];
      if (l) renderPreview(l);
    });
    container.addEventListener('mouseleave', clearPreviewBlocks);
    container.addEventListener('click', e => {
      const card = e.target.closest('.search-card');
      if (!card) return;
      const l = allLectures[card.dataset.sn];
      if (l) showPopover(l);
    });
  }

  // ─── Popover ───

  function showPopover(lec, anchor) {
    el('popoverTitle').textContent = (lec.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const isSpecial = lec.category === 'MRC020';
    const metaBits = [
      isSpecial ? '특강' : '멘토링',
      lec.lecDate || '',
      lec.lecTime || '',
      lec.mentor || '',
      lec.count?.max ? `${lec.count.current ?? '?'}/${lec.count.max}명` : '',
      lec.detailFetched && lec.location
        ? (lec.isOnline ? '비대면 ' : '대면 ') + lec.location
        : '',
      lec.status === 'A' ? '접수중' : lec.status === 'C' ? '마감' : '',
      lec.applied ? '✓ 신청 완료' : '',
    ].filter(Boolean);
    el('popoverMeta').textContent = metaBits.join(' · ');
    el('popoverDesc').textContent = lec.description || '(설명 없음)';
    el('popoverOpen').onclick = () => {
      chrome.tabs.create({
        url: `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${lec.sn}&menuNo=200046`
      });
    };
    // 위치: anchor 근처 or 중앙
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      popover.style.top = Math.min(rect.top, window.innerHeight - 300) + 'px';
      popover.style.left = Math.min(rect.right + 10, window.innerWidth - 380) + 'px';
    } else {
      popover.style.top = '50%';
      popover.style.left = '50%';
      popover.style.transform = 'translate(-50%, -50%)';
    }
    popover.style.display = 'block';
  }
  el('popoverClose').onclick = () => { popover.style.display = 'none'; };
  document.addEventListener('click', e => {
    if (!popover.contains(e.target) && !e.target.closest('.lec-block') && !e.target.closest('.search-card')) {
      popover.style.display = 'none';
    }
  });

  // ─── 네비게이션 ───

  function updateWeekLabel() {
    const end = addDays(weekStart, 6);
    weekLabel.textContent = `${fmtISO(weekStart).replace(/-/g, '.')} ~ ${fmtISO(end).replace(/-/g, '.')}`;
  }

  function rerenderAll() {
    renderGridSkeleton();
    renderAppliedBlocks();
    runSearch();
    updateWeekLabel();
  }

  el('prevWeek').onclick = () => { weekStart = addDays(weekStart, -7); rerenderAll(); };
  el('nextWeek').onclick = () => { weekStart = addDays(weekStart, 7); rerenderAll(); };
  el('todayBtn').onclick = () => { weekStart = mondayOf(new Date()); rerenderAll(); };

  // ─── 키보드 단축키 ───
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { weekStart = addDays(weekStart, -7); rerenderAll(); }
    if (e.key === 'ArrowRight') { weekStart = addDays(weekStart, 7); rerenderAll(); }
    if (e.key === 't' || e.key === 'T') { weekStart = mondayOf(new Date()); rerenderAll(); }
    if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
    if (e.key === 'Escape') { popover.style.display = 'none'; }
  });

  // ─── 검색 debounce ───
  let searchTimer;
  [searchInput].forEach(i => i.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 150);
  }));
  [filterStatus, filterCategory, filterLocation, onlyFreeSlot, thisWeekOnly].forEach(i =>
    i.addEventListener('change', runSearch)
  );

  // ─── 유틸 ───
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ─── 시작 ───
  allLectures = await SWM.getLectures();
  favorites = await SWM.getFavorites();
  const meta = await SWM.getMeta();

  const openCount = Object.values(allLectures).filter(l => l.status === 'A').length;
  const appliedCount = Object.values(allLectures).filter(l => l.applied).length;
  headerStats.textContent = `접수중 ${openCount} · 즐겨찾기 ${favorites.length} · 내 신청 ${appliedCount}${meta.lastFullSync ? '' : ' · 동기화 필요'}`;

  rerenderAll();
  bindCardEvents(searchResults);
  bindCardEvents(undatedList);

})();
