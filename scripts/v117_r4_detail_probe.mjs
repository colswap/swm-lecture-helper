// detail page probe: fetch 1 applied sn's view.do, dump raw + parsed info.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://www.swmaestro.ai';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

function makeJar() {
  const s = new Map();
  return {
    ingest(list) { for (const raw of list) { const f = raw.split(';')[0].trim(); const e = f.indexOf('='); if (e > 0) s.set(f.slice(0, e), f.slice(e + 1)); } },
    header() { return Array.from(s.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
  };
}
function pc(r) { if (typeof r.headers.getSetCookie === 'function') return r.headers.getSetCookie(); const x = r.headers.get('set-cookie'); return x ? [x] : []; }
async function req(jar, method, url, opts = {}) {
  const { body, referer, extraHeaders } = opts;
  const h = { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'ko-KR,ko', Cookie: jar.header(), ...(referer ? { Referer: referer } : {}), ...(extraHeaders || {}) };
  let b = body;
  if (b && typeof b === 'object' && !(b instanceof URLSearchParams)) { b = new URLSearchParams(b).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (b instanceof URLSearchParams) { h['Content-Type'] = 'application/x-www-form-urlencoded'; b = b.toString(); }
  const r = await fetch(url, { method, headers: h, body: b, redirect: 'manual' });
  jar.ingest(pc(r));
  if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get('location'); if (loc) return req(jar, method === 'POST' && r.status === 303 ? 'GET' : 'GET', new URL(loc, url).toString(), { referer: url }); }
  return r;
}
async function login(user, pw) {
  const jar = makeJar();
  const u = `${BASE}/sw/member/user/forLogin.do?menuNo=200025`;
  const h1 = await (await req(jar, 'GET', u)).text();
  const csrf = h1.match(/id="csrfToken"\s+value="([^"]+)"/)[1];
  const f = new URLSearchParams({ loginFlag: '', menuNo: '200025', csrfToken: csrf, username: user, password: pw });
  await (await req(jar, 'POST', `${BASE}/sw/member/user/checkStat.json`, { body: f, referer: u, extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } })).text();
  const h3 = await (await req(jar, 'POST', `${BASE}/sw/member/user/toLogin.do`, { body: f, referer: u })).text();
  const fields = {}; const ire = /<input[^>]*type=['"]hidden['"][^>]*name=['"]([^'"]+)['"][^>]*value=['"]([^'"]*)['"]/gi; let m; while ((m = ire.exec(h3)) !== null) fields[m[1]] = m[2];
  const action = new URL(h3.match(/action=['"]([^'"]+)['"]/)[1], BASE).toString();
  await req(jar, 'POST', action, { body: new URLSearchParams(fields), referer: u });
  return jar;
}

const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.swm_creds.json'), 'utf-8'));
const jar = await login(creds.user, creds.pw);
const sns = process.argv.slice(2).length ? process.argv.slice(2) : ['10032', '9652', '9602', '9006'];
const out = {};
for (const sn of sns) {
  const url = `${BASE}/sw/mypage/mentoLec/view.do?qustnrSn=${sn}&menuNo=200046`;
  const r = await req(jar, 'GET', url);
  const html = await r.text();
  fs.writeFileSync(`/mnt/c/claude/staging/v117_r4_detail_${sn}.html`, html, 'utf-8');
  // find "강의날짜" and "개설 승인" and "상태" and "모집 명"
  const keys = ['강의날짜', '개설 승인', '상태', '모집 명', '장소', '작성자', '접수 기간', '접수'];
  const extracted = {};
  for (const k of keys) {
    // find occurrence then next sibling text
    const re = new RegExp(`${k}[\\s\\S]{0,800}`, 'g');
    // dump first 800 chars after key
    const i = html.indexOf(k);
    extracted[k] = i >= 0 ? html.slice(i, i + 400).replace(/\n/g, '\\n') : '';
  }
  out[sn] = extracted;
  console.log(`\n=== sn=${sn} ===`);
  for (const k of keys) {
    console.log(`  [${k}]`, extracted[k].substring(0, 200));
  }
}
fs.writeFileSync('/mnt/c/claude/staging/v117_r4_detail_probe.json', JSON.stringify(out, null, 2), 'utf-8');
