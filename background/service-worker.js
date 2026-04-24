// service-worker.js — 주기 백그라운드 sync + 알림 (신규/빈자리/멘토)

const ALARM_NAME = 'swm-sync';
const PERIOD_MIN = 30;
const FULL_SYNC_INTERVAL_H = 6;
const JITTER_MIN = 2; // 여러 확장 인스턴스가 정각에 몰려 SWM 치지 않게 ±2분 분산
const FIRE_JITTER_MAX_MS = 60_000; // 매 fire 마다 추가 0-60s 랜덤 지연 (server smoothing)
const SKIP_IF_RECENT_ACTIVITY_MS = 2 * 60 * 1000; // 사용자가 2분 내 UI 열었으면 alarm skip

const DEFAULT_SETTINGS = {
  // 모든 알림은 기본 OFF. 사용자가 ⋯ 메뉴 → "알림 설정" 에서 명시적 ON 해야 발송.
  notifyNewLecture: false,
  notifySlotOpen: false,      // 즐겨찾기 강연 빈자리
  notifyMentorMatch: false,   // 관심 멘토 매치 (watchedMentors 있어야 발동)
  watchedMentors: [],         // string[]
  keywords: [],               // string[] (추후)
};

async function registerAlarm() {
  // 첫 실행에 ±2분 jitter — thundering-herd 방지 (여러 사용자가 브라우저 켤 때 동시에 치는 현상).
  // 이후 periodInMinutes=30 기준 주기 유지하되 시작 시각이 분산되므로 이후 slot 도 분산됨.
  const jitter = (Math.random() * 2 - 1) * JITTER_MIN;
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: Math.max(1, PERIOD_MIN + jitter),
    periodInMinutes: PERIOD_MIN,
  });
}

chrome.runtime.onInstalled.addListener(registerAlarm);
chrome.runtime.onStartup.addListener(registerAlarm);

// MV3 근본 이슈 대응: content_scripts declarative 방식은 확장 설치·업데이트·리로드 시점에
// 이미 열려 있던 탭에는 자동 주입되지 않는다. 사용자가 해당 탭을 F5 해야만 주입됨.
// onInstalled / onStartup 에서 이미 열린 swmaestro 탭들을 찾아 programmatic 로 직접 주입.
// (1Password, Pocket, LastPass 등 주요 확장이 모두 쓰는 표준 패턴.)
const SWM_CONTENT_FILES = ['lib/storage.js', 'lib/time_utils.js', 'content/content.js', 'content/detail.js'];
const SWM_CONTENT_CSS = ['content/content.css'];

async function injectIntoSwmTabs(reason) {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*'],
    });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: SWM_CONTENT_FILES,
          injectImmediately: false,
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: SWM_CONTENT_CSS,
        });
        console.log(`SWM Helper: re-injected into tab ${tab.id} (${reason})`);
      } catch (e) {
        // 이미 주입된 탭은 "already been injected" 류 에러. 무시 OK.
        // 로그인 페이지·SSO 등 matches 밖 URL 도 여기서 조용히 스킵.
        console.debug(`SWM Helper: inject skip tab ${tab.id}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn('SWM Helper: injectIntoSwmTabs error', e);
  }
}

chrome.runtime.onInstalled.addListener(() => injectIntoSwmTabs('onInstalled'));
chrome.runtime.onStartup.addListener(() => injectIntoSwmTabs('onStartup'));

// 수동 주입 메시지 — popup/timetable 이 PING fail 시 요청. tabId 를 받아 해당 탭에만 주입.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'SWM_INJECT_TAB') return;
  const tabId = msg.tabId || sender?.tab?.id;
  if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return; }
  (async () => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: SWM_CONTENT_FILES,
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: SWM_CONTENT_CSS,
      });
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async response
});

// 온보딩: 첫 설치 → welcome 탭, 업데이트 → 변경점 알림 한 번.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } else if (details.reason === 'update') {
    const prev = details.previousVersion;
    // v1.16.1 마이그레이션: v1.15.0 regex 가 HH:MM:SS 를 오매칭해 storage 에 박아둔
    // "00:00 ~ HH:MM" / "30:00 ~ ..." 같은 잘못된 lecTime 을 비워서 다음 sync 때 재파싱 유도.
    // v1.16.2 가드: v1.15.x 에서 올라오는 사용자만 필요. v1.16.x → v1.16.x 는 skip.
    if (prev && (prev.startsWith('1.15.') || prev.startsWith('1.14.') || prev.startsWith('1.13.'))) {
      try {
        const { lectures = {} } = await chrome.storage.local.get('lectures');
        let healed = 0;
        for (const [sn, lec] of Object.entries(lectures)) {
          if (!lec || typeof lec !== 'object') continue;
          const t = lec.lecTime;
          if (!t) continue;
          // 01:00~ 이상은 의심 없음. 00:00 으로 시작하는데 끝이 10:00 이상인 경우 — 정상
          // 강연에서는 거의 없고 v1.15.0 오매칭 (":SS" 의 SS → 분 → 시간 slot) 전형.
          // h1 > 23 같은 비정상 값도 걸러냄.
          const m = String(t).match(/^(\d{1,2}):(\d{2})\s*[~\-]\s*(\d{1,2}):(\d{2})$/);
          if (!m) continue;
          const h1 = +m[1], h2 = +m[3];
          const badH1Overflow = h1 > 23;                 // 30:00~ 같은 건 무조건 오매칭
          const suspectZeroStart = h1 === 0 && h2 >= 10; // 00:00~15:00 오매칭 패턴
          if (badH1Overflow || suspectZeroStart) {
            lec.lecTime = '';
            healed++;
          }
        }
        if (healed > 0) {
          await chrome.storage.local.set({ lectures });
          console.log(`SWM Helper: v1.16 migration healed ${healed} stale lecTime entries`);
        }
      } catch (e) {
        console.error('SWM Helper: v1.16 migration error', e);
      }
    }

    if (prev && (prev.startsWith('1.16.') || prev.startsWith('1.15.') || prev.startsWith('1.14.') || prev.startsWith('1.13.'))) {
      chrome.notifications.create('update-1162', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'SWM Helper 1.16.2 업데이트',
        message: '마감 포함 시간표 UX · 회귀 수정 · 문구 정비',
        priority: 1,
      });
    }
  }
});

async function findSwmaestroTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://swmaestro.ai/*', 'https://www.swmaestro.ai/*'],
  });
  return tabs.find(t => t.status === 'complete') || tabs[0] || null;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// sync 전 snapshot (빈자리 diff 용) — lecture 객체 다 복사하지 않고 필요한 것만
async function snapshotForSlotDiff() {
  const { lectures = {} } = await chrome.storage.local.get('lectures');
  const snap = {};
  for (const [sn, l] of Object.entries(lectures)) {
    if (l.count?.max != null && l.count?.current != null) {
      snap[sn] = { current: l.count.current, max: l.count.max };
    }
  }
  return snap;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const settings = await getSettings();
  const anyEnabled = settings.notifyNewLecture || settings.notifySlotOpen || settings.notifyMentorMatch;
  if (!anyEnabled) return; // 모든 알림 OFF → 폴링 자체 skip

  // 적응형 skip: 사용자가 팝업/시간표 최근 2분 안에 열었으면 이미 최신. alarm fire 생략.
  // 사용자 수동 sync 가 있을 가능성 + 재동기화 중첩 방지.
  const { lastUserActivity } = await chrome.storage.local.get('lastUserActivity');
  if (typeof lastUserActivity === 'number' && Date.now() - lastUserActivity < SKIP_IF_RECENT_ACTIVITY_MS) {
    return;
  }

  // per-fire jitter: 여러 사용자가 정각 30분 간격에 몰려 SWM 을 동시에 치지 않도록
  // 0-60s 랜덤 지연. `registerAlarm` 의 ±2분 오프셋은 instance-lifetime 범위,
  // 이 지연은 fire-lifetime 범위로 추가 smoothing.
  if (FIRE_JITTER_MAX_MS > 0) {
    await new Promise(r => setTimeout(r, Math.random() * FIRE_JITTER_MAX_MS));
  }

  const tab = await findSwmaestroTab();
  if (!tab) return;

  // snapshotForSlotDiff 는 빈자리 알림 OFF 면 의미 없음 — lectures 전체 loop 건너뛰기 (~5-10ms).
  const needSlotSnap = settings.notifySlotOpen;
  const [metaBefore, slotBefore, favsWrap] = await Promise.all([
    chrome.storage.local.get('meta').then(r => r.meta || {}),
    needSlotSnap ? snapshotForSlotDiff() : Promise.resolve({}),
    chrome.storage.local.get('favorites'),
  ]);
  const knownBefore = new Set(metaBefore.knownLectureSns || []);
  const favs = new Set(favsWrap.favorites || []);

  // 분기: (A) 마지막 FULL 로부터 FULL_SYNC_INTERVAL_H 경과 or
  //       (B) 빈자리 알림 & 즐겨찾기 있음
  //       → FULL_SYNC (전체 페이지 + count 추적)
  //       그 외 → PEEK_FIRST_PAGE (1 페이지만). PEEK 에서 새 sn 감지 시 같은 tick 안에서 FULL 로 승격.
  const lastFull = metaBefore.lastFullSync ? new Date(metaBefore.lastFullSync).getTime() : 0;
  const hoursSinceFull = lastFull ? (Date.now() - lastFull) / 3_600_000 : Infinity;
  const fullByTime = hoursSinceFull >= FULL_SYNC_INTERVAL_H;
  const fullByFavSlot = settings.notifySlotOpen && favs.size > 0;
  let needsFullSync = fullByTime || fullByFavSlot;
  let lectures = {};
  let newSns = [];
  let fullRan = false; // 한 tick 안에서 FULL 이 최대 1회만 실행되도록 guard

  // FULL 실행 로직 — FULL 분기 + PEEK 승격 경로 둘 다에서 호출
  async function runFullSync() {
    if (fullRan) return true; // 이미 돌았으면 noop (guard)
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter: 'A' });
      if (!resp?.success) return false;
    } catch { return false; }
    const after = await chrome.storage.local.get(['meta', 'lectures']);
    lectures = after.lectures || {};
    const knownAfter = new Set(after.meta?.knownLectureSns || []);
    newSns = [...knownAfter].filter(sn => !knownBefore.has(sn));
    fullRan = true;
    return true;
  }

  if (needsFullSync) {
    const ok = await runFullSync();
    if (!ok) return;
  } else {
    // PEEK: 첫 페이지만 fetch
    let peek;
    try {
      peek = await chrome.tabs.sendMessage(tab.id, { type: 'PEEK_FIRST_PAGE', statusFilter: 'A' });
    } catch { return; }
    if (!peek?.ok || !peek.lectures) return;

    const peekLectures = peek.lectures;
    const peekSns = Object.keys(peekLectures);
    newSns = peekSns.filter(sn => !knownBefore.has(sn));
    if (newSns.length === 0) return; // 변화 없음 — 종료

    // 새 sn 감지 → FULL 로 승격 (count/페이지 전체 확보 + lastFullSync 갱신)
    needsFullSync = true;
    const ok = await runFullSync();
    if (!ok) {
      // FULL 승격 실패 시: PEEK 결과만이라도 storage 에 merge 해서 다음 tick 에 재시도 가능하게.
      const existing = (await chrome.storage.local.get('lectures')).lectures || {};
      for (const sn of newSns) existing[sn] = { ...existing[sn], ...peekLectures[sn] };
      await chrome.storage.local.set({
        lectures: existing,
        meta: { ...metaBefore, knownLectureSns: [...new Set([...knownBefore, ...peekSns])] },
      });
      lectures = existing;
    }
  }

  // 각 알림 종류별 후보 sn 집합
  const newSet = settings.notifyNewLecture ? new Set(newSns) : new Set();

  const slotSet = new Set();
  if (fullRan) {  // FULL 이 실제 돌았을 때만 빈자리 검출 가능 (PEEK 단독 tick 에선 불가)
    for (const sn of favs) {
      const prev = slotBefore[sn];
      const curr = lectures[sn]?.count;
      if (!prev || !curr || curr.max == null || curr.current == null) continue;
      if (prev.current >= prev.max && curr.current < curr.max) slotSet.add(sn);
    }
  }

  const mentorSet = new Set();
  if (settings.notifyMentorMatch && settings.watchedMentors?.length > 0) {
    for (const sn of newSns) {
      const m = lectures[sn]?.mentor;
      if (!m) continue;
      if (settings.watchedMentors.some(w => m.includes(w))) mentorSet.add(sn);
    }
  }

  // 우선순위 dedup: mentor > slot > new (강연 1건은 1개 알림에만)
  const finalMentor = mentorSet;
  const finalSlot = new Set([...slotSet].filter(sn => !finalMentor.has(sn)));
  const finalNew = new Set([...newSet].filter(sn => !finalMentor.has(sn) && !finalSlot.has(sn)));

  if (finalMentor.size > 0) notifyMentorMatch([...finalMentor], lectures);
  if (finalSlot.size > 0) notifySlotOpen([...finalSlot], lectures);
  if (finalNew.size > 0) notifyNew([...finalNew], lectures);
});

function titleBrief(sns, lectures, n = 3) {
  const sample = sns.slice(0, n).map(sn => {
    const t = (lectures[sn]?.title || sn).replace(/^\[[^\]]+\]\s*/, '');
    return t.length > 30 ? t.slice(0, 30) + '…' : t;
  }).join(', ');
  return sns.length <= n ? sample : `${sample} 외 ${sns.length - n}건`;
}

function notifyNew(sns, lectures) {
  chrome.notifications.create(`swm-new-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `SWM 새 강연 ${sns.length}건`,
    message: titleBrief(sns, lectures),
    priority: 1,
  });
}

function notifySlotOpen(sns, lectures) {
  chrome.notifications.create(`swm-slot-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `⭐ 빈자리 발생 ${sns.length}건`,
    message: titleBrief(sns, lectures),
    priority: 2,
  });
}

function notifyMentorMatch(sns, lectures) {
  chrome.notifications.create(`swm-mentor-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `🔔 관심 멘토의 새 강연 ${sns.length}건`,
    message: titleBrief(sns, lectures),
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener((notifId) => {
  if (!notifId.startsWith('swm-')) return;
  chrome.tabs.create({
    url: 'https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046',
  });
  chrome.notifications.clear(notifId);
});
