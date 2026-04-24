// perf-i3-compare.js — v1 / v2 / v3 parser in-process 비교 (Node 변동 제거).
// v1: /tmp/baseline_v1/lib/query_parser.js (NLS 이전 원본 1.15.0)
// v3: /mnt/c/claude/swm-lecture-helper/lib/query_parser.js (현 HEAD, NLS v3)
// 동일 프로세스에서 동일 쿼리를 교대로 벤치 → env 변동 최소화.

'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const SAMPLES = [
  '', 'ai', '백엔드', 'llm 창업', '내일', '이번주 온라인', '다음주 접수중 백엔드',
  '오늘 오후 3시 이후', '저녁 온라인', '14-18시 접수중', '월요일 ai',
  '@김철수 #backend -카카오', '@"이현수" #특강 온라인 접수중',
  '오전 9-12시 접수중 프론트엔드', '다음주 목요일 오후 3시 이후 ai',
  '머신러닝 딥러닝 gpt llm rag', '스프링 kafka msa backend', '쿠버 aws k8s docker',
  '취업 면접 이력서 이직', '창업 투자 mvp pmf ir',
  '#AI 내일 14시 이후 -스타트업', '@"김민수" #데이터 -면접 오프라인',
  'unity 유니티 게임 언리얼 godot', '보안 해킹 취약점 암호학', '이번달 접수중',
];

function loadParser(file, tag) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {}, module: { exports: {} } };
  new Function('window', 'module', 'exports', src)(sandbox.window, sandbox.module, sandbox.module.exports);
  return sandbox.window.SWM_QUERY || sandbox.module.exports;
}

const V1 = loadParser('/tmp/baseline_v1/lib/query_parser.js', 'v1');
const V3 = loadParser('/mnt/c/claude/swm-lecture-helper/lib/query_parser.js', 'v3');

function benchSession(parser, iter) {
  for (let i = 0; i < 200; i++) for (const q of SAMPLES) parser.parse(q);
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) for (const q of SAMPLES) parser.parse(q);
  return (performance.now() - t0) / iter;
}

// 동일 조건으로 교차 3 라운드, median.
function bench3(parser, iter) {
  const runs = [benchSession(parser, iter), benchSession(parser, iter), benchSession(parser, iter)];
  runs.sort((a, b) => a - b);
  return runs[1];
}

const ITER = 3000;
// 워밍업 + 인터리브: v1→v3→v1→v3 로 3회씩 돌리고 median.
const r1 = [bench3(V1, ITER), bench3(V3, ITER), bench3(V1, ITER), bench3(V3, ITER)];
const v1Median = [r1[0], r1[2]].sort((a, b) => a - b)[0]; // min of 2 v1 runs
const v3Median = [r1[1], r1[3]].sort((a, b) => a - b)[0]; // min of 2 v3 runs

console.log('\n=== in-process session bench (ms/session) ===');
console.log(`v1 (baseline):  ${v1Median.toFixed(4)} ms/session`);
console.log(`v3 (current):   ${v3Median.toFixed(4)} ms/session`);
console.log(`Δ absolute:     ${(v3Median - v1Median).toFixed(4)} ms  (${((v3Median / v1Median) - 1) * 100 | 0}% v3/v1)`);
console.log(`Δ per-parse:    ${((v3Median - v1Median) / SAMPLES.length * 1000).toFixed(2)} µs/parse`);

// 개별 쿼리 비교 (µs/parse, 5000 iter).
function benchOne(parser, q, iter) {
  for (let i = 0; i < 200; i++) parser.parse(q);
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) parser.parse(q);
  return ((performance.now() - t0) / iter) * 1000;
}
console.log('\n=== per-query (µs/call, 5000 iter, interleaved) ===');
console.log('| query | v1 | v3 | Δ µs | Δ % |');
console.log('|---|---:|---:|---:|---:|');
const rows = [];
for (const q of SAMPLES) {
  // 교대로 4번 측정 → v1 min, v3 min.
  const a1 = benchOne(V1, q, 5000);
  const a3 = benchOne(V3, q, 5000);
  const b1 = benchOne(V1, q, 5000);
  const b3 = benchOne(V3, q, 5000);
  const v1 = Math.min(a1, b1);
  const v3 = Math.min(a3, b3);
  rows.push({ q, v1, v3, delta: v3 - v1, pct: ((v3 - v1) / v1) * 100 });
  console.log(`| \`${q || '<empty>'}\` | ${v1.toFixed(2)} | ${v3.toFixed(2)} | ${(v3 - v1).toFixed(2)} | ${((v3 / v1 - 1) * 100).toFixed(1)}% |`);
}

// 요약
const totalV1 = rows.reduce((s, r) => s + r.v1, 0);
const totalV3 = rows.reduce((s, r) => s + r.v3, 0);
console.log(`\nsum over 25 queries: v1 ${totalV1.toFixed(2)} µs, v3 ${totalV3.toFixed(2)} µs · overall Δ ${(((totalV3 / totalV1) - 1) * 100).toFixed(1)}%`);

const out = {
  sessionMs: { v1: v1Median, v3: v3Median, deltaPct: ((v3Median / v1Median) - 1) * 100 },
  perQuery: rows,
  totals: { v1: totalV1, v3: totalV3, deltaPct: ((totalV3 / totalV1) - 1) * 100 },
};
fs.writeFileSync('/mnt/c/claude/staging/scripts/perf-i3-compare.json', JSON.stringify(out, null, 2));
