// node --test test/storage.test.js
//
// v1.16.0 K1 race tests — saveSettings / toggleFavorite 가 병렬 호출 시
// 서로의 필드/상태를 덮어쓰지 않음을 보장.

const { test } = require('node:test');
const assert = require('node:assert');

// ─── chrome.storage.local 인메모리 mock (직렬 큐 정합성 검증용) ───
// set/get 에 의도적으로 작은 async 지연을 걸어 read-modify-write race 를 재현하기 쉽게 함.
function installChromeMock(opts = {}) {
  const delay = opts.delay ?? 5;
  const store = {};
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          await new Promise(r => setTimeout(r, delay));
          if (typeof key === 'string') return { [key]: store[key] };
          return { ...store };
        },
        async set(obj) {
          await new Promise(r => setTimeout(r, delay));
          Object.assign(store, obj);
        },
      },
    },
  };
  return store;
}

function loadSWM() {
  // storage.js 는 전역에 SWM 상수를 정의하고 module.exports 한다.
  // node test 는 매 테스트마다 fresh 큐가 필요하므로 require.cache 초기화.
  delete require.cache[require.resolve('../lib/storage.js')];
  return require('../lib/storage.js');
}

// ─── saveSettings race ───
test('saveSettings: palette + themeMode 병렬 호출 시 둘 다 보존', async () => {
  installChromeMock({ delay: 8 });
  const SWM = loadSWM();

  // 초기값
  await SWM.saveSettings({ initial: true });

  // 동시에 두 개의 patch (palette / themeMode) 를 쏘아준다.
  const [aResult, bResult] = await Promise.all([
    SWM.saveSettings({ palette: 'sakura' }),
    SWM.saveSettings({ themeMode: 'dark' }),
  ]);

  const final = await SWM.getSettings();
  assert.strictEqual(final.palette, 'sakura', 'palette 가 themeMode 쓰기에 덮이지 않아야 함');
  assert.strictEqual(final.themeMode, 'dark', 'themeMode 가 palette 쓰기에 덮이지 않아야 함');
  assert.strictEqual(final.initial, true, '기존 필드 initial 이 보존되어야 함');
  // 두 쓰기 모두 merged 객체를 반환해야 함
  assert.ok(aResult && bResult, 'saveSettings 가 merged 결과를 반환해야 함');
});

test('saveSettings: 3개 이상 병렬 패치도 전부 보존', async () => {
  installChromeMock({ delay: 3 });
  const SWM = loadSWM();

  await Promise.all([
    SWM.saveSettings({ a: 1 }),
    SWM.saveSettings({ b: 2 }),
    SWM.saveSettings({ c: 3 }),
    SWM.saveSettings({ d: 4 }),
    SWM.saveSettings({ e: 5 }),
  ]);

  const final = await SWM.getSettings();
  assert.strictEqual(final.a, 1);
  assert.strictEqual(final.b, 2);
  assert.strictEqual(final.c, 3);
  assert.strictEqual(final.d, 4);
  assert.strictEqual(final.e, 5);
});

test('saveSettings: 동일 키 최종 write 가 이기고 다른 키는 보존', async () => {
  installChromeMock({ delay: 3 });
  const SWM = loadSWM();

  await SWM.saveSettings({ keep: 'yes' });

  await Promise.all([
    SWM.saveSettings({ palette: 'default' }),
    SWM.saveSettings({ palette: 'sakura' }),
  ]);

  const final = await SWM.getSettings();
  // 마지막으로 enqueue 된 쓰기가 최종값 — 둘 중 하나는 확정.
  assert.ok(final.palette === 'default' || final.palette === 'sakura');
  assert.strictEqual(final.keep, 'yes', '무관한 필드는 보존되어야 함');
});

// ─── toggleFavorite race ───
test('toggleFavorite: 동일 sn 에 대해 병렬 2회 → 원래 상태로 복원', async () => {
  installChromeMock({ delay: 5 });
  const SWM = loadSWM();

  // 초기 상태: 즐겨찾기 비어있음.
  const sn = 'lec-42';

  // 병렬 2회 토글 → on, off 순차 처리되어야 함 → 최종 비어있음.
  await Promise.all([SWM.toggleFavorite(sn), SWM.toggleFavorite(sn)]);

  const favs = await SWM.getFavorites();
  assert.ok(!favs.includes(sn), '2회 토글 후 sn 이 즐겨찾기에 없어야 함');
});

test('toggleFavorite: sn 타입 정규화 — number 로 저장돼 있던 레거시도 string 로 토글', async () => {
  // r1-H1: v1.15.0 이하 데이터에 number sn 이 섞여 있어도 string sn 으로 토글 성공해야 함.
  const store = installChromeMock({ delay: 2 });
  store.favorites = [9006, '9602', 10032]; // mixed types 시뮬레이션
  const SWM = loadSWM();

  // 기존 number sn 을 string 으로 off
  let favs = await SWM.toggleFavorite('9006');
  assert.ok(!favs.includes('9006') && !favs.includes(9006), 'number sn 도 off 되어야 함');
  assert.ok(favs.every(s => typeof s === 'string'), '결과 전부 string 이어야 함');

  // 새 sn 추가 (기존 목록에 없는 것 사용)
  favs = await SWM.toggleFavorite(20000); // number 로 호출해도 string 으로 저장
  assert.ok(favs.includes('20000'), 'number 로 넘겨도 string 으로 저장');
  assert.ok(!favs.includes(20000), '저장 후에는 number 아닌 string');
});

test('markUserActivity: _saveQueue 경유하여 lastUserActivity 저장', async () => {
  // r1-C1: 이전엔 chrome.storage.local.set 직접 호출 → queue 우회. 이제 SWM.markUserActivity 로 통일.
  installChromeMock({ delay: 1 });
  const SWM = loadSWM();
  const before = Date.now();
  await SWM.markUserActivity();
  const { lastUserActivity } = await chrome.storage.local.get('lastUserActivity');
  assert.ok(typeof lastUserActivity === 'number', 'lastUserActivity 가 숫자로 저장됨');
  assert.ok(lastUserActivity >= before, 'Date.now() 이후 시각이 저장됨');
});

test('toggleFavorite: 병렬 3회 → 최종 on', async () => {
  installChromeMock({ delay: 5 });
  const SWM = loadSWM();

  const sn = 'lec-99';
  await Promise.all([
    SWM.toggleFavorite(sn),
    SWM.toggleFavorite(sn),
    SWM.toggleFavorite(sn),
  ]);

  const favs = await SWM.getFavorites();
  assert.ok(favs.includes(sn), '3회 토글 후 sn 이 즐겨찾기에 있어야 함');
});

test('toggleFavorite: 서로 다른 sn 병렬 → 둘 다 추가', async () => {
  installChromeMock({ delay: 5 });
  const SWM = loadSWM();

  await Promise.all([
    SWM.toggleFavorite('a'),
    SWM.toggleFavorite('b'),
    SWM.toggleFavorite('c'),
  ]);

  const favs = await SWM.getFavorites();
  assert.deepStrictEqual(new Set(favs), new Set(['a', 'b', 'c']));
});

// ─── notifyModal 저장 race (R8-1) ───
// timetable/menu.js openNotifyModal.save 가 SWM.saveSettings({patch}) 로 이전된 후,
// notify 토글 저장과 theme/palette 변경이 병렬로 일어나도 서로 덮지 않아야 함.
test('saveSettings: notifyModal 저장(병렬) 이 theme/palette 변경을 덮지 않음', async () => {
  installChromeMock({ delay: 6 });
  const SWM = loadSWM();

  await SWM.saveSettings({ palette: 'sakura', themeMode: 'dark' });

  await Promise.all([
    SWM.saveSettings({
      notifyNewLecture: true,
      notifySlotOpen: false,
      notifyMentorMatch: true,
      watchedMentors: ['김멘토'],
    }),
    SWM.saveSettings({ palette: 'night' }),
    SWM.saveSettings({ themeMode: 'light' }),
  ]);

  const final = await SWM.getSettings();
  assert.strictEqual(final.notifyNewLecture, true);
  assert.strictEqual(final.notifySlotOpen, false);
  assert.strictEqual(final.notifyMentorMatch, true);
  assert.deepStrictEqual(final.watchedMentors, ['김멘토']);
  assert.strictEqual(final.palette, 'night', 'palette 가 notify patch 에 덮이지 않아야 함');
  assert.strictEqual(final.themeMode, 'light', 'themeMode 가 notify patch 에 덮이지 않아야 함');
});

// ─── saveSettings + toggleFavorite 혼합 race (큐 공유) ───
test('saveSettings + toggleFavorite 병렬 — 서로 다른 storage key 상호 영향 없음', async () => {
  installChromeMock({ delay: 3 });
  const SWM = loadSWM();

  await Promise.all([
    SWM.saveSettings({ palette: 'night' }),
    SWM.toggleFavorite('x'),
    SWM.saveSettings({ themeMode: 'light' }),
    SWM.toggleFavorite('y'),
  ]);

  const settings = await SWM.getSettings();
  const favs = await SWM.getFavorites();
  assert.strictEqual(settings.palette, 'night');
  assert.strictEqual(settings.themeMode, 'light');
  assert.deepStrictEqual(new Set(favs), new Set(['x', 'y']));
});
