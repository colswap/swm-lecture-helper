#!/usr/bin/env node
// parser_audit.mjs — 수집한 SWM 리스트 JSON 에 대해 time_utils 의 파서를 돌려
// 성공률과 실패 bucket 을 보고한다.
//
//   node scripts/parser_audit.mjs --in /tmp/swm_broad.json [--out docs/review/audit.json]

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
// time_utils.js 는 CJS IIFE + module.exports → createRequire 로 로드
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require(path.join(here, '..', 'lib', 'time_utils.js'));

function parseArgs(argv) {
  const a = { in: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--in') { a.in = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
  }
  return a;
}

function classifyFailure(row, parsed) {
  const edc = (row.edc || '').trim();
  if (!edc) return 'empty_edc';
  if (!parsed.lecDate) return 'date_parse_failed';
  if (!parsed.lecTime) {
    if (/미정|TBD|추후|tba/i.test(edc)) return 'placeholder_time';
    if (!/\d/.test(edc.replace(/\d{4}-?\d{2}-?\d{2}/, ''))) return 'no_time_given';
    if (/시\s*[~\-–—]/.test(edc) || /시$/.test(edc)) return 'korean_hhsi';
    if (/오전|오후|am|pm/i.test(edc)) return 'ampm_natural';
    return 'unknown_format';
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.in) {
    process.stderr.write('Usage: parser_audit.mjs --in <file.json> [--out <file>]\n');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(args.in, 'utf-8'));
  const rows = data.rows || [];
  const report = {
    input: args.in,
    total: rows.length,
    ok: 0,
    fail: 0,
    buckets: {},
    samples: [],
    failures: [],
    target_mentors: { '이정영': [], '박주람': [], '이세진': [] },
  };

  for (const r of rows) {
    const parsed = T.parseLecDateTime(r.edc || '');
    const ok = !!(parsed.lecDate && parsed.lecTime && parsed.range);
    const entry = {
      sn: r.qustnrSn,
      mentorNm: r.author,
      lecNm: r.title,
      edcRaw: r.edc,
      lecDate: parsed.lecDate || '',
      lecTime: parsed.lecTime || '',
      range: parsed.range,
      ok,
    };
    if (ok) {
      report.ok++;
    } else {
      report.fail++;
      const bucket = classifyFailure(r, parsed);
      entry.reason = bucket;
      report.buckets[bucket] = (report.buckets[bucket] || 0) + 1;
      if (report.failures.length < 50) report.failures.push(entry);
    }
    if (report.target_mentors[r.author]) {
      report.target_mentors[r.author].push({
        sn: r.qustnrSn,
        edcRaw: r.edc,
        parsed: entry,
      });
    }
    if (report.samples.length < 8) report.samples.push(entry);
  }
  report.success_rate = rows.length ? (report.ok / rows.length) : 0;

  const summary = [
    `# parser_audit: ${args.in}`,
    `total=${report.total} ok=${report.ok} fail=${report.fail} success=${(report.success_rate * 100).toFixed(2)}%`,
    `buckets: ${JSON.stringify(report.buckets)}`,
    '',
  ];
  process.stdout.write(summary.join('\n') + '\n');

  if (report.failures.length) {
    process.stdout.write('--- failures ---\n');
    for (const f of report.failures.slice(0, 20)) {
      process.stdout.write(`  [${f.reason}] sn=${f.sn} ${f.mentorNm} | edc=${JSON.stringify(f.edcRaw)}\n`);
    }
  }
  process.stdout.write('\n--- target mentors ---\n');
  for (const [name, hits] of Object.entries(report.target_mentors)) {
    for (const h of hits) {
      const p = h.parsed;
      const mark = p.ok ? 'OK ' : 'FAIL';
      process.stdout.write(`  ${mark} ${name} sn=${h.sn} edc=${JSON.stringify(h.edcRaw)} → lecDate=${p.lecDate} lecTime=${p.lecTime}\n`);
    }
  }

  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf-8');
    process.stderr.write(`[out] ${args.out}\n`);
  }
}

main();
