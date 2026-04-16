// service-worker.js — 주기 백그라운드 sync + 알림 (신규/빈자리/멘토)

const ALARM_NAME = 'swm-sync';
const PERIOD_MIN = 30;

const DEFAULT_SETTINGS = {
  // 모든 알림은 기본 OFF. 사용자가 ⋯ 메뉴 → "알림 설정" 에서 명시적 ON 해야 발송.
  notifyNewLecture: false,
  notifySlotOpen: false,      // 즐겨찾기 강연 빈자리
  notifyMentorMatch: false,   // 관심 멘토 매치 (watchedMentors 있어야 발동)
  watchedMentors: [],         // string[]
  keywords: [],               // string[] (추후)
};

async function registerAlarm() {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MIN });
}

chrome.runtime.onInstalled.addListener(registerAlarm);
chrome.runtime.onStartup.addListener(registerAlarm);

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

  const tab = await findSwmaestroTab();
  if (!tab) return;

  const [metaBefore, slotBefore, favsWrap] = await Promise.all([
    chrome.storage.local.get('meta').then(r => r.meta || {}),
    snapshotForSlotDiff(),
    chrome.storage.local.get('favorites'),
  ]);
  const knownBefore = new Set(metaBefore.knownLectureSns || []);
  const favs = new Set(favsWrap.favorites || []);

  // 분기: 빈자리 알림 & 즐겨찾기 있으면 → FULL_SYNC (전체 페이지 + count 추적 필요)
  //       그 외 → PEEK_FIRST_PAGE (1 페이지만, 신규/멘토만 검증)
  const needsFullSync = settings.notifySlotOpen && favs.size > 0;
  let lectures = {};
  let newSns = [];

  if (needsFullSync) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'FULL_SYNC', statusFilter: 'A' });
      if (!resp?.success) return;
    } catch { return; }
    const after = await chrome.storage.local.get(['meta', 'lectures']);
    lectures = after.lectures || {};
    const knownAfter = new Set(after.meta?.knownLectureSns || []);
    newSns = [...knownAfter].filter(sn => !knownBefore.has(sn));
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

    // peek 결과를 storage 에 합치고 (notification 메시지용 + 다음 사이클 비교용)
    // 기존 lectures 와 merge, knownLectureSns 에 추가
    const existing = (await chrome.storage.local.get('lectures')).lectures || {};
    for (const sn of newSns) existing[sn] = { ...existing[sn], ...peekLectures[sn] };
    await chrome.storage.local.set({
      lectures: existing,
      meta: { ...metaBefore, knownLectureSns: [...new Set([...knownBefore, ...peekSns])] },
    });
    lectures = existing;
  }

  // 각 알림 종류별 후보 sn 집합
  const newSet = settings.notifyNewLecture ? new Set(newSns) : new Set();

  const slotSet = new Set();
  if (needsFullSync) {  // PEEK 모드에선 빈자리 검출 불가
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
