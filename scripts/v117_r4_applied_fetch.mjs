#!/usr/bin/env node
// v117_r4_applied_fetch.mjs — live e2e 읽기 전용 수집.
//
// 목표: fetchAppliedSns 에서 참조하는 /sw/mypage/userAnswer/history.do 페이지의
// tds[2..7] raw 셀 내용을 덤프해서 tds[4] 에 "날짜+시간"이 합쳐서 들어오는지 확증.
// 추가로 각 applied sn 에 대해 mentoLec/view.do 상세 페이지의 info['강의날짜'],
// info['개설 승인'] 도 수집해 데이터 완전성 매트릭스를 구축.
//
// 실행:  node scripts/v117_r4_applied_fetch.mjs
// 산출물:
//   /mnt/c/claude/staging/v117_r4_applied_dump.json  — raw dump
//
// 금지: apply / cancel / settings 변경 API 호출 (읽기 only).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TIME = require('../lib/time_utils.js');

const BASE = 'https://www.swmaestro.ai';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const OUT_PATH = '/mnt/c/claude/staging/v117_r4_applied_dump.json';

// ------------------- 쿠키 jar (swm_fetch_and_audit.mjs 에서 포팅) -------------------
function makeJar() {
  const store = new Map();
  return {
    ingest(setCookieHeaderList) {
      for (const raw of setCookieHeaderList) {
        const first = raw.split(';')[0].trim();
        const eq = first.indexOf('=');
        if (eq <= 0) continue;
        const k = first.slice(0, eq);
        const v = first.slice(eq + 1);
        store.set(k, v);
      }
    },
    header() {
      return Array.from(store.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

function parseSetCookie(resp) {
  if (typeof resp.headers.getSetCookie === 'function') return resp.headers.getSetCookie();
  const raw = resp.headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function req(jar, method, url, { body, referer, extraHeaders } = {}) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    Cookie: jar.header(),
    ...(referer ? { Referer: referer } : {}),
    ...(extraHeaders || {}),
  };
  if (body && typeof body === 'object' && !(body instanceof URLSearchParams)) {
    body = new URLSearchParams(body).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body instanceof URLSearchParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = body.toString();
  }
  const resp = await fetch(url, { method, headers, body, redirect: 'manual' });
  jar.ingest(parseSetCookie(resp));
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const loc = resp.headers.get('location');
    if (loc) {
      const next = new URL(loc, url).toString();
      return req(jar, method === 'POST' && resp.status === 303 ? 'GET' : 'GET', next, { referer: url });
    }
  }
  return resp;
}

// ------------------- 로그인 -------------------
function loadCreds() {
  const p = path.join(os.homedir(), '.swm_creds.json');
  if (!fs.existsSync(p)) throw new Error(`Missing creds at ${p}`);
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  if (!j.user || !j.pw) throw new Error('Creds file missing user/pw');
  return j;
}

async function login(user, pw) {
  const jar = makeJar();
  const loginUrl = `${BASE}/sw/member/user/forLogin.do?menuNo=200025`;
  const r1 = await req(jar, 'GET', loginUrl);
  const html1 = await r1.text();
  const csrfM = html1.match(/id="csrfToken"\s+value="([^"]+)"/);
  if (!csrfM) throw new Error('csrfToken parse failed');
  const csrf = csrfM[1];
  const form = new URLSearchParams({
    loginFlag: '',
    menuNo: '200025',
    csrfToken: csrf,
    username: user,
    password: pw,
  });
  const r2 = await req(jar, 'POST', `${BASE}/sw/member/user/checkStat.json`, {
    body: form,
    referer: loginUrl,
    extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  });
  const stat = await r2.json().catch(() => null);
  if (!stat || stat.resultCode !== 'success') {
    throw new Error(`checkStat fail: ${JSON.stringify(stat)}`);
  }
  const r3 = await req(jar, 'POST', `${BASE}/sw/member/user/toLogin.do`, {
    body: form,
    referer: loginUrl,
  });
  const html3 = await r3.text();
  const fields = {};
  const inputRe = /<input[^>]*type=['"]hidden['"][^>]*name=['"]([^'"]+)['"][^>]*value=['"]([^'"]*)['"]/gi;
  let m;
  while ((m = inputRe.exec(html3)) !== null) fields[m[1]] = m[2];
  const actionM = html3.match(/action=['"]([^'"]+)['"]/);
  if (!actionM || !Object.keys(fields).length) throw new Error(`toLogin form parse failed`);
  const action = new URL(actionM[1], BASE).toString();
  const r4 = await req(jar, 'POST', action, {
    body: new URLSearchParams(fields),
    referer: loginUrl,
  });
  const html4 = await r4.text();
  if (/아이디를 입력/.test(html4) && /로그인/.test(html4)) {
    throw new Error('Login failed — credentials rejected.');
  }
  return jar;
}

// ------------------- history.do 파싱 -------------------
function stripTags(s) {
  return s.replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function collapseOuter(s) { return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim(); }

function parseHistoryPage(html) {
  const out = [];
  // iterate ALL tbodies (첫 번째는 팀원 표일 수 있으므로). mentoLec/view.do 링크가 들어있는 tbody만 처리.
  const tbRe = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/g;
  let tb;
  while ((tb = tbRe.exec(html)) !== null) {
    const tbody = tb[1];
    if (!tbody.includes('mentoLec/view.do')) continue;
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = trRe.exec(tbody)) !== null) {
      const tr = m[1];
      // qustnrSn from mentoLec/view.do link (ignore special/board rows)
      const linkM = tr.match(/href=["']([^"']*mentoLec\/view\.do[^"']*)["']/);
      if (!linkM) continue;
      const snM = linkM[1].match(/qustnrSn=(\d+)/);
      if (!snM) continue;
      const sn = snM[1];

      // collect td texts in order
      const tdRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      const tds = [];
      let tm;
      while ((tm = tdRe.exec(tr)) !== null) {
        tds.push(collapseOuter(stripTags(tm[1])));
      }

      // cancelled row? (any td containing 접수취소)
      const cancelled = tds.some(t => t.includes('접수취소'));

      out.push({ sn, tds, cancelled });
    }
  }
  return out;
}

// ------------------- view.do 상세 파싱 -------------------
// SWM detail HTML pattern (observed 2026-04-24):
//   <strong class="t">강의날짜</strong>
//   <div class="c">
//       <span class="eventDt">2026.04.17</span>
//       &nbsp;21:30시 ~ 23:30시
//   </div>
// content.js 는 DOMParser 로 group.querySelector('.t').textContent + .c textContent 로 수집.
// 여기서는 key marker "t" strong 뒤 "c" div 쌍을 regex 로 뽑음.
function parseDetailPage(html) {
  const info = {};
  // <strong class="t">KEY</strong> ... <div class="c">VAL</div>  — 같은 group 내 순서 보장.
  const pairRe = /<strong[^>]*class=["'][^"']*\bt\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>[\s\S]{0,100}?<div[^>]*class=["'][^"']*\bc\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = pairRe.exec(html)) !== null) {
    const k = collapseOuter(stripTags(m[1]).replace(/ /g, ' '));
    // 내부 nested strong 제거 (OK → OK 그대로), &nbsp; → space, collapse.
    const v = collapseOuter(stripTags(m[2]).replace(/ /g, ' '));
    if (k && v != null) info[k] = v;
  }
  return info;
}

// ------------------- main -------------------
async function main() {
  const creds = loadCreds();
  console.error(`[r4] login as ${creds.user}`);
  const jar = await login(creds.user, creds.pw);
  console.error(`[r4] login OK`);

  // Phase 1: fetch history pages
  const historyRows = [];
  const MAX_PAGES = 20;
  let loginBroken = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE}/sw/mypage/userAnswer/history.do?menuNo=200047&pageIndex=${page}`;
    const r = await req(jar, 'GET', url);
    if (!r.ok) {
      console.error(`[r4] history page ${page} status ${r.status}, stop`);
      break;
    }
    const html = await r.text();
    // quick login check
    if (/forLogin\.do/.test(html) && /아이디를 입력/.test(html)) {
      loginBroken = true;
      break;
    }
    const rows = parseHistoryPage(html);
    console.error(`[r4] page ${page}: ${rows.length} rows (${rows.filter(r => r.cancelled).length} cancelled)`);
    if (rows.length === 0) break;
    historyRows.push({ page, url, rows });
    if (rows.length < 10) break;
  }

  if (loginBroken) {
    console.error('[r4] login broke mid-stream — abort');
    process.exit(2);
  }

  // Phase 2: for non-cancelled applied rows, fetch detail
  const appliedSns = [];
  const seen = new Set();
  for (const pg of historyRows) {
    for (const row of pg.rows) {
      if (row.cancelled) continue;
      if (seen.has(row.sn)) continue;
      seen.add(row.sn);
      appliedSns.push(row);
    }
  }

  console.error(`[r4] ${appliedSns.length} unique non-cancelled applied sns`);

  const matrix = [];
  const detailCap = Math.min(appliedSns.length, 15); // 최소 5 목표, 15 까지
  for (let i = 0; i < detailCap; i++) {
    const row = appliedSns[i];
    const url = `${BASE}/sw/mypage/mentoLec/view.do?qustnrSn=${row.sn}&menuNo=200046`;
    const r = await req(jar, 'GET', url);
    const html = await r.text();
    const info = parseDetailPage(html);
    const lecDateRaw = info['강의날짜'] || '';
    const approvedRaw = info['개설 승인'] || '';
    const statusRaw = info['상태'] || '';
    const titleRaw = info['모집 명'] || '';

    // tds[4] 에서 파싱 시도 (content.js 와 동일 경로)
    const td4 = row.tds[4] || '';
    const parsedFromHistory = TIME.extractLecDateTime(td4);
    const parsedFromDetail = TIME.extractLecDateTime(lecDateRaw);

    const entry = {
      sn: row.sn,
      history: {
        tds_count: row.tds.length,
        tds_raw: row.tds, // tds[0..n]
        td4_raw: td4,
        td4_parsed: parsedFromHistory,
      },
      detail: {
        url,
        title: titleRaw,
        lecDateRaw,
        approvedRaw,
        statusRaw,
        lecDateRaw_parsed: parsedFromDetail,
        info_keys: Object.keys(info),
      },
      completeness: {
        history_has_lecDate: !!parsedFromHistory.lecDate,
        history_has_lecTime: !!parsedFromHistory.lecTime,
        detail_has_lecDate: !!parsedFromDetail.lecDate,
        detail_has_lecTime: !!parsedFromDetail.lecTime,
        detail_has_isApproved: approvedRaw !== '',
      },
    };
    matrix.push(entry);
    console.error(`[r4] sn=${row.sn} td4="${td4.replace(/\n/g, '\\n')}" histLecT=${parsedFromHistory.lecTime || '∅'} detailLecT=${parsedFromDetail.lecTime || '∅'}`);
  }

  // sampling: td4 raw 10+
  const td4Samples = appliedSns.slice(0, Math.min(appliedSns.length, 20)).map(r => ({
    sn: r.sn,
    td4: r.tds[4] || '',
    allTds: r.tds,
  }));

  const out = {
    ts: new Date().toISOString(),
    user: creds.user,
    summary: {
      history_pages_fetched: historyRows.length,
      total_rows: historyRows.reduce((a, p) => a + p.rows.length, 0),
      cancelled_rows: historyRows.reduce((a, p) => a + p.rows.filter(r => r.cancelled).length, 0),
      unique_applied_sns: appliedSns.length,
      detail_fetched: matrix.length,
    },
    td4_samples: td4Samples,
    matrix,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf-8');
  console.error(`[r4] wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error('[r4] FATAL', err);
  process.exit(1);
});
