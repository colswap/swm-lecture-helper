// storage.js — chrome.storage.local 래퍼 (에러 방어)

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
    try {
      const existing = await this.getLectures();
      const merged = { ...existing };
      for (const [sn, lec] of Object.entries(newData)) {
        merged[sn] = merged[sn] ? { ...merged[sn], ...lec } : lec;
      }
      await chrome.storage.local.set({ lectures: merged });
      return merged;
    } catch (e) {
      console.error('SWM storage: saveLectures error', e);
      return {};
    }
  },

  async saveLecture(sn, data) {
    try {
      const lectures = await this.getLectures();
      lectures[sn] = { ...(lectures[sn] || {}), ...data, lastUpdated: new Date().toISOString() };
      await chrome.storage.local.set({ lectures });
    } catch (e) {
      console.error('SWM storage: saveLecture error', e);
    }
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
    const favs = await this.getFavorites();
    const idx = favs.indexOf(sn);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(sn);
    try { await chrome.storage.local.set({ favorites: favs }); } catch (e) {}
    return favs;
  },

  async getSettings() {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      return settings || { notifyNewLecture: true, notifyDeadline: true, notifySlotOpen: true, checkInterval: 30, keywords: [] };
    } catch (e) {
      return { notifyNewLecture: true, notifyDeadline: true, notifySlotOpen: true, checkInterval: 30, keywords: [] };
    }
  },

  async saveSettings(settings) {
    try { await chrome.storage.local.set({ settings }); } catch (e) {}
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
    try { await chrome.storage.local.set({ meta }); } catch (e) {}
  }
};
