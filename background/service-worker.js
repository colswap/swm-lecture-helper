// service-worker.js — Phase 1+2: 최소 백그라운드 (메시지 라우팅만)
// Phase 4에서 알림 로직 추가 예정

chrome.runtime.onInstalled.addListener(() => {
  console.log('SWM Lecture Helper installed');
});

// content script ↔ popup 메시지 릴레이 (필요 시)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 팝업에서 보낸 SYNC_STATUS 메시지를 다른 리스너에 전달
  if (msg.type === 'SYNC_STATUS') {
    // 팝업이 열려있으면 자동으로 수신됨
  }
});
