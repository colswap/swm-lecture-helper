#!/usr/bin/env node
// swm_fetch_and_audit.mjs — SWM 로그인 + 멘토링/특강 리스트 대량 수집.
// Port of staging/swm_fetch.py 의 로그인 체인 (forLogin → checkStat → toLogin → action).
//
// 사용법:
//   node scripts/swm_fetch_and_audit.mjs --date 2026-04-23 --out ./out.json
//   node scripts/swm_fetch_and_audit.mjs --from 2026-04-13 --to 2026-05-31 --out ./april_may.json
//
// ~/.swm_creds.json 에서 자격증명 로드. 읽기 전용 (신청/취소 호출 금지).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://www.swmaestro.ai';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ------------------- 쿠키 jar -------------------
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
  // Node 22 fetch: headers.getSetCookie() returns array.
  if (typeof resp.headers.getSetCookie === 'function') {
    return resp.headers.getSetCookie();
  }
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
  // follow redirects manually to preserve cookies
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const loc = resp.headers.get('location');
    if (loc) {
      const next = new URL(loc, url).toString();
      return req(jar, method === 'POST' && resp.status === 303 ? 'GET' : 'GET', next, {
        referer: url,
      });
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
  if (!actionM || !Object.keys(fields).length) {
    throw new Error(`toLogin form parse failed (len=${html3.length})`);
  }
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

// ------------------- 리스트 페이지 -------------------

function listUrl({ month, page, status = '', gubun = '', search = '', searchCnd = '1' }) {
  const q = new URLSearchParams({
    pageIndex: String(page),
    menuNo: '200046',
    searchStatMentolec: status,
    searchGubunMentolec: gubun,
    hideAt: 'H',
    setDate: month,
    edcDateOrder: '',
    regDateOrder: '',
    searchCnd: searchCnd,
    searchWrd: search,
  });
  return `${BASE}/sw/mypage/mentoLec/list.do?${q.toString()}`;
}

async function fetchAllPagesForMonth(jar, month, { status = '', maxPages = 80 } = {}) {
  const htmls = [];
  let lastFirstNo = null;
  for (let pi = 1; pi <= maxPages; pi++) {
    const url = listUrl({ month, page: pi, status });
    const r = await req(jar, 'GET', url);
    if (!r.ok) {
      process.stderr.write(`[warn] page ${pi} status ${r.status}\n`);
      break;
    }
    const html = await r.text();
    if (!/mentoLec\/list\.do|boardlist/.test(html)) {
      process.stderr.write(`[warn] page ${pi} not a list page (len ${html.length})\n`);
      break;
    }
    const rows = extractRows(html);
    if (rows.length === 0) break;
    const first = rows[0];
    if (first.rowNo && first.rowNo === lastFirstNo) break;
    lastFirstNo = first.rowNo;
    htmls.push(html);
    if (rows.length < 10) break;
  }
  return htmls;
}

// Parse one list page HTML → rows.
// Extract each <tr> inside div.boardlist tbody manually (no DOM parser).
function extractRows(html) {
  // Narrow to the boardlist area first
  const boardIdx = html.indexOf('boardlist');
  if (boardIdx < 0) return [];
  const tbodyIdx = html.indexOf('<tbody', boardIdx);
  if (tbodyIdx < 0) return [];
  const tbodyEnd = html.indexOf('</tbody>', tbodyIdx);
  const tbody = html.slice(tbodyIdx, tbodyEnd);
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(tbody)) !== null) {
    const tr = m[1];
    const row = parseTr(tr);
    if (row) out.push(row);
  }
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function parseTr(tr) {
  const tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  const tds = [];
  let m;
  while ((m = tdRe.exec(tr)) !== null) tds.push({ attrs: m[1] || '', html: m[2] });
  if (tds.length < 7) return null;
  // find td with class="tit"
  let titIdx = tds.findIndex(t => /class=["'][^"']*\btit\b/.test(t.attrs));
  if (titIdx < 0) return null;
  const titHtml = tds[titIdx].html;
  const aM = titHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/);
  if (!aM) return null;
  const href = aM[1];
  const title = collapse(stripTags(aM[2]));
  const snM = href.match(/qustnrSn=(\d+)/);
  const sn = snM ? snM[1] : '';
  const statusMatch = titHtml.match(/<(?:span|div)[^>]*class=["'][^"']*\bab\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/);
  const statusText = statusMatch ? collapse(stripTags(statusMatch[1])) : '';
  const bbsMatch = titHtml.match(/class=["'][^"']*bbs_m[^"']*["'][^>]*>([\s\S]*?)</);
  const bbs = bbsMatch ? collapse(stripTags(bbsMatch[1])) : '';
  const regM = bbs.match(/접수기간\s*:\s*([\d\-]+\s*~\s*[\d\-]+)/);
  const regPeriod = regM ? regM[1] : '';
  // row number td[0]
  const rowNo = collapse(stripTags(tds[0].html));
  // edc typically at tds[3]
  const edc = collapse(stripTags(tds[3] ? tds[3].html : ''));
  const enroll = collapse(stripTags(tds[4] ? tds[4].html : '')).replace(/\s+/g, '');
  const author = collapse(stripTags(tds[7] ? tds[7].html : ''));
  const regdate = collapse(stripTags(tds[8] ? tds[8].html : ''));
  return {
    rowNo,
    qustnrSn: sn,
    title,
    url: new URL(href, BASE).toString(),
    edc,
    enroll,
    status: statusText,
    author,
    regdate,
    reg_period: regPeriod,
  };
}

// ------------------- main -------------------

function parseArgs(argv) {
  const args = { date: null, from: null, to: null, out: null, status: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--date') { args.date = v; i++; }
    else if (a === '--from') { args.from = v; i++; }
    else if (a === '--to') { args.to = v; i++; }
    else if (a === '--out') { args.out = v; i++; }
    else if (a === '--status') { args.status = v; i++; }
  }
  return args;
}

function monthOf(dateStr) { return dateStr.slice(0, 7); }

function enumMonths(from, to) {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const months = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

async function main() {
  const args = parseArgs(process.argv);
  const creds = loadCreds();
  process.stderr.write(`[login] ${creds.user}\n`);
  const jar = await login(creds.user, creds.pw);
  process.stderr.write('[login] ok\n');

  let months = [];
  const dates = [];
  if (args.date) {
    const ds = args.date.split(',');
    dates.push(...ds);
    months = Array.from(new Set(ds.map(monthOf)));
  } else if (args.from && args.to) {
    months = enumMonths(args.from, args.to);
  } else {
    const today = new Date();
    const m = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    months = [m];
  }

  const allRows = [];
  for (const month of months) {
    process.stderr.write(`[fetch] month=${month} status=${args.status || 'all'}\n`);
    const htmls = await fetchAllPagesForMonth(jar, month, { status: args.status });
    let count = 0;
    for (const h of htmls) {
      const rows = extractRows(h);
      for (const r of rows) allRows.push({ ...r, month });
      count += rows.length;
    }
    process.stderr.write(`[fetch] ${month} → ${count} rows across ${htmls.length} page(s)\n`);
  }
  // dedupe by qustnrSn
  const seen = new Set();
  const uniq = [];
  for (const r of allRows) {
    if (!r.qustnrSn || seen.has(r.qustnrSn)) continue;
    seen.add(r.qustnrSn);
    uniq.push(r);
  }
  let filtered = uniq;
  if (dates.length) {
    filtered = uniq.filter(r => dates.some(d => (r.edc || '').includes(d)));
  } else if (args.from && args.to) {
    filtered = uniq.filter(r => {
      const m = (r.edc || '').match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return false;
      return m[1] >= args.from && m[1] <= args.to;
    });
  }
  const result = {
    query: { dates, months, status: args.status, from: args.from, to: args.to },
    total_rows: uniq.length,
    matched: filtered.length,
    rows: filtered,
  };
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(result, null, 2), 'utf-8');
    process.stderr.write(`[out] wrote ${args.out} (${filtered.length}/${uniq.length})\n`);
  } else {
    process.stdout.write(JSON.stringify(result, null, 2));
  }
}

main().catch(e => {
  process.stderr.write(`ERROR: ${e.stack || e.message}\n`);
  process.exit(1);
});
