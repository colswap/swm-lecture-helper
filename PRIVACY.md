# Privacy Policy — SWM Lecture Helper

*Last updated: 2026-04-14*

The SWM Lecture Helper Chrome extension ("the extension") enhances the user experience of the SW Maestro (swmaestro.ai) mentoring/lecture board. This document describes what data the extension handles.

## What data is collected

The extension accesses and stores **locally in your browser only**:

- Lecture list and detail data (title, date, time, location, mentor, description) — scraped from pages you can already view on swmaestro.ai while logged in with your own account
- Your own application history (내 신청 내역) — fetched from `/sw/mypage/userAnswer/history.do`
- Favorites you mark with the ★ button
- Sync metadata (last sync timestamp, lecture SN list)

All data is stored in `chrome.storage.local`, which resides only on your computer.

## What data is NOT sent anywhere

- **No remote server.** The extension does not transmit any data to any remote service.
- **No analytics, no telemetry, no ads.**
- **No third-party APIs** — the extension only communicates with `swmaestro.ai` and `www.swmaestro.ai`, the domains you are already using.

## Permissions and why they are needed

| Permission | Reason |
|---|---|
| `host_permissions: https://swmaestro.ai/*, https://www.swmaestro.ai/*` | Fetch lecture list and detail pages while the user is logged in |
| `storage` | Save scraped lecture data in the browser (chrome.storage.local) |
| `alarms` | Schedule periodic background sync (every 30 minutes) |
| `notifications` | Desktop notifications when new lectures appear during background sync |
| `tabs`, `activeTab` | Locate an open swmaestro.ai tab so the content script can run |

## When you click Apply / Cancel in the popover

When you press the "즉시 신청" or "신청 취소" button inside a lecture popover, the extension issues an HTTP POST to swmaestro.ai (`/sw/mypage/mentoLec/apply.json` or `/sw/mypage/userAnswer/cancel.json`) authenticated with your existing session cookie. This is functionally identical to clicking the same button on the swmaestro.ai website: no credentials leave your browser, and no external service is involved. A browser `confirm()` dialog is shown before each such request so nothing happens without your explicit approval.

## Data deletion

To clear all stored data: uninstall the extension, or open DevTools on any swmaestro.ai page → Application → Storage → Extension → clear.

## Contact

Questions or concerns: open an issue at [github.com/colswap/swm-lecture-helper/issues](https://github.com/colswap/swm-lecture-helper/issues).
