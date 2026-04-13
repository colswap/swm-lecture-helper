// service-worker.js — 주기 백그라운드 sync + 알림 (신규/빈자리/멘토)

const ALARM_NAME = 'swm-sync';
const PERIOD_MIN = 30;

const DEFAULT_SETTINGS = {
  notifyNewLecture: true,
  notifySlotOpen: true,     // 즐겨찾기 강연 빈자리
  watchedMentors: [],        // string[]
  keywords: [],              // string[] (추후)
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

  const tab = await findSwmaestroTab();
  if (!tab) return;

  const [metaBefore, slotBefore, settings, favsWrap] = await Promise.all([
    chrome.storage.local.get('meta').then(r => r.meta || {}),
    snapshotForSlotDiff(),
    getSettings(),
    chrome.storage.local.get('favorites'),
  ]);
  const knownBefore = new Set(metaBefore.knownLectureSns || []);
  const favs = new Set(favsWrap.favorites || []);

  // sync 실행 (content script 에 메시지)
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'FULL_SYNC',
      statusFilter: 'A',
    });
    if (!resp?.success) return;
  } catch {
    return; // content script 미주입 등
  }

  // sync 후 상태
  const { meta: metaAfter = {}, lectures = {} } = await chrome.storage.local.get(['meta', 'lectures']);
  const knownAfter = new Set(metaAfter.knownLectureSns || []);

  // 1. 신규 강연
  const newSns = [...knownAfter].filter(sn => !knownBefore.has(sn));
  if (settings.notifyNewLecture && newSns.length > 0) {
    notifyNew(newSns, lectures);
  }

  // 2. 즐겨찾기 빈자리 (favorite + 만석→여석)
  if (settings.notifySlotOpen && favs.size > 0) {
    const opens = [];
    for (const sn of favs) {
      const prev = slotBefore[sn];
      const curr = lectures[sn]?.count;
      if (!prev || !curr || curr.max == null || curr.current == null) continue;
      if (prev.current >= prev.max && curr.current < curr.max) {
        opens.push(sn);
      }
    }
    if (opens.length > 0) notifySlotOpen(opens, lectures);
  }

  // 3. 멘토 매치 (신규 강연만)
  if (settings.watchedMentors?.length > 0 && newSns.length > 0) {
    const matched = newSns.filter(sn => {
      const m = lectures[sn]?.mentor;
      if (!m) return false;
      return settings.watchedMentors.some(w => m.includes(w) || w.includes(m));
    });
    if (matched.length > 0) notifyMentorMatch(matched, lectures);
  }
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
