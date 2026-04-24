// ─── 스크린샷용 더미 데이터 주입 (실 데이터 자동 백업) ────────────────────
// 사용법:
//   1. 본인 실 계정에서 확장 사용 중인 상태로, 팝업 또는 시간표 열기
//   2. F12 → Console 탭
//   3. 이 파일 전체 복사 → 붙여넣기 → Enter
//   4. "✅ 주입 완료" 뜨면 팝업/시간표 닫았다가 다시 열기 → 더미 데이터 반영
//   5. 스크린샷 6장 촬영
//   6. 복원: Console 에 다음 입력
//        await chrome.storage.local.set(JSON.parse(localStorage.__swm_backup__));
//        localStorage.removeItem('__swm_backup__');
//        console.log('복원 완료 — 탭 닫았다가 다시 열기');
//
//   ⚠ 만약 더미 주입 후 다른 브라우저 창을 닫았거나 localStorage 비었으면 복원 불가.
//      동기화 버튼 다시 눌러서 재수집.
// ─────────────────────────────────────────────────────────────────────
(async () => {
  // ── 1. 현재 storage 백업 (이미 백업 있으면 덮어쓰지 않음 — 원본 보호) ──
  const cur = await chrome.storage.local.get(null);
  if (localStorage.getItem('__swm_backup__')) {
    console.log(`🗂 기존 백업 유지 (재주입 시나리오)`);
  } else {
    localStorage.setItem('__swm_backup__', JSON.stringify(cur));
    console.log(`🗂 백업 완료 (lectures ${Object.keys(cur.lectures||{}).length}건, favorites ${(cur.favorites||[]).length}건)`);
  }

  // ── 2. 더미 데이터 생성 ──
  const mondayOf = (d = new Date()) => { const dt = new Date(d); const day = dt.getDay();
    dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
    dt.setHours(0, 0, 0, 0); return dt; };
  const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const fmtISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const MON = mondayOf();

  const ENTRIES = [
    // [day, start, end, categoryNm, title, mentor, isOnline]
    [0, '09:00', '10:30', '멘토 특강', 'LLM 파인튜닝 실전 — Llama/Qwen 로드맵', '이현수', true],
    [0, '11:00', '12:30', '자유 멘토링', 'RAG 에이전트 설계와 검색 품질', '김민수', false],
    [0, '14:00', '16:00', '멘토 특강', 'AWS 아키텍처 마이그레이션 케이스', '박준호', true],
    [0, '16:30', '18:00', '자유 멘토링', '쿠버네티스 K8s 운영 노하우', '정서연', true],
    [0, '19:00', '21:00', '멘토 특강', 'React 18 동시성 모델 깊이', '최도윤', true],
    [1, '09:30', '11:00', '자유 멘토링', '스타트업 투자 유치 전략과 IR', '한수정', false],
    [1, '11:30', '13:00', '멘토 특강', '프로덕트 매니저 커리어 로드맵', '조우진', true],
    [1, '13:30', '15:30', '자유 멘토링', '데이터 파이프라인 ETL 실전', '윤서진', false],
    [1, '16:00', '18:00', '멘토 특강', '웹 보안 해킹 방어 실습', '강태희', true],
    [1, '19:00', '20:30', '자유 멘토링', 'MSA 마이크로서비스 Kafka 설계', '오하늘', true],
    [2, '09:00', '11:00', '멘토 특강', 'iOS/Flutter 모바일 앱 출시 가이드', '서준형', true],
    [2, '11:30', '13:00', '자유 멘토링', '알고리즘 코딩테스트 실전', '임다빈', false],
    [2, '14:00', '15:30', '멘토 특강', 'DevOps CI/CD 모니터링 Observability', '김민수', true],
    [2, '16:00', '17:30', '자유 멘토링', 'Unity 게임 개발 그래픽스', '이지은', false],
    [2, '18:00', '20:00', '멘토 특강', '블록체인 스마트 컨트랙트 Web3', '박준호', true],
    [2, '20:30', '22:00', '자유 멘토링', '리눅스 커널 임베디드 펌웨어', '정서연', false],
    [3, '10:00', '12:00', '멘토 특강', '아이디어 검증과 프로덕트 기획', '최도윤', true],
    [3, '13:00', '15:00', '자유 멘토링', '팀 빌딩 회고 KPT 실습', '한수정', false],
    [3, '15:30', '17:00', '멘토 특강', '주니어 개발자 이직 면접 전략', '조우진', true],
    [3, '17:30', '19:00', '자유 멘토링', '리팩토링과 테스트 코드 작성법', '윤서진', true],
    [3, '19:30', '21:00', '멘토 특강', '소마 연수생 오피스아워', '강태희', false],
    [4, '09:30', '11:30', '자유 멘토링', 'Terraform IaC 클라우드 인프라', '오하늘', true],
    [4, '12:00', '13:30', '멘토 특강', '벡터DB 임베딩 검색 튜닝', '서준형', true],
    [4, '14:30', '16:30', '자유 멘토링', 'Next.js 14 서버 컴포넌트', '임다빈', false],
    [4, '17:00', '18:30', '멘토 특강', 'MLOps 실무 파이프라인', '김민수', true],
    [4, '19:00', '21:00', '자유 멘토링', '개발자 커리어 성장 로드맵', '이지은', true],
    [5, '10:00', '12:00', '멘토 특강', 'Rust 시스템 프로그래밍 실전', '박준호', false],
    [5, '14:00', '16:00', '자유 멘토링', '오픈소스 기여와 PR 리뷰', '정서연', true],
    [5, '18:00', '20:00', '멘토 특강', 'AI 에이전트 디자인 패턴', '최도윤', true],
    [6, '10:00', '12:00', '자유 멘토링', '1인 개발 수익화 사이드프로젝트', '한수정', false],
    [6, '15:00', '17:00', '멘토 특강', '대규모 트래픽 백엔드 Spring 설계', '조우진', true],
  ];

  const ONLINE_LOCS = ['온라인(Webex)', '온라인 Zoom', '온라인 Google Meet'];
  const OFFLINE_LOCS = ['서울 강남구 스페이스A7 2층', '성수 센터 B1 세미나실', '코엑스 5층 501호'];

  const lectures = {};
  let sn = 9800;
  ENTRIES.forEach((e, i) => {
    const [day, s, t, categoryNm, title, mentor, isOnline] = e;
    const id = String(sn++);
    const category = categoryNm === '멘토 특강' ? 'MRC020' : 'MRC010';
    const max = category === 'MRC020' ? 12 : 4;
    const curr = Math.max(1, Math.floor(Math.random() * max));
    lectures[id] = {
      sn: id,
      title: `[${categoryNm}] ${title}`,
      category, categoryNm, status: 'A',
      lecDate: fmtISO(addDays(MON, day)),
      lecTime: `${s} ~ ${t}`,
      count: { current: curr, max },
      mentor,
      regDate: fmtISO(addDays(new Date(), -7)),
      regPeriod: `${fmtISO(addDays(new Date(), -7))} ~ ${fmtISO(addDays(MON, day))}`,
      location: isOnline ? ONLINE_LOCS[i % 3] : OFFLINE_LOCS[i % 3],
      isOnline,
      description: `${title} 실전 경험 공유. 참여자 질의응답 포함.\n\n담당: ${mentor}\n대상: 연수생 전원`,
      detailFetched: true,
    };
  });

  const snList = Object.keys(lectures);
  // applied 는 전부 미래 (목~일, day 3-6) — 취소 버튼 노출 보장.
  // ENTRIES 인덱스: day3 = 16~20, day4 = 21~25, day5 = 26~28, day6 = 29~30
  const appliedIdx = [16, 18, 20, 21, 23, 24, 26, 28, 29, 30];
  // favorites 는 전 요일 분산 (즐겨찾기는 날짜 제약 없음)
  const favIdx     = [1, 2, 4, 7, 10, 11, 13, 17, 19, 22, 25, 27, 30];
  appliedIdx.forEach(i => {
    if (!snList[i]) return;
    lectures[snList[i]].applied = true;
    lectures[snList[i]].applySn = String(40000 + parseInt(snList[i]));
  });
  const favorites = favIdx.map(i => snList[i]).filter(Boolean);

  const meta = {
    knownLectureSns: snList,
    lastFullSync: new Date().toISOString(),
    lastSync: new Date().toISOString(),
  };

  // 온보딩 / 코치마크 이미 본 것으로 처리 (캡처 시 오버레이 방지)
  const curSettings = cur.settings || {};
  const settings = {
    ...curSettings,
    onboardingSeen: true,
    timetableCoachmarkSeen: true,
  };

  await chrome.storage.local.clear();
  await chrome.storage.local.set({ lectures, favorites, meta, settings });
  console.log(`✅ 주입 완료: ${snList.length} 강연, applied ${appliedIdx.length}, favorites ${favIdx.length}`);
  console.log(`🔙 복원 명령 (캡처 후):`);
  console.log(`   await chrome.storage.local.clear(); await chrome.storage.local.set(JSON.parse(localStorage.__swm_backup__)); localStorage.removeItem('__swm_backup__'); console.log('복원 완료');`);
})();
