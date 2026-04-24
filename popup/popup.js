// popup.js — 검색, 필터, 즐겨찾기

(async function() {
  'use strict';

  let allLectures = {};
  let favorites = [];
  let settings = {};
  let currentTab = 'search';
  let currentResults = [];

  // --- DOM 요소 ---
  const searchInput = document.getElementById('searchInput');
  const filterDate = document.getElementById('filterDate');
  const filterStatus = document.getElementById('filterStatus');
  const filterCategory = document.getElementById('filterCategory');
  const filterLocation = document.getElementById('filterLocation');
  const filterDerivedCat = document.getElementById('filterDerivedCat');
  const advancedSearchPanel = document.getElementById('advancedSearchPanel');
  const resultsDiv = document.getElementById('results');
  const resultCount = document.getElementById('resultCount');
  const syncBtn = document.getElementById('syncBtn');
  const syncAllBtn = document.getElementById('syncAllBtn');
  const headerStats = document.getElementById('headerStats');
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge && chrome?.runtime?.getManifest) {
    versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
  }

  // --- 초기화 ---
  function updateHeaderStats() {
    // 단일 pass — 두 번 Object.values(allLectures).filter() 하던 것을 loop 1회로 병합.
    let openCount = 0, appliedCount = 0;
    for (const sn in allLectures) {
      const l = allLectures[sn];
      if (l.status === 'A') openCount++;
      if (l.applied) appliedCount++;
    }
    const favCount = favorites.length;
    headerStats.textContent = `접수 ${openCount} · ★ ${favCount} · 신청 ${appliedCount}`;
    headerStats.title = `접수중 ${openCount} · 즐겨찾기 ${favCount} · 내 신청 ${appliedCount}`;
  }

  async function init() {
    // storage 병렬: 순차 await 는 매 오픈마다 40-80ms 낭비
    const [lecs, favs, sett, meta] = await Promise.all([
      SWM.getLectures(), SWM.getFavorites(), SWM.getSettings(), SWM.getMeta(),
    ]);
    allLectures = lecs; favorites = favs; settings = sett;

    // v1.16.1 §R2 self-heal: legacy sn-less 레코드 key 로부터 복구 (timetable.js 와 쌍).
    let _healed = false;
    for (const [key, lec] of Object.entries(allLectures)) {
      if (lec && typeof lec === 'object' && !lec.sn) { lec.sn = key; _healed = true; }
    }
    if (_healed) { try { await SWM.replaceLectures(allLectures); } catch {} }

    // alarm skip-if-recent 용 타임스탬프. 팝업 열림 = 사용자 활동.
    // SW 가 읽어 2분 내 활동이면 중복 polling 회피 (server smoothing).
    SWM.markUserActivity().catch(() => {});

    injectDerivedCategories();
    rebuildCatFilterOptions();
    // 상세 검색은 기본 닫힘 — 명시적 true 일 때만 open
    if (advancedSearchPanel && settings.advancedSearchOpen === true) advancedSearchPanel.open = true;

    if (meta.lastFullSync) {
      updateHeaderStats();
      doSearch();
    } else {
      headerStats.textContent = '동기화 필요';
      resultsDiv.innerHTML = `
        <div style="padding:32px 20px;text-align:center;color:var(--slate-500)">
          <div style="font-size:28px;margin-bottom:12px">👋</div>
          <div style="font-size:14px;font-weight:600;color:var(--slate-800);margin-bottom:8px">시작하기</div>
          <ol style="text-align:left;font-size:12.5px;line-height:1.8;padding-left:20px;margin:0">
            <li><a href="https://www.swmaestro.ai" target="_blank" style="color:var(--brand-500)">swmaestro.ai</a> 에 로그인</li>
            <li>아래 <strong>"접수중 동기화"</strong> 버튼 클릭</li>
            <li>완료되면 강연 목록이 여기 표시됩니다</li>
          </ol>
        </div>`;
    }
    maybeStartCoachmark();
  }

  // --- Classifier 주입 / 필터 옵션 / 칩 토글 ---
  function injectDerivedCategories() {
    // 971 × 18 regex × 매 오픈/storage 이벤트 → 무거움. lec._cv 캐싱.
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

  // --- 검색 & 필터 ---
  function doSearch() {
    const rawQuery = searchInput.value;
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
      // 내 신청 탭: 상태 필터 무시 (접수중이든 마감이든 전부 보임)
    }

    // 키워드 검색: v1.15.0 — SWM_QUERY 파서 사용 (prefix-free 경로는 기존 substring 호환)
    let ast = null;
    if (window.SWM_QUERY && rawQuery && rawQuery.trim()) {
      try { ast = window.SWM_QUERY.parse(rawQuery); }
      catch (e) { console.warn('query parse fallback', e); ast = null; }
    }
    if (ast && !window.SWM_QUERY.isEmpty(ast)) {
      // v1.16.0: rank() with opts.rank computes BM25 score for freeText queries.
      // Result shape is [{lec, score}], so unwrap. Downstream date sort still wins
      // for the default popup view; the score is preserved on `lec` via closure
      // for callers that wish to consume it later.
      const ranked = window.SWM_QUERY.rank(ast, lectures, { rank: true });
      lectures = ranked.map(r => r.lec);
    } else if (rawQuery && rawQuery.trim()) {
      const q = rawQuery.trim().toLowerCase();
      lectures = lectures.filter(l => {
        const searchable = [
          l.title, l.mentor, l.categoryNm, l.description, l.location
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }
    renderQueryChips(ast);

    // 날짜 필터: 특정 날짜 선택시 모든 탭에 적용. 비어있을 때는 검색 탭에서만 "오늘 이후" 적용.
    // r9-B-1 (Q1=B): status 필터가 '' (마감 포함) 이거나 'C' (마감) 이면, 사용자 의도가
    // "과거 강연도 보고 싶다" 라고 판단 — "오늘 이후" 필터 해제.
    if (date) {
      lectures = lectures.filter(l => l.lecDate === date);
    } else if (currentTab === 'search' && status === 'A') {
      const today = new Date().toISOString().slice(0, 10);
      lectures = lectures.filter(l => !l.lecDate || l.lecDate >= today);
    }

    // 상태/분류/장소 필터는 검색 탭에서만 적용.
    if (currentTab === 'search') {
      if (status) lectures = lectures.filter(l => l.status === status);
      if (category) lectures = lectures.filter(l => l.category === category);
      if (location === 'online') lectures = lectures.filter(l => l.isOnline === true);
      else if (location === 'offline') lectures = lectures.filter(l => l.detailFetched && l.isOnline === false);
      // hasStarted 필터도 status === 'A' 일 때만 — 마감 포함이면 이미 시작한 강연 허용.
      if (status === 'A') lectures = lectures.filter(l => !hasStarted(l));
    }

    const derivedCat = filterDerivedCat ? filterDerivedCat.value : '';
    if (derivedCat) {
      lectures = lectures.filter(l => Array.isArray(l.derivedCategories) && l.derivedCategories.includes(derivedCat));
    }

    // 정렬
    if (currentTab === 'applied') {
      // 내 신청: 미래(가까운 것 먼저) → 과거(최근 것 먼저)
      const today = new Date().toISOString().slice(0, 10);
      lectures.sort((a, b) => {
        const aF = (a.lecDate || '') >= today;
        const bF = (b.lecDate || '') >= today;
        if (aF !== bF) return aF ? -1 : 1;
        const ak = (a.lecDate || '') + (a.lecTime || '');
        const bk = (b.lecDate || '') + (b.lecTime || '');
        return aF ? ak.localeCompare(bk) : bk.localeCompare(ak);
      });
    } else {
      // 기본: 날짜+시간 오름차순
      lectures.sort((a, b) => {
        const ak = a.lecDate ? `${a.lecDate} ${a.lecTime || ''}` : '\uffff';
        const bk = b.lecDate ? `${b.lecDate} ${b.lecTime || ''}` : '\uffff';
        const cmp = ak.localeCompare(bk);
        if (cmp !== 0) return cmp;
        return (parseInt(a.sn, 10) || 0) - (parseInt(b.sn, 10) || 0);
      });
    }

    currentResults = lectures;
    renderResults(lectures);
  }

  // --- 검색 쿼리 chip 렌더 (v1.15.0 NLS v2 — 자연어 라벨) ---
  const DERIVED_CHIP_LABEL = {
    ai: '🤖 AI/LLM', backend: '⚙️ 백엔드', frontend: '🎨 프론트', mobile: '📱 모바일',
    data: '📊 데이터', cloud: '☁️ 클라우드', devops: '🔧 DevOps', security: '🔒 보안',
    game: '🎮 게임', blockchain: '⛓️ 블록체인', os: '💻 OS', pm: '📋 기획',
    startup: '🚀 창업', career: '💼 커리어', cs: '🧮 CS', idea: '💡 아이디어',
    team: '🤝 팀', soma: '🌱 소마',
  };
  const MIN_TO_LABEL = (m) => {
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}시`;
  };
  function formatDateChip(from, to) {
    if (!from && !to) return '';
    if (from && to && from === to) {
      const today = new Date();
      const tISO = today.toISOString().slice(0, 10);
      const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
      const d2 = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);
      if (from === tISO) return '📅 오늘';
      if (from === tomorrow) return '📅 내일';
      if (from === d2) return '📅 모레';
      return '📅 ' + from.slice(5).replace('-', '/');
    }
    const f = from ? from.slice(5).replace('-', '/') : '';
    const t = to ? to.slice(5).replace('-', '/') : '';
    return `📅 ${f}${f && t ? '~' : t ? '~' : ''}${t}`;
  }
  function formatTimeChip(from, to) {
    if (from === 0 && to === 12 * 60) return '🕐 오전';
    if (from === 12 * 60 && to === 24 * 60) return '🕐 오후';
    if (from === 18 * 60 && to === 24 * 60) return '🕐 저녁';
    const f = from !== null ? MIN_TO_LABEL(from) : '';
    const t = to !== null ? MIN_TO_LABEL(to) : '';
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
      for (const m of inc.mentor || []) chips.push(chipHtml('mentor', m, `${m} (멘토)`));
      for (const c of inc.category || []) {
        const label = c === 'MRC020' ? '🎤 특강' : (c === 'MRC010' ? '💬 멘토링' : c);
        chips.push(chipHtml('category', c, label));
      }
      for (const d of inc.derivedCat || []) {
        chips.push(chipHtml('derivedCat', d, DERIVED_CHIP_LABEL[d] || '#' + d));
      }
      for (const n of inc.categoryNm || []) chips.push(chipHtml('categoryNm', n, '#' + n));
      if (inc.location && inc.location.online !== null) {
        const online = inc.location.online;
        chips.push(chipHtml('location', online ? 'online' : 'offline', online ? '🌐 비대면' : '📍 대면'));
      }
      if (inc.status === 'A') chips.push(chipHtml('status', 'A', '🟢 접수중'));
      else if (inc.status === 'C') chips.push(chipHtml('status', 'C', '⚫ 마감'));
      if (inc.dateFrom || inc.dateTo) {
        chips.push(chipHtml('date', 'range', formatDateChip(inc.dateFrom, inc.dateTo)));
      }
      if (inc.timeFromMin !== null || inc.timeToMin !== null) {
        chips.push(chipHtml('time', 'range', formatTimeChip(inc.timeFromMin, inc.timeToMin)));
      }
      for (const e of ast.exclude || []) chips.push(chipHtml('exclude', e, '제외: ' + e));
    }
    el.innerHTML = chips.join('');
  }

  function chipHtml(type, val, label) {
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
    doSearch();
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
        metaBits.push(`<button class="fav-btn ${isFav ? 'on' : ''}" data-sn="${l.sn}" title="즐겨찾기">${isFav ? starSvgFilled : starSvgEmpty}</button>`);
      }

      // 태그 라인: 장소 + 상태
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
      const ariaLabel = `${displayTitle}${l.lecDate ? ', ' + formatDate(l.lecDate) : ''}${l.lecTime ? ' ' + l.lecTime : ''} — 상세 페이지 열기`;
      return `
        <div class="${itemClass}" data-sn="${l.sn}" role="button" tabindex="0" aria-label="${escapeHtml(ariaLabel)}" ${l.applied ? 'title="신청한 강연"' : ''}>
          <div class="meta-line">${metaBits.join('')}</div>
          <div class="title-line">${escapeHtml(displayTitle)}</div>
          ${chips}
          <div class="tags-line">${tags.join('')}</div>
        </div>`;
    }).join('');
  }

  // --- 이벤트 핸들러 ---

  // 검색/필터 변경
  let searchTimer;
  const fireSearch = () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 200); };
  searchInput.addEventListener('input', (e) => { if (e.isComposing) return; fireSearch(); });
  // compositionend 한글 조합 종료 시 — 마지막 글자까지 즉시 검색 대상으로 포함
  let lastCompositionEnd = 0;
  searchInput.addEventListener('compositionend', () => { lastCompositionEnd = Date.now(); fireSearch(); });
  // Enter — IME 조합 무시, 즉시 검색 실행
  searchInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (Date.now() - lastCompositionEnd < 50) return;
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); doSearch(); }
  });
  filterDate.addEventListener('change', doSearch);
  filterStatus.addEventListener('change', doSearch);
  filterCategory.addEventListener('change', doSearch);
  filterLocation.addEventListener('change', doSearch);
  if (filterDerivedCat) filterDerivedCat.addEventListener('change', doSearch);

  // Query chip × button → remove token
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

  // Query help popover toggle
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

  if (advancedSearchPanel) {
    advancedSearchPanel.addEventListener('toggle', async () => {
      settings = { ...settings, advancedSearchOpen: advancedSearchPanel.open };
      await SWM.saveSettings({ advancedSearchOpen: advancedSearchPanel.open });
    });
  }

  // 탭 전환
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      currentTab = tab.dataset.tab;
      doSearch();
    });
  });

  // 강연 클릭 → 상세 페이지 열기
  function openLectureDetail(sn) {
    chrome.tabs.create({
      url: `https://www.swmaestro.ai/sw/mypage/mentoLec/view.do?qustnrSn=${encodeURIComponent(sn)}&menuNo=200046`
    });
  }
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

    if (item) openLectureDetail(item.dataset.sn);
  });
  // A11y: 카드 Tab 포커스 + Enter/Space 로 상세 페이지 열기
  resultsDiv.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.lecture-item');
    if (!item || e.target.closest('.fav-btn')) return;
    if (e.target !== item) return;
    e.preventDefault();
    openLectureDetail(item.dataset.sn);
  });

  // swmaestro.ai 탭 찾기 (www 포함, 아무 페이지든 OK)
  async function findSwmTab() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active?.url?.includes('swmaestro.ai') && active.status === 'complete') return active;

    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*']
    });
    // 로드 완료된 탭 우선 — loading 탭은 content script 가 아직 없을 수 있음.
    const complete = tabs.find(t => t.status === 'complete');
    return complete || tabs[0] || null;
  }

  // 팝업 토스트 — persist 모드 (닫기 버튼, 자동 닫힘 없음 또는 10s)
  const popoverToastEl = document.getElementById('popoverToast');
  const popoverToastTextEl = document.getElementById('popoverToastText');
  const popoverToastCloseEl = document.getElementById('popoverToastClose');
  if (popoverToastCloseEl) {
    popoverToastCloseEl.addEventListener('click', () => {
      popoverToastEl.style.display = 'none';
    });
  }
  function showSyncToast(text, level /* 'success' | 'warn' | 'error' */, opts) {
    if (!popoverToastEl || !popoverToastTextEl) return;
    popoverToastTextEl.textContent = text;
    popoverToastEl.className = 'popover-toast ' + (level || 'success');
    popoverToastEl.style.display = 'flex';
    clearTimeout(showSyncToast._timer);
    const ms = (opts && typeof opts.duration === 'number') ? opts.duration : 10000;
    if (ms > 0) {
      showSyncToast._timer = setTimeout(() => {
        popoverToastEl.style.display = 'none';
      }, ms);
    }
  }

  // lib/storage.js 의 safeSet 이 quota/write 실패를 감지하면 이 훅을 호출한다.
  // 팝업은 즉시 닫힐 수 있지만, 열려있는 동안에는 경고 토스트로 노출.
  window.SWM_showStorageError = (msg) => showSyncToast(msg, 'error', { duration: 15000 });

  async function triggerSync(button, statusFilter) {
    // SVG 아이콘 보존을 위해 innerHTML 전체 저장 + 복구
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.textContent = '동기화 중...';

    const tab = await findSwmTab();
    if (!tab) {
      button.innerHTML = originalHTML;
      button.disabled = false;
      showSyncToast('swmaestro.ai 탭을 먼저 여세요', 'error');
      return;
    }

    syncRunning = true;
    try {
      // PING 으로 content script alive 사전 확인. 실패 시 background 에 programmatic 주입 요청 후 재시도.
      // MV3 declarative content_scripts 는 설치·업데이트 시점에 기존 탭에 자동 주입되지 않음.
      const pingAlive = async () => {
        try {
          await Promise.race([
            chrome.tabs.sendMessage(tab.id, { type: 'PING' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ping-timeout')), 2000)),
          ]);
          return true;
        } catch (e) {
          console.warn('[SWM popup] PING fail', { id: tab.id, url: tab.url, status: tab.status, err: String(e.message || e) });
          return false;
        }
      };
      if (!(await pingAlive())) {
        showSyncToast('swmaestro 창 연결 중...', 'warn', { duration: 3000 });
        // background 에 해당 탭 주입 요청
        const injectRes = await chrome.runtime.sendMessage({ type: 'SWM_INJECT_TAB', tabId: tab.id }).catch(e => ({ ok: false, error: e.message }));
        if (!injectRes?.ok) {
          console.warn('[SWM popup] inject fail:', injectRes);
          showSyncToast('swmaestro.ai 창을 새로고침한 뒤 다시 시도하세요', 'error', { duration: 10000 });
          syncRunning = false; button.innerHTML = originalHTML; button.disabled = false;
          return;
        }
        // 주입 완료 → 짧은 대기 후 재PING
        await new Promise(r => setTimeout(r, 300));
        if (!(await pingAlive())) {
          showSyncToast('swmaestro.ai 창을 새로고침한 뒤 다시 시도하세요', 'error', { duration: 10000 });
          syncRunning = false; button.innerHTML = originalHTML; button.disabled = false;
          return;
        }
      }

      const timeoutMs = 180000; // 3분
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      if (response?.success) {
        allLectures = await SWM.getLectures();
        injectDerivedCategories();
        rebuildCatFilterOptions();
        updateHeaderStats();
        // r9-A-1: 마감 포함 (statusFilter==='' 또는 'all') 로 sync 완료 후,
        // 상태 필터가 "접수중 (A)" 로 남아 있으면 방금 긁어온 마감 강연이 즉시 숨겨지는 모순.
        // sync scope 에 맞춰 UI 필터 자동 정합.
        if (statusFilter === '' || statusFilter === 'all') {
          filterStatus.value = '';
        } else if (statusFilter === 'A' || statusFilter === 'C') {
          filterStatus.value = statusFilter;
        }
        doSearch();
        const msg = response.failedPages > 0
          ? `동기화 완료 — ${response.count}개 · ${response.failedPages}페이지 실패`
          : `동기화 완료 — ${response.count}개 강연`;
        showSyncToast(msg, response.failedPages > 0 ? 'warn' : 'success');
      } else {
        showSyncToast('동기화 실패 — swmaestro.ai 로그인을 확인하세요', 'error');
      }
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('Could not establish connection') || msg.includes('Receiving end')) {
        console.warn('[SWM popup] sendMessage fail — tab:', { id: tab?.id, url: tab?.url, status: tab?.status });
        showSyncToast('swmaestro.ai 창을 새로고침한 뒤 다시 시도하세요', 'error', { duration: 10000 });
      } else if (msg.includes('timeout')) {
        showSyncToast('시간 초과 — 다시 시도해주세요', 'error');
      } else {
        console.error('[SWM popup] sync error:', e);
        showSyncToast('오류 발생 — ' + msg, 'error');
      }
    }

    button.innerHTML = originalHTML;
    button.disabled = false;
    syncRunning = false;
  }

  syncBtn.addEventListener('click', () => triggerSync(syncBtn, 'A'));
  syncAllBtn.addEventListener('click', () => triggerSync(syncAllBtn, ''));

  document.getElementById('openTimetableBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('timetable/timetable.html') });
  });

  // 팝업 ⋯ 메뉴
  const popupMenuBtn = document.getElementById('popupMenuBtn');
  const popupMenuDropdown = document.getElementById('popupMenuDropdown');
  const popupMenuDark = document.getElementById('popupMenuDark');
  const popupDarkLabel = document.getElementById('popupDarkModeLabel');

  popupMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = popupMenuDropdown.style.display === 'none';
    popupMenuDropdown.style.display = open ? 'block' : 'none';
    popupMenuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!popupMenuDropdown.contains(e.target) && e.target !== popupMenuBtn) {
      popupMenuDropdown.style.display = 'none';
      popupMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && popupMenuDropdown.style.display !== 'none') {
      popupMenuDropdown.style.display = 'none';
      popupMenuBtn.setAttribute('aria-expanded', 'false');
      popupMenuBtn.focus();
    }
  });
  popupMenuDropdown.addEventListener('click', async e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    if (action === 'darkmode') return; // bindDarkModeMenuItem 이 처리
    popupMenuDropdown.style.display = 'none';
    if (action === 'palette') {
      if (window.SWMMenuCommon?.openThemeModal) window.SWMMenuCommon.openThemeModal();
      return;
    }
    if (action === 'replay-tour') {
      if (typeof maybeStartCoachmark === 'function') {
        await chrome.storage.session?.set({ forceCoachmark: true }).catch(() => {});
        await SWM.saveSettings({ onboardingSeen: false });
        maybeStartCoachmark();
      }
      return;
    }
    if (action === 'reset') {
      const ok = await window.SWMModal.showConfirm({
        title: '데이터 초기화',
        body: '모든 캐시된 강연 데이터·즐겨찾기·설정이 삭제됩니다. 진행할까요?',
        confirmLabel: '초기화',
        cancelLabel: '취소',
        danger: true,
      });
      if (!ok) return;
      await chrome.storage.local.clear();
      await window.SWMModal.showAlert({
        title: '초기화 완료',
        body: '모든 데이터가 삭제되었습니다. 다시 동기화해주세요.',
      });
      location.reload();
    }
  });
  if (window.SWMMenuCommon && popupMenuDark && popupDarkLabel) {
    window.SWMMenuCommon.bindDarkModeMenuItem(popupMenuDark, popupDarkLabel);
  }

  // 동기화 상태 수신 (수동 sync 중에만 — alarm sync 시 SVG 소실 방지)
  let syncRunning = false;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYNC_STATUS' && syncRunning) {
      syncBtn.textContent = msg.status;
    }
  });

  // Cross-document storage 변경 자동 반영
  // (timetable 에서 ★ 토글 / sync 진행 시 즉시 popup UI 업데이트)
  //
  // Debounce 80ms — sync 중 storage.local.set 이 5-20회 연속 호출되므로 마지막 상태 1회 렌더.
  let _popupRerenderTimer = null;
  function schedulePopupRerender() {
    // 리렌더는 열린 menu/tooltip anchor 를 제거할 수 있어, 사전에 닫는다.
    closeAllPopupPopovers();
    if (_popupRerenderTimer) return;
    _popupRerenderTimer = setTimeout(() => {
      _popupRerenderTimer = null;
      updateHeaderStats();
      doSearch();
    }, 80);
  }

  function closeAllPopupPopovers() {
    try { document.querySelectorAll('.menu-panel.open, .swm-tooltip, [data-popover-open="1"]').forEach(el => {
      el.classList.remove('open');
      el.removeAttribute('data-popover-open');
      if (el.classList.contains('swm-tooltip')) el.remove();
    }); } catch (_) {}
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (changes.lectures) {
      allLectures = changes.lectures.newValue || {};
      injectDerivedCategories();
      rebuildCatFilterOptions();
      changed = true;
    }
    if (changes.favorites) {
      favorites = changes.favorites.newValue || [];
      changed = true;
    }
    if (changes.settings) {
      settings = { ...settings, ...(changes.settings.newValue || {}) };
    }
    if (changed) schedulePopupRerender();
  });

  // --- 유틸리티 ---
  function escapeHtml(text) {
    // textContent→innerHTML escapes &, <, > but NOT " or ' — required for
    // attribute-safe interpolation (chip data-val="..." uses this).
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // location 에서 URL 부분 제거 — "온라인 Webex https://..." → "온라인 Webex".
  // SWM 실데이터는 clean 하지만 소수 강의는 장소 셀에 회의 링크를 함께 적음.
  // 한 줄 표시에 URL 이 섞이면 지저분하므로 여기서 strip. 링크는 상세 페이지에서 확인.
  function cleanLocation(loc) {
    if (!loc) return '';
    return String(loc).replace(/\s*https?:\/\/\S+/g, '').trim();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parseInt(parts[1])}/${parseInt(parts[2])}`;
    }
    return dateStr;
  }

  // --- Coachmark (onboarding tour) ---
  const POPUP_STEPS = [
    {
      target: '#searchInput',
      arrow: 'bottom',
      title: '💬 자연어 한 줄로 검색',
      body:
        '<p>"내일 비대면 접수중" 처럼 한 줄 입력 → 3개 칩으로 자동 분해:</p>'
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
      target: '#filterStatus',
      arrow: 'bottom',
      title: '🔎 상세 검색 — 날짜 + 4개 드롭다운',
      body:
        '<p>접힌 패널을 열면 가로 한 줄에 필터 5개. 아래 주제는 별도 줄:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-accordion">'
      +     '<div class="cm-demo-accord-header">▾ 상세 검색</div>'
      +     '<div class="cm-demo-filter-row">'
      +       '<span class="cm-demo-select cm-demo-select-date">mm/dd/yyyy</span>'
      +       '<span class="cm-demo-select">접수중 ▾</span>'
      +       '<span class="cm-demo-select">전체 분류 ▾</span>'
      +       '<span class="cm-demo-select">전체 장소 ▾</span>'
      +     '</div>'
      +     '<div class="cm-demo-filter-row">'
      +       '<span class="cm-demo-select cm-demo-select-full">전체 주제 ▾</span>'
      +     '</div>'
      +   '</div>'
      + '</div>',
    },
    {
      target: '#results',
      arrow: 'top',
      title: '📇 결과 카드 — 클릭하면 상세 페이지가 열려요',
      body:
        '<p>카드를 클릭하면 <strong>SWM 상세 페이지가 새 탭으로</strong> 열립니다. 실제 신청은 그 페이지 안의 신청 버튼으로 진행해주세요. ⭐ 즐겨찾기 / 카테고리 뱃지 / 상태 태그 한눈에:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-cards">'
      +     '<div class="cm-demo-card">'
      +       '<div class="cm-demo-meta">'
      +         '<span class="cm-demo-badge" data-cat="ai">🤖 AI/LLM</span>'
      +         '<span class="cm-demo-date">04/20 14:00</span>'
      +       '</div>'
      +       '<div class="cm-demo-title">LLM 파인튜닝 실전</div>'
      +       '<div class="cm-demo-tags">'
      +         '<span class="cm-demo-tag online">비대면</span>'
      +         '<span class="cm-demo-tag open">접수중</span>'
      +       '</div>'
      +     '</div>'
      +     '<div class="cm-demo-card">'
      +       '<div class="cm-demo-meta">'
      +         '<span class="cm-demo-badge" data-cat="backend">⚙️ 백엔드</span>'
      +         '<span class="cm-demo-date">04/20 19:00</span>'
      +       '</div>'
      +       '<div class="cm-demo-title">대용량 트래픽 설계 패턴</div>'
      +       '<div class="cm-demo-tags">'
      +         '<span class="cm-demo-tag offline">대면</span>'
      +         '<span class="cm-demo-tag open">접수중</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>',
    },
    {
      target: '#openTimetableBtn',
      arrow: 'bottom',
      title: '📅 주간 뷰는 전체화면에서',
      body:
        '<p>버튼 하나로 전체화면 주간 시간표 열림 — 그리드 드래그로 빈 시간 매치도 여기서:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-grid">'
      +     '<div class="cm-demo-grid-head">'
      +       '<span>월</span><span>화</span><span>수</span><span>목</span><span>금</span>'
      +     '</div>'
      +     '<div class="cm-demo-grid-body">'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="ai" style="top:12%;height:28%">LLM</span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col"></div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="backend" style="top:48%;height:24%">백엔드</span>'
      +       '</div>'
      +       '<div class="cm-demo-grid-col">'
      +         '<span class="cm-demo-block" data-cat="startup" style="top:18%;height:22%">스타트업</span>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>',
    },
    {
      target: '#popupMenuBtn',
      arrow: 'left',
      title: '⚙️ 메뉴 — 테마 · 가이드 · 초기화',
      body:
        '<p>3가지 항목:</p>'
      + '<div class="cm-demo">'
      +   '<div class="cm-demo-menu">'
      +     '<div class="cm-demo-menu-label">정보</div>'
      +     '<div class="cm-demo-menu-item">🌓 테마 (라이트/다크/시스템)</div>'
      +     '<div class="cm-demo-menu-item">🎨 팔레트 테마</div>'
      +     '<div class="cm-demo-menu-item">💡 설명 다시 보기</div>'
      +     '<div class="cm-demo-menu-divider"></div>'
      +     '<div class="cm-demo-menu-item">🗑️ 데이터 초기화</div>'
      +   '</div>'
      + '</div>',
    },
  ];

  let _popupCoachmarkStarted = false;
  async function maybeStartCoachmark() {
    if (!window.SWM_COACHMARK) return;
    if (_popupCoachmarkStarted) return;  // 세션당 1회 guard
    let force = false;
    try {
      if (chrome.storage && chrome.storage.session) {
        const s = await chrome.storage.session.get('forceCoachmark');
        force = !!s.forceCoachmark;
      }
    } catch {}
    const fresh = await SWM.getSettings();
    if (!fresh.onboardingSeen || force) {
      _popupCoachmarkStarted = true;
      if (force) {
        try { await chrome.storage.session.remove('forceCoachmark'); } catch {}
      }
      // Open advanced panel so filterDerivedCat step has a visible target
      if (advancedSearchPanel && !advancedSearchPanel.open) {
        advancedSearchPanel.open = true;
      }
      setTimeout(() => {
        window.SWM_COACHMARK.start(POPUP_STEPS, {
          onComplete: async () => {
            await SWM.saveSettings({ onboardingSeen: true });
          },
          onSkip: async () => {
            await SWM.saveSettings({ onboardingSeen: true });
          },
        });
      }, 120);
    }
  }

  // --- 시작 ---
  await init();

})();
