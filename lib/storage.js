// storage.js — chrome.storage.local 래퍼

const SWM = {
  async getLectures() {
    const { lectures } = await chrome.storage.local.get('lectures');
    return lectures || {};
  },

  async saveLectures(newData) {
    const existing = await this.getLectures();
    const merged = { ...existing };
    for (const [sn, lec] of Object.entries(newData)) {
      if (merged[sn]) {
        // 기존 상세 정보 보존하면서 목록 데이터 업데이트
        merged[sn] = { ...merged[sn], ...lec };
      } else {
        merged[sn] = lec;
      }
    }
    await chrome.storage.local.set({ lectures: merged });
    return merged;
  },

  async saveLecture(sn, data) {
    const lectures = await this.getLectures();
    lectures[sn] = { ...(lectures[sn] || {}), ...data, lastUpdated: new Date().toISOString() };
    await chrome.storage.local.set({ lectures });
  },

  async getFavorites() {
    const { favorites } = await chrome.storage.local.get('favorites');
    return favorites || [];
  },

  async toggleFavorite(sn) {
    const favs = await this.getFavorites();
    const idx = favs.indexOf(sn);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(sn);
    }
    await chrome.storage.local.set({ favorites: favs });
    return favs;
  },

  async getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return settings || {
      notifyNewLecture: true,
      notifyDeadline: true,
      notifySlotOpen: true,
      checkInterval: 30,
      keywords: []
    };
  },

  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  },

  async getMeta() {
    const { meta } = await chrome.storage.local.get('meta');
    return meta || { lastFullSync: null, knownLectureSns: [] };
  },

  async saveMeta(meta) {
    await chrome.storage.local.set({ meta });
  }
};
