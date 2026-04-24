// 시간표 관련 유틸. **v1.16.1 단일 source of truth**.
// Browser: window.SWM_TIME / plus legacy globals (parseTimeRange, mondayOf, ...).
// Node (tests): require('../lib/time_utils.js') → API 객체.
//
// v1.16.1 통합 변경:
//  · content.js 의 inline extractLecDateTime 이 제거되고 이 파일로 집약됨 (manifest
//    content_scripts 에 lib/time_utils.js 추가됨).
//  · timetable/menu.js iCal export 는 parseTimeRange 를 직접 사용 (24:00 overnight
//    정상 export).
//  · lib/query_parser.js 의 parseTimeToMin 은 parseTimeRange 로 대체.
//  · 9 sharp bug 수정:
//      #1 영문 AM/PM postfix ("2:00 PM ~ 5:00 PM") 정상 인식
//      #2 24:00 표기 보존 (00:00 으로 wrap 하지 않음)
//      #3 "오전 9시~12시" end=12 는 noon 유지 (상속 AM 일 때)
//      #4 저녁/밤/아침/새벽 prefix 추가
//      #7 "N시 반" → "N:30"
//      #8 "정각" strip
//      #9 "부터/까지" → " ~ "

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 시간 범위 파서. 다양한 입력을 { startMin, endMin } 로 정규화.
  // 실패 시 null. endMin <= startMin 이면 야간으로 간주하여 +24h.
  // 지원 포맷:
  //   "13:00 ~ 16:00" / "9:00-12:00" / "13시 30분 ~ 16시"
  //   "오후 2시 ~ 오후 5시" / "오후 2:00 ~ 5:00"
  //   "13:00~16:00" / "13:00 – 16:00" (en/em dash)
  //   "2:00 PM ~ 5:00 PM" / "2pm~5pm" (영문 postfix, v1.16.1)
  //   "오전 9시 ~ 12시" (상속 AM 에서 12 는 정오 유지, v1.16.1)
  //   "저녁 7시 ~ 9시" / "밤 11시 ~ 1시" / "아침 9시 ~ 11시" / "새벽 2시 ~ 4시" (v1.16.1)
  //   "오후 2시 반 ~ 4시 반" (반 → :30, v1.16.1)
  //   "2시 정각 ~ 4시 정각" (정각 strip, v1.16.1)
  //   "14시부터 16시까지" (부터/까지, v1.16.1)
  //   "22:00 ~ 24:00" (endMin=1440 보존, v1.16.1)
  // ──────────────────────────────────────────────
  function normalizeRangeText(str) {
    let s = String(str)
      .replace(/ /g, ' ')
      .replace(/：/g, ':')
      .replace(/[〜～]/g, '~');

    // SWM history 페이지 quirk (r3 발견): "21:30:00 ~ 23:30:00" HH:MM:SS 포맷.
    // regex 가 :SS 를 처리 못하면 "30:00 ~ 23:30" 로 오매칭 → h1=30 → boundary reject → lecTime 빈 값.
    s = s.replace(/(\d{1,2}:\d{2}):\d{2}/g, '$1');

    // 영문 AM/PM postfix ("2:00 PM" / "9am" / "2pm") → prefix 정규화.
    // 여러 번 매칭 가능하므로 /g 플래그. 소문자 tag 는 보존, 대문자로 정규화.
    s = s.replace(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)\b/g, (_, h, m, tag) => {
      const mm = m ? String(+m).padStart(2, '0') : '00';
      return `${tag.toUpperCase()} ${h}:${mm}`;
    });

    // "정각" strip (sharp #8). HH:MM 뒤 혹은 H시 뒤.
    s = s.replace(/(\d{1,2}:\d{2})\s*정각/g, '$1');
    s = s.replace(/(\d{1,2})\s*시\s*정각/g, '$1:00');

    // "N시 반" → "N:30" (sharp #7). HH:MM 뒤 "반" 은 지원 안 함 (모호).
    s = s.replace(/(\d{1,2})\s*시\s*반/g, '$1:30');

    // SWM detail 페이지 quirk: "14:00시 ~ 16:00시" — HH:MM 뒤 시 suffix 선제 제거.
    s = s.replace(/(\d{1,2}:\d{2})\s*시/g, '$1');
    // "13시 30분" / "13시30분" → "13:30"
    s = s.replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, (_, h, m) => `${h}:${String(+m).padStart(2, '0')}`);
    // "19시" (뒤에 숫자 없으면) → "19:00"
    s = s.replace(/(\d{1,2})\s*시(?!\s*\d)/g, (_, h) => `${h}:00`);

    // 부터/까지 (sharp #9). 부터 → ~, 끝의 까지 → 삭제.
    s = s.replace(/\s*부터\s*/g, ' ~ ');
    s = s.replace(/\s*까지만?(?!\d)/g, '');

    return s;
  }

  // prefix 토큰 → AM/PM 판정.
  // Korean AM (오전/아침/새벽) vs English AM (am/AM) 는 12 시 해석이 다름.
  //  · Korean AM + 12 → 정오 (12:00)   — 문화적 관행 "오전 12시 = 낮 12시"
  //  · English AM + 12 → 자정 (00:00) — 기술적 표준 "12 AM = midnight"
  // PM + 12 → 그대로 12 (정오, 둘 다 동일).
  function _isPm(t) { return !!t && /오후|저녁|밤|PM|pm/.test(t); }
  function _isKoreanAm(t) { return !!t && /오전|아침|새벽/.test(t); }
  function _isEnglishAm(t) { return !!t && /AM|am/.test(t); }
  function _isAnyAm(t) { return _isKoreanAm(t) || _isEnglishAm(t); }

  function parseTimeRange(str) {
    if (!str) return null;
    const s = normalizeRangeText(str);

    const tryPack = (h1, m1, h2, m2) => {
      if (![h1, m1, h2, m2].every(Number.isFinite)) return null;
      // v1.16.1 §B2: boundary 강화.
      // - h1 ≤ 23 (시작 시각은 실제 시계 범위)
      // - h2 ≤ 27 (overnight 고려해 25:00~27:00 같은 명시 야간 표기는 허용,
      //            "25:00~28:00" 처럼 양쪽 모두 그리드 밖은 reject)
      // - duration ≤ 14h (a2 실데이터 기준 >14h 강연 사례 0건)
      if (h1 < 0 || h1 > 24 || h2 < 0 || h2 > 28) return null;
      if (m1 < 0 || m1 > 59 || m2 < 0 || m2 > 59) return null;
      let startMin = h1 * 60 + m1;
      let endMin = h2 * 60 + m2;
      if (endMin === startMin) return { startMin, endMin }; // 0분 (멘토 입력 오류 수용)
      if (endMin < startMin) endMin += 24 * 60; // 야간
      // 16h 초과 reject — 14h 로 조이면 stale "00:00~16:00" 블록이 파싱 실패하여 내 신청이 사라짐.
      // 시각 clamp 는 blockPos 에서 담당하므로 parser 는 관대하게.
      if (endMin - startMin > 16 * 60) return null;
      return { startMin, endMin };
    };

    // 확장 regex: 앞·뒤 모두 optional ampm/저녁/밤/아침/새벽 tag, 콜론 기반 HH:MM 쌍.
    const PREFIX = '(오전|오후|저녁|밤|아침|새벽|AM|PM|am|pm)?';
    const HM = '(\\d{1,2}):(\\d{2})';
    const SEP = '\\s*[~\\-–—]\\s*';
    const re = new RegExp(`${PREFIX}\\s*${HM}${SEP}${PREFIX}\\s*${HM}`);
    const m = s.match(re);
    if (!m) return null;

    const adj = (h, tag, fallback) => {
      const explicit = !!tag;
      const eff = tag || fallback;
      if (_isPm(eff) && h < 12) return h + 12;
      if (h === 12) {
        if (_isEnglishAm(eff)) return 0;             // 12 AM = midnight
        if (_isKoreanAm(eff)) {
          // explicit Korean AM 12 → 0 (자정) 으로 가는 것이 안전. 다만 end 위치에서
          // start 로부터 AM 을 상속(!explicit) 한 경우엔 12 는 정오 (sharp #3).
          if (!explicit && _isKoreanAm(fallback)) return 12;
          return 0;
        }
      }
      return h;
    };
    const h1 = adj(+m[2], m[1], null);
    // end 위치는 두 해석 (inherit / no-inherit) 을 모두 시도한 뒤 더 짧은 유효 range
    // 를 채택. "저녁 7시 ~ 9시" (inherit 시 2h) 는 정답, "밤 11시 ~ 1시" (inherit 시
    // 14h overnight, no-inherit 시 2h) 는 no-inherit 가 정답. 이 규칙 하나로 sharp
    // #3 (오전 상속 12) + #4 (저녁/밤/아침/새벽) + a2 야간 강연을 일관되게 처리.
    const h2Inherit = adj(+m[5], m[4], m[1]);
    const h2Alone   = adj(+m[5], m[4], null);
    const r1 = tryPack(h1, +m[3], h2Inherit, +m[6]);
    if (h2Inherit === h2Alone) return r1; // 상속 의미 없는 케이스
    const r2 = tryPack(h1, +m[3], h2Alone, +m[6]);
    if (r1 && r2) return (r1.endMin - r1.startMin) <= (r2.endMin - r2.startMin) ? r1 : r2;
    return r1 || r2;
  }

  // ──────────────────────────────────────────────
  // 원본 "강의날짜" 문자열에서 lecDate(YYYY-MM-DD) + lecTime("HH:MM ~ HH:MM") 추출.
  // v1.16.1: content.js 의 extractLecDateTime 를 이 함수로 집약. 외부 호출자는
  //          `window.SWM_TIME.extractLecDateTime` 또는 `window.SWM.extractLecDateTime`
  //          를 호출 (둘 다 같은 구현 참조).
  // 반환: { lecDate, lecTime, range }. 실패 필드는 빈 문자열/null.
  //
  // 24:00 정책: endMin === 1440 이면 "24:00" 문자열을 보존. 다음 날 00:00 으로 wrap
  // 하지 않는다 — iCal export 는 parseTimeRange 결과의 endMin 를 보고 +1day 처리.
  // ──────────────────────────────────────────────
  function extractLecDateTime(raw) {
    const out = { lecDate: '', lecTime: '', range: null };
    if (!raw) return out;
    const s = String(raw).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const dM = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (dM) {
      out.lecDate = `${dM[1]}-${String(+dM[2]).padStart(2, '0')}-${String(+dM[3]).padStart(2, '0')}`;
    }
    const r = parseTimeRange(s);
    if (r) {
      out.range = r;
      const sDisp = minToHHMM(r.startMin % (24 * 60));
      // endMin === 1440 (정확히 24:00) 은 "24:00" 문자열로 보존. 야간(24:00 초과)
      // 은 % 1440 로 wrap. startMin 기준 상대로 정의.
      let eDisp;
      if (r.endMin === 24 * 60) {
        eDisp = '24:00';
      } else if (r.endMin > 24 * 60) {
        eDisp = minToHHMM(r.endMin - 24 * 60);
      } else {
        eDisp = minToHHMM(r.endMin);
      }
      out.lecTime = `${sDisp} ~ ${eDisp}`;
    }
    return out;
  }

  // v1.16.1: parseLecDateTime 은 extractLecDateTime 의 alias (하위 호환).
  const parseLecDateTime = extractLecDateTime;

  // 주어진 Date의 이번 주 월요일 00:00 로 정규화
  function mondayOf(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  // YYYY-MM-DD
  function fmtISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // "4/13 (월)"
  function fmtDayHeader(date) {
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const wdays = ['일', '월', '화', '수', '목', '금', '토'];
    return `${m}/${d} (${wdays[date.getDay()]})`;
  }

  // 두 인터벌 겹침
  function overlaps(a, b) {
    if (!a || !b) return false;
    return !(a.endMin <= b.startMin || a.startMin >= b.endMin);
  }

  // min → "HH:MM". 24:00 보존 (1440 → "24:00"), 그 외는 % 1440.
  function minToHHMM(min) {
    if (min === 24 * 60) return '24:00';
    const n = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(n / 60);
    const m = n % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // 강연이 이미 시작했는가 (과거 or 오늘인데 시작 분이 지남)
  function hasStarted(l) {
    if (!l || !l.lecDate) return false;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (l.lecDate < today) return true;
    if (l.lecDate > today) return false;
    if (!l.lecTime) return false;
    const r = parseTimeRange(l.lecTime);
    if (!r) return false;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return r.startMin <= nowMin;
  }

  // 강연 시작까지 남은 시간 (hour). 시작 시각 없으면 lecDate 00:00 기준. 이미 시작했으면 음수.
  function hoursUntilStart(l) {
    if (!l || !l.lecDate) return Infinity;
    const [y, m, d] = l.lecDate.split('-').map(Number);
    const r = parseTimeRange(l.lecTime);
    const startMin = r ? r.startMin : 0;
    const startAt = new Date(y, m - 1, d, Math.floor(startMin / 60), startMin % 60, 0, 0);
    return (startAt.getTime() - Date.now()) / 3_600_000;
  }

  const API = {
    parseTimeRange,
    parseLecDateTime,      // alias → extractLecDateTime
    extractLecDateTime,    // 정식 이름 (v1.16.1)
    mondayOf,
    addDays,
    fmtISO,
    fmtDayHeader,
    overlaps,
    minToHHMM,
    hasStarted,
    hoursUntilStart,
  };

  if (typeof window !== 'undefined') {
    window.SWM_TIME = API;
    // legacy globals (popup.js / timetable.js 가 bare name 로 호출)
    window.parseTimeRange = parseTimeRange;
    window.parseLecDateTime = parseLecDateTime;
    window.mondayOf = mondayOf;
    window.addDays = addDays;
    window.fmtISO = fmtISO;
    window.fmtDayHeader = fmtDayHeader;
    window.overlaps = overlaps;
    window.minToHHMM = minToHHMM;
    window.hasStarted = hasStarted;
    window.hoursUntilStart = hoursUntilStart;

    // content script: detail.js / content.js 가 window.SWM 네임스페이스도 참조.
    // 여기서 미리 세팅해 detail.js 가 lib 로드 순서에 의존하지 않게 함.
    window.SWM = window.SWM || {};
    if (!window.SWM.extractLecDateTime) window.SWM.extractLecDateTime = extractLecDateTime;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();
