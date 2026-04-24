// storage.js — chrome.storage.local 래퍼 (에러 방어)
//
// v1.16.0: saveSettings / toggleFavorite 에 단일 직렬 큐 + fresh-read 머지 도입.
// 동일 컨텍스트 내 병렬 호출이 last-write-wins 로 서로의 필드를 덮어쓰지 않음.
// v1.16.0 R11: saveLectures / saveLecture / saveMeta 도 동일 _saveQueue 로 이전.
//              safeSet wrapper 로 chrome.runtime.lastError + QUOTA_BYTES 감지 → 토스트.

let _saveQueue = Promise.resolve();

function _enqueue(fn) {
  const next = _saveQueue.then(fn, fn);
  _saveQueue = next.catch(() => {});
  return next;
}

// 최근 quota 경고 토스트 시각 — 스팸 방지 (2초 쿨다운).
let _lastQuotaToastAt = 0;
function _notifyQuota(kind) {
  const now = Date.now();
  if (now - _lastQuotaToastAt < 2000) return;
  _lastQuotaToastAt = now;
  const msg = kind === 'quota'
    ? '저장 용량 초과 — 오래된 캐시 정리 필요'
    : '저장 실패 — 잠시 후 재시도';
  try {
    if (typeof window !== 'undefined' && typeof window.SWM_showStorageError === 'function') {
      window.SWM_showStorageError(msg);
    }
  } catch (_) {}
}

// chrome.storage.local.set 래퍼. quota/기타 lastError 를 분류해 콘솔 + UI 노출.
// 반환: true 성공, false 실패.
async function safeSet(obj) {
  try {
    await chrome.storage.local.set(obj);
    return true;
  } catch (e) {
    const msg = String(e?.message || e);
    const isQuota = /QUOTA|quota/i.test(msg);
    console.error('SWM storage: set failed', msg, Object.keys(obj || {}));
    _notifyQuota(isQuota ? 'quota' : 'other');
    return false;
  }
}

const SWM = {
  async getLectures() {
    try {
      const { lectures } = await chrome.storage.local.get('lectures');
      return lectures || {};
    } catch (e) {
      console.error('SWM storage: getLectures error', e);
      return {};
    }
  },

  async saveLectures(newData) {
    return _enqueue(async () => {
      try {
        const existing = await this.getLectures();
        const merged = { ...existing };
        for (const [sn, lec] of Object.entries(newData)) {
          const prev = merged[sn];
          if (prev) {
            const next = { ...prev, ...lec };
            // count.current 값이 새로 들어오면 이전값을 prev 로 보관 (빈자리 알림용, 1틱 히스토리)
            if (lec.count && typeof lec.count.current === 'number' && prev.count && typeof prev.count.current === 'number') {
              next.count = { ...lec.count, prev: prev.count.current };
            } else if (lec.count && prev.count) {
              next.count = { ...prev.count, ...lec.count };
            }
            // v1.16.1 §R2 self-heal: legacy sn-less 레코드 복구
            if (!next.sn) next.sn = sn;
            merged[sn] = next;
          } else {
            merged[sn] = { ...lec, sn: lec.sn || sn };
          }
        }
        await safeSet({ lectures: merged });
        return merged;
      } catch (e) {
        console.error('SWM storage: saveLectures error', e);
        return {};
      }
    });
  },

  async saveLecture(sn, data) {
    return _enqueue(async () => {
      try {
        const lectures = await this.getLectures();
        const prev = lectures[sn] || {};
        // v1.16.1 §R2 self-heal: sn 필드가 legacy 레코드에서 누락돼 있어도 key 로부터 복구
        lectures[sn] = { ...prev, ...data, sn: prev.sn || data.sn || sn, lastUpdated: new Date().toISOString() };
        await safeSet({ lectures });
      } catch (e) {
        console.error('SWM storage: saveLecture error', e);
      }
    });
  },

  // 전체 lectures 객체를 한 번에 교체해야 하는 경우(대량 diff after fullSync) 전용.
  // v1.16.1 §R2 self-heal: 교체 대상 전체를 훑어 sn 보강 (legacy corruption 1-pass 복구).
  async replaceLectures(lectures) {
    return _enqueue(async () => {
      const healed = {};
      for (const [key, lec] of Object.entries(lectures || {})) {
        healed[key] = (lec && typeof lec === 'object') ? { ...lec, sn: lec.sn || key } : lec;
      }
      await safeSet({ lectures: healed });
    });
  },

  async getFavorites() {
    try {
      const { favorites } = await chrome.storage.local.get('favorites');
      return favorites || [];
    } catch (e) {
      return [];
    }
  },

  async toggleFavorite(sn) {
    return _enqueue(async () => {
      try {
        // r1-H1: sn 타입 정규화 — 레거시 데이터에 number sn 이 섞여 있어도
        // indexOf 가 strict equality 라 miss 나던 문제. 항상 string 으로 저장·비교.
        const snStr = String(sn);
        const { favorites = [] } = await chrome.storage.local.get('favorites');
        const normalized = favorites.map(String);
        const idx = normalized.indexOf(snStr);
        if (idx >= 0) normalized.splice(idx, 1);
        else normalized.push(snStr);
        await safeSet({ favorites: normalized });
        return normalized;
      } catch (e) {
        console.error('SWM storage: toggleFavorite error', e);
        return [];
      }
    });
  },

  async getSettings() {
    const DEFAULTS = {
      notifyNewLecture: false,
      notifySlotOpen: false,
      notifyMentorMatch: false,
      watchedMentors: [],
      keywords: [],
      onboardingSeen: false,
      timetableCoachmarkSeen: false,
    };
    try {
      const { settings } = await chrome.storage.local.get('settings');
      return { ...DEFAULTS, ...(settings || {}) };
    } catch (e) {
      return { ...DEFAULTS };
    }
  },

  // patch 또는 전체 settings 객체 둘 다 허용 — 내부에서 fresh-read 후 머지.
  async saveSettings(patch) {
    return _enqueue(async () => {
      try {
        const { settings = {} } = await chrome.storage.local.get('settings');
        const merged = { ...settings, ...(patch || {}) };
        await safeSet({ settings: merged });
        return merged;
      } catch (e) {
        console.error('SWM storage: saveSettings error', e);
      }
    });
  },

  async getMeta() {
    try {
      const { meta } = await chrome.storage.local.get('meta');
      return meta || { lastFullSync: null, knownLectureSns: [] };
    } catch (e) {
      return { lastFullSync: null, knownLectureSns: [] };
    }
  },

  async saveMeta(meta) {
    return _enqueue(async () => {
      await safeSet({ meta });
    });
  },

  // 팝업·시간표 열림 시각 기록 — background sync 의 skip-if-recent 에서 사용.
  // 다른 storage write 와 동일하게 _saveQueue 경유 (직접 set 호출 지양 — r1-C1).
  async markUserActivity() {
    return _enqueue(async () => {
      await safeSet({ lastUserActivity: Date.now() });
    });
  },

  // 외부 파일 (content/service-worker 등) 에서 직접 write 할 때 사용할 래퍼.
  // quota 감지 + 토스트까지 일관 처리.
  safeSet,
};

// window 노출: coachmark.js 및 test harness 에서 window.SWM 로 접근.
if (typeof window !== 'undefined') window.SWM = SWM;
// node test harness 노출.
if (typeof module !== 'undefined' && module.exports) module.exports = SWM;
