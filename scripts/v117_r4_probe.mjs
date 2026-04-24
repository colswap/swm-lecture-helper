// quick probe: dump raw history.do HTML to understand structure.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://www.swmaestro.ai';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function makeJar() {
  const store = new Map();
  return {
    ingest(list) {
      for (const raw of list) {
        const first = raw.split(';')[0].trim();
        const eq = first.indexOf('=');
        if (eq <= 0) continue;
        store.set(first.slice(0, eq), first.slice(eq + 1));
      }
    },
    header() { return Array.from(store.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
  };
}
function parseSet(r) {
  if (typeof r.headers.getSetCookie === 'function') return r.headers.getSetCookie();
  const x = r.headers.get('set-cookie'); return x ? [x] : [];
}
async function req(jar, method, url, opts = {}) {
  const { body, referer, extraHeaders } = opts;
  const headers = {
    'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8', Cookie: jar.header(),
    ...(referer ? { Referer: referer } : {}), ...(extraHeaders || {}),
  };
  let b = body;
  if (b && typeof b === 'object' && !(b instanceof URLSearchParams)) {
    b = new URLSearchParams(b).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (b instanceof URLSearchParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'; b = b.toString();
  }
  const resp = await fetch(url, { method, headers, body: b, redirect: 'manual' });
  jar.ingest(parseSet(resp));
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const loc = resp.headers.get('location');
    if (loc) return req(jar, method === 'POST' && resp.status === 303 ? 'GET' : 'GET', new URL(loc, url).toString(), { referer: url });
  }
  return resp;
}
async function login(user, pw) {
  const jar = makeJar();
  const loginUrl = `${BASE}/sw/member/user/forLogin.do?menuNo=200025`;
  const r1 = await req(jar, 'GET', loginUrl);
  const html1 = await r1.text();
  const csrf = html1.match(/id="csrfToken"\s+value="([^"]+)"/)[1];
  const form = new URLSearchParams({ loginFlag: '', menuNo: '200025', csrfToken: csrf, username: user, password: pw });
  const r2 = await req(jar, 'POST', `${BASE}/sw/member/user/checkStat.json`, {
    body: form, referer: loginUrl,
    extraHeaders: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  });
  await r2.json();
  const r3 = await req(jar, 'POST', `${BASE}/sw/member/user/toLogin.do`, { body: form, referer: loginUrl });
  const html3 = await r3.text();
  const fields = {}; const ire = /<input[^>]*type=['"]hidden['"][^>]*name=['"]([^'"]+)['"][^>]*value=['"]([^'"]*)['"]/gi;
  let m; while ((m = ire.exec(html3)) !== null) fields[m[1]] = m[2];
  const action = new URL(html3.match(/action=['"]([^'"]+)['"]/)[1], BASE).toString();
  await req(jar, 'POST', action, { body: new URLSearchParams(fields), referer: loginUrl });
  return jar;
}

const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.swm_creds.json'), 'utf-8'));
const jar = await login(creds.user, creds.pw);
const r = await req(jar, 'GET', `${BASE}/sw/mypage/userAnswer/history.do?menuNo=200047&pageIndex=1`);
const html = await r.text();
const out = '/mnt/c/claude/staging/v117_r4_history_raw.html';
fs.writeFileSync(out, html, 'utf-8');
console.error(`len=${html.length} -> ${out}`);
// print first tbody location + 1500 chars around
const idx = html.indexOf('<tbody');
console.error(`first <tbody at ${idx}`);
if (idx >= 0) {
  const end = html.indexOf('</tbody>', idx);
  console.error(`length up to </tbody>: ${end - idx}`);
  console.error('--- tbody preview (first 2000 chars) ---');
  console.error(html.slice(idx, Math.min(idx + 2000, end)));
}
// also count <tr and <td
console.error(`total <tr count: ${(html.match(/<tr\b/g) || []).length}`);
console.error(`total mentoLec/view.do count: ${(html.match(/mentoLec\/view\.do/g) || []).length}`);
console.error(`total qustnrSn= count: ${(html.match(/qustnrSn=\d+/g) || []).length}`);
