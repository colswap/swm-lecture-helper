// service-worker.js — 주기 백그라운드 sync + 신규 강연 알림

const ALARM_NAME = 'swm-sync';
const PERIOD_MIN = 30;

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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const tab = await findSwmaestroTab();
  if (!tab) return;

  const { meta: metaBefore = {} } = await chrome.storage.local.get('meta');
  const before = new Set(metaBefore.knownLectureSns || []);

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'FULL_SYNC',
      statusFilter: 'A',
    });
    if (!resp?.success) return;
  } catch {
    // content script 미주입 (페이지 로딩 중 등) → 스킵
    return;
  }

  const { meta: metaAfter = {}, lectures = {} } = await chrome.storage.local.get(['meta', 'lectures']);
  const after = new Set(metaAfter.knownLectureSns || []);
  const newSns = [...after].filter(sn => !before.has(sn));

  if (newSns.length === 0) return;

  const sample = newSns.slice(0, 3).map(sn => lectures[sn]?.title || sn).join(', ');
  const message = newSns.length <= 3
    ? sample
    : `${sample} 외 ${newSns.length - 3}건`;

  chrome.notifications.create(`swm-new-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `SWM 새 강연 ${newSns.length}건`,
    message,
    priority: 1,
  });
});

chrome.notifications.onClicked.addListener((notifId) => {
  if (!notifId.startsWith('swm-new-')) return;
  chrome.tabs.create({
    url: 'https://www.swmaestro.ai/sw/mypage/mentoLec/list.do?menuNo=200046',
  });
  chrome.notifications.clear(notifId);
});
