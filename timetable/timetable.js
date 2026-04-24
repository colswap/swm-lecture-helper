// SWM 시간표 뷰 — 사이드바는 팝업과 동일한 검색/렌더 로직, 메인은 주간 그리드

(async function () {
  'use strict';

  // 그리드 시간 범위 (09:00 ~ 23:00) — SWM 실측: 9시 시작 강연 21건 확인 (엄격 파싱 기준)
  const START_HOUR = 9;
  const END_HOUR = 23;
  const HOUR_PX = 52;
  const baseMin = START_HOUR * 60;

  let allLectures = {};
  let favorites = [];
  let settings = {};
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
  const filterDerivedCat = el('filterDerivedCat');
  const onlyFreeSlot = el('onlyFreeSlot');
  const thisWeekOnly = el('thisWeekOnly');
  const showFavsOnGrid = el('showFavsOnGrid');
  const advancedSearchPanel = el('advancedSearchPanel');
  const mentorWatchPanel = el('mentorWatchPanel');
  const mentorSearch = el('mentorSearch');
  const mentorSuggestions = el('mentorSuggestions');
  const watchedMentorsEl = el('watchedMentors');
  const mwCountEl = el('mwCount');
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
  const versionBadge = el('versionBadge');
  if (versionBadge && chrome?.runtime?.getManifest) {
    versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // ─── Google Calendar template URL (OAuth 없이 사용자가 수동 저장) ───
  // https://calendar.google.com/calendar/render?action=TEMPLATE&text=&dates=&location=&details=
  // dates 는 UTC basic format (YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ).
  // Asia/Seoul = UTC+9 → 로컬 → UTC 변환.
  function buildGcalTemplateUrl(lec) {
    if (!lec.lecDate || !lec.lecTime) return null;
    const range = parseTimeRange(lec.lecTime);
    if (!range) return null;
    const [Y, M, D] = lec.lecDate.split('-').map(Number);
    // 로컬 (KST) → UTC. JS Date 는 로컬 타임존이라 new Date(Y, M-1, D, h, m) 가 KST.
    const startLocal = new Date(Y, M - 1, D, 0, 0, 0, 0);
    startLocal.setMinutes(startLocal.getMinutes() + range.startMin);
    const endLocal = new Date(Y, M - 1, D, 0, 0, 0, 0);
    endLocal.setMinutes(endLocal.getMinutes() + range.endMin);
    const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const title = (lec.title || '').replace(/^\[[^\]]+\]\s*/, ''); // "[멘토 특강] " prefix 제거
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${fmt(startLocal)}/${fmt(endLocal)}`,
    });
    if (lec.location) params.set('location', lec.location);
    const descLines = [];
    if (lec.mentor) descLines.push(`멘토: ${lec.mentor}`);
    if (lec.categoryNm) descLines.push(`분류: ${lec.categoryNm}`);
    descLines.push(`https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${lec.sn}&menuNo=200046`);
    params.set('details', descLines.join('\n'));
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  // ─── 헤더 통계 (팝업과 동일) ───
  function updateHeaderStats() {
    // 단일 pass — 두 번 filter 대신 loop 1회.
    let openCount = 0, appliedCount = 0;
    for (const sn in allLectures) {
      const l = allLectures[sn];
      if (l.status === 'A') openCount++;
      if (l.applied) appliedCount++;
    }
    headerStats.textContent = `접수중 ${openCount} · 즐겨찾기 ${favorites.length} · 내 신청 ${appliedCount}`;
  }

  // ─── Classifier 주입 / 필터 옵션 / 칩 토글 ───
  function injectDerivedCategories() {
    // 971 × 18 regex × storage 이벤트마다 재실행 방지 — lec._cv 버전 캐싱.
    if (window.SWM_CLASSIFY?.injectInto) {
      window.SWM_CLASSIFY.injectInto(allLectures);
    }
  }

  function rebuildCatFilterOptions() {
    if (!filterDerivedCat) return;
    const counter = new Map();
    const metaById = new Map();
    for (const l of Object.values(allLectures)) {
      if (!l.derivedChips) continue;
      for (const c of l.derivedChips) {
        counter.set(c.id, (counter.get(c.id) || 0) + 1);
        if (!metaById.has(c.id)) metaById.set(c.id, c);
      }
    }
    const prev = filterDerivedCat.value;
    const opts = [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, cnt]) => {
        const meta = metaById.get(id) || { emoji: '', label: id };
        return `<option value="${id}">${meta.emoji} ${escapeHtml(meta.label)} (${cnt})</option>`;
      });
    filterDerivedCat.innerHTML = `<option value="">전체 주제</option>${opts.join('')}`;
    if (prev && counter.has(prev)) filterDerivedCat.value = prev;
  }

  function applyChipVisibility() {
    // v1.14.1: 카드 칩은 항상 표시 (팝오버도 동일). 예전 showCatChips 플래그는 무시.
    document.body.classList.remove('hide-cat-chips');
  }

  // ─── 관심 멘토 (popup 에서 이관) ───
  function collectMentors() {
    const counter = new Map();
    for (const l of Object.values(allLectures)) {
      if (l.mentor) counter.set(l.mentor, (counter.get(l.mentor) || 0) + 1);
    }
    return counter;
  }

  function renderMentorWatch() {
    const watched = Array.isArray(settings.watchedMentors) ? settings.watchedMentors : [];
    if (mwCountEl) {
      mwCountEl.textContent = watched.length === 0 ? '' :
        (settings.notifyMentorMatch ? `🔔 ${watched.length}명` : `🔕 ${watched.length}명 (알림 꺼짐)`);
    }
    if (watchedMentorsEl) {
      watchedMentorsEl.innerHTML = watched.map(m => (
        `<li><span class="badge badge-secondary badge-removable">` +
        `<span>${escapeHtml(m)}</span>` +
        `<button type="button" class="badge-x mw-x" data-mentor="${escapeHtml(m)}" title="해제">×</button>` +
        `</span></li>`
      )).join('');
    }
    renderMentorSuggestions();
  }

  function renderMentorSuggestions() {
    if (!mentorSuggestions || !mentorSearch) return;
    const q = mentorSearch.value.trim().toLowerCase();
    if (!q) { mentorSuggestions.innerHTML = ''; return; }
    const watched = new Set(settings.watchedMentors || []);
    const counter = collectMentors();
    const scored = [];
    for (const [mentor, cnt] of counter) {
      if (watched.has(mentor)) continue;
      const mLow = mentor.toLowerCase();
      let hit = mLow.includes(q);
      if (!hit) {
        for (const l of Object.values(allLectures)) {
          if (l.mentor === mentor && (l.title || '').toLowerCase().includes(q)) { hit = true; break; }
        }
      }
      if (hit) scored.push([mentor, cnt]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, 8);
    if (top.length === 0) {
      mentorSuggestions.innerHTML = '<div class="mw-empty">일치하는 멘토 없음</div>';
      return;
    }
    mentorSuggestions.innerHTML = top.map(([mentor, cnt]) => (
      `<button type="button" class="mw-add" data-mentor="${escapeHtml(mentor)}">` +
      `<span>${escapeHtml(mentor)}</span><span class="mw-cnt">${cnt}건</span></button>`
    )).join('');
  }

  async function addWatchedMentor(mentor) {
    const list = Array.isArray(settings.watchedMentors) ? settings.watchedMentors.slice() : [];
    if (list.includes(mentor)) return;
    list.push(mentor);
    settings = { ...settings, watchedMentors: list, notifyMentorMatch: true };
    await SWM.saveSettings({ watchedMentors: list, notifyMentorMatch: true });
    if (mentorSearch) mentorSearch.value = '';
    renderMentorWatch();
  }

  async function removeWatchedMentor(mentor) {
    const list = (settings.watchedMentors || []).filter(m => m !== mentor);
    settings = { ...settings, watchedMentors: list };
    await SWM.saveSettings({ watchedMentors: list });
    renderMentorWatch();
  }

  // ─── 검색/필터 ───
  function runSearch() {
    const rawQuery = searchInput.value;
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
      // 내 신청 탭: 상태 필터 무시 (접수중이든 마감이든 전부 보임)
    }

    // 키워드 검색 (v1.15.0 — SWM_QUERY 파서, prefix-free 경로는 기존 substring 호환)
    let ast = null;
    if (window.SWM_QUERY && rawQuery && rawQuery.trim()) {
      try { ast = window.SWM_QUERY.parse(rawQuery); }
      catch (e) { console.warn('query parse fallback', e); ast = null; }
    }
    if (ast && !window.SWM_QUERY.isEmpty(ast)) {
      // v1.16.0: rank() with BM25 — timetable distributes results into time slots,
      // so the score order is not visible, but the unified path keeps both views
      // on a single API.
      const ranked = window.SWM_QUERY.rank(ast, lectures, { rank: true });
      lectures = ranked.map(r => r.lec);
    } else if (rawQuery && rawQuery.trim()) {
      const q = rawQuery.trim().toLowerCase();
      lectures = lectures.filter(l => {
        const searchable = [l.title, l.mentor, l.categoryNm, l.description, l.location]
          .filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }
    renderQueryChips(ast);

    // 날짜 범위 필터 (B-1): start~end 지정 시 해당 범위만. 둘 중 하나만 지정 시 open-ended.
    // r9-B-1 (Q1=B): status === 'A' (접수중만) 일 때만 "오늘 이후" 기본 필터 적용.
    // 마감 포함 (status==='') 이나 마감 (status==='C') 는 사용자가 과거도 보고 싶은 것.
    if (dateStart || dateEnd) {
      lectures = lectures.filter(l => {
        if (!l.lecDate) return false;
        if (dateStart && l.lecDate < dateStart) return false;
        if (dateEnd && l.lecDate > dateEnd) return false;
        return true;
      });
    } else if (currentTab === 'search' && !slotSearchActive && !thisWeekOnly.checked && status === 'A') {
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

    const derivedCat = filterDerivedCat ? filterDerivedCat.value : '';
    if (derivedCat) {
      lectures = lectures.filter(l => Array.isArray(l.derivedCategories) && l.derivedCategories.includes(derivedCat));
    }

    // 정렬
    if (currentTab === 'applied') {
      // 내 신청: 미래(가까운 것 먼저) → 과거(최근 것 먼저)
      const today = fmtISO(new Date());
      lectures.sort((a, b) => {
        const aF = (a.lecDate || '') >= today;
        const bF = (b.lecDate || '') >= today;
        if (aF !== bF) return aF ? -1 : 1;
        const ak = (a.lecDate || '') + (a.lecTime || '');
        const bk = (b.lecDate || '') + (b.lecTime || '');
        return aF ? ak.localeCompare(bk) : bk.localeCompare(ak);
      });
    } else {
      lectures.sort((a, b) => {
        const ak = a.lecDate ? `${a.lecDate} ${a.lecTime || ''}` : '\uffff';
        const bk = b.lecDate ? `${b.lecDate} ${b.lecTime || ''}` : '\uffff';
        const cmp = ak.localeCompare(bk);
        if (cmp !== 0) return cmp;
        return (parseInt(a.sn, 10) || 0) - (parseInt(b.sn, 10) || 0);
      });
    }

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
      if (l.lecTime) {
        metaBits.push(`<span>${escapeHtml(l.lecTime)}</span>`);
      } else if (l.lecDate) {
        metaBits.push('<span class="time-tbd">시간 미정</span>');
      }
      if (l.mentor || l.count?.max) {
        metaBits.push('<span class="sep">·</span>');
        if (l.mentor) metaBits.push(`<span>${escapeHtml(l.mentor)}</span>`);
        if (l.mentor && l.count?.max) metaBits.push('<span class="sep">·</span>');
        if (l.count?.max) metaBits.push(`<span class="count">${escapeHtml(l.count.current ?? '?')}/${escapeHtml(l.count.max)}명</span>`);
      }
      metaBits.push('<span class="spacer"></span>');
      if (l.applied) {
        metaBits.push('<span class="applied-badge">신청</span>');
      } else {
        metaBits.push(`<button class="fav-btn ${isFav ? 'on' : ''}" data-sn="${l.sn}" title="즐겨찾기">${isFav ? starFilled : starEmpty}</button>`);
      }

      const tags = [];
      if (l.location) {
        const locClass = l.isOnline ? 'online' : 'offline';
        const locLabel = l.isOnline ? '비대면' : '대면';
        tags.push(`<span class="tag ${locClass}">${locLabel} ${escapeHtml(cleanLocation(l.location))}</span>`);
      }
      if (l.status === 'A') tags.push('<span class="tag open">접수중</span>');
      else if (l.status === 'C') tags.push('<span class="tag closed">마감</span>');
      if (l.isApproved === true) tags.push('<span class="tag approved">✅ 개설 확정</span>');
      else if (l.isApproved === false) tags.push('<span class="tag pending">⏳ 미승인</span>');

      const chips = Array.isArray(l.derivedChips) && l.derivedChips.length
        ? `<div class="cat-chips">${l.derivedChips.map(c =>
            `<span class="badge" data-cat="${escapeHtml(c.id)}" title="${escapeHtml(c.label)}">${c.emoji} ${escapeHtml(c.label)}</span>`
          ).join('')}</div>`
        : '';

      const itemClass = `lecture-item${l.applied ? ' applied' : ''}`;
      const ariaLabel = `${displayTitle}${l.lecDate ? ', ' + l.lecDate : ''}${l.lecTime ? ' ' + l.lecTime : ''} — 상세 팝오버 열기`;
      return `
        <div class="${itemClass}" data-sn="${l.sn}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}" ${l.applied ? 'title="신청한 강연"' : ''}>
          <div class="meta-line">${metaBits.join('')}</div>
          <div class="title-line">${escapeHtml(displayTitle)}</div>
          ${chips}
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

  // v1.16.1 §B2: blockPos defense-in-depth.
  // a3 감사 (v1161_a3_render_safety.md) 에서 "00:00~16:00" lecTime 이 그리드(780px)
  // 바깥으로 52~208px overflow 되는 것을 확인. parser 가 허용해도 여기서 다시 clamp.
  // null 반환 시 호출자는 render skip.
  function blockPos(range) {
    const colHeight = (END_HOUR - START_HOUR + 1) * HOUR_PX; // 780
    const MIN_BLOCK = 20;

    // G1: range null/undefined 방어 (호출부가 항상 가드하지만 future caller 대응).
    // G2: startMin/endMin NaN/Infinity 체크 — storage corruption 시 silent fail 방지.
    if (!range || !Number.isFinite(range.startMin) || !Number.isFinite(range.endMin)) {
      console.warn('[timetable] blockPos: invalid range', range);
      return null;
    }
    // endMin <= startMin → parser 가 이미 +24h 처리하므로 여기서는 0/음수 방어만.
    if (range.endMin <= range.startMin) {
      console.warn('[timetable] blockPos: endMin <= startMin', range);
      return null;
    }
    // G6: duration 너무 길 때도 skip 하지 않고 **시각적으로 clamp** — stale 데이터 블록도
    // 사용자 시야에 보여야 "재동기화 필요" 판단 가능. "00:00~16:00" 같은 legacy 는 콘솔 경고만.
    const duration = range.endMin - range.startMin;
    if (duration > 14 * 60) {
      console.warn('[timetable] blockPos: duration > 14h — 시각 clamp 로 표시', range);
    }

    const top = Math.max(0, (range.startMin - baseMin) / 60) * HOUR_PX;
    // G3: top 상한 — 그리드 밖 렌더 차단 (S5 "25:00~28:00" 재현 방지).
    if (top >= colHeight) {
      console.warn('[timetable] blockPos: top >= colHeight', { top, colHeight });
      return null;
    }
    // G4: height 상한 clamp — 그리드 바깥으로 삐져나가지 않도록 (S1 "00:00~16:00").
    const rawHeight = (range.endMin - range.startMin) / 60 * HOUR_PX;
    const height = Math.max(MIN_BLOCK, Math.min(rawHeight, colHeight - top));
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
      const pos = blockPos(range);
      if (!pos) return; // v1.16.1 §B2: 렌더 가드 — overflow/invalid range skip
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const block = document.createElement('div');
      block.className = 'lec-block favorite';
      block.dataset.sn = l.sn;
      if (!l.derivedCategories?.length && window.SWM_CLASSIFY?.injectInto) {
        window.SWM_CLASSIFY.injectInto({ [l.sn]: l });
      }
      if (l.derivedCategories?.[0]) block.dataset.cat = l.derivedCategories[0];
      block.style.top = pos.top + 'px';
      block.style.height = pos.height + 'px';
      block.innerHTML = `
        <button type="button" class="fav-unstar" data-sn="${escapeHtml(l.sn)}" title="즐겨찾기에서 제거" aria-label="즐겨찾기에서 제거">★</button>
        <div class="bt">${escapeHtml(title)}</div>
        <div class="bl">${escapeHtml(minToHHMM(range.startMin))}~${escapeHtml(minToHHMM(range.endMin))}${l.mentor ? ' · ' + escapeHtml(l.mentor) : ''}</div>`;
      block.addEventListener('click', e => {
        const target = e.target;
        if (target && target.classList && target.classList.contains('fav-unstar')) {
          e.stopPropagation();
          SWM.toggleFavorite(l.sn).then(() => renderFavoriteBlocks()).catch(() => {});
          return;
        }
        e.stopPropagation();
        showPopover(l, block);
      });
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
      const pos = blockPos(range);
      if (!pos) return; // v1.16.1 §B2: 렌더 가드 — overflow/invalid range skip
      const isSpecial = l.category === 'MRC020';
      const title = (l.title || '').replace(/^\[[^\]]+\]\s*/, '');
      const block = document.createElement('div');
      block.className = `lec-block applied ${isSpecial ? 'special' : 'free'}`;
      block.dataset.sn = l.sn;
      // 안전망: storage.onChanged race / classifier injection 누락 시 즉석 분류.
      // injectInto 는 _cv 캐시로 idempotent — 재호출 비용 없음.
      if (!l.derivedCategories?.length && window.SWM_CLASSIFY?.injectInto) {
        window.SWM_CLASSIFY.injectInto({ [l.sn]: l });
      }
      if (l.derivedCategories?.[0]) block.dataset.cat = l.derivedCategories[0];
      block.style.top = pos.top + 'px';
      block.style.height = pos.height + 'px';
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
    const pos = blockPos(range);
    if (!pos) {
      // v1.16.1 §B2: invalid range (overflow / NaN) → 텍스트 안내 후 블록 미생성
      previewInfo.textContent = '시간 범위가 유효하지 않음';
      previewInfo.className = 'preview-info';
      return;
    }
    const title = (candidate.title || '').replace(/^\[[^\]]+\]\s*/, '');
    const block = document.createElement('div');
    block.className = `lec-block preview${hasConflict ? ' conflict' : ''}`;
    block.style.top = pos.top + 'px';
    block.style.height = pos.height + 'px';
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
      if (lec.count?.max) parts.push(`${escapeHtml(lec.count.current ?? '?')}/${escapeHtml(lec.count.max)}명`);
      rows.push(`<div class="meta-row">${svgIcon(ICON.user)}<span>${parts.join(' · ')}</span></div>`);
    }
    if (lec.detailFetched && lec.location) {
      rows.push(`<div class="meta-row">${svgIcon(ICON.pin)}<span>${lec.isOnline ? '비대면' : '대면'} · ${escapeHtml(cleanLocation(lec.location))}</span></div>`);
    }
    const badges = [];
    if (lec.status === 'A') badges.push('<span class="tag open">접수중</span>');
    else if (lec.status === 'C') badges.push('<span class="tag closed">마감</span>');
    if (lec.applied) badges.push('<span class="applied-badge">신청 완료</span>');
    // 개설 승인 여부 — 상세 페이지에서 수집된 경우만 표시
    if (lec.isApproved === true) badges.push('<span class="tag approved">✅ 개설 확정</span>');
    else if (lec.isApproved === false) badges.push('<span class="tag pending">⏳ 미승인</span>');
    if (badges.length) rows.push(`<div class="meta-row"><div class="badges">${badges.join('')}</div></div>`);
    // N4: 팝오버는 카테고리 칩을 항상 표시 (전역 플래그 무시)
    if (Array.isArray(lec.derivedChips) && lec.derivedChips.length) {
      const chipHtml = lec.derivedChips.map(c =>
        `<span class="badge" data-cat="${escapeHtml(c.id)}" title="${escapeHtml(c.label)}">${c.emoji} ${escapeHtml(c.label)}</span>`
      ).join(' ');
      rows.push(`<div class="meta-row"><div class="cat-chips popover-cat-chips">${chipHtml}</div></div>`);
    }
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
        url: `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${encodeURIComponent(lec.sn)}&menuNo=200046`
      });
    };

    // Google Calendar template URL (OAuth 불필요 — 새 탭으로 Gcal 웹 이벤트 생성 UI 엶)
    // 마커를 gcalPushedSns 에 기록 → bulk push 시 이미 추가된 것 제외.
    el('popoverGcal').onclick = async () => {
      const url = buildGcalTemplateUrl(lec);
      if (!url) { toast('시간 정보 없음 — 상세 페이지 먼저 조회', 'warn'); return; }
      chrome.tabs.create({ url });
      try {
        const { gcalPushedSns = [] } = await chrome.storage.local.get('gcalPushedSns');
        if (!gcalPushedSns.includes(lec.sn)) {
          await chrome.storage.local.set({ gcalPushedSns: [...gcalPushedSns, lec.sn] });
        }
      } catch {}
    };

    updateActionButtons(lec);
    el('popoverApply').onclick = () => onApplyClick(lec);
    el('popoverCancel').onclick = () => onCancelClick(lec);
    // applied 인데 applySn 모르면 백그라운드 스크래핑
    if (lec.applied && !lec.applySn) fetchApplySn(lec.sn);

    // 위치: 먼저 보여서 실제 크기 측정 후 viewport 안에 clamp
    popover.style.left = '-9999px';
    popover.style.top = '0';
    popover.style.transform = '';
    popover.classList.add('show');
    popoverBackdrop.classList.add('show');

    const popRect = popover.getBoundingClientRect();
    const popW = popRect.width;
    const popH = popRect.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;

    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      // 우측에 공간 있으면 우측, 없으면 좌측
      let left = rect.right + 10;
      if (left + popW > vw - pad) left = Math.max(pad, rect.left - popW - 10);
      // 세로: anchor 상단 기준, 넘치면 위로 조정
      let top = rect.top;
      if (top + popH > vh - pad) top = vh - popH - pad;
      if (top < pad) top = pad;
      // 가로도 최종 clamp
      left = Math.max(pad, Math.min(left, vw - popW - pad));
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    } else {
      // anchor 없으면 화면 중앙
      popover.style.left = Math.max(pad, (vw - popW) / 2) + 'px';
      popover.style.top = Math.max(pad, (vh - popH) / 2) + 'px';
    }
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

    // 시간 충돌 검사 (F3)
    let conflictMsg = '';
    const lecRange = parseTimeRange(lec.lecTime);
    if (lec.lecDate && lecRange) {
      const conflicts = Object.values(allLectures).filter(l =>
        l.applied && l.lecDate === lec.lecDate && l.sn !== lec.sn && l.lecTime
      ).filter(l => {
        const r = parseTimeRange(l.lecTime);
        return r && overlaps(lecRange, r);
      });
      if (conflicts.length > 0) {
        const names = conflicts.map(c => {
          const t = (c.title || '').replace(/^\[[^\]]+\]\s*/, '');
          const shown = t.length > 30 ? t.slice(0, 30) + '…' : t;
          return `  - ${c.lecTime} ${shown}`;
        }).join('\n');
        conflictMsg = `\n\n⚠️ 시간 충돌!\n같은 날 신청한 강연과 겹칩니다:\n${names}`;

        // 대안 제안: 같은 카테고리의 다른 시간대 강연 3개 (F3 P0)
        const myCats = new Set(Array.isArray(lec.derivedCategories) ? lec.derivedCategories : []);
        const weekISO = Array.from({ length: 7 }, (_, i) => fmtISO(addDays(weekStart, i)));
        const today = fmtISO(new Date());
        const alternatives = Object.values(allLectures).filter(cand => {
          if (cand.sn === lec.sn) return false;
          if (cand.applied) return false;
          if (cand.status !== 'A') return false;
          if (!cand.lecDate || cand.lecDate < today) return false;
          if (!weekISO.includes(cand.lecDate)) return false;
          if (!cand.lecTime) return false;
          // 같은 카테고리 겹침
          const cats = Array.isArray(cand.derivedCategories) ? cand.derivedCategories : [];
          if (!cats.some(c => myCats.has(c))) return false;
          // 내 기존 신청과 겹치면 제외
          const cr = parseTimeRange(cand.lecTime);
          if (!cr) return false;
          const myBlocks = Object.values(allLectures)
            .filter(l => l.applied && l.lecDate === cand.lecDate && l.lecTime && l.sn !== cand.sn)
            .map(l => parseTimeRange(l.lecTime)).filter(Boolean);
          return myBlocks.every(b => !overlaps(b, cr));
        }).sort((a, b) => (a.lecDate + a.lecTime).localeCompare(b.lecDate + b.lecTime)).slice(0, 3);

        if (alternatives.length > 0) {
          const altLines = alternatives.map(a => {
            const t = (a.title || '').replace(/^\[[^\]]+\]\s*/, '');
            const shown = t.length > 28 ? t.slice(0, 28) + '…' : t;
            return `  - ${a.lecDate} ${a.lecTime} ${shown}`;
          }).join('\n');
          conflictMsg += `\n\n💡 대안 (같은 주제, 겹치지 않는 시간):\n${altLines}\n더 보려면 시간표에서 주제 필터 사용`;
        }
      }
    }

    const hoursLeft = hoursUntilStart(lec);
    const applyCutoffWarn = (Number.isFinite(hoursLeft) && hoursLeft > 0 && hoursLeft < 24)
      ? '⚠️ 시작까지 24시간 이내입니다. 신청 후 시스템 취소가 거부될 수 있어요.\n\n'
      : '';

    const ok = await window.SWMModal.showConfirm({
      title: '강연 신청',
      body: `${applyCutoffWarn}이 강연을 지금 신청합니다.\n\n` +
        `${cleanTitle}\n${lec.lecDate || ''} ${lec.lecTime || ''}${loc}${conflictMsg}\n\n진행할까요?`,
      confirmLabel: '신청',
      cancelLabel: '취소',
    });
    if (!ok) return;

    const applyBtn = el('popoverApply');
    applyBtn.disabled = true;
    el('popoverApplyLabel').textContent = '신청 중…';

    // Optimistic UI: API 응답 전 UI 먼저 applied=true 반영, 실패 시 롤백.
    // 체감 latency ~600ms → ~0ms.
    const prev = allLectures[lec.sn] ? { ...allLectures[lec.sn] } : null;
    if (allLectures[lec.sn]) {
      allLectures[lec.sn] = { ...allLectures[lec.sn], applied: true };
      lec.applied = true;
      updateActionButtons(allLectures[lec.sn]);
      renderAppliedBlocks();
      updateHeaderStats();
      runSearch();
    }

    const r = await sendToSwm({
      type: 'APPLY',
      sn: lec.sn,
      applyCnt: lec.count?.max ?? '',
      appCnt: lec.count?.current ?? 0,
    });
    applyBtn.disabled = false;
    el('popoverApplyLabel').textContent = '즉시 신청';

    const isSuccess = r.resultCode === 'success';
    const isAlreadyApplied = r.resultCode === 'error' && /이미\s*신청/.test(r.msg || '');
    const shouldRollback = !isSuccess && !isAlreadyApplied;

    if (shouldRollback && prev && allLectures[lec.sn]) {
      // 롤백
      allLectures[lec.sn] = prev;
      lec.applied = prev.applied || false;
      updateActionButtons(allLectures[lec.sn]);
      renderAppliedBlocks();
      updateHeaderStats();
      runSearch();
    }

    if (r.noTab) return toast('swmaestro.ai 탭을 먼저 여세요', 'error');
    if (r.loginRequired) return toast('로그인 만료. 사이트에서 다시 로그인 필요', 'error');
    if (isSuccess) {
      toast('신청 완료', 'success');
      await setLectureApplied(lec.sn, true);
    } else if (isAlreadyApplied) {
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
    const hoursLeft = hoursUntilStart(lec);
    const cutoffWarn = (Number.isFinite(hoursLeft) && hoursLeft > 0 && hoursLeft < 24)
      ? '⚠️ SWM 정책상 시작 24시간 이내 강연은 시스템 취소가 거부됩니다.\n취소가 꼭 필요하면 멘토에게 직접 연락해주세요.\n\n'
      : '';
    const ok = await window.SWMModal.showConfirm({
      title: '신청 취소',
      body: `${cutoffWarn}이 강연의 신청을 취소합니다.\n\n` +
        `${cleanTitle}\n${lec.lecDate || ''} ${lec.lecTime || ''}\n\n진행할까요?`,
      confirmLabel: '취소하기',
      cancelLabel: '닫기',
      danger: true,
    });
    if (!ok) return;

    const cancelBtn = el('popoverCancel');
    cancelBtn.disabled = true;
    el('popoverCancelLabel').textContent = '취소 중…';

    // Optimistic UI: applied=false 선반영, cancelAt!=Y 또는 에러 시 롤백.
    const prev = allLectures[lec.sn] ? { ...allLectures[lec.sn] } : null;
    if (allLectures[lec.sn]) {
      const next = { ...allLectures[lec.sn], applied: false };
      delete next.applySn;
      allLectures[lec.sn] = next;
      lec.applied = false;
      updateActionButtons(allLectures[lec.sn]);
      renderAppliedBlocks();
      updateHeaderStats();
      runSearch();
    }

    const r = await sendToSwm({ type: 'CANCEL_APPLY', sn: lec.sn, applySn: lec.applySn });
    cancelBtn.disabled = false;
    el('popoverCancelLabel').textContent = '신청 취소';

    const isCanceled = r.resultCode === 'success' && r.cancelAt === 'Y';
    const shouldRollback = !isCanceled; // cancelAt==='N' (취소 불가) + 에러 전부 롤백

    if (shouldRollback && prev && allLectures[lec.sn]) {
      allLectures[lec.sn] = prev;
      lec.applied = prev.applied || false;
      updateActionButtons(allLectures[lec.sn]);
      renderAppliedBlocks();
      updateHeaderStats();
      runSearch();
    }

    if (r.noTab) return toast('swmaestro.ai 탭을 먼저 여세요', 'error');
    if (r.loginRequired) return toast('로그인 만료. 사이트에서 다시 로그인 필요', 'error');
    if (isCanceled) {
      toast('취소 완료', 'success');
      await setLectureApplied(lec.sn, false);
    } else if (r.resultCode === 'success' && r.cancelAt === 'N') {
      toast('취소 불가 (시작 24시간 이내 또는 지난 강연)', 'warn');
    } else {
      toast(`실패: ${r.msg || r.error || '알 수 없는 오류'}`, 'error');
    }
  }

  async function setLectureApplied(sn, applied) {
    // in-memory allLectures 는 UI 즉시 반영용. 저장은 SWM.saveLecture 의 fresh-read+merge
    // + _saveQueue 로 위임 — content.js 의 fullSync 와 병렬 실행돼도 lec 유실 없음.
    if (!allLectures[sn]) return;
    const next = { ...allLectures[sn], applied };
    if (!applied) delete next.applySn;
    allLectures[sn] = next;
    const patch = applied ? { applied: true } : { applied: false, applySn: null };
    await SWM.saveLecture(sn, patch);
    if (currentPopoverSn === sn) updateActionButtons(next);
  }

  async function fetchApplySn(sn) {
    const r = await sendToSwm({ type: 'GET_APPLY_SN', sn });
    if (r?.applySn && allLectures[sn]) {
      allLectures[sn].applySn = r.applySn;
      await SWM.saveLecture(sn, { applySn: r.applySn });
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

  function toast(text, level = 'success', opts) {
    const t = el('popoverToast');
    const textEl = document.getElementById('popoverToastText') || t;
    const closeEl = document.getElementById('popoverToastClose');
    textEl.textContent = text;
    t.className = 'popover-toast ' + level;
    t.style.display = 'flex';
    if (closeEl && !closeEl._bound) {
      closeEl.addEventListener('click', () => { t.style.display = 'none'; });
      closeEl._bound = true;
    }
    clearTimeout(toast._timer);
    const ms = (opts && typeof opts.duration === 'number') ? opts.duration : 10000;
    if (ms > 0) {
      toast._timer = setTimeout(() => { t.style.display = 'none'; }, ms);
    }
  }

  // lib/storage.js 의 safeSet 이 quota/write 실패를 감지했을 때 호출되는 훅.
  window.SWM_showStorageError = (msg) => toast(msg, 'error', { duration: 15000 });

  // ─── 쿼리 chip 렌더 (v1.15.0 NLS v2 — 자연어 라벨) ───
  const DERIVED_CHIP_LABEL = {
    ai: '🤖 AI/LLM', backend: '⚙️ 백엔드', frontend: '🎨 프론트', mobile: '📱 모바일',
    data: '📊 데이터', cloud: '☁️ 클라우드', devops: '🔧 DevOps', security: '🔒 보안',
    game: '🎮 게임', blockchain: '⛓️ 블록체인', os: '💻 OS', pm: '📋 기획',
    startup: '🚀 창업', career: '💼 커리어', cs: '🧮 CS', idea: '💡 아이디어',
    team: '🤝 팀', soma: '🌱 소마',
  };
  function minToTimeLabel(m) {
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}시`;
  }
  function formatDateChipTT(from, to) {
    if (!from && !to) return '';
    if (from && to && from === to) {
      const today = fmtISO(new Date());
      const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
      const d2 = new Date(); d2.setDate(d2.getDate() + 2);
      if (from === today) return '📅 오늘';
      if (from === fmtISO(tmr)) return '📅 내일';
      if (from === fmtISO(d2)) return '📅 모레';
      return '📅 ' + from.slice(5).replace('-', '/');
    }
    const f = from ? from.slice(5).replace('-', '/') : '';
    const t = to ? to.slice(5).replace('-', '/') : '';
    return `📅 ${f}${(f && t) || t ? '~' : ''}${t}`;
  }
  function formatTimeChipTT(from, to) {
    if (from === 0 && to === 12 * 60) return '🕐 오전';
    if (from === 12 * 60 && to === 24 * 60) return '🕐 오후';
    if (from === 18 * 60 && to === 24 * 60) return '🕐 저녁';
    const f = from !== null ? minToTimeLabel(from) : '';
    const t = to !== null ? minToTimeLabel(to) : '';
    if (f && !t) return `🕐 ${f} 이후`;
    if (!f && t) return `🕐 ${t} 이전`;
    return `🕐 ${f}~${t}`;
  }
  function renderQueryChips(ast) {
    const el = document.getElementById('queryChips');
    if (!el) return;
    const chips = [];
    if (ast) {
      const inc = ast.include || {};
      for (const m of inc.mentor || []) chips.push(qChipHtml('mentor', m, `${m} (멘토)`));
      for (const c of inc.category || []) {
        const label = c === 'MRC020' ? '🎤 특강' : (c === 'MRC010' ? '💬 멘토링' : c);
        chips.push(qChipHtml('category', c, label));
      }
      for (const d of inc.derivedCat || []) {
        chips.push(qChipHtml('derivedCat', d, DERIVED_CHIP_LABEL[d] || '#' + d));
      }
      for (const n of inc.categoryNm || []) chips.push(qChipHtml('categoryNm', n, '#' + n));
      if (inc.location && inc.location.online !== null) {
        const online = inc.location.online;
        chips.push(qChipHtml('location', online ? 'online' : 'offline', online ? '🌐 비대면' : '📍 대면'));
      }
      if (inc.status === 'A') chips.push(qChipHtml('status', 'A', '🟢 접수중'));
      else if (inc.status === 'C') chips.push(qChipHtml('status', 'C', '⚫ 마감'));
      if (inc.dateFrom || inc.dateTo) {
        chips.push(qChipHtml('date', 'range', formatDateChipTT(inc.dateFrom, inc.dateTo)));
      }
      if (inc.timeFromMin !== null || inc.timeToMin !== null) {
        chips.push(qChipHtml('time', 'range', formatTimeChipTT(inc.timeFromMin, inc.timeToMin)));
      }
      for (const e of ast.exclude || []) chips.push(qChipHtml('exclude', e, '제외: ' + e));
    }
    el.innerHTML = chips.join('');
  }
  function qChipHtml(type, val, label) {
    return `<span class="query-chip" data-type="${escapeHtml(type)}" data-val="${escapeHtml(val)}" role="listitem"><span class="qc-label">${escapeHtml(label)}</span><button class="qc-x" aria-label="토큰 제거" type="button">×</button></span>`;
  }
  function removeQueryToken(type, val) {
    if (!window.SWM_QUERY) return;
    const ast = window.SWM_QUERY.parse(searchInput.value);
    if (type === 'mentor') ast.include.mentor = (ast.include.mentor || []).filter(x => x !== val);
    else if (type === 'category') ast.include.category = (ast.include.category || []).filter(x => x !== val);
    else if (type === 'derivedCat') ast.include.derivedCat = (ast.include.derivedCat || []).filter(x => x !== val);
    else if (type === 'categoryNm') ast.include.categoryNm = (ast.include.categoryNm || []).filter(x => x !== val);
    else if (type === 'location') ast.include.location.online = null;
    else if (type === 'status') ast.include.status = null;
    else if (type === 'date') { ast.include.dateFrom = null; ast.include.dateTo = null; }
    else if (type === 'time') { ast.include.timeFromMin = null; ast.include.timeToMin = null; }
    else if (type === 'exclude') ast.exclude = (ast.exclude || []).filter(x => x !== val);
    searchInput.value = window.SWM_QUERY.stringify(ast);
    runSearch();
  }

  // ─── 이벤트 ───
  let searchTimer;
  const fireSearch = () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); };
  searchInput.addEventListener('input', (e) => { if (e.isComposing) return; fireSearch(); });
  // compositionend 한글 조합 종료 시 — 마지막 글자까지 즉시 검색 대상으로 포함
  let lastCompositionEnd = 0;
  searchInput.addEventListener('compositionend', () => { lastCompositionEnd = Date.now(); fireSearch(); });
  // Enter — IME 조합 무시, 즉시 검색 실행
  searchInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (Date.now() - lastCompositionEnd < 50) return;
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); runSearch(); }
  });
  const queryChipsEl = document.getElementById('queryChips');
  if (queryChipsEl) {
    queryChipsEl.addEventListener('click', e => {
      const x = e.target.closest('.qc-x');
      if (!x) return;
      const chip = x.closest('.query-chip');
      if (!chip) return;
      removeQueryToken(chip.dataset.type, chip.dataset.val);
    });
  }
  const queryHelpBtn = document.getElementById('queryHelp');
  const queryHelpPop = document.getElementById('queryHelpPopover');
  if (queryHelpBtn && queryHelpPop) {
    queryHelpBtn.addEventListener('click', e => {
      e.stopPropagation();
      queryHelpPop.hidden = !queryHelpPop.hidden;
      queryHelpBtn.setAttribute('aria-expanded', String(!queryHelpPop.hidden));
    });
    document.addEventListener('click', e => {
      if (!queryHelpPop.hidden && !queryHelpPop.contains(e.target) && e.target !== queryHelpBtn) {
        queryHelpPop.hidden = true;
        queryHelpBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !queryHelpPop.hidden) {
        queryHelpPop.hidden = true;
        queryHelpBtn.setAttribute('aria-expanded', 'false');
        queryHelpBtn.focus();
      }
    });
  }
  [filterDateStart, filterDateEnd, filterStatus, filterCategory, filterLocation, onlyFreeSlot, thisWeekOnly]
    .forEach(i => i.addEventListener('change', runSearch));
  if (filterDerivedCat) filterDerivedCat.addEventListener('change', runSearch);
  if (advancedSearchPanel) {
    advancedSearchPanel.addEventListener('toggle', async () => {
      settings = { ...settings, advancedSearchOpen: advancedSearchPanel.open };
      await SWM.saveSettings({ advancedSearchOpen: advancedSearchPanel.open });
    });
  }
  showFavsOnGrid.addEventListener('change', renderFavoriteBlocks);

  // 관심 멘토 이벤트 (timetable 사이드바에 이관)
  if (mentorSearch) {
    let mwTimer;
    mentorSearch.addEventListener('input', () => {
      clearTimeout(mwTimer);
      mwTimer = setTimeout(renderMentorSuggestions, 120);
    });
  }
  if (mentorSuggestions) {
    mentorSuggestions.addEventListener('click', e => {
      const btn = e.target.closest('.mw-add');
      if (!btn) return;
      addWatchedMentor(btn.dataset.mentor);
    });
  }
  if (watchedMentorsEl) {
    watchedMentorsEl.addEventListener('click', e => {
      const x = e.target.closest('.mw-x');
      if (!x) return;
      removeWatchedMentor(x.dataset.mentor);
    });
  }
  clearDateRange.addEventListener('click', () => {
    filterDateStart.value = '';
    filterDateEnd.value = '';
    runSearch();
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
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
  // A11y: 카드 Tab 포커스 + Enter/Space 로 팝오버 열기
  resultsDiv.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.lecture-item');
    if (!item || e.target.closest('.fav-btn')) return;
    if (e.target !== item) return;
    e.preventDefault();
    const l = allLectures[item.dataset.sn];
    if (l) showPopover(l, item);
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

  // rAF throttle: mousemove 는 초당 100-150회 fire. renderDragPreview 를 매번 하면 레이아웃 잦은 요청.
  // 1프레임당 1회로 제한 — 60fps 유지 + jank 방지.
  let _dragRafPending = false;
  document.addEventListener('mousemove', e => {
    if (!dragState) return;
    const rect = dragState.colEl.getBoundingClientRect();
    dragState.currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    if (_dragRafPending) return;
    _dragRafPending = true;
    requestAnimationFrame(() => {
      _dragRafPending = false;
      if (dragState) renderDragPreview();
    });
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

  // ─── 시간대 프리셋 (chip 기반) ───
  const presetChips = el('presetChips');
  const presetSaveBtn = el('presetSaveBtn');

  async function renderPresetChips() {
    const { slotPresets = [] } = await chrome.storage.local.get('slotPresets');
    presetChips.innerHTML = '';
    slotPresets.forEach((p, i) => {
      const chip = document.createElement('span');
      chip.className = 'preset-chip';
      chip.title = `클릭: "${p.name}" 로드`;
      chip.innerHTML = `${escapeHtml(p.name)}<span class="x" title="삭제">×</span>`;
      chip.addEventListener('click', e => {
        if (e.target.classList.contains('x')) return;
        applyPreset(p);
      });
      chip.querySelector('.x').addEventListener('click', async e => {
        e.stopPropagation();
        const okDel = await window.SWMModal.showConfirm({
          title: '프리셋 삭제',
          body: `"${p.name}" 프리셋을 삭제할까요?`,
          confirmLabel: '삭제',
          cancelLabel: '취소',
          danger: true,
        });
        if (!okDel) return;
        slotPresets.splice(i, 1);
        await chrome.storage.local.set({ slotPresets });
        renderPresetChips();
      });
      presetChips.appendChild(chip);
    });
  }

  function applyPreset(preset) {
    selectedSlots.clear();
    for (const p of preset.pattern) {
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        if (d.getDay() === p.day) {
          const dateStr = fmtISO(d);
          if (!selectedSlots.has(dateStr)) selectedSlots.set(dateStr, []);
          selectedSlots.get(dateStr).push({ startMin: p.startMin, endMin: p.endMin });
          break;
        }
      }
    }
    renderSlotBlocks();
    renderSlotBar();
    updateDayHeaderSelection();
    runSearch();
  }

  presetSaveBtn.addEventListener('click', async () => {
    if (selectedSlots.size === 0) {
      await window.SWMModal.showAlert({ title: '프리셋 저장', body: '먼저 시간대를 선택하세요.' });
      return;
    }
    const name = prompt('프리셋 이름:');
    if (!name?.trim()) return;
    const pattern = [];
    for (const [dateStr, ranges] of selectedSlots) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const day = new Date(y, m - 1, d).getDay();
      for (const r of ranges) pattern.push({ day, startMin: r.startMin, endMin: r.endMin });
    }
    const { slotPresets = [] } = await chrome.storage.local.get('slotPresets');
    const idx = slotPresets.findIndex(p => p.name === name.trim());
    if (idx >= 0) slotPresets[idx] = { name: name.trim(), pattern };
    else slotPresets.push({ name: name.trim(), pattern });
    await chrome.storage.local.set({ slotPresets });
    renderPresetChips();
  });

  renderPresetChips();

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
      ? '시간 지정 검색 종료'
      : '시간 지정 검색';
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
  // 현재 시간 실시간 표시선 (08:00 이전이면 맨 위, 23:00 이후면 맨 아래에 표시)
  function renderNowLine() {
    document.querySelectorAll('.now-line').forEach(el => el.remove());
    const now = new Date();
    const todayStr = fmtISO(now);
    const todayCol = gridBody.querySelector(`.day-column[data-date="${todayStr}"]`);
    if (!todayCol) return;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = START_HOUR * 60;
    const endMin = END_HOUR * 60;
    const clampedMin = Math.max(startMin, Math.min(nowMin, endMin));
    const top = (clampedMin - startMin) / 60 * HOUR_PX;
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = top + 'px';
    todayCol.appendChild(line);
  }

  // 현재 시각 기준 그리드 자동 스크롤 (첫 렌더 1회만)
  // 현재 시각의 1시간 위가 화면 상단에 오도록 — 현재 진행중인 슬롯 + 앞으로 남은 시간 최대 가시
  let _nowScrolled = false;
  function scrollToNow() {
    if (_nowScrolled) return;
    const wrap = gridBody.parentElement;  // .grid-wrapper
    if (!wrap) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = START_HOUR * 60;
    if (nowMin < startMin) return;  // 이른 아침 — 기본 top 유지
    // 현재 시각 - 60분 지점이 상단에 오도록
    const offsetPx = Math.max(0, (nowMin - startMin - 60) / 60 * HOUR_PX);
    wrap.scrollTop = offsetPx;
    _nowScrolled = true;
  }
  // 초기 1회 자동 스크롤 (현재 시각 근처로)
  renderNowLine();
  scrollToNow();
  // 탭 hidden 일 때는 now-line 갱신 skip. 다시 visible 되면 즉시 1회 갱신 후 재개.
  setInterval(() => { if (!document.hidden) renderNowLine(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderNowLine();
  });

  function rerenderAll() {
    renderGridSkeleton();
    renderFavoriteBlocks();
    renderAppliedBlocks();
    renderSlotBlocks();
    updateDayHeaderSelection();
    renderSlotBar();
    renderNowLine();
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
  // popup 에서 ★ 토글하거나 sync 후 lectures 변경 시 자동 리프레시.
  //
  // Debounce: fullSync 중 content.js 가 storage.local.set 을 5-20회 연속 호출
  // (chunk 마다 detail 배치 저장). rerender 매번 fire 하면 누적 수백 ms. 80ms
  // coalesce 로 마지막 상태만 1회 렌더 — 사용자 체감 "실시간성" 은 유지.
  let _rerenderTimer = null;
  let _pendingRender = { headerStats: false, favBlocks: false, appliedBlocks: false, search: false };
  function flushRerender() {
    _rerenderTimer = null;
    const p = _pendingRender;
    _pendingRender = { headerStats: false, favBlocks: false, appliedBlocks: false, search: false };
    if (p.headerStats) updateHeaderStats();
    if (p.favBlocks) renderFavoriteBlocks();
    if (p.appliedBlocks) renderAppliedBlocks();
    if (p.search) runSearch();
  }
  function scheduleRerender(parts) {
    for (const k of Object.keys(parts)) if (parts[k]) _pendingRender[k] = true;
    // 리렌더는 popover/tooltip/menu 를 orphan anchor 로 만들 수 있어, 사전에 닫는다.
    // (열린 popover 는 블록 DOM 에 기대어 위치를 잡는데, 리렌더로 그 블록이 제거되면 좌표 stale.)
    closeAllPopovers();
    if (_rerenderTimer) return;
    _rerenderTimer = setTimeout(flushRerender, 80);
  }

  function closeAllPopovers() {
    try { if (typeof hidePopover === 'function' && currentPopoverSn) hidePopover(); } catch (_) {}
    // common menu(⋯) / tooltip — lib/menu_common 이 document 에 연 패널들을 닫는다.
    try { document.querySelectorAll('.menu-panel.open, .swm-tooltip, [data-popover-open="1"]').forEach(el => {
      el.classList.remove('open');
      el.removeAttribute('data-popover-open');
      if (el.classList.contains('swm-tooltip')) el.remove();
    }); } catch (_) {}
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let needRender = false;
    if (changes.lectures) {
      allLectures = changes.lectures.newValue || {};
      injectDerivedCategories();
      rebuildCatFilterOptions();
      needRender = true;
    }
    if (changes.favorites) {
      favorites = changes.favorites.newValue || [];
      needRender = true;
      refreshPopoverFavBtn();
    }
    if (changes.settings) {
      settings = { ...settings, ...(changes.settings.newValue || {}) };
      applyChipVisibility();
      renderMentorWatch();
      needRender = true;
    }
    if (needRender) {
      scheduleRerender({ headerStats: true, favBlocks: true, appliedBlocks: true, search: true });
    }
  });

  // ─── 동기화 버튼 (팝업 로직 재사용) ───
  async function findSwmTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.url?.includes('swmaestro.ai') && active.status === 'complete') return active;
    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*']
    });
    // 로드 완료된 탭 우선 — loading 중인 탭은 content script 없음.
    const complete = tabs.find(t => t.status === 'complete');
    return complete || tabs[0] || null;
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
    syncRunning = true;
    try {
      // PING 으로 content script alive 사전 확인. 실패 시 background 에 programmatic 주입 요청 후 재시도.
      const pingAlive = async () => {
        try {
          await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'PING' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ping-timeout')), 2000)),
          ]);
          return true;
        } catch (e) {
          console.warn('[SWM timetable] PING fail', { id: tab.id, url: tab.url, status: tab.status, err: String(e.message || e) });
          return false;
        }
      };
      if (!(await pingAlive())) {
        button.textContent = 'swmaestro 창 연결 중...';
        const injectRes = await chrome.runtime.sendMessage({ type: 'SWM_INJECT_TAB', tabId: tab.id }).catch(e => ({ ok: false, error: e.message }));
        if (!injectRes?.ok) {
          console.warn('[SWM timetable] inject fail:', injectRes);
          button.textContent = 'swmaestro.ai 창 새로고침 필요';
          setTimeout(() => { button.innerHTML = originalHTML; button.disabled = false; syncRunning = false; }, 3500);
          return;
        }
        await new Promise(r => setTimeout(r, 300));
        if (!(await pingAlive())) {
          button.textContent = 'swmaestro.ai 창 새로고침 필요';
          setTimeout(() => { button.innerHTML = originalHTML; button.disabled = false; syncRunning = false; }, 3500);
          return;
        }
      }

      // 3분 timeout — content.js 응답 없으면 자동 실패 (무한 대기 방지)
      const timeoutMs = 180000; // 3분
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      if (response?.success) {
        button.textContent = response.failedPages > 0
          ? `완료! ${response.count}개 · ${response.failedPages}페이지 실패`
          : `완료! ${response.count}개`;
        allLectures = await SWM.getLectures();
        favorites = await SWM.getFavorites();
        injectDerivedCategories();
        rebuildCatFilterOptions();
        // r9-A-1: sync scope 에 맞춰 UI 상태 필터 정합.
        if (statusFilter === '' || statusFilter === 'all') {
          filterStatus.value = '';
        } else if (statusFilter === 'A' || statusFilter === 'C') {
          filterStatus.value = statusFilter;
        }
        rerenderAll();
      } else {
        console.warn('[SWM timetable] sync fail:', response);
        button.textContent = response?.error ? '실패 (상세 콘솔)' : '실패 (로그인 확인)';
      }
    } catch (e) {
      console.error('[SWM timetable] sync error:', e, 'tab:', tab ? { id: tab.id, url: tab.url, status: tab.status } : null);
      const msg = String(e.message || e);
      if (msg.includes('Could not establish connection') || msg.includes('Receiving end')) {
        button.textContent = 'swmaestro.ai 창 새로고침 필요';
      } else if (msg.includes('timeout')) {
        button.textContent = '시간 초과';
      } else {
        button.textContent = '오류 발생';
      }
    }
    setTimeout(() => { button.innerHTML = originalHTML; button.disabled = false; syncRunning = false; }, 2500);
  }
  syncBtn.addEventListener('click', () => triggerSync(syncBtn, 'A'));
  syncAllBtn.addEventListener('click', () => triggerSync(syncAllBtn, ''));

  // sync 상태 라벨 업데이트 (content script가 보내는 중간 상태)
  // SYNC_STATUS 는 수동 동기화 중에만 버튼 텍스트 갱신 (alarm sync 시 SVG 소실 방지)
  let syncRunning = false;
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'SYNC_STATUS' && syncRunning) syncBtn.textContent = msg.status;
  });

  // ─── 유틸 ───
  function escapeHtml(s) {
    // textContent→innerHTML escapes &, <, > but NOT " or ' — required for
    // attribute-safe interpolation (chip data-val="..." uses this).
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function cleanLocation(loc) {
    if (!loc) return '';
    return String(loc).replace(/\s*https?:\/\/\S+/g, '').trim();
  }
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    return dateStr;
  }

  // ─── Coachmark (timetable tour) ───
  const TIMETABLE_STEPS = [
    {
      target: '#searchInput',
      arrow: 'right',
      title: '💬 자연어 검색 — 사이드바',
      body:
        '<p>팝업과 동일 — 한 줄 입력 → 3개 칩 자동 분해:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-input">🔍 <span>내일 비대면 접수중</span></div>'
      +   '<div class="cm-demo-chips">'
      +     '<span class="cm-demo-chip cm-demo-chip-date">📅 내일</span>'
      +     '<span class="cm-demo-chip cm-demo-chip-loc">🌐 비대면</span>'
      +     '<span class="cm-demo-chip cm-demo-chip-status">🟢 접수중</span>'
      +   '</div>'
      +   '<p class="cm-demo-hint">고급: <code>@김멘토</code> <code>#AI</code> <code>-카카오</code></p>'
      + '</div>',
    },
    {
      target: '.grid-wrapper',
      arrow: 'left',
      title: '🧩 그리드 블록 — 상호작용',
      body:
        '<p>블록 <b>클릭</b> → 상세 팝오버, <b>호버</b> → 요약 프리뷰, <b>우클릭</b> → 즐겨찾기 토글.</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-grid">'
      +     '<div class="cm-demo-grid-head">'
      +       '<span>월</span><span>화</span><span>수</span><span>목</span><span>금</span>'
      +     '</div>'
      +     '<div class="cm-demo-grid-body">'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="ai" style="top:12%;height:32%">LLM 파인튜닝</span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="backend" style="top:50%;height:28%">백엔드 설계</span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="startup" style="top:22%;height:22%">스타트업</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>',
    },
    {
      target: '#advancedToggle',
      arrow: 'top',
      title: '🎯 내 빈 시간에 맞는 강연',
      body:
        '<p><b>순서:</b> ① 이 버튼 클릭 → ② 그리드에서 빈 시간 드래그 → ③ 그 시간에 들을 수 있는 강연만 표시.</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-grid cm-demo-grid-drag">'
      +     '<div class="cm-demo-grid-head">'
      +       '<span>월</span><span>화</span><span>수</span><span>목</span><span>금</span>'
      +     '</div>'
      +     '<div class="cm-demo-grid-body">'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-drag" style="top:30%;height:38%"></span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-drag" style="top:30%;height:38%"></span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col"></div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="cm-demo-card">'
      +     '<div class="cm-demo-meta">'
      +       '<span class="cm-demo-badge" data-cat="ai">🤖 AI/LLM</span>'
      +       '<span class="cm-demo-date">화 14:00~16:00</span>'
      +     '</div>'
      +     '<div class="cm-demo-title">LLM 파인튜닝 실전</div>'
      +   '</div>'
      + '</div>',
    },
    {
      target: '#menuBtn',
      arrow: 'top',
      title: '⋯ 메뉴 — 동기화·내보내기·테마·알림',
      body:
        '<p>3개 섹션:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-menu">'
      +     '<div class="cm-demo-menu-label">데이터</div>'
      +     '<div class="cm-demo-menu-item">🔄 새로고침</div>'
      +     '<div class="cm-demo-menu-item">♻️ 전량 재동기화</div>'
      +     '<div class="cm-demo-menu-divider"></div>'
      +     '<div class="cm-demo-menu-label">내보내기</div>'
      +     '<div class="cm-demo-menu-item">🗓️ iCal (.ics)</div>'
      +     '<div class="cm-demo-menu-item">🖼️ 이미지로 저장</div>'
      +     '<div class="cm-demo-menu-divider"></div>'
      +     '<div class="cm-demo-menu-label">알림/설정</div>'
      +     '<div class="cm-demo-menu-item">🔔 알림 설정</div>'
      +     '<div class="cm-demo-menu-item">🌓 테마</div>'
      +     '<div class="cm-demo-menu-item">🎨 팔레트 테마</div>'
      +     '<div class="cm-demo-menu-item">💡 설명 다시 보기</div>'
      +   '</div>'
      + '</div>',
    },
  ];

  function startTimetableTour() {
    if (!window.SWM_COACHMARK) return;
    if (advancedSearchPanel && !advancedSearchPanel.open) advancedSearchPanel.open = true;
    setTimeout(() => {
      window.SWM_COACHMARK.start(TIMETABLE_STEPS, {
        onComplete: async () => {
          await SWM.saveSettings({ timetableCoachmarkSeen: true });
        },
        onSkip: async () => {
          await SWM.saveSettings({ timetableCoachmarkSeen: true });
        },
      });
    }, 120);
  }
  window.SWM_START_TIMETABLE_TOUR = startTimetableTour;

  // 세션당 최대 1회 guard — 재동기화나 storage.onChanged 로 인한 재렌더 중에도 중복 호출 방지
  let _coachmarkSessionStarted = false;
  async function maybeStartTimetableCoachmark() {
    if (_coachmarkSessionStarted) return;
    const fresh = await SWM.getSettings();
    if (!fresh.timetableCoachmarkSeen) {
      _coachmarkSessionStarted = true;
      startTimetableTour();
    }
  }

  // ─── 시작 ───
  // storage 병렬: 순차 await 제거
  const _init = await Promise.all([
    SWM.getLectures(), SWM.getFavorites(), SWM.getSettings(),
  ]);
  allLectures = _init[0]; favorites = _init[1]; settings = _init[2];

  // v1.16.1 §R2 self-heal: 과거 버전 race/partial-write 으로 sn 필드 누락된
  // legacy 레코드를 key 로부터 1-pass 복구. 최초 1회만 실행 (변경 있을 때만 저장).
  (async () => {
    let healed = false;
    for (const [key, lec] of Object.entries(allLectures)) {
      if (lec && typeof lec === 'object' && !lec.sn) {
        lec.sn = key;
        healed = true;
      }
    }
    if (healed) {
      console.log('[SWM] legacy sn-less records healed');
      try { await SWM.replaceLectures(allLectures); } catch {}
    }
  })();

  // alarm skip-if-recent 용 타임스탬프 — 시간표 열림 = 사용자 활동.
  SWM.markUserActivity().catch(() => {});

  injectDerivedCategories();
  rebuildCatFilterOptions();
  applyChipVisibility();
  // 상세 검색은 기본 닫힘 — settings.advancedSearchOpen 이 명시적으로 true 인 경우에만 open
  if (advancedSearchPanel && settings.advancedSearchOpen === true) advancedSearchPanel.open = true;
  renderMentorWatch();
  rerenderAll();
  maybeStartTimetableCoachmark();

})();
