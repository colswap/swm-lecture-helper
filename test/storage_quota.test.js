// node --test test/storage_quota.test.js
//
// v1.16.0 R11 — storage quota 초과 / write 실패 시 토스트 훅 노출 검증.
// chrome.storage.local.set 에 QUOTA_BYTES 에러를 던지는 mock 을 주입하고
// window.SWM_showStorageError 훅이 호출되는지 확인.

const { test } = require('node:test');
const assert = require('node:assert');

function installChromeMock({ failMode = null } = {}) {
  const store = {};
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: store[key] };
          return { ...store };
        },
        async set(obj) {
          if (failMode === 'quota') {
            const err = new Error('QUOTA_BYTES quota exceeded');
            throw err;
          }
          if (failMode === 'other') {
            throw new Error('unknown write failure');
          }
          Object.assign(store, obj);
        },
      },
    },
  };
  return store;
}

function installWindowHook() {
  const calls = [];
  global.window = { SWM_showStorageError: (msg) => calls.push(msg) };
  return calls;
}

function loadSWM() {
  delete require.cache[require.resolve('../lib/storage.js')];
  return require('../lib/storage.js');
}

test('safeSet: QUOTA_BYTES 초과 시 SWM_showStorageError 훅 호출', async () => {
  installChromeMock({ failMode: 'quota' });
  const calls = installWindowHook();
  const SWM = loadSWM();

  const ok = await SWM.safeSet({ lectures: { '1': { sn: '1' } } });
  assert.strictEqual(ok, false, 'safeSet 는 실패 시 false 반환');
  assert.strictEqual(calls.length, 1, '훅 1회 호출');
  assert.match(calls[0], /용량|저장/, '사용자 친화 메시지');
});

test('saveLectures: quota 실패 시 토스트 훅 호출 + 조용히 반환', async () => {
  installChromeMock({ failMode: 'quota' });
  const calls = installWindowHook();
  const SWM = loadSWM();

  // throw 하지 않아야 함 (silent-catch + UI 노출로 이전).
  const res = await SWM.saveLectures({ '1': { sn: '1', title: 't' } });
  assert.ok(calls.length >= 1, 'quota 경고 훅 호출됨');
  // 반환값은 내부 merged (빈 객체일 수 있음) — 크래시 없음.
  assert.ok(res !== undefined);
});

test('saveSettings: 기타 write 실패 시에도 훅 호출', async () => {
  installChromeMock({ failMode: 'other' });
  const calls = installWindowHook();
  const SWM = loadSWM();

  await SWM.saveSettings({ themeMode: 'dark' });
  assert.strictEqual(calls.length, 1);
});

test('safeSet: 2초 쿨다운 — 연속 quota 실패 시 중복 토스트 안 남김', async () => {
  installChromeMock({ failMode: 'quota' });
  const calls = installWindowHook();
  const SWM = loadSWM();

  await SWM.safeSet({ a: 1 });
  await SWM.safeSet({ b: 2 });
  await SWM.safeSet({ c: 3 });
  assert.strictEqual(calls.length, 1, '쿨다운 창 내 호출은 1회로 병합');
});

test('saveLecture: 큐 직렬화 — 연속 호출이 모두 저장됨 (정상 경로)', async () => {
  installChromeMock({}); // 실패 없음
  installWindowHook();
  const SWM = loadSWM();

  await Promise.all([
    SWM.saveLecture('1', { applied: true }),
    SWM.saveLecture('2', { applied: false }),
    SWM.saveLecture('1', { applySn: '999' }),
  ]);
  const lecs = await SWM.getLectures();
  assert.strictEqual(lecs['1'].applied, true);
  assert.strictEqual(lecs['1'].applySn, '999', '2차 patch 가 보존');
  assert.strictEqual(lecs['2'].applied, false);
});

test('saveLecture + saveLectures 혼합 병렬 — 큐 공유로 서로 덮지 않음', async () => {
  installChromeMock({});
  installWindowHook();
  const SWM = loadSWM();

  // 초기 데이터
  await SWM.saveLectures({ 'a': { sn: 'a', title: 'A' }, 'b': { sn: 'b', title: 'B' } });

  // timetable.setLectureApplied 시나리오 + content.fullSync saveLectures 병렬
  await Promise.all([
    SWM.saveLecture('a', { applied: true }),
    SWM.saveLectures({ 'c': { sn: 'c', title: 'C' } }),
    SWM.saveLecture('b', { applied: true }),
    SWM.saveLectures({ 'd': { sn: 'd', title: 'D' } }),
  ]);

  const lecs = await SWM.getLectures();
  assert.strictEqual(lecs.a.applied, true, 'a applied 가 saveLectures 쓰기에 덮이지 않음');
  assert.strictEqual(lecs.a.title, 'A');
  assert.strictEqual(lecs.b.applied, true);
  assert.strictEqual(lecs.c.title, 'C');
  assert.strictEqual(lecs.d.title, 'D');
});

test('replaceLectures: 전체 교체 도 큐 경유 + safeSet quota 감지', async () => {
  installChromeMock({ failMode: 'quota' });
  const calls = installWindowHook();
  const SWM = loadSWM();

  await SWM.replaceLectures({ 'x': { sn: 'x' } });
  assert.ok(calls.length >= 1, 'replaceLectures 도 quota 훅 호출');
});
