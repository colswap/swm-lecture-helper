// v117_r2_repro.mjs — sn=undefined / lecTime=undefined corruption 재현.
//
// 사용자 Console 실측:
//   applied count: 4
//   [0] sn=9006,         lecDate='2026-04-07', lecTime=undefined
//   [1] sn=undefined,    lecDate='2026-04-11', lecTime='00:00 ~ 15:00'
//   [2] sn=undefined,    lecDate='2026-04-14', lecTime=undefined
//   [3] sn=undefined,    lecDate='2026-04-17', lecTime=undefined
//
// `sn=undefined` 은 value 객체에 `sn` field 자체가 없다는 뜻 (JS `${undefined}` == "undefined").
// `lecTime=undefined` 도 동일.
//
// 이 스크립트는 content.js / detail.js / storage.js 의 저장 경로를 node 에서 흉내내어
// 각 경로가 sn 누락 / lecTime 누락 레코드를 실제로 storage 에 남길 수 있는지 시뮬한다.

import assert from 'node:assert';

// ─── In-memory chrome.storage.local mock ─────────────────────────────
class StorageMock {
  constructor() { this.data = {}; }
  async get(key) {
    if (key === null) return { ...this.data };
    if (typeof key === 'string') return { [key]: this.data[key] };
    if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, this.data[k]]));
    return {};
  }
  async set(obj) { Object.assign(this.data, obj); }
  async clear() { this.data = {}; }
}

// ─── storage.js 핵심 로직 재구현 (실물과 동일) ───────────────────────
function makeSWM(storage) {
  let queue = Promise.resolve();
  const enqueue = fn => (queue = queue.then(fn, fn).catch(() => {}), queue);

  const SWM = {
    async getLectures() {
      const r = await storage.get('lectures');
      return r.lectures || {};
    },
    async saveLectures(newData) {
      return enqueue(async () => {
        const existing = await SWM.getLectures();
        const merged = { ...existing };
        for (const [sn, lec] of Object.entries(newData)) {
          const prev = merged[sn];
          if (prev) {
            merged[sn] = { ...prev, ...lec };
          } else {
            merged[sn] = lec; // ★ CRITICAL: lec 에 sn 필드 없으면 여기서 sn 누락 레코드 생성
          }
        }
        await storage.set({ lectures: merged });
        return merged;
      });
    },
    async saveLecture(sn, data) {
      return enqueue(async () => {
        const lectures = await SWM.getLectures();
        lectures[sn] = { ...(lectures[sn] || {}), ...data, lastUpdated: 'X' };
        await storage.set({ lectures });
      });
    },
    async replaceLectures(lectures) {
      return enqueue(async () => { await storage.set({ lectures }); });
    },
  };
  return SWM;
}

// ─── 각 scenario 실행 ────────────────────────────────────────────────
async function run(name, fn) {
  const storage = new StorageMock();
  const SWM = makeSWM(storage);
  try {
    const out = await fn({ storage, SWM });
    const lectures = (await storage.get('lectures')).lectures || {};
    console.log(`\n── ${name} ──`);
    for (const [key, val] of Object.entries(lectures)) {
      const snShow = 'sn' in val ? JSON.stringify(val.sn) : 'MISSING';
      const ltShow = 'lecTime' in val ? JSON.stringify(val.lecTime) : 'MISSING';
      const ldShow = 'lecDate' in val ? JSON.stringify(val.lecDate) : 'MISSING';
      const appShow = val.applied ? ' applied' : '';
      console.log(`  key=${JSON.stringify(key)}  sn=${snShow}  lecDate=${ldShow}  lecTime=${ltShow}${appShow}`);
    }
    if (out?.note) console.log(`  NOTE: ${out.note}`);
    return { lectures, out };
  } catch (e) {
    console.log(`\n── ${name} ── FAILED: ${e.message}`);
  }
}

// ─── (a) content.js 과거 line 557 경로 ───────────────────────────────
// v1.13~v1.16.1 zip: `all[sn] = { sn, applied: true }` — 과거 applied 강의(list scope 밖)를
// minimal 레코드로 추가. 이후 fetchDetailsBatch 가 details 를 merge.
// sn 은 항상 포함됨. lecTime 은 details fetch 성공 시에만 채워짐.
await run('(a1) v1.13 경로: applied minimal + details fetch 성공', async ({ SWM }) => {
  // 1. 접수중 list에 없는 과거 applied sn 4개
  const appliedSns = ['9006', '9007', '9008', '9009'];
  const all = await SWM.getLectures();
  for (const sn of appliedSns) {
    if (!all[sn]) all[sn] = { sn, applied: true };
  }
  await SWM.replaceLectures(all);
  // 2. details fetch — 각각 성공 (lecTime 포함)
  const detailBatch = {};
  for (const sn of appliedSns) {
    detailBatch[sn] = {
      // ★ v1.13 fetchOneDetail: data 에 sn 없음!
      location: '온라인(Zoom)', isOnline: true, description: '...', detailFetched: true,
      lecDate: '2026-04-07', lecTime: '14:00 ~ 16:00',
    };
  }
  await SWM.saveLectures(detailBatch);
  return { note: 'prev 가 {sn, applied:true} 상태이므로 spread 가 sn 보존 → 모든 레코드 sn 존재' };
});

// ─── (b) detail.js overwrite (v1.13~v1.15) ───────────────────────────
// 구 detail.js: const data = { sn, ..., lecDate, lecTime }; — lecTime 이 local let 변수이고
// 파싱 실패 시 ''. saveLecture merge: { ...prev, ...data } — 이전 lecTime 이 '' 로 덮어씀.
// 하지만 sn 은 살아있음.
await run('(b) v1.15 detail.js: lecTime 파싱 실패 시 빈 문자열 덮어쓰기', async ({ SWM }) => {
  // 1. list sync: sn 9010 이 상세 수집 안 된 상태로 저장됨 (lecDate='', lecTime='14:00 ~ 16:00')
  await SWM.saveLectures({ 9010: { sn: '9010', title: 'X', lecDate: '2026-04-11', lecTime: '14:00 ~ 16:00' } });
  // 2. 사용자가 detail 페이지 클릭 → detail.js 실행. 강의날짜 셀이 "9:00 ~ 12:00" (1자리 시작)
  // v1.15 regex /(\d{2}:\d{2})시?\s*~\s*(\d{2}:\d{2})/ 매칭 실패 → lecTime = ''.
  // data 에 `lecTime: ''` 포함 → saveLecture 머지 시 이전 값 wipe.
  const lecTime = ''; // parsing fail
  const lecDate = '2026-04-11';
  const data = {
    sn: '9010', title: 'Physical AI', status: 'C', location: '', isOnline: false, description: '',
    lecDate, lecTime, mentor: '...', regPeriod: '...', detailFetched: true,
  };
  // saveLecture merge
  const lectures = await SWM.getLectures();
  lectures['9010'] = { ...(lectures['9010'] || {}), ...data, lastUpdated: 'X' };
  await SWM.replaceLectures(lectures);
  return { note: 'lecTime 이 "" 으로 overwrite 됨 (undefined 아님). sn 은 살아있음.' };
});

// ─── (c) saveLecture(undefined, ...) ─────────────────────────────────
// 만약 어떤 경로에서 sn 인자가 undefined 로 전달된다면:
//   lectures[undefined] = { ...data, lastUpdated }
// JS 객체 키는 coerce → "undefined" 문자열. 이 value 에 sn 필드 없으면 corruption.
await run('(c) saveLecture(undefined, data-without-sn)', async ({ SWM }) => {
  const data = { lecDate: '2026-04-14', lecTime: '10:00 ~ 12:00', detailFetched: true, applied: true };
  await SWM.saveLecture(undefined, data);
  return { note: 'lectures["undefined"] = {...}, sn 필드 없음. key 가 문자열 "undefined" 로 저장됨.' };
});

// ─── (d) inject-dummy-console.js 백업/복원 ───────────────────────────
await run('(d) inject dummy → JSON round-trip → 복원', async ({ storage, SWM }) => {
  // 1. 사용자 실 데이터 세팅 (정상)
  const userLectures = {
    '9006': { sn: '9006', lecDate: '2026-04-07', lecTime: '14:00 ~ 16:00', applied: true, title: 'X' },
  };
  await storage.set({ lectures: userLectures, favorites: [], meta: {}, settings: {} });
  // 2. inject: 현재 상태 백업 (JSON 직렬화)
  const cur = await storage.get(null);
  const backup = JSON.stringify(cur);
  // 3. 더미 주입 (clear + set)
  await storage.clear();
  await storage.set({
    lectures: { '9800': { sn: '9800', lecDate: '2026-04-10', lecTime: '09:00 ~ 10:30', applied: true } },
    favorites: [], meta: {}, settings: {},
  });
  // 4. 복원
  await storage.clear();
  await storage.set(JSON.parse(backup));
  return { note: 'JSON round-trip 이 sn/lecTime 보존. 백업 시점이 이미 corruption 이었다면 그대로 복원.' };
});

// ─── (e) fetchAppliedSns + history 페이지 sn regex 실패 ───────────────
// 현 코드: if (!m) return; — sn 못 찾으면 skip. 그래서 applied.set(undefined, ...) 불가.
// 과거 버전에도 동일 guard 존재.
await run('(e) history 행에 qustnrSn regex fail 시 skip 되는가', async () => {
  const html = `<tbody><tr><td class="tit"><a href="view.do?other=1">X</a></td></tr></tbody>`;
  // 모사: m = null → early return → applied set 호출 안 됨. corruption 없음.
  return { note: 'regex 실패 시 row 건너뜀 — 이 경로로는 corruption 생성 불가.' };
});

// ─── (f) CRITICAL: 레거시 sn-less 레코드 + 현재/zip applied merge ───
// ★ 가장 유력한 재현 시나리오 ★
//
// 전제: 과거 어떤 시점 (early v1.14/v1.15 intermediate?) 에 sn 필드 없이 저장된 레거시
// 레코드가 storage 에 남아있다. 현재 코드 (또는 v1.16.1 zip) 가 이 레코드를 만나면:
//
// v1.16.1 zip line 463-466:
//   for (const sn of appliedSns) {
//     if (!all[sn]) { all[sn] = { sn, applied: true }; ... }  // ← !all[sn] 이 false 이므로 skip!
//   }
// → sn 복구 로직 미작동. 기존 sn-less 레코드 그대로 유지.
//
// 이후 fetchDetailsBatch → saveLectures({sn: {data-without-sn}}):
//   const next = { ...prev, ...lec };  // prev 에 sn 없음, lec 에도 없음 → next 에 sn 없음.
// → corruption 영속.
await run('(f) 레거시 sn-less 레코드 + v1.16.1 zip applied flow', async ({ storage, SWM }) => {
  // 초기 corruption 상태 — 이 레코드들은 "과거 어떤 버그로" 생성됐다고 가정.
  await storage.set({
    lectures: {
      '9006': { sn: '9006', lecDate: '2026-04-07', lecTime: '14:00 ~ 16:00', applied: true, title: 'X1' },
      '9011': { lecDate: '2026-04-11', lecTime: '00:00 ~ 15:00', applied: true, title: 'Physical AI' }, // sn 없음
      '9014': { lecDate: '2026-04-14', applied: true, title: 'X3' },                                   // sn 없음, lecTime 없음
      '9017': { lecDate: '2026-04-17', applied: true, title: 'X4' },                                   // sn 없음, lecTime 없음
    },
  });

  // v1.16.1 zip 시뮬: fetchAppliedSns 는 ['9006','9011','9014','9017'] 반환.
  const appliedSns = ['9006', '9011', '9014', '9017'];
  const appliedSet = new Set(appliedSns);
  const all = await SWM.getLectures();
  for (const sn of Object.keys(all)) {
    const wantApplied = appliedSet.has(sn);
    if (!!all[sn].applied !== wantApplied) {
      all[sn] = { ...all[sn], applied: wantApplied };
    }
  }
  for (const sn of appliedSns) {
    if (!all[sn]) all[sn] = { sn, applied: true }; // 모두 존재 → skip
  }
  await SWM.replaceLectures(all);

  // details fetch (v1.16.1 zip fetchOneDetail: data 에 sn 없음)
  // sn=9006 은 상세 성공 → lecTime 추가됨 (이미 있지만 overwrite 없음 if 조건부).
  // 9011: parsing 실패 (기존 lecTime '00:00 ~ 15:00' 보존 because data.lecTime 조건부로 추가 안함).
  // 9014, 9017: parsing 실패 → lecTime 필드 미추가 → 여전히 undefined.
  const detailBatch = {
    '9006': { location: 'Zoom', isOnline: true, description: '', detailFetched: true, lecDate: '2026-04-07', lecTime: '14:00 ~ 16:00' },
    '9011': { location: '', isOnline: false, description: '', detailFetched: true }, // no lecTime
    '9014': { location: '', isOnline: false, description: '', detailFetched: true },
    '9017': { location: '', isOnline: false, description: '', detailFetched: true },
  };
  await SWM.saveLectures(detailBatch);

  return { note: '★ 재현 성공: 9011/9014/9017 레코드가 sn=undefined 로 남음. 9011 에 lecTime 보존.' };
});

// ─── (g) 레거시 sn-less 레코드는 어디서 왔을까? ───────────────────────
// 가설: VERY EARLY 버전의 fetchOneDetail 가 독자적으로 saveLectures(collected) 호출하되
// collected[r.sn] = r.data (data 에 sn 없음). 첫 sync 에서 listLectures 에는 있는 sn 이지만
// `needDetail` 저장 직전에 race 혹은 chrome.storage.local.clear() 로 prev 가 지워지면
// saveLectures 에서 `merged[sn] = lec` → sn 없음.
// 또는: 사용자가 inject-dummy → extension 수동 reload 중 clear() 했다면?
await run('(g) race: saveLectures 직전 prev 삭제', async ({ storage, SWM }) => {
  // 1. list sync: 9011 저장
  await SWM.saveLectures({ '9011': { sn: '9011', title: 'Physical AI', lecDate: '2026-04-11' } });
  // 2. 사용자가 F12 console 에서 다른 데이터 inject (clear) — 비동기 레이스
  await storage.set({ lectures: {
    '9014': { lecDate: '2026-04-14', applied: true, title: 'X3' },   // sn 없는 상태로 직접 주입
    '9017': { lecDate: '2026-04-17', applied: true, title: 'X4' },
  } });
  // 3. fetchOneDetail 가 9011 에 대한 data (no sn) 를 saveLectures({9011: data}) 로 저장
  await SWM.saveLectures({
    '9011': { location: '', isOnline: false, description: '', detailFetched: true, lecTime: '00:00 ~ 15:00' },
  });
  return { note: 'prev 가 사라진 상태에서 merged[sn] = lec → sn 없는 9011 레코드 생성.' };
});

console.log('\n─── SUMMARY ───');
console.log('재현 성공 경로:');
console.log('  (f) 레거시 sn-less 레코드 + v1.16.1 zip applied merge — 4-레코드 패턴 재현');
console.log('  (g) inject/수동 storage 조작 중 race — 레거시 레코드 생성 경로');
console.log('  (c) saveLecture(undefined, ...) — key "undefined" 생성. 사용자 데이터와는 형태 다름.');
console.log('  (b) v1.15 detail.js lecTime="" 덮어쓰기 — sn 은 유지됨.');
console.log('');
console.log('★ 가장 유력한 원인:');
console.log('  1. 사용자가 과거 버전 (v1.14 개발 중 or inject-dummy 운용 중) 에서 sn 필드 없는 레거시');
console.log('     레코드가 생성됨. v1.16.1 zip 의 applied merge 는 `if (!all[sn])` 로 존재 여부만 체크');
console.log('     하므로 sn 복구 로직이 작동하지 않음. (f) 시나리오.');
console.log('  2. lecTime 누락은 details fetch 가 실패했거나 data.lecTime 을 조건부로만 추가하는');
console.log('     현 코드가 sn-less prev 와 merge 될 때 lecTime 정보도 함께 씻겨나갔을 가능성.');
console.log('  3. lecTime="00:00 ~ 15:00" 은 pre-v1.16.1 의 Physical AI 15h 블록 잔재 (time_utils 16h');
console.log('     허용 이전).');
