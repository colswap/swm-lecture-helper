// perf-i3.js — v1.15.0 Phase H 성능 리뷰 (Task #23)
//
// Phase H 변경분:
//   • NLS v3: DERIVED_ALIAS 140 → 280+ 엔트리 (카테고리별 10+ 확장)
//   • 팔레트 v3: --cat-*-bg / --cat-*-tag-bg 이중 토큰 (19 × 2 = 38) + 블록 19 + 배지 19
//     = 76 토큰 선언 + 38 selector 규칙 (body.cat-colors × 19 + .lec-block[data-cat] × 19)
//   • .lec-block 재설계: ::after dot 제거, ::before 별, preview-pulse / conflict-glow /
//     conflict-shake 3 keyframes + hover lift scale
//
// 측정:
//   1. parse() 25 샘플 × 5000 iter (G4 baseline 과 직접 비교)
//   2. apply() 971 mock 강연 × 6 시나리오
//   3. classifier.injectInto() cold vs warm (971 강연 × _cv cache 유효성)
//   4. CSS rule/selector 카운트 (G4 기준 성장율)
//   5. keyframe / animation 수
//   6. 번들 크기 변화
//
// node 환경에서 실행: `node scripts/perf-i3.js`

'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = '/mnt/c/claude/swm-lecture-helper';
const BASELINE_JSON = '/mnt/c/claude/staging/scripts/perf-g4-result.json';

global.window = global.window || global;
const QUERY = require(path.join(ROOT, 'lib/query_parser.js'));

// classifier 는 window 에만 export 하므로 module 로는 require 이 안 됨 — 소스 읽어서 sandbox 로 실행.
function loadClassifier() {
  const src = fs.readFileSync(path.join(ROOT, 'lib/classifier.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.SWM_CLASSIFY;
}

const CLASSIFY = loadClassifier();

// G4 와 동일한 25 샘플 쿼리.
const SAMPLE_QUERIES = [
  '',
  'ai',
  '백엔드',
  'llm 창업',
  '내일',
  '이번주 온라인',
  '다음주 접수중 백엔드',
  '오늘 오후 3시 이후',
  '저녁 온라인',
  '14-18시 접수중',
  '월요일 ai',
  '@김철수 #backend -카카오',
  '@"이현수" #특강 온라인 접수중',
  '오전 9-12시 접수중 프론트엔드',
  '다음주 목요일 오후 3시 이후 ai',
  '머신러닝 딥러닝 gpt llm rag',
  '스프링 kafka msa backend',
  '쿠버 aws k8s docker',
  '취업 면접 이력서 이직',
  '창업 투자 mvp pmf ir',
  '#AI 내일 14시 이후 -스타트업',
  '@"김민수" #데이터 -면접 오프라인',
  'unity 유니티 게임 언리얼 godot',
  '보안 해킹 취약점 암호학',
  '이번달 접수중',
];

// NLS v3 신규 alias 만 포함한 추가 쿼리 (회귀 민감).
const V3_ONLY_QUERIES = [
  'agentic 바이브코딩 vibe',
  'fastapi django graphql nextjs',
  'flutter 플러터 reactnative kotlin',
  'etl warehouse pandas spark bigquery',
  'terraform docker 쿠버네티스',
  'observability sre ci cicd',
  'pentest infosec 취약',
  'godot unreal 그래픽스',
  'web3 nft defi solidity 이더리움',
  'rtos 펌웨어 embedded',
  '퍼소나 경험맵 유저리서치 프로덕트매니저',
  'vc pitch pmf mvp',
  '포트폴리오 인터뷰 이직',
  '자료구조 알고리즘 코테',
  '브레인스토밍 아이디에이션',
  'kpt 애자일 scrum',
  '소마 마에스트로 연수생',
];

function makeMockLectures(n) {
  const MENTORS = ['김민수', '이현수', '박지우', '정아라', '최수민', 'John Kim', 'Alice Park', '조영식', '한상현', '유지호'];
  const TITLES = [
    ['LLM 파인튜닝', 'RAG 시스템', 'GPT 프롬프트', '딥러닝 MLOps', 'Agentic 설계'],
    ['대용량 트래픽', 'Spring Boot MSA', 'Kafka 스트리밍', 'API 설계', 'GraphQL 실전'],
    ['React 최적화', 'Next.js 실전', 'Vue 컴포지션', 'Tailwind 시스템', 'TypeScript 제네릭'],
    ['스타트업 피치', '창업 투자', 'IR 덱', '이력서 클리닉', '면접 준비'],
  ];
  const DERIVED = [['ai'], ['backend'], ['frontend'], ['startup', 'career']];
  const CATEGORIES = ['MRC010', 'MRC020'];
  const LOCS = ['온라인 (Zoom)', '서울 강남 본사', '오프라인 (판교)', '비대면 Webex', '현장 참석'];
  const out = {};
  const now = new Date('2026-04-19');
  for (let i = 0; i < n; i++) {
    const sn = String(10000 + i);
    const b = i % 4;
    const d = new Date(now.getTime() + (i % 30) * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hh = String(9 + (i % 12)).padStart(2, '0') + ':' + (i % 2 === 0 ? '00' : '30');
    const loc = LOCS[i % LOCS.length];
    out[sn] = {
      lecSn: sn,
      sn,
      title: TITLES[b][i % 5] + ' #' + i,
      mentor: MENTORS[i % MENTORS.length],
      categoryNm: b === 3 ? '커리어' : b === 0 ? 'AI/LLM' : '개발',
      category: CATEGORIES[i % 2],
      description: '상세 설명',
      location: loc,
      isOnline: /온라인|비대면|Webex|Zoom/i.test(loc),
      status: i % 3 === 0 ? 'C' : 'A',
      lecDate: iso,
      lecTime: hh,
      derivedCategories: DERIVED[b],
    };
  }
  return out;
}

function bench(name, fn, iter) {
  for (let i = 0; i < Math.min(200, iter); i++) fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn(i);
  const t1 = performance.now();
  return { name, iter, total: t1 - t0, perCall: ((t1 - t0) / iter) * 1000 };
}

const results = {};

// ── 1. parse() 단독 — G4 baseline 과 동일한 25 쿼리 ──
{
  const ITER = 5000;
  const rows = [];
  for (const q of SAMPLE_QUERIES) {
    const r = bench(`parse:"${q.slice(0, 30)}"`, () => QUERY.parse(q), ITER);
    rows.push({ q, ...r });
  }
  results.parseSingle = rows;

  const SESSION_ITER = 2000;
  results.parseSession = bench('parse:session-25q', () => {
    for (const q of SAMPLE_QUERIES) QUERY.parse(q);
  }, SESSION_ITER);
}

// ── 2. NLS v3 전용 신규 alias 쿼리 ──
{
  const ITER = 5000;
  const rows = [];
  for (const q of V3_ONLY_QUERIES) {
    const r = bench(`v3:"${q.slice(0, 30)}"`, () => QUERY.parse(q), ITER);
    rows.push({ q, ...r });
  }
  results.parseV3New = rows;
}

// ── 3. apply() 971 강연 시나리오 ──
{
  const lectures971 = Object.values(makeMockLectures(971));
  const scenarios = [
    ['empty', ''],
    ['1word-heuristic', 'ai'],
    ['nls-date-loc-status', '내일 비대면 접수중'],
    ['nls-complex', '다음주 목요일 오후 3시 이후 ai'],
    ['prefixed-full', '@"이현수" #backend -카카오 접수중'],
    ['freetext-korean', '머신러닝'],
    ['v3-alias-burst', 'agentic fastapi flutter'],
  ];
  const rows = [];
  for (const [name, q] of scenarios) {
    const ast = QUERY.parse(q);
    const hit = QUERY.apply(ast, lectures971).length;
    const r = bench(`apply:${name}`, () => QUERY.apply(ast, lectures971), 1000);
    rows.push({ name, q, hit, ...r });
  }
  results.applyScenarios = rows;
}

// ── 4. classifier.injectInto cold vs warm (cache validation) ──
{
  const lecturesObj = makeMockLectures(971);
  // strip description 을 좀 더 현실적인 분류 입력으로 치환 (기본 mock 은 description 빈약).
  const keywords = ['LLM GPT 파인튜닝', 'Spring Kafka MSA', 'React Next.js Vue', '창업 IR', '커리어 면접', '보안 해킹', '쿠버 도커', '모바일 Flutter iOS', '데이터 ETL'];
  for (const [i, l] of Object.values(lecturesObj).entries()) {
    l.description = keywords[i % keywords.length] + ' ' + l.description;
    l._cv = null;
  }
  // Cold: 모든 강연 _cv 리셋
  const cold = bench('classifier:cold-971', () => {
    for (const l of Object.values(lecturesObj)) l._cv = null;
    CLASSIFY.injectInto(lecturesObj);
  }, 30);
  // Warm: 이미 _cv = VERSION 세팅됨, 정상적으로는 for-loop 가 all-skip → 거의 0
  const warm = bench('classifier:warm-971', () => {
    CLASSIFY.injectInto(lecturesObj);
  }, 500);
  results.classifier = { cold, warm, ratio: cold.perCall / warm.perCall };
}

// ── 5. CSS rule/selector/keyframe ──
function cssStats(file) {
  const src = fs.readFileSync(file, 'utf8');
  const noComment = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = { rules: 0, selectors: 0, atRules: 0, keyframes: 0, mediaRules: 0, containerRules: 0 };
  // keyframes / media 집계 (string count).
  out.keyframes = (noComment.match(/@keyframes\s+/g) || []).length;
  out.mediaRules = (noComment.match(/@media\s*\(/g) || []).length;
  out.containerRules = (noComment.match(/@container\s*/g) || []).length;
  let depth = 0, selStart = 0;
  for (let i = 0; i < noComment.length; i++) {
    const c = noComment[i];
    if (c === '{') {
      if (depth === 0) {
        const sel = noComment.slice(selStart, i).trim();
        if (sel) {
          if (sel.startsWith('@')) out.atRules++;
          else { out.rules++; out.selectors += sel.split(',').length; }
        }
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) selStart = i + 1;
    }
  }
  return { file: path.basename(file), bytes: src.length, ...out };
}
{
  results.cssStats = [
    cssStats(path.join(ROOT, 'lib/tokens.css')),
    cssStats(path.join(ROOT, 'lib/coachmark.css')),
    cssStats(path.join(ROOT, 'popup/popup.css')),
    cssStats(path.join(ROOT, 'timetable/timetable.css')),
    cssStats(path.join(ROOT, 'content/content.css')),
  ];
}

// ── 6. alias 테이블 크기 ──
{
  const src = fs.readFileSync(path.join(ROOT, 'lib/query_parser.js'), 'utf8');
  const block = src.match(/const DERIVED_ALIAS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  const count = block ? (block[1].match(/'[^']+'\s*:/g) || []).length : 0;
  results.aliasTable = { derivedAliasEntries: count };
}

// ── 7. 파일 사이즈 ──
{
  const files = [
    'lib/query_parser.js', 'lib/classifier.js', 'lib/coachmark.js', 'lib/coachmark.css',
    'lib/tokens.css',
    'popup/popup.js', 'popup/popup.css', 'popup/popup.html',
    'timetable/timetable.js', 'timetable/timetable.css', 'timetable/timetable.html', 'timetable/menu.js',
    'background/service-worker.js', 'content/content.js', 'content/detail.js',
  ];
  results.fileSizes = files.map(f => {
    const p = path.join(ROOT, f);
    try { return { file: f, bytes: fs.statSync(p).size }; } catch { return { file: f, bytes: null }; }
  });
}

// ── 8. baseline 비교 ──
{
  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8')); } catch {}
  if (baseline) {
    const map = new Map(baseline.parseSingle.map(r => [r.q, r.perCall]));
    const deltas = results.parseSingle.map(r => {
      const base = map.get(r.q);
      if (base == null) return { q: r.q, base: null, cur: r.perCall, delta: null };
      return { q: r.q, base, cur: r.perCall, delta: r.perCall - base, pct: ((r.perCall - base) / base) * 100 };
    });
    results.parseDeltas = deltas;
    const baseSession = baseline.parseSession ? baseline.parseSession.total / baseline.parseSession.iter : null;
    const curSession = results.parseSession.total / results.parseSession.iter;
    results.sessionDelta = { base: baseSession, cur: curSession, pct: baseSession ? ((curSession - baseSession) / baseSession) * 100 : null };
  }
}

// ── 출력 ──
const fmt = n => (n == null ? '—' : Number(n).toFixed(3));
const fmtPct = n => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');

console.log('\n=== 1. parse() per-query (µs/call, 5000 iter) — G4 baseline 과 비교 ===');
console.log('| query | G4 base µs | v3 cur µs | Δ |');
console.log('|---|---:|---:|---:|');
const dMap = new Map((results.parseDeltas || []).map(d => [d.q, d]));
for (const r of results.parseSingle) {
  const d = dMap.get(r.q);
  const base = d ? d.base : null;
  const pct = d ? d.pct : null;
  console.log(`| \`${(r.q.slice(0, 40) || '<empty>')}\` | ${fmt(base)} | ${fmt(r.perCall)} | ${fmtPct(pct)} |`);
}

console.log('\n=== 2. parse() 25-query session ===');
if (results.sessionDelta) {
  console.log(`G4 base: ${fmt(results.sessionDelta.base)} ms/session · v3 cur: ${fmt(results.sessionDelta.cur)} ms/session · Δ ${fmtPct(results.sessionDelta.pct)}`);
}

console.log('\n=== 3. parse() v3 신규 alias 쿼리 ===');
console.log('| query | µs/call |');
console.log('|---|---:|');
for (const r of results.parseV3New) {
  console.log(`| \`${r.q}\` | ${fmt(r.perCall)} |`);
}

console.log('\n=== 4. apply() 시나리오 (971 강연, 1000 iter) ===');
console.log('| scenario | hit | µs/call |');
console.log('|---|---:|---:|');
for (const r of results.applyScenarios) {
  console.log(`| ${r.name} | ${r.hit} | ${fmt(r.perCall)} |`);
}

console.log('\n=== 5. classifier cold vs warm ===');
console.log(`cold 971: ${fmt(results.classifier.cold.perCall)} µs/run  ·  warm 971: ${fmt(results.classifier.warm.perCall)} µs/run  ·  ratio cold/warm = ${fmt(results.classifier.ratio)}x`);

console.log('\n=== 6. CSS stats ===');
console.log('| file | bytes | rules | selectors | atRules | keyframes | media | container |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of results.cssStats) {
  console.log(`| ${r.file} | ${r.bytes} | ${r.rules} | ${r.selectors} | ${r.atRules} | ${r.keyframes} | ${r.mediaRules} | ${r.containerRules} |`);
}

console.log('\n=== 7. DERIVED_ALIAS 테이블 크기 ===');
console.log(`entries: ${results.aliasTable.derivedAliasEntries}`);

console.log('\n=== 8. 파일 사이즈 ===');
let total = 0;
for (const r of results.fileSizes) { total += r.bytes || 0; console.log(`  ${r.file}: ${r.bytes} bytes`); }
console.log(`TOTAL: ${total} bytes (${(total / 1024).toFixed(1)} KB)`);

const outPath = '/mnt/c/claude/staging/scripts/perf-i3-result.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\n[result JSON → ${outPath}]`);
