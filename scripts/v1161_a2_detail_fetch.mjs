#!/usr/bin/env node
// v1161_a2_detail_fetch.mjs — swm_fetch_and_audit.mjs 의 login 체인을 재사용하여
// `/sw/mypage/mentoLec/view.do?qustnrSn={sn}&menuNo=200046` 상세 HTML 을
// 배치로 받아 raw 강의날짜 텍스트를 추출한다. 읽기 전용.
//
// 사용법:
//   node scripts/v1161_a2_detail_fetch.mjs --input /tmp/swm_wide.json --limit 50 \
//       --filter '[멘토 특강]' --out /tmp/swm_detail.json
//
// ~/.swm_creds.json 에서 자격증명 로드.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://www.swmaestro.ai';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ------------------- 쿠키 jar (동일) -------------------
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

// ------------------- 상세 페이지 파싱 -------------------

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function collapse(s) { return s.replace(/\s+/g, ' ').trim(); }

// "강의날짜" strong 다음 <div class="c"> ... </div> 통째로 꺼낸다.
function extractDateBlock(html) {
  const strongIdx = html.indexOf('강의날짜</strong>');
  if (strongIdx < 0) return { rawHtml: '', rawText: '', dateSpan: '', afterSpan: '' };
  // 다음에 나오는 <div class="c"> 찾기.
  const divStart = html.indexOf('<div class="c">', strongIdx);
  if (divStart < 0) return { rawHtml: '', rawText: '', dateSpan: '', afterSpan: '' };
  // div 가 span 하나만 있는 단순 구조지만 내부 다른 </div> 있을 수 있음.
  // 가장 가까운 </div> 로 종료 가정 (관찰상 이 블록에는 nested div 없음).
  const divEnd = html.indexOf('</div>', divStart);
  if (divEnd < 0) return { rawHtml: '', rawText: '', dateSpan: '', afterSpan: '' };
  const rawHtml = html.slice(divStart, divEnd + 6);
  const dateSpanM = rawHtml.match(/<span\s+class="eventDt">([^<]*)<\/span>/);
  const dateSpan = dateSpanM ? collapse(stripTags(dateSpanM[1])) : '';
  // span 뒤 이어지는 "raw time" (시 suffix 가 붙는 그 부분)
  const afterSpan = dateSpanM
    ? collapse(stripTags(rawHtml.slice(rawHtml.indexOf('</span>') + 7).replace(/<\/div>\s*$/, '')))
    : '';
  const rawText = collapse(stripTags(rawHtml));
  return { rawHtml, rawText, dateSpan, afterSpan };
}

// ------------------- 파서 복제 (content.js / time_utils.js 와 동일 로직) -------------------
// Task 는 "content.js extractLecDateTime + time_utils.js parseLecDateTime 둘 다 적용" 요구.
// Node 환경이라 content.js 를 못 import → 동일 로직 inline 복제. 원본 그대로.

function extractLecDateTime_content(raw) {
  const out = { lecDate: '', lecTime: '' };
  if (!raw) return out;
  let s = String(raw)
    .replace(/ /g, ' ')
    .replace(/：/g, ':')
    .replace(/[〜～]/g, '~')
    .replace(/\s+/g, ' ')
    .trim();
  const dM = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (dM) {
    out.lecDate = `${dM[1]}-${String(+dM[2]).padStart(2, '0')}-${String(+dM[3]).padStart(2, '0')}`;
  }
  s = s.replace(/(\d{1,2}:\d{2})\s*시/g, '$1');
  s = s.replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, (_, h, m) => `${h}:${String(+m).padStart(2, '0')}`);
  s = s.replace(/(\d{1,2})\s*시(?!\s*\d)/g, (_, h) => `${h}:00`);
  const pack = (h1, m1, h2, m2) => {
    if (![h1, m1, h2, m2].every(Number.isFinite)) return null;
    if (h1 < 0 || h1 > 29 || h2 < 0 || h2 > 29) return null;
    if (m1 < 0 || m1 > 59 || m2 < 0 || m2 > 59) return null;
    const startMin = h1 * 60 + m1;
    let endMin = h2 * 60 + m2;
    if (endMin === startMin) return { startMin, endMin };
    if (endMin < startMin) endMin += 24 * 60;
    if (endMin - startMin > 16 * 60) return null;
    return { startMin, endMin };
  };
  const toHHMM = (min) => {
    const mm = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;
  };
  const re = /(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})\s*[~\-–—]\s*(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})/;
  const m = s.match(re);
  if (m) {
    const isPm = (t) => t && /오후|pm/i.test(t);
    const isAm = (t) => t && /오전|am/i.test(t);
    const adj = (h, tag, fallback) => {
      const eff = tag || fallback;
      if (isPm(eff) && h < 12) return h + 12;
      if (isAm(eff) && h === 12) return 0;
      return h;
    };
    const h1 = adj(+m[2], m[1], null);
    const h2 = adj(+m[5], m[4], m[1]);
    const r = pack(h1, +m[3], h2, +m[6]);
    if (r) {
      const endDisplay = r.endMin >= 24 * 60 ? r.endMin - 24 * 60 : r.endMin;
      out.lecTime = `${toHHMM(r.startMin)} ~ ${toHHMM(endDisplay)}`;
    }
  }
  return out;
}

// time_utils.js parseLecDateTime 재구현 (원문 그대로)
function parseTimeRange_lib(str) {
  if (!str) return null;
  let s = String(str)
    .replace(/ /g, ' ')
    .replace(/：/g, ':')
    .replace(/[〜～]/g, '~');
  s = s.replace(/(\d{1,2}:\d{2})\s*시/g, '$1');
  s = s.replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분/g, (_, h, m) => `${h}:${String(+m).padStart(2, '0')}`);
  s = s.replace(/(\d{1,2})\s*시(?!\s*\d)/g, (_, h) => `${h}:00`);

  const tryPack = (h1, m1, h2, m2) => {
    if (![h1, m1, h2, m2].every(Number.isFinite)) return null;
    if (h1 < 0 || h1 > 29 || h2 < 0 || h2 > 29) return null;
    if (m1 < 0 || m1 > 59 || m2 < 0 || m2 > 59) return null;
    let startMin = h1 * 60 + m1;
    let endMin = h2 * 60 + m2;
    if (endMin === startMin) return { startMin, endMin };
    if (endMin < startMin) endMin += 24 * 60;
    if (endMin - startMin > 16 * 60) return null;
    return { startMin, endMin };
  };

  const re = /(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})\s*[~\-–—]\s*(오전|오후|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})/;
  const m = s.match(re);
  if (!m) return null;

  const isPm = (t) => t && /오후|pm/i.test(t);
  const isAm = (t) => t && /오전|am/i.test(t);
  const adj = (h, tag, fallback) => {
    const effective = tag || fallback;
    if (isPm(effective) && h < 12) return h + 12;
    if (isAm(effective) && h === 12) return 0;
    return h;
  };
  const h1 = adj(+m[2], m[1], null);
  const h2 = adj(+m[5], m[4], m[1]);
  return tryPack(h1, +m[3], h2, +m[6]);
}

function minToHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseLecDateTime_lib(raw) {
  const out = { lecDate: '', lecTime: '', range: null };
  if (!raw) return out;
  const s = String(raw).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const dM = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (dM) {
    out.lecDate = `${dM[1]}-${String(+dM[2]).padStart(2, '0')}-${String(+dM[3]).padStart(2, '0')}`;
  }
  const r = parseTimeRange_lib(s);
  if (r) {
    out.range = r;
    out.lecTime = `${minToHHMM(r.startMin % (24 * 60))} ~ ${minToHHMM(r.endMin % (24 * 60) || 24 * 60)}`;
    if (r.endMin >= 24 * 60 && r.endMin % (24 * 60) !== 0) {
      out.lecTime = `${minToHHMM(r.startMin)} ~ ${minToHHMM(r.endMin - 24 * 60)}`;
    }
  }
  return out;
}

// ------------------- main -------------------

function parseArgs(argv) {
  const args = { input: null, limit: 50, filter: '', out: null, sleepMs: 300 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--input') { args.input = v; i++; }
    else if (a === '--limit') { args.limit = Number(v); i++; }
    else if (a === '--filter') { args.filter = v; i++; }
    else if (a === '--out') { args.out = v; i++; }
    else if (a === '--sleep') { args.sleepMs = Number(v); i++; }
  }
  return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) throw new Error('--input is required');
  const listJson = JSON.parse(fs.readFileSync(args.input, 'utf-8'));
  const rows = listJson.rows || [];

  // filter pool
  let pool = rows;
  if (args.filter) {
    pool = rows.filter(r => (r.title || '').includes(args.filter));
  }
  // dedupe by qustnrSn (already done, but safety)
  const seen = new Set();
  pool = pool.filter(r => {
    if (!r.qustnrSn || seen.has(r.qustnrSn)) return false;
    seen.add(r.qustnrSn);
    return true;
  });
  // Spread across dates: sort by edc ascending for variety
  pool.sort((a, b) => (a.edc || '').localeCompare(b.edc || ''));

  // Stride sample to cover date range
  const n = Math.min(args.limit, pool.length);
  const samples = [];
  if (pool.length <= args.limit) {
    samples.push(...pool);
  } else {
    const stride = pool.length / args.limit;
    for (let i = 0; i < args.limit; i++) {
      samples.push(pool[Math.floor(i * stride)]);
    }
  }
  process.stderr.write(`[pool] filter="${args.filter}" pool=${pool.length} sampling=${samples.length}\n`);

  const creds = loadCreds();
  process.stderr.write(`[login] ${creds.user}\n`);
  const jar = await login(creds.user, creds.pw);
  process.stderr.write(`[login] ok\n`);

  const results = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const url = `${BASE}/sw/mypage/mentoLec/view.do?qustnrSn=${s.qustnrSn}&menuNo=200046`;
    try {
      const r = await req(jar, 'GET', url);
      if (!r.ok) {
        process.stderr.write(`[${i+1}/${samples.length}] sn=${s.qustnrSn} HTTP ${r.status}\n`);
        results.push({ ...s, detailUrl: url, error: `http ${r.status}` });
        continue;
      }
      const html = await r.text();
      const block = extractDateBlock(html);
      // Parsed results
      const contentResult = extractLecDateTime_content(block.rawText);
      const libResult = parseLecDateTime_lib(block.rawText);
      // Also parse afterSpan raw (the time-only part with 시 suffix)
      const afterSpan_content = extractLecDateTime_content(block.afterSpan);
      const afterSpan_lib = parseLecDateTime_lib(block.afterSpan);
      // And combined "date span + afterSpan":
      const combinedRaw = block.dateSpan + ' ' + block.afterSpan;
      const combined_content = extractLecDateTime_content(combinedRaw);
      const combined_lib = parseLecDateTime_lib(combinedRaw);
      results.push({
        qustnrSn: s.qustnrSn,
        title: s.title,
        listEdc: s.edc,
        detailUrl: url,
        rawHtml: block.rawHtml,
        rawText: block.rawText,
        dateSpan: block.dateSpan,
        afterSpan: block.afterSpan,
        combinedRaw,
        parse: {
          combined: { content: combined_content, lib: { lecDate: combined_lib.lecDate, lecTime: combined_lib.lecTime } },
          rawText: { content: contentResult, lib: { lecDate: libResult.lecDate, lecTime: libResult.lecTime } },
          afterSpan: { content: afterSpan_content, lib: { lecDate: afterSpan_lib.lecDate, lecTime: afterSpan_lib.lecTime } },
        },
      });
      if ((i + 1) % 10 === 0) {
        process.stderr.write(`[${i+1}/${samples.length}] sn=${s.qustnrSn} raw="${block.rawText.slice(0,50)}"\n`);
      }
      await sleep(args.sleepMs);
    } catch (e) {
      process.stderr.write(`[${i+1}/${samples.length}] sn=${s.qustnrSn} ERROR ${e.message}\n`);
      results.push({ ...s, detailUrl: url, error: e.message });
    }
  }

  const output = {
    query: { input: args.input, filter: args.filter, limit: args.limit, total_pool: pool.length },
    count: results.length,
    results,
  };
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(output, null, 2), 'utf-8');
    process.stderr.write(`[out] wrote ${args.out} (${results.length} results)\n`);
  } else {
    process.stdout.write(JSON.stringify(output, null, 2));
  }
}

main().catch(e => {
  process.stderr.write(`ERROR: ${e.stack || e.message}\n`);
  process.exit(1);
});
