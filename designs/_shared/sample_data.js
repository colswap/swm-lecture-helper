// 모든 variant 프리뷰가 공유하는 샘플 데이터 + Lucide 아이콘 셋
export const SAMPLE = [
  {
    sn: '9714', category: 'special', categoryNm: '특강',
    title: '[AI 기초] RAG 기초 이론 & 실습',
    date: '4/18', time: '19:00 ~ 21:00',
    mentor: '이현수', count: { current: 3, max: 10 },
    location: '온라인(Webex)', isOnline: true,
    status: 'A', applied: false, favorite: true,
  },
  {
    sn: '9338', category: 'special', categoryNm: '특강',
    title: 'AI 에이전트의 두뇌 만들기: 프로젝트 지식을 AI가 읽고 쓰게',
    date: '4/15', time: '19:00 ~ 21:00',
    mentor: '이현수', count: { current: 6, max: 6 },
    location: '토즈-강남역', isOnline: false,
    status: 'C', applied: true, favorite: false,
  },
  {
    sn: '9623', category: 'free', categoryNm: '멘토링',
    title: '229명의 멘토 중 유일하게 알려줄 수 있는 인프라 아키텍처',
    date: '4/13', time: '12:30 ~ 13:30',
    mentor: '정인호', count: { current: 3, max: 5 },
    location: '온라인(Webex)', isOnline: true,
    status: 'A', applied: false, favorite: true,
  },
  {
    sn: '9420', category: 'free', categoryNm: '멘토링',
    title: '바이브코딩 - 심화반',
    date: '4/22', time: '19:00 ~ 21:00',
    mentor: '정진우', count: { current: 4, max: 4 },
    location: '토즈-홍대점', isOnline: false,
    status: 'C', applied: true, favorite: false,
  },
  {
    sn: '9715', category: 'special', categoryNm: '특강',
    title: 'LLM 서빙 최적화: GPU 선택과 양자화 실무 가이드',
    date: '4/13', time: '20:00 ~ 22:00',
    mentor: '이상호', count: { current: 4, max: 20 },
    location: '온라인(Webex)', isOnline: true,
    status: 'A', applied: false, favorite: false,
  },
];
