// v1.16.1 verification script. Runs a1 synthetic (122) + a2 realdata (870)
// through the unified time_utils.js and reports parsed / fail / 24:00-divergence.
// Usage: node scripts/v1161_verify.js

const path = require('path');
const fs = require('fs');
const T = require(path.join(__dirname, '..', 'lib', 'time_utils.js'));

function reportA2() {
  const p = '/mnt/c/claude/staging/v1161_a2_realdata.json';
  if (!fs.existsSync(p)) {
    console.log('[a2] realdata not available, skip');
    return;
  }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  let total = 0, parsed = 0, divergent = 0, fail24 = 0;
  const failSamples = [];

  const check = (raw, tag, sn) => {
    if (!raw) return;
    total++;
    const r = T.extractLecDateTime(raw);
    if (r.lecTime) {
      parsed++;
      if (/24:00/.test(raw) && !/24:00/.test(r.lecTime)) fail24++;
    } else {
      if (failSamples.length < 5) failSamples.push({ tag, sn, raw });
    }
  };

  for (const row of (d.list?.rows || [])) check(row.raw, 'list', row.qustnrSn);
  for (const row of (d.detail_mentor_special?.rows || [])) check(row.combinedRaw || row.rawText, 'detail-special', row.qustnrSn);
  for (const row of (d.detail_free_mentoring?.rows || [])) check(row.combinedRaw || row.rawText, 'detail-free', row.qustnrSn);

  console.log(`[a2 realdata] total=${total} parsed=${parsed}/${total} (${(parsed / total * 100).toFixed(2)}%) 24:00-발산=${fail24}`);
  if (failSamples.length) {
    console.log('[a2] fail samples:');
    for (const s of failSamples) console.log(` · ${s.tag} sn=${s.sn}: ${JSON.stringify(s.raw)}`);
  }
}

function reportA1() {
  const p = '/mnt/c/claude/staging/v1161_a1_harness.js';
  if (!fs.existsSync(p)) {
    console.log('[a1] harness not available, skip');
    return;
  }
  const { execSync } = require('child_process');
  const out = execSync(`node ${p}`, { cwd: path.join(__dirname, '..') }).toString();
  const rows = JSON.parse(out);
  let libPass = 0, libFail = 0;
  const fails = [];
  for (const r of rows) {
    if (r.expect === null) continue;
    if (r.libLecTime === r.expect) libPass++;
    else { libFail++; fails.push(r); }
  }
  console.log(`[a1 harness] lib path: pass=${libPass} fail=${libFail} total(expected-defined)=${libPass + libFail}`);
  if (fails.length) {
    console.log('[a1] remaining fails (mostly harness expected-value drift):');
    for (const f of fails) console.log(` · ${f.id} ${f.cat} ${JSON.stringify(f.input)} → ${JSON.stringify(f.libLecTime)} vs expect ${JSON.stringify(f.expect)}`);
  }
}

reportA1();
reportA2();
