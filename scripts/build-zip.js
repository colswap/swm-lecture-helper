// v1.16.1 zip 빌드 — forward-slash 경로 강제 (CWS 호환).
// PowerShell Compress-Archive 는 backslash 로 저장해서 Chrome 이 인식 못할 수 있음.
// 사용: node scripts/build-zip.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT = path.join(ROOT, `swm-lecture-helper-v${pkg.version}.zip`);

const FILES = [
  'manifest.json',
  'background/service-worker.js',
  'content/content.css',
  'content/content.js',
  'content/detail.js',
  'lib/classifier.js',
  'lib/coachmark.css',
  'lib/coachmark.js',
  'lib/html2canvas.min.js',
  'lib/menu_common.js',
  'lib/modal.js',
  'lib/query_parser.js',
  'lib/storage.js',
  'lib/theme.js',
  'lib/themes.js',
  'lib/time_utils.js',
  'lib/tokens.css',
  'popup/popup.css',
  'popup/popup.html',
  'popup/popup.js',
  'timetable/menu.js',
  'timetable/timetable.css',
  'timetable/timetable.html',
  'timetable/timetable.js',
  'welcome.css',
  'welcome.html',
  'welcome.js',
  'icons/icon128.png',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/logo_white.png',
];

// Minimal ZIP (no compression, STORE method) — CWS 는 어떤 방식이든 OK.
// Node 내장 만으로 DEFLATE 하기 번거로우니 zlib.deflateRawSync 사용.
const zlib = require('zlib');

function crc32(buf) {
  let c, crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

const localHeaders = [];
const centralDirs = [];
let offset = 0;

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  const data = fs.readFileSync(abs);
  const compressed = zlib.deflateRawSync(data);
  const useCompressed = compressed.length < data.length;
  const payload = useCompressed ? compressed : data;
  const method = useCompressed ? 8 : 0;
  const crc = crc32(data);
  const nameBuf = Buffer.from(rel, 'utf8');

  // Local file header
  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);     // version needed
  local.writeUInt16LE(0, 6);      // flags
  local.writeUInt16LE(method, 8); // method
  local.writeUInt16LE(0, 10);     // time
  local.writeUInt16LE(0, 12);     // date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra
  nameBuf.copy(local, 30);
  localHeaders.push(local, payload);

  // Central directory entry
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);   // version made by
  central.writeUInt16LE(20, 6);   // version needed
  central.writeUInt16LE(0, 8);    // flags
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(0, 12);   // time
  central.writeUInt16LE(0, 14);   // date
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);   // extra
  central.writeUInt16LE(0, 32);   // comment
  central.writeUInt16LE(0, 34);   // disk
  central.writeUInt16LE(0, 36);   // internal attr
  central.writeUInt32LE(0, 38);   // external attr
  central.writeUInt32LE(offset, 42);
  nameBuf.copy(central, 46);
  centralDirs.push(central);

  offset += local.length + payload.length;
}

const centralStart = offset;
const centralSize = centralDirs.reduce((a, b) => a + b.length, 0);

// End of central directory
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(centralDirs.length, 8);
eocd.writeUInt16LE(centralDirs.length, 10);
eocd.writeUInt32LE(centralSize, 12);
eocd.writeUInt32LE(centralStart, 16);
eocd.writeUInt16LE(0, 20);

const parts = [...localHeaders, ...centralDirs, eocd];
fs.writeFileSync(OUT, Buffer.concat(parts));
const stat = fs.statSync(OUT);
console.log(`built: ${path.basename(OUT)} (${(stat.size / 1024).toFixed(1)} KB, ${FILES.length} files)`);
