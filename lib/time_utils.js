// 시간표 관련 유틸

// "HH:MM ~ HH:MM" 또는 "HH:MM시 ~ HH:MM" 등 변형 포맷을 허용
// 리턴: { startMin, endMin } (자정부터 분 단위) 또는 null
function parseTimeRange(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2}):(\d{2})[^\d]{1,10}(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return {
    startMin: +m[1] * 60 + +m[2],
    endMin: +m[3] * 60 + +m[4],
  };
}

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
  return !(a.endMin <= b.startMin || a.startMin >= b.endMin);
}

// min → "HH:MM"
function minToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 강연이 이미 시작했는가 (과거 or 오늘인데 시작 분이 지남)
function hasStarted(l) {
  if (!l.lecDate) return false;
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
