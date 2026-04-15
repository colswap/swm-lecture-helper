// 스크린샷용 더미 데이터. 실 사용자처럼 촘촘하게.
// "강연 많이 듣는 파워 유저" 컨셉: 매일 여러 개 블록, applied/favorite 많음.

function mondayOf(d = new Date()) {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const MON = mondayOf();

const MENTORS = ['김민수', '이지은', '박준호', '정서연', '최도윤', '한수정', '조우진', '윤서진', '강태희', '오하늘', '서준형', '임다빈'];

const TITLES_SPECIAL = [
  'LLM 애플리케이션 실전 설계',
  '스타트업 투자 유치 전략',
  '클라우드 인프라 최적화 사례',
  'React 18 동시성 모델',
  'MLOps 실무 파이프라인',
  '모바일 앱 성능 튜닝',
  '데이터 엔지니어링 입문',
  '프로덕트 매니저 커리어',
  'Kubernetes 운영 노하우',
  'AI 에이전트 설계 패턴',
  '대규모 Node.js 백엔드',
  'Rust 웹 서버 실전',
  'Next.js 14 마이그레이션',
  '사이드카 아키텍처 사례',
  '벡터DB 활용법',
];
const TITLES_FREE = [
  '프론트엔드 커리어 패스',
  '백엔드 아키텍처 리뷰',
  'AI 제품 기획 방법론',
  '기술 블로그 작성법',
  '개발자 네트워킹 노하우',
  '면접 준비 전략',
  '오픈소스 기여 가이드',
  '소마 프로젝트 회고',
  '사이드 프로젝트 선정',
  '커뮤니티 활동 팁',
  '1인 개발 수익화',
  '팀 리딩 경험 공유',
];

const LOC_ONLINE = [
  '온라인 Webex https://webex.meeting/swm-mentor',
  '온라인 Zoom',
  '온라인 Google Meet',
  '온라인 Discord 보이스 채널',
];
const LOC_OFFLINE = [
  '서울 강남구 스페이스 A7 2층',
  '성수 센터 B1 세미나실',
  '코엑스 5층 회의실 501',
  '광화문 HQ 3층 열린공간',
];

// 촘촘한 일정 (월~금 × 오전/오후/저녁 + 주말 일부)
const SCHEDULE = [
  [0, '09:00', '10:30'], [0, '11:00', '12:30'], [0, '14:00', '16:00'], [0, '16:30', '18:00'], [0, '19:00', '21:00'], [0, '20:30', '22:00'],
  [1, '09:30', '11:00'], [1, '11:30', '13:00'], [1, '13:30', '15:30'], [1, '16:00', '18:00'], [1, '19:00', '20:30'], [1, '21:00', '22:30'],
  [2, '09:00', '11:00'], [2, '11:30', '13:00'], [2, '14:00', '15:30'], [2, '16:00', '17:30'], [2, '18:00', '20:00'], [2, '20:30', '22:00'],
  [3, '10:00', '12:00'], [3, '13:00', '15:00'], [3, '15:30', '17:00'], [3, '17:30', '19:00'], [3, '19:30', '21:00'],
  [4, '09:30', '11:30'], [4, '12:00', '13:30'], [4, '14:30', '16:30'], [4, '17:00', '18:30'], [4, '19:00', '21:00'],
  [5, '10:00', '12:00'], [5, '14:00', '16:00'], [5, '18:00', '20:00'],
  [6, '10:00', '12:00'], [6, '15:00', '17:00'],
];

const lectures = {};
let snCounter = 9800;

for (let i = 0; i < SCHEDULE.length; i++) {
  const [dayOff, tStart, tEnd] = SCHEDULE[i];
  const isSpecial = i % 2 === 0;
  const titlePool = isSpecial ? TITLES_SPECIAL : TITLES_FREE;
  const title = titlePool[i % titlePool.length];
  const category = isSpecial ? 'MRC020' : 'MRC010';
  const categoryNm = isSpecial ? '멘토 특강' : '자유 멘토링';
  const mentor = MENTORS[i % MENTORS.length];
  const isOnline = (i % 4) !== 0;
  const location = isOnline ? LOC_ONLINE[i % LOC_ONLINE.length] : LOC_OFFLINE[i % LOC_OFFLINE.length];
  const maxCnt = isSpecial ? 12 : 4;
  const currentCnt = Math.max(1, Math.floor(Math.random() * (maxCnt)));

  const lecDate = fmtISO(addDays(MON, dayOff));
  const sn = String(snCounter++);

  lectures[sn] = {
    sn,
    title: `[${categoryNm}] ${title}`,
    category,
    status: 'A',
    lecDate,
    lecTime: `${tStart} ~ ${tEnd}`,
    count: { current: currentCnt, max: maxCnt },
    mentor,
    regDate: fmtISO(addDays(new Date(), -7)),
    regPeriod: `${fmtISO(addDays(new Date(), -7))} ~ ${fmtISO(addDays(MON, dayOff))}`,
    location,
    isOnline,
    description: isSpecial
      ? `이번 특강에서는 ${title}을 주제로 실무 경험과 최신 트렌드를 공유합니다. 참여자 질의응답 시간 포함, 실전 예제 위주로 진행됩니다.`
      : `${title}에 관심 있는 연수생을 위한 자유 멘토링입니다. 소규모로 진행되며 개별 질문 환영합니다.`,
    detailFetched: true,
  };
}

const snList = Object.keys(lectures);

// 강연 많이 듣는 파워유저 — 신청 10건, 즐겨찾기 14건 (요일별 분산)
const appliedPicks = [0, 3, 6, 9, 13, 16, 19, 22, 24, 27];
const favoritePicks = [1, 4, 7, 10, 11, 14, 15, 17, 20, 23, 25, 28, 30, 32];

const appliedSns = appliedPicks.map(i => snList[i]).filter(Boolean);
for (const sn of appliedSns) {
  lectures[sn].applied = true;
  lectures[sn].applySn = String(40000 + parseInt(sn));
}

const favorites = favoritePicks.map(i => snList[i]).filter(Boolean);

// meta
const meta = {
  knownLectureSns: snList,
  lastFullSync: new Date().toISOString(),
  lastSync: new Date().toISOString(),
};

// settings
const settings = {
  notifyNewLecture: true,
  notifySlotOpen: true,
  watchedMentors: [],
  keywords: [],
};

module.exports = { lectures, favorites, meta, settings };

if (require.main === module) {
  console.log(JSON.stringify({
    lecturesCount: Object.keys(lectures).length,
    appliedCount: appliedSns.length,
    favoritesCount: favorites.length,
    sample: Object.values(lectures).slice(0, 2),
  }, null, 2));
}
