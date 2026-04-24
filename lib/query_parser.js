// query_parser.js — 2-layer hybrid search parser for v1.16.0 (NLS v3 + BM25)
// Exposes window.SWM_QUERY = { VERSION, parse, apply, rank, stringify, isEmpty, hasKorean, buildKoreanFuzzy }
// Also exports via module.exports for node --test.
//
// Layer 2 (explicit prefix): @mentor  #tag  -exclude
// Layer 1 (heuristic, no prefix): date/time phrases, status, location, category, derivedCat alias, else → freeText.
// v1.16.0 changes (i6):
//   • buildKoreanFuzzy: bounded to `\S*` (single-token) — fixes 2KB-description false-positive blow-up
//   • JW (Jaro-Winkler over NFD 자모) typo promotion at parse-time — "벡엔드" → derivedCat:backend
//   • rank(ast, lecs, {rank:true}) opt-in BM25 rerank, returns [{lec, score}] desc

(function () {
  'use strict';

  const VERSION = '2026-04-20-nls5-nl';

  const PREFIX_MENTION = '@';
  const PREFIX_TAG = '#';
  const PREFIX_EXCLUDE = '-';

  // Category (MRC) aliases — bidirectional lookup
  const CATEGORY_ALIAS = Object.freeze({
    '특강': 'MRC020', 'special': 'MRC020', '멘토특강': 'MRC020', '강의': 'MRC020', 'lecture': 'MRC020',
    '멘토링': 'MRC010', 'mentoring': 'MRC010', '자유멘토링': 'MRC010',
  });

  const LOCATION_ALIAS = Object.freeze({
    '온라인': true, 'online': true, '비대면': true, 'remote': true,
    '인터넷': true, 'zoom': true, '줌': true, 'webex': true, 'meet': true, '구글미트': true,
    'discord': true, '디스코드': true,
    '오프라인': false, 'offline': false, '대면': false, '현장': false,
  });

  const STATUS_ALIAS = Object.freeze({
    '접수중': 'A', '신청가능': 'A', '모집중': 'A', 'open': 'A',
    '진행중': 'A', '대기': 'A', '대기중': 'A', '열린': 'A', '열려있는': 'A',
    '마감': 'C', '종료': 'C', 'closed': 'C', '완료': 'C', '닫힌': 'C',
  });

  // Curated derivedCat alias → classifier id. 10+ per category (NLS v3 BM25).
  const DERIVED_ALIAS = Object.freeze({
    // ai
    'ai': 'ai', 'llm': 'ai', 'ml': 'ai', 'rag': 'ai', 'gpt': 'ai', 'chatgpt': 'ai',
    '딥러닝': 'ai', '머신러닝': 'ai', '인공지능': 'ai', '생성형': 'ai',
    '에이전트': 'ai', '프롬프트': 'ai', 'agent': 'ai', 'prompt': 'ai',
    'agentic': 'ai', '바이브코딩': 'ai', 'vibe': 'ai', '바이브': 'ai',
    'nlp': 'ai', 'vlm': 'ai', 'clip': 'ai', 'diffusion': 'ai',
    '파인튜닝': 'ai', 'finetuning': 'ai', 'finetune': 'ai',
    '사전훈련': 'ai', 'pretraining': 'ai', '임베딩': 'ai', 'embedding': 'ai',
    // backend
    'backend': 'backend', '백엔드': 'backend', '서버': 'backend',
    'spring': 'backend', 'springboot': 'backend', '스프링': 'backend',
    'msa': 'backend', 'kafka': 'backend', 'api': 'backend',
    'graphql': 'backend', 'django': 'backend', 'fastapi': 'backend',
    // frontend
    'frontend': 'frontend', '프론트엔드': 'frontend', '프론트': 'frontend',
    'react': 'frontend', 'vue': 'frontend', 'next': 'frontend', 'nextjs': 'frontend',
    'nuxt': 'frontend', 'svelte': 'frontend', 'tailwind': 'frontend', 'typescript': 'frontend',
    // mobile
    'mobile': 'mobile', '모바일': 'mobile',
    'ios': 'mobile', 'android': 'mobile', '안드로이드': 'mobile',
    'flutter': 'mobile', '플러터': 'mobile', 'swift': 'mobile',
    'kotlin': 'mobile', '코틀린': 'mobile', 'reactnative': 'mobile',
    // data
    'data': 'data', '데이터': 'data', 'sql': 'data', 'etl': 'data',
    '분석': 'data', '데이터분석': 'data', '빅데이터': 'data',
    'warehouse': 'data', 'pandas': 'data', 'spark': 'data', 'bigquery': 'data',
    // cloud
    'cloud': 'cloud', '클라우드': 'cloud',
    'aws': 'cloud', 'gcp': 'cloud', 'azure': 'cloud',
    'k8s': 'cloud', 'kubernetes': 'cloud', '쿠버': 'cloud', '쿠버네티스': 'cloud',
    'terraform': 'cloud', 'docker': 'cloud',
    // devops
    'devops': 'devops', '데브옵스': 'devops',
    'ci': 'devops', 'cd': 'devops', 'cicd': 'devops',
    'jenkins': 'devops', 'monitoring': 'devops', '모니터링': 'devops',
    'observability': 'devops', 'sre': 'devops',
    // security
    'security': 'security', '보안': 'security',
    '해킹': 'security', '취약': 'security', '취약점': 'security',
    '암호': 'security', '암호학': 'security',
    'pentest': 'security', 'infosec': 'security',
    // game
    'game': 'game', '게임': 'game', '게임개발': 'game',
    'unity': 'game', '유니티': 'game', 'unreal': 'game', '언리얼': 'game',
    '그래픽스': 'game', 'godot': 'game',
    // blockchain
    'blockchain': 'blockchain', '블록체인': 'blockchain',
    'web3': 'blockchain', 'nft': 'blockchain', 'defi': 'blockchain',
    'solidity': 'blockchain', 'ethereum': 'blockchain', '이더리움': 'blockchain',
    'crypto': 'blockchain', '암호화폐': 'blockchain', '스마트컨트랙트': 'blockchain',
    // os
    'os': 'os', '운영체제': 'os',
    '커널': 'os', 'kernel': 'os',
    '임베디드': 'os', 'embedded': 'os',
    '펌웨어': 'os', 'firmware': 'os',
    'rtos': 'os',
    // pm/planning → classifier id is 'idea' (idea rule covers PM/PO/기획/프로덕트/UX)
    'pm': 'idea', 'po': 'idea',
    '기획': 'idea', '프로덕트': 'idea', 'product': 'idea',
    '서비스기획': 'idea', 'ux': 'idea',
    '유저리서치': 'idea', '퍼소나': 'idea', '사용자조사': 'idea', '프로덕트매니저': 'idea',
    '경험맵': 'idea', '리서치': 'idea',
    // startup
    'startup': 'startup', '창업': 'startup', '스타트업': 'startup',
    'ir': 'startup', '투자': 'startup',
    'bm': 'startup', '비즈니스모델': 'startup',
    '피치': 'startup', 'pitch': 'startup',
    'mvp': 'startup', 'pmf': 'startup', 'vc': 'startup',
    // career
    'career': 'career', '커리어': 'career',
    '이력서': 'career', '면접': 'career', '취업': 'career',
    '연봉': 'career', 'resume': 'career',
    '인터뷰': 'career', '이직': 'career', '포트폴리오': 'career',
    // cs
    'cs': 'cs', '알고리즘': 'cs', 'algorithm': 'cs',
    '코테': 'cs', '코딩테스트': 'cs',
    '자료구조': 'cs', 'ds': 'cs', '네트워크기초': 'cs',
    // idea
    'idea': 'idea', '아이디어': 'idea',
    '아이디에이션': 'idea', 'ideation': 'idea',
    '브레인스토밍': 'idea', 'brainstorm': 'idea',
    // team
    'team': 'team', '팀빌딩': 'team',
    '회고': 'team', 'kpt': 'team',
    '스프린트': 'team', 'sprint': 'team', 'scrum': 'team',
    '협업': 'team', 'agile': 'team', '애자일': 'team',
    // soma
    'soma': 'soma', '소마': 'soma',
    '마에스트로': 'soma', '연수생': 'soma', 'swmaestro': 'soma',
  });

  // ─── helpers ───
  function hasKorean(s) {
    return /[\u3131-\uD79D\uAC00-\uD7A3]/.test(s);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Bounded fuzzy: `\S*` between chars keeps the match within a single
  // whitespace-delimited token. Prevents the v1.15.0 regression where
  // `김.*멘.*토` matched 2KB descriptions that happened to contain 김/멘/토
  // scattered across unrelated paragraphs (F1 30→1~2 hit on 113-doc set).
  // Existing "컴터" → "컴퓨터공학" recall preserved (single token).
  function buildKoreanFuzzy(kw) {
    const escaped = [...kw].map(escapeRegex);
    return new RegExp(escaped.join('\\S*'), 'i');
  }

  function aliasLookup(map, v) {
    if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
    const lc = v.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, lc)) return map[lc];
    return undefined;
  }

  // ─── Jaro-Winkler over NFD 자모 (typo correction for Korean) ───
  // NFD decomposes 한글 syllable into 초성+중성+종성, so 1-jamo edits
  // ("벡엔드" vs "백엔드" — only 중성 ㅔ↔ㅐ differs) score very high.
  function jaro(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
    const aMatch = new Array(a.length).fill(false);
    const bMatch = new Array(b.length).fill(false);
    let matches = 0;
    for (let i = 0; i < a.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, b.length);
      for (let j = start; j < end; j++) {
        if (bMatch[j] || a[i] !== b[j]) continue;
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
    if (matches === 0) return 0;
    let trans = 0, k = 0;
    for (let i = 0; i < a.length; i++) {
      if (!aMatch[i]) continue;
      while (!bMatch[k]) k++;
      if (a[i] !== b[k]) trans++;
      k++;
    }
    trans /= 2;
    return (matches / a.length + matches / b.length + (matches - trans) / matches) / 3;
  }
  function jaroWinkler(a, b, p = 0.1) {
    const A = a.normalize('NFD');
    const B = b.normalize('NFD');
    const j = jaro(A, B);
    let l = 0;
    for (; l < Math.min(4, A.length, B.length); l++) if (A[l] !== B[l]) break;
    return j + l * p * (1 - j);
  }

  // ─── JW vocab — Korean alias keys eligible for typo promotion ───
  // Built lazily on first parse() call to avoid module-init cost.
  let JW_VOCAB = null;
  function buildJwVocab() {
    if (JW_VOCAB) return JW_VOCAB;
    const v = { derived: [], location: [], status: [] };
    for (const k of Object.keys(DERIVED_ALIAS)) if (hasKorean(k) && k.length >= 2) v.derived.push(k);
    for (const k of Object.keys(LOCATION_ALIAS)) if (hasKorean(k) && k.length >= 2) v.location.push(k);
    for (const k of Object.keys(STATUS_ALIAS)) if (hasKorean(k) && k.length >= 2) v.status.push(k);
    JW_VOCAB = v;
    return v;
  }

  const JW_THRESHOLD = 0.85;
  const JW_MIN_LEN = 2;

  // Try to promote a freeText-bound Korean token into a structured field via
  // JW similarity. Returns true if promoted (caller should NOT push to freeText).
  function tryJwPromote(ast, token) {
    if (token.length < JW_MIN_LEN) return false;
    if (!hasKorean(token)) return false;
    const vocab = buildJwVocab();
    let best = { score: 0, key: null, kind: null };
    for (const k of vocab.derived) {
      const s = jaroWinkler(token, k);
      if (s > best.score) best = { score: s, key: k, kind: 'derived' };
    }
    for (const k of vocab.location) {
      const s = jaroWinkler(token, k);
      if (s > best.score) best = { score: s, key: k, kind: 'location' };
    }
    for (const k of vocab.status) {
      const s = jaroWinkler(token, k);
      if (s > best.score) best = { score: s, key: k, kind: 'status' };
    }
    if (best.score < JW_THRESHOLD) return false;
    if (best.kind === 'derived') {
      ast.include.derivedCat.push(DERIVED_ALIAS[best.key]);
      // Push the canonical alias key (e.g., "백엔드") instead of the typo ("벡엔드")
      // so BM25 tokens match document text.
      ast.raw_tokens.push(best.key);
    }
    else if (best.kind === 'location') ast.include.location.online = LOCATION_ALIAS[best.key];
    else if (best.kind === 'status') ast.include.status = STATUS_ALIAS[best.key];
    return true;
  }

  // ─── date / time helpers ───
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }
  function weekRange(now, weekOffset) {
    const d = new Date(now.getTime());
    const dow = d.getDay(); // 0=Sun..6=Sat
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = addDays(d, diffToMon + weekOffset * 7);
    const sunday = addDays(monday, 6);
    return { start: monday, end: sunday };
  }
  function monthRange(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  }
  function nearestDow(now, target) {
    const today = new Date(now.getTime());
    const cur = today.getDay();
    const diff = (target - cur + 7) % 7;
    return addDays(today, diff);
  }
  function minToHHMM(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  // v1.16.1: parseTimeToMin 제거됨 (sharp #6). @time: directive (단일 HH:MM) 는
  // 아래 _dirTimeToMin 로, lecTime 필터 비교는 parseTimeRange 를 통해 start/end
  // 를 각각 추출한다.
  function _dirTimeToMin(s) {
    if (!s) return null;
    const m = /^(\d{2}):(\d{2})$/.exec(s);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  // lecTime 문자열을 {startMin, endMin} 분으로. time_utils 의 parseTimeRange 에 위임.
  // (Node 테스트에선 require, 브라우저에선 window.parseTimeRange 를 사용.)
  // 실 데이터는 항상 range 이지만 과거 테스트 픽스처에 단일 HH:MM 이 있을 수
  // 있어, range 파싱 실패 시 첫 HH:MM 토큰으로 fallback (start==end 로 해석).
  function _lecTimeRange(lecTime) {
    if (!lecTime) return null;
    const fn = (typeof window !== 'undefined' && window.parseTimeRange)
      ? window.parseTimeRange
      : (typeof require === 'function' ? require('./time_utils.js').parseTimeRange : null);
    const r = fn ? fn(lecTime) : null;
    if (r) return r;
    const m = /(\d{1,2}):(\d{2})/.exec(lecTime);
    if (!m) return null;
    const mm = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return { startMin: mm, endMin: mm };
  }

  // ─── pre-tokenize regex (module-scope, hoisted from extractTimeAndDate) ───
  // Hoisting avoids ~12 × `new RegExp()` compiles per parse() call. /g flags stay
  // on .replace() (stateless); for existence checks we use String.indexOf (literal
  // Korean keywords) or .search() / .exec() which reset lastIndex.
  // Weekend/weekdays with fixed capture — old regex ate the 주 into group1
  // then failed to match 주말, silently falling through to prefix-less branch
  // so `다음 주말` and `이번 주말` both resolved to this-weekend. New form
  // makes the `주` between prefix and 주말/평일 optional (non-capturing).
  const RE_WEEKEND = /(?:(이번|다음|금|차|지난|저번)\s*(?:주\s*)?)?주말/g;
  const RE_WEEKDAYS = /(?:(이번|다음|금|차|지난|저번)\s*(?:주\s*)?)?평일/g;
  // 다다음주 MUST be matched before 다음주 (substring collision).
  const RE_WEEK_2AHEAD = /(다다음\s*주)/g;
  const RE_WEEK_CUR = /(이번\s*주|금주)/g;
  const RE_WEEK_NEXT = /(다음\s*주|차주|내주)/g;
  const RE_WEEK_PREV = /(지난\s*주|저번\s*주|전주)/g;
  // English week phrases — pre-strip before tokenizer, else `next` maps to
  // DERIVED_ALIAS.frontend and `week` becomes freeText.
  const RE_EN_WEEK = /\b(next|last|this)\s+week\b/gi;
  // English DOW / weekend / am-pm — pre-strip so they don't leak to freeText or collide with
  // DERIVED_ALIAS (e.g., `pm` → `기획` alias collision).
  const RE_EN_DOW = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi;
  const RE_EN_WEEKEND = /\bweekend\b/gi;
  const RE_EN_AMPM = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  const EN_DOW_MAP = { monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0 };
  const RE_MONTH_CUR = /(이번\s*달|금월)/g;
  const RE_MONTH_NEXT = /(다음\s*달|내달|차월)/g;
  const RE_MONTH_PREV = /(지난\s*달|전월)/g;
  // ISO / M-D direct date (exact day). Must run BEFORE @date: directive lookup would
  // be confused, and BEFORE N월 / N월 N일 (otherwise 5/3 → 5월 alone match risk).
  const RE_ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  // "4/24-4/27" — slash date range. Must run BEFORE RE_MD_SLASH (which would match 4/24 alone).
  const RE_MD_SLASH_RANGE = /\b(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})\b/g;
  const RE_MD_SLASH = /\b(\d{1,2})\/(\d{1,2})(?!\d|\/)/g;
  // "4월 24일부터 27일까지" / "4월 24일부터 5월 1일까지" — Korean date range with 부터/까지.
  // group: (fromMonth)(fromDay)(toMonth?)(toDay)
  const RE_KR_DATE_RANGE = /(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*부터\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일\s*까지/g;
  // "내일까지" / "오늘까지" / "모레까지" / "글피까지" — today → relative target.
  const RE_UNTIL_REL = /(오늘|내일|모레|글피)\s*까지/g;
  // "N월 N일" — specific day; must run BEFORE RE_MONTH_N.
  const RE_MONTH_DAY = /\b(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  // "N일후" / "N일 뒤" / "N주일후" / "N주일 뒤" — relative offset
  const RE_DAYS_AFTER = /\b(\d{1,2})\s*일\s*(후|뒤)/g;
  const RE_WEEKS_AFTER = /\b(\d{1,2})\s*주(?:일)?\s*(후|뒤)/g;
  // "N월초/중/말" (first / mid / last third of month). Run BEFORE RE_MONTH_N
  // so the month number isn't consumed by the broader month-only regex.
  const RE_MONTH_PART = /\b(\d{1,2})\s*월\s*(초|중|말)/g;
  // "N월" (1~12) — digit-boundary + negative lookahead for 요일 to avoid 월요일 collision.
  const RE_MONTH_N = /\b(\d{1,2})\s*월(?!요일)/g;
  // "MM-DD" (year-less ISO). Restrict month to 01~12 (leading zero required)
  // so `9-11시` keeps parsing as a time range, not April-11.
  const RE_MD_DASH = /\b(0\d|1[0-2])-(\d{1,2})\b(?!-\d|\s*시)/g;
  // N-M시 / N~M시 with optional AM/PM prefix. Fixes "오후 2-4시" losing context.
  const RE_RANGE = /(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})\s*[-~]\s*(\d{1,2})\s*시/g;
  const RE_AFTER = /(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})\s*시\s*이후/g;
  const RE_BEFORE = /(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})\s*시\s*이전/g;
  // HH:MM ~ HH:MM — must run BEFORE RE_AT_HOUR which would otherwise match `14:00` alone.
  const RE_HHMM_RANGE = /(\d{1,2}):(\d{2})\s*(?:부터|~|-)\s*(\d{1,2}):(\d{2})(?:\s*까지만?)?/g;
  // Korean time range — requires 시 on at least one side. Matches:
  //   9시~11시, 9시부터 11시까지, 오후 2시~4시, 오후 2시~오후 4시, 9시 30분~11시, 9시~11시까지
  const RE_TIME_RANGE_KR = /(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(?:부터|~|-)\s*(?:(오전|오후|저녁|밤|아침|새벽)\s*)?(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?\s*(?:까지만?)?/g;
  // Single-point time with optional minute + 조사. Runs AFTER range regexes so
  // it only catches standalone N시 / HH:MM. Negative lookahead guards against
  // accidental ingestion of 이후/이전/짜리 (handled by RE_AFTER/RE_BEFORE/RE_DURATION).
  const RE_AT_HOUR = /(오전|오후|저녁|밤|아침|새벽)?\s*(\d{1,2})(?:시(?!간)\s*(?:(\d{1,2})\s*분)?|:(\d{2}))\s*(에|부터|까지만|까지)?(?!\s*(?:이후|이전|짜리))/g;
  const RE_DATE_DIR = /@date:(\d{4}-\d{2}-\d{2})(?:\.\.(\d{4}-\d{2}-\d{2}))?/g;
  const RE_TIME_DIR = /@time:(\d{2}:\d{2})?\.\.(\d{2}:\d{2})?/g;

  // Literal DOW / day keywords — use indexOf + replaceAll to skip regex entirely.
  const DOW_LIST = [
    ['월요일', 1], ['화요일', 2], ['수요일', 3], ['목요일', 4],
    ['금요일', 5], ['토요일', 6], ['일요일', 0],
  ];
  const DAY_KW_LIST = [
    // 내일모레/모래 (오타) MUST be first so 내일 doesn't substring-match inside 내일모레.
    { kws: ['내일모레', '모래'], englishRe: null, days: 2 },
    { kws: ['그저께', '그제'], englishRe: null, days: -2 },
    { kws: ['오늘', '지금'], englishRe: /today/gi, days: 0 },
    { kws: ['내일', '다음날'], englishRe: /tomorrow/gi, days: 1 },
    { kws: ['모레'], englishRe: null, days: 2 },
    { kws: ['글피'], englishRe: null, days: 3 },
    { kws: ['어제', '전날'], englishRe: /yesterday/gi, days: -1 },
    { kws: ['이틀후', '이틀 뒤'], englishRe: null, days: 2 },
    { kws: ['일주일후', '일주일 뒤'], englishRe: null, days: 7 },
  ];

  // Fast-path: raw 문자열이 date/time 트리거 문자를 하나도 포함하지 않으면
  // ~18개 regex 테스트를 전부 스킵. 순수 영문 쿼리 ('ai backend') 에서 parse
  // cost 를 ~1µs 절감.
  const RE_TRIGGER = /\d|[월화수목금토일주달내외오어모평말분시저아밤새차지전다후뒤이틀점정자글끄피그제날금]|@date|@time|today|tomorrow|yesterday|next\s+week|last\s+week|this\s+week|\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|am|pm)\b/i;

  // ─── pre-tokenize: extract multi-word time/date phrases, mutate ast ───
  //
  // Consumes matched substrings (replaces with space) so the normal tokenizer
  // won't re-interpret them. Order matters: longer patterns first.
  function extractTimeAndDate(raw, ast, now) {
    if (!RE_TRIGGER.test(raw)) return raw;
    let s = raw;

    // Stringify-produced directives FIRST — consume "@date:YYYY-MM-DD..YYYY-MM-DD"
    // before the free-form ISO regex can steal its digits.
    RE_DATE_DIR.lastIndex = 0;
    const dirDm = RE_DATE_DIR.exec(s);
    if (dirDm) {
      ast.include.dateFrom = dirDm[1];
      ast.include.dateTo = dirDm[2] || dirDm[1];
      s = s.replace(RE_DATE_DIR, ' ');
    }
    RE_TIME_DIR.lastIndex = 0;
    const dirTm = RE_TIME_DIR.exec(s);
    if (dirTm) {
      ast.include.timeFromMin = dirTm[1] ? _dirTimeToMin(dirTm[1]) : null;
      ast.include.timeToMin = dirTm[2] ? _dirTimeToMin(dirTm[2]) : null;
      s = s.replace(RE_TIME_DIR, ' ');
    }

    // English "next/last/this week" — pre-strip before alias lookup. Without
    // this, `next` hits DERIVED_ALIAS[next]=frontend and `week` leaks to freeText.
    RE_EN_WEEK.lastIndex = 0;
    const enw = RE_EN_WEEK.exec(s);
    if (enw) {
      const w = enw[1].toLowerCase();
      const offset = w === 'next' ? 1 : (w === 'last' ? -1 : 0);
      const { start, end } = weekRange(now, offset);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_EN_WEEK, ' ');
    }

    // English am/pm time — convert "7 pm" / "9am" / "7:30pm" to time range.
    // Must run BEFORE DERIVED_ALIAS lookup (pm/am would else hit 기획/none).
    RE_EN_AMPM.lastIndex = 0;
    const enam = RE_EN_AMPM.exec(s);
    if (enam) {
      let h = parseInt(enam[1], 10);
      const m = enam[2] ? parseInt(enam[2], 10) : 0;
      const ap = enam[3].toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      ast.include.timeFromMin = h * 60 + m;
      ast.include.timeToMin = (h + 1) * 60 + m;
      s = s.replace(RE_EN_AMPM, ' ');
    }

    // English DOW — map to DOW integer, compute nearest upcoming.
    RE_EN_DOW.lastIndex = 0;
    const endow = RE_EN_DOW.exec(s);
    if (endow) {
      const day = EN_DOW_MAP[endow[1].toLowerCase()];
      if (day !== undefined) {
        const target = nearestDow(now, day);
        ast.include.dateFrom = toISO(target);
        ast.include.dateTo = ast.include.dateFrom;
        s = s.replace(RE_EN_DOW, ' ');
      }
    }

    // English "weekend" — this weekend (Sat-Sun).
    RE_EN_WEEKEND.lastIndex = 0;
    if (RE_EN_WEEKEND.test(s)) {
      const { start } = weekRange(now, 0);
      ast.include.dateFrom = toISO(addDays(start, 5));
      ast.include.dateTo = toISO(addDays(start, 6));
      s = s.replace(RE_EN_WEEKEND, ' ');
    }

    // 주말/평일 (+ optional 이번주/다음주 prefix) — must run BEFORE 이번주/다음주 standalone
    // so "다음주 주말" is consumed as a single phrase.
    RE_WEEKEND.lastIndex = 0;
    const wem = RE_WEEKEND.exec(s);
    if (wem) {
      const pre = wem[1] || '';
      const offset = /다음|차/.test(pre) ? 1 : (/지난|저번/.test(pre) ? -1 : 0);
      const { start } = weekRange(now, offset);
      ast.include.dateFrom = toISO(addDays(start, 5)); // Sat
      ast.include.dateTo = toISO(addDays(start, 6)); // Sun
      s = s.replace(RE_WEEKEND, ' ');
    }
    RE_WEEKDAYS.lastIndex = 0;
    const wdm = RE_WEEKDAYS.exec(s);
    if (wdm) {
      const pre = wdm[1] || '';
      const offset = /다음|차/.test(pre) ? 1 : (/지난|저번/.test(pre) ? -1 : 0);
      const { start } = weekRange(now, offset);
      ast.include.dateFrom = toISO(start); // Mon
      ast.include.dateTo = toISO(addDays(start, 4)); // Fri
      s = s.replace(RE_WEEKDAYS, ' ');
    }

    // ISO / M-D direct date (exact day) — run early so subsequent month/week regex
    // don't gobble the components.
    RE_ISO_DATE.lastIndex = 0;
    const isom = RE_ISO_DATE.exec(s);
    if (isom) {
      ast.include.dateFrom = `${isom[1]}-${isom[2]}-${isom[3]}`;
      ast.include.dateTo = ast.include.dateFrom;
      s = s.replace(RE_ISO_DATE, ' ');
    }
    // "4/24-4/27" — slash date range. BEFORE RE_MD_SLASH.
    RE_MD_SLASH_RANGE.lastIndex = 0;
    const mdsr = RE_MD_SLASH_RANGE.exec(s);
    if (mdsr) {
      const fm = parseInt(mdsr[1], 10), fd = parseInt(mdsr[2], 10);
      const tm = parseInt(mdsr[3], 10), td = parseInt(mdsr[4], 10);
      if (fm >= 1 && fm <= 12 && fd >= 1 && fd <= 31 && tm >= 1 && tm <= 12 && td >= 1 && td <= 31) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const fy = (fm > curM || (fm === curM && fd >= now.getDate())) ? curY : curY + 1;
        const ty = (tm >= fm) ? fy : fy + 1;
        ast.include.dateFrom = toISO(new Date(fy, fm - 1, fd));
        ast.include.dateTo = toISO(new Date(ty, tm - 1, td));
        s = s.replace(RE_MD_SLASH_RANGE, ' ');
      }
    }
    // "4월 24일부터 27일까지" / "4월 24일부터 5월 1일까지" — Korean date range.
    RE_KR_DATE_RANGE.lastIndex = 0;
    const krdr = RE_KR_DATE_RANGE.exec(s);
    if (krdr) {
      const fm = parseInt(krdr[1], 10), fd = parseInt(krdr[2], 10);
      const tm = krdr[3] ? parseInt(krdr[3], 10) : fm;
      const td = parseInt(krdr[4], 10);
      if (fm >= 1 && fm <= 12 && fd >= 1 && fd <= 31 && tm >= 1 && tm <= 12 && td >= 1 && td <= 31) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const fy = (fm > curM || (fm === curM && fd >= now.getDate())) ? curY : curY + 1;
        const ty = (tm > fm || (tm === fm && td >= fd)) ? fy : fy + 1;
        ast.include.dateFrom = toISO(new Date(fy, fm - 1, fd));
        ast.include.dateTo = toISO(new Date(ty, tm - 1, td));
        s = s.replace(RE_KR_DATE_RANGE, ' ');
      }
    }
    // "내일까지" / "오늘까지" / "모레까지" / "글피까지" — today → target.
    RE_UNTIL_REL.lastIndex = 0;
    const urm = RE_UNTIL_REL.exec(s);
    if (urm) {
      const offsets = { '오늘': 0, '내일': 1, '모레': 2, '글피': 3 };
      const offset = offsets[urm[1]];
      if (offset !== undefined) {
        ast.include.dateFrom = toISO(now);
        ast.include.dateTo = toISO(addDays(now, offset));
        s = s.replace(RE_UNTIL_REL, ' ');
      }
    }
    RE_MD_SLASH.lastIndex = 0;
    const mds = RE_MD_SLASH.exec(s);
    if (mds) {
      const mm = parseInt(mds[1], 10);
      const dd = parseInt(mds[2], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const y = now.getFullYear();
        ast.include.dateFrom = toISO(new Date(y, mm - 1, dd));
        ast.include.dateTo = ast.include.dateFrom;
        s = s.replace(RE_MD_SLASH, ' ');
      }
    }
    // "04-24" — year-less MM-DD. Leading-zero month required to avoid eating
    // time ranges like "9-11" (those go through RE_RANGE later).
    RE_MD_DASH.lastIndex = 0;
    const mdd = RE_MD_DASH.exec(s);
    if (mdd) {
      const mm = parseInt(mdd[1], 10);
      const dd = parseInt(mdd[2], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const y = (mm > curM || (mm === curM && dd >= now.getDate())) ? curY : curY + 1;
        ast.include.dateFrom = toISO(new Date(y, mm - 1, dd));
        ast.include.dateTo = ast.include.dateFrom;
        s = s.replace(RE_MD_DASH, ' ');
      }
    }
    // "N월 N일" → single day. BEFORE RE_MONTH_N (month alone).
    RE_MONTH_DAY.lastIndex = 0;
    const mdm = RE_MONTH_DAY.exec(s);
    if (mdm) {
      const mm = parseInt(mdm[1], 10);
      const dd = parseInt(mdm[2], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const y = (mm > curM || (mm === curM && dd >= now.getDate())) ? curY : curY + 1;
        ast.include.dateFrom = toISO(new Date(y, mm - 1, dd));
        ast.include.dateTo = ast.include.dateFrom;
        s = s.replace(RE_MONTH_DAY, ' ');
      }
    }

    // Relative offsets: N일후 / N주일후 (before DOW / DAY_KW)
    RE_DAYS_AFTER.lastIndex = 0;
    const dam = RE_DAYS_AFTER.exec(s);
    if (dam) {
      const n = parseInt(dam[1], 10);
      const d = addDays(now, n);
      ast.include.dateFrom = toISO(d);
      ast.include.dateTo = toISO(d);
      s = s.replace(RE_DAYS_AFTER, ' ');
    }
    RE_WEEKS_AFTER.lastIndex = 0;
    const wam = RE_WEEKS_AFTER.exec(s);
    if (wam) {
      const n = parseInt(wam[1], 10);
      const d = addDays(now, n * 7);
      ast.include.dateFrom = toISO(d);
      ast.include.dateTo = toISO(d);
      s = s.replace(RE_WEEKS_AFTER, ' ');
    }

    // Multi-word week / month — before day-of-week (which could substring-collide)
    // 다다음주 MUST come BEFORE 다음주 (substring collision "다음주" ⊂ "다다음주")
    if (RE_WEEK_2AHEAD.test(s)) {
      RE_WEEK_2AHEAD.lastIndex = 0;
      const { start, end } = weekRange(now, 2);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_WEEK_2AHEAD, ' ');
    }
    if (RE_WEEK_CUR.test(s)) {
      RE_WEEK_CUR.lastIndex = 0;
      const { start, end } = weekRange(now, 0);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_WEEK_CUR, ' ');
    }
    if (RE_WEEK_NEXT.test(s)) {
      RE_WEEK_NEXT.lastIndex = 0;
      const { start, end } = weekRange(now, 1);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_WEEK_NEXT, ' ');
    }
    if (RE_WEEK_PREV.test(s)) {
      RE_WEEK_PREV.lastIndex = 0;
      const { start, end } = weekRange(now, -1);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_WEEK_PREV, ' ');
    }
    if (RE_MONTH_CUR.test(s)) {
      RE_MONTH_CUR.lastIndex = 0;
      const { start, end } = monthRange(now);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_MONTH_CUR, ' ');
    }
    if (RE_MONTH_NEXT.test(s)) {
      RE_MONTH_NEXT.lastIndex = 0;
      const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_MONTH_NEXT, ' ');
    }
    if (RE_MONTH_PREV.test(s)) {
      RE_MONTH_PREV.lastIndex = 0;
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      ast.include.dateFrom = toISO(start);
      ast.include.dateTo = toISO(end);
      s = s.replace(RE_MONTH_PREV, ' ');
    }

    // "N월초/중/말" — split the month into thirds. Runs BEFORE RE_MONTH_N so
    // the "4월" part isn't swallowed as the full month range first.
    RE_MONTH_PART.lastIndex = 0;
    const mpm = RE_MONTH_PART.exec(s);
    if (mpm) {
      const month = parseInt(mpm[1], 10);
      const part = mpm[2];
      if (month >= 1 && month <= 12) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const year = month >= curM ? curY : curY + 1;
        const lastDay = new Date(year, month, 0).getDate();
        let fromD, toD;
        if (part === '초') { fromD = 1; toD = 10; }
        else if (part === '중') { fromD = 11; toD = 20; }
        else { fromD = 21; toD = lastDay; } // 말
        ast.include.dateFrom = toISO(new Date(year, month - 1, fromD));
        ast.include.dateTo = toISO(new Date(year, month - 1, toD));
        s = s.replace(RE_MONTH_PART, ' ');
      }
    }

    // "N월" (1~12) → first..last day of that month; roll to next year if already past.
    RE_MONTH_N.lastIndex = 0;
    const mnm = RE_MONTH_N.exec(s);
    if (mnm) {
      const month = parseInt(mnm[1], 10);
      if (month >= 1 && month <= 12) {
        const curY = now.getFullYear();
        const curM = now.getMonth() + 1;
        const year = month >= curM ? curY : curY + 1;
        ast.include.dateFrom = toISO(new Date(year, month - 1, 1));
        ast.include.dateTo = toISO(new Date(year, month, 0));
        s = s.replace(RE_MONTH_N, ' ');
      }
    }

    // Day of week → nearest upcoming (today counts if matches). If a
    // multi-day range is already set (e.g., from "다음주"), pick the DOW
    // within that range instead of overriding it to today. Before this fix,
    // `다음주 월요일` was silently resolved to today-is-Monday.
    for (const [kw, num] of DOW_LIST) {
      if (s.indexOf(kw) === -1) continue;
      let d;
      if (ast.include.dateFrom && ast.include.dateTo && ast.include.dateFrom !== ast.include.dateTo) {
        const from = new Date(ast.include.dateFrom + 'T00:00:00');
        const to = new Date(ast.include.dateTo + 'T00:00:00');
        d = from;
        while (d <= to && d.getDay() !== num) d = addDays(d, 1);
        if (d > to) d = nearestDow(now, num);
      } else {
        d = nearestDow(now, num);
      }
      ast.include.dateFrom = toISO(d);
      ast.include.dateTo = toISO(d);
      s = s.split(kw).join(' ');
    }

    // Absolute day keywords (Korean literal + English case-insensitive regex)
    for (const item of DAY_KW_LIST) {
      let hit = false;
      for (const kw of item.kws) {
        if (s.indexOf(kw) !== -1) {
          s = s.split(kw).join(' ');
          hit = true;
        }
      }
      if (!hit && item.englishRe) {
        item.englishRe.lastIndex = 0;
        if (item.englishRe.test(s)) {
          item.englishRe.lastIndex = 0;
          s = s.replace(item.englishRe, ' ');
          hit = true;
        }
      }
      if (hit) {
        const d = addDays(now, item.days);
        ast.include.dateFrom = toISO(d);
        ast.include.dateTo = toISO(d);
      }
    }

    // Apply AM/PM modifier to raw hour (1~12 → 13~24 when PM, 12 → 0 when AM).
    const applyHourMod = (h, mod) => {
      if ((mod === '오후' || mod === '저녁') && h >= 1 && h < 12) return h + 12;
      if (mod === '밤' && h >= 1 && h < 12) return h + 12;
      if ((mod === '오전' || mod === '새벽') && h === 12) return 0;
      return h;
    };

    // "HH:MM ~ HH:MM" — digit-only range. MUST run before RE_AT_HOUR which
    // would otherwise consume "14:00" alone and miss the "~18:00" half.
    RE_HHMM_RANGE.lastIndex = 0;
    const hrm = RE_HHMM_RANGE.exec(s);
    if (hrm) {
      ast.include.timeFromMin = parseInt(hrm[1], 10) * 60 + parseInt(hrm[2], 10);
      ast.include.timeToMin = parseInt(hrm[3], 10) * 60 + parseInt(hrm[4], 10);
      s = s.replace(RE_HHMM_RANGE, ' ');
    }

    // Korean time range — "9시~11시", "9시부터 11시까지", "오후 2시~4시", etc.
    RE_TIME_RANGE_KR.lastIndex = 0;
    const krm = RE_TIME_RANGE_KR.exec(s);
    if (krm && ast.include.timeFromMin === null && ast.include.timeToMin === null) {
      const mod1 = krm[1];
      const mod2 = krm[4] || mod1;
      let h1 = parseInt(krm[2], 10);
      let h2 = parseInt(krm[5], 10);
      const m1 = krm[3] ? parseInt(krm[3], 10) : 0;
      const m2 = krm[6] ? parseInt(krm[6], 10) : 0;
      h1 = applyHourMod(h1, mod1);
      h2 = applyHourMod(h2, mod2);
      if (h1 >= 0 && h1 <= 24 && h2 >= 0 && h2 <= 24 && m1 < 60 && m2 < 60) {
        ast.include.timeFromMin = h1 * 60 + m1;
        ast.include.timeToMin = h2 * 60 + m2;
        s = s.replace(RE_TIME_RANGE_KR, ' ');
      }
    }

    // Range "N-M시" / "N~M시" with optional AM/PM prefix.
    RE_RANGE.lastIndex = 0;
    const rm = RE_RANGE.exec(s);
    if (rm && ast.include.timeFromMin === null && ast.include.timeToMin === null) {
      const mod = rm[1];
      let h1 = parseInt(rm[2], 10);
      let h2 = parseInt(rm[3], 10);
      h1 = applyHourMod(h1, mod);
      h2 = applyHourMod(h2, mod);
      ast.include.timeFromMin = h1 * 60;
      ast.include.timeToMin = h2 * 60;
      s = s.replace(RE_RANGE, ' ');
    }

    // "오후 N시 이후" / "N시 이후"
    RE_AFTER.lastIndex = 0;
    const am = RE_AFTER.exec(s);
    if (am) {
      let h = parseInt(am[2], 10);
      h = applyHourMod(h, am[1]);
      ast.include.timeFromMin = h * 60;
      s = s.replace(RE_AFTER, ' ');
    }
    RE_BEFORE.lastIndex = 0;
    const bm = RE_BEFORE.exec(s);
    if (bm) {
      let h = parseInt(bm[2], 10);
      h = applyHourMod(h, bm[1]);
      ast.include.timeToMin = h * 60;
      s = s.replace(RE_BEFORE, ' ');
    }

    // Single-point time "N시" / "HH:MM" with optional minute + 조사.
    // Runs AFTER all range/이후/이전 handlers — at this point any surviving
    // "N시" or "HH:MM" is a standalone point that should produce a 1-hour
    // window (or half-open range if 조사 is 부터/까지).
    RE_AT_HOUR.lastIndex = 0;
    const ahm = RE_AT_HOUR.exec(s);
    if (ahm) {
      const mod = ahm[1];
      let h = parseInt(ahm[2], 10);
      const m = ahm[3] ? parseInt(ahm[3], 10) : (ahm[4] ? parseInt(ahm[4], 10) : 0);
      const josa = ahm[5];
      h = applyHourMod(h, mod);
      if (h >= 0 && h <= 24 && m < 60) {
        const at = h * 60 + m;
        if (josa === '까지' || josa === '까지만') {
          if (ast.include.timeToMin === null) ast.include.timeToMin = at;
        } else if (josa === '부터') {
          if (ast.include.timeFromMin === null) ast.include.timeFromMin = at;
        } else {
          // Single-point (no 조사 or "에") → 1-hour window.
          if (ast.include.timeFromMin === null) ast.include.timeFromMin = at;
          if (ast.include.timeToMin === null) ast.include.timeToMin = at + 60;
        }
        s = s.replace(RE_AT_HOUR, ' ');
      }
    }

    // Standalone time-of-day keywords. Each consumes the bare keyword plus
    // any trailing 조사 (에만/에/부터/까지) so they don't leak into freeText.
    // Only sets time bounds if not already constrained by earlier handlers.
    const setStandalone = (kw, fromMin, toMin) => {
      const re = new RegExp(kw + '(?:에만|에|부터|까지만|까지)?', 'g');
      if (s.indexOf(kw) === -1) return;
      if (ast.include.timeFromMin === null) ast.include.timeFromMin = fromMin;
      if (ast.include.timeToMin === null) ast.include.timeToMin = toMin;
      s = s.replace(re, ' ');
    };
    setStandalone('오전', 0, 12 * 60);
    setStandalone('오후', 12 * 60, 24 * 60);
    setStandalone('저녁', 18 * 60, 24 * 60);
    setStandalone('아침', 6 * 60, 12 * 60);
    setStandalone('새벽', 0, 6 * 60);
    setStandalone('점심', 12 * 60, 13 * 60);
    setStandalone('정오', 12 * 60, 13 * 60);
    setStandalone('자정', 0, 60);
    // "밤" — 20:00~24:00. Place AFTER 오전/오후 so "오후 밤" nonsense still makes 오후 win.
    setStandalone('밤', 20 * 60, 24 * 60);

    return s;
  }

  // ─── AST ───
  // raw_tokens: topical hints preserved from the user's original query for BM25
  // scoring. Unlike ast.include.freeText (which only holds unresolved tokens),
  // raw_tokens also keeps tokens that got promoted to derivedCat / categoryNm
  // (e.g., "AI", "백엔드", "IR"). This lets rank() score by relevance even
  // when every query token was alias-resolved and freeText is empty.
  // Excluded: mentor (@), exclude (-), location / status / category filters,
  // and date/time phrases (stripped in pre-tokenize). Not emitted by stringify.
  function newAst() {
    return {
      include: {
        mentor: [],
        category: [],
        derivedCat: [],
        location: { online: null },
        status: null,
        dateFrom: null,
        dateTo: null,
        timeFromMin: null,
        timeToMin: null,
        categoryNm: [],
        freeText: [],
      },
      exclude: [],
      raw_tokens: [],
    };
  }

  // ─── tokenizer ───
  function tokenize(raw) {
    const out = [];
    const re = /([@#-])?"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      if (m[2] !== undefined) {
        out.push({ prefix: m[1] || null, value: m[2] });
      } else {
        const raw2 = m[3];
        const ch = raw2[0];
        if ((ch === PREFIX_MENTION || ch === PREFIX_TAG || ch === PREFIX_EXCLUDE) && raw2.length > 1) {
          out.push({ prefix: ch, value: raw2.slice(1) });
        } else {
          out.push({ prefix: null, value: raw2 });
        }
      }
    }
    return out;
  }

  // ─── routers ───
  function routeMention(ast, v) {
    const loc = aliasLookup(LOCATION_ALIAS, v);
    if (loc !== undefined) { ast.include.location.online = loc; return; }
    ast.include.mentor.push(v);
  }

  function routeTag(ast, v) {
    const vU = v.toUpperCase();
    if (vU === 'MRC010' || vU === 'MRC020') { ast.include.category.push(vU); return; }
    const cat = aliasLookup(CATEGORY_ALIAS, v);
    if (cat !== undefined) { ast.include.category.push(cat); return; }
    const id = aliasLookup(DERIVED_ALIAS, v);
    if (id !== undefined) { ast.include.derivedCat.push(id); ast.raw_tokens.push(v); return; }
    ast.include.categoryNm.push(v);
    ast.raw_tokens.push(v);
  }

  function routeHeuristic(ast, v) {
    const cat = aliasLookup(CATEGORY_ALIAS, v);
    if (cat !== undefined) { ast.include.category.push(cat); return; }
    const loc = aliasLookup(LOCATION_ALIAS, v);
    if (loc !== undefined) { ast.include.location.online = loc; return; }
    const st = aliasLookup(STATUS_ALIAS, v);
    if (st !== undefined) { ast.include.status = st; return; }
    const id = aliasLookup(DERIVED_ALIAS, v);
    if (id !== undefined) { ast.include.derivedCat.push(id); ast.raw_tokens.push(v); return; }
    if (tryJwPromote(ast, v)) return;
    ast.include.freeText.push(v);
    ast.raw_tokens.push(v);
  }

  // ─── dedupe ───
  function dedupeArr(arr, ci) {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const key = ci ? String(v).toLowerCase() : v;
      if (!seen.has(key)) { seen.add(key); out.push(v); }
    }
    return out;
  }

  function dedupeAst(ast) {
    ast.include.mentor = dedupeArr(ast.include.mentor, true);
    ast.include.category = dedupeArr(ast.include.category, false);
    ast.include.derivedCat = dedupeArr(ast.include.derivedCat, true);
    ast.include.categoryNm = dedupeArr(ast.include.categoryNm, true);
    ast.include.freeText = dedupeArr(ast.include.freeText, true);
    ast.exclude = dedupeArr(ast.exclude, true);
    ast.raw_tokens = dedupeArr(ast.raw_tokens, true);
  }

  // ─── public API ───
  function parse(raw, opts) {
    opts = opts || {};
    const now = opts.now instanceof Date ? opts.now : new Date();
    const ast = newAst();
    const s0 = raw == null ? '' : String(raw);
    if (!s0.trim()) return ast;

    // Pre-extract date/time phrases (multi-word, regex-based)
    const s1 = extractTimeAndDate(s0, ast, now);

    const tokens = tokenize(s1);
    for (const { prefix, value } of tokens) {
      const v = value.trim();
      if (!v) continue;
      if (!prefix && (v === PREFIX_MENTION || v === PREFIX_TAG || v === PREFIX_EXCLUDE)) continue;
      if (prefix === PREFIX_MENTION) routeMention(ast, v);
      else if (prefix === PREFIX_TAG) routeTag(ast, v);
      else if (prefix === PREFIX_EXCLUDE) ast.exclude.push(v);
      else routeHeuristic(ast, v);
    }
    dedupeAst(ast);
    return ast;
  }

  function isEmpty(ast) {
    if (!ast) return true;
    const inc = ast.include || {};
    if (ast.exclude && ast.exclude.length) return false;
    if (inc.mentor && inc.mentor.length) return false;
    if (inc.category && inc.category.length) return false;
    if (inc.derivedCat && inc.derivedCat.length) return false;
    if (inc.categoryNm && inc.categoryNm.length) return false;
    if (inc.freeText && inc.freeText.length) return false;
    if (inc.location && inc.location.online !== null) return false;
    if (inc.status) return false;
    if (inc.dateFrom || inc.dateTo) return false;
    if (inc.timeFromMin !== null || inc.timeToMin !== null) return false;
    return true;
  }

  function apply(ast, lectures) {
    if (!Array.isArray(lectures)) return [];
    if (isEmpty(ast)) return lectures.slice();

    const inc = ast.include;
    const excludes = (ast.exclude || []).map(x => x.toLowerCase());
    const mentorLC = (inc.mentor || []).map(x => x.toLowerCase());
    const categoryCodes = inc.category || [];
    const derivedIds = inc.derivedCat || [];
    const categoryNmLC = (inc.categoryNm || []).map(x => x.toLowerCase());
    const locOnline = inc.location && inc.location.online;
    const status = inc.status;
    const dateFrom = inc.dateFrom;
    const dateTo = inc.dateTo;
    const tFrom = inc.timeFromMin;
    const tTo = inc.timeToMin;
    const freeMatchers = (inc.freeText || []).map(t => {
      if (hasKorean(t)) return { re: buildKoreanFuzzy(t) };
      return { raw: t.toLowerCase() };
    });

    return lectures.filter(l => {
      const fields = [l.title, l.mentor, l.categoryNm, l.description, l.location].filter(Boolean);
      const hay = fields.join(' ').toLowerCase();

      for (const ex of excludes) if (hay.includes(ex)) return false;

      if (mentorLC.length) {
        const m = (l.mentor || '').toLowerCase();
        if (!mentorLC.some(x => m.includes(x))) return false;
      }

      if (categoryCodes.length) {
        if (!categoryCodes.includes(l.category)) return false;
      }

      if (derivedIds.length) {
        const dc = Array.isArray(l.derivedCategories) ? l.derivedCategories : [];
        if (!derivedIds.some(id => dc.includes(id))) return false;
      }

      if (locOnline !== null && locOnline !== undefined) {
        if (l.isOnline !== locOnline) return false;
      }

      if (status) {
        if (l.status !== status) return false;
      }

      if (dateFrom) {
        if (!l.lecDate || l.lecDate < dateFrom) return false;
      }
      if (dateTo) {
        if (!l.lecDate || l.lecDate > dateTo) return false;
      }

      // v1.16.1: tFrom 은 lecTime startMin 과, tTo 는 lecTime endMin 과 비교.
      // 이전 parseTimeToMin 은 start 시각만 뽑아 tTo (종료 기준) 에도 start 를
      // 비교 → "15시까지" 필터에 "14:00 ~ 17:00" 강연이 통과하던 sharp #6 수정.
      if ((tFrom !== null && tFrom !== undefined) || (tTo !== null && tTo !== undefined)) {
        const r = _lecTimeRange(l.lecTime);
        if (!r) return false;
        if (tFrom !== null && tFrom !== undefined && r.startMin < tFrom) return false;
        if (tTo !== null && tTo !== undefined && r.endMin > tTo) return false;
      }

      if (categoryNmLC.length) {
        const cn = (l.categoryNm || '').toLowerCase();
        if (!categoryNmLC.some(x => cn.includes(x))) return false;
      }

      for (const fm of freeMatchers) {
        if (fm.re) {
          if (!fm.re.test(hay)) return false;
        } else {
          if (!hay.includes(fm.raw)) return false;
        }
      }

      return true;
    });
  }

  // ─── BM25 (pure JS) ───
  // Builds an in-memory index per call over the *filtered* lecture set.
  // 113 docs × ~4 fields ≈ 4K tokens → <5ms. 971 docs estimated <10ms.
  // Field weights: title×3, mentor×2, categoryNm×2, description×1.
  const BM25_K1 = 1.5;
  const BM25_B = 0.75;
  const BM25_FIELDS = [
    ['title', 3],
    ['mentor', 2],
    ['categoryNm', 2],
    ['description', 1],
  ];
  const BM25_TOKEN_RE = /[\p{L}\p{N}]+/gu;

  function tokenizeBM25(s) {
    if (!s) return [];
    const out = [];
    const m = String(s).toLowerCase().match(BM25_TOKEN_RE);
    if (!m) return out;
    for (const w of m) {
      out.push(w);
      // Korean 2-gram for finer-grained matching ("AI" stays as one English token,
      // but "에이전트" → ['에이', '이전', '전트'] for partial-overlap recall).
      if (w.length >= 2 && hasKorean(w)) {
        for (let i = 0; i < w.length - 1; i++) {
          const c1 = w.charCodeAt(i), c2 = w.charCodeAt(i + 1);
          if (c1 >= 0xAC00 && c1 <= 0xD7A3 && c2 >= 0xAC00 && c2 <= 0xD7A3) {
            out.push(w.slice(i, i + 2));
          }
        }
      }
    }
    return out;
  }

  function buildDocTokens(lec) {
    const tokens = [];
    for (const [field, weight] of BM25_FIELDS) {
      const ft = tokenizeBM25(lec[field] || '');
      for (let w = 0; w < weight; w++) {
        for (const t of ft) tokens.push(t);
      }
    }
    return tokens;
  }

  // Per-lecture BM25 tokenization + tf map, cached by lecture object identity.
  // lectures[] passed to rank() is the full catalog; filtered[] is a subset
  // returned by apply(). We compute tokens/tf once per lec across calls.
  // WeakMap keyed on lec object so GC can collect entries when catalog rotates.
  const DOC_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function getDocEntry(lec) {
    if (DOC_CACHE && typeof lec === 'object' && lec !== null) {
      let e = DOC_CACHE.get(lec);
      if (e) return e;
      const tokens = buildDocTokens(lec);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      e = { tokens, tf, dl: tokens.length };
      DOC_CACHE.set(lec, e);
      return e;
    }
    const tokens = buildDocTokens(lec);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { tokens, tf, dl: tokens.length };
  }

  // Corpus-level (df / idf / avgdl) cache keyed on the lectures array reference.
  // Re-computes only when the caller passes a different array instance. N must
  // match to catch the "same array, mutated in place" edge case (rare in UI —
  // SWM lecture lists are re-assigned wholesale, not mutated).
  const CORPUS_CACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function getCorpusStats(lectures) {
    if (CORPUS_CACHE) {
      const hit = CORPUS_CACHE.get(lectures);
      if (hit && hit.N === lectures.length) return hit;
    }
    const N = lectures.length;
    let totalLen = 0;
    const df = new Map();
    for (let i = 0; i < N; i++) {
      const e = getDocEntry(lectures[i]);
      totalLen += e.dl;
      for (const t of e.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    const avgdl = N ? totalLen / N : 0;
    const idf = new Map();
    for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
    const stats = { N, avgdl, df, idf };
    if (CORPUS_CACHE) CORPUS_CACHE.set(lectures, stats);
    return stats;
  }

  // Score `filtered` (subset) using idf/avgdl from the full `lectures` corpus.
  // This is standard BM25 practice — ranking within a filtered subset while
  // keeping idf rarity signal calibrated against the full catalog.
  function bm25Score(filtered, freeQuery, lectures) {
    const { avgdl, idf } = getCorpusStats(lectures);
    const qts = tokenizeBM25(freeQuery);
    const N = filtered.length;
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      const e = getDocEntry(filtered[i]);
      const dl = e.dl;
      let s = 0;
      for (const t of qts) {
        const f = e.tf.get(t) || 0;
        if (!f) continue;
        const num = f * (BM25_K1 + 1);
        const den = f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (avgdl || 1)));
        s += (idf.get(t) || 0) * (num / den);
      }
      out[i] = { lec: filtered[i], score: s };
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // Build the BM25 query string from raw_tokens (topical hints preserved at
  // parse time). Falls back to freeText if raw_tokens is absent (legacy ASTs
  // built outside parse()). Previously rank() used only freeText, so any query
  // where every token alias-resolved (e.g. "AI", "창업 IR", "Agentic AI")
  // scored 0 on every doc — lectures came back in upstream array order.
  function buildSearchQuery(ast) {
    if (!ast) return '';
    if (Array.isArray(ast.raw_tokens) && ast.raw_tokens.length) {
      return ast.raw_tokens.join(' ');
    }
    const inc = ast.include || {};
    return (inc.freeText || []).join(' ');
  }

  function rank(ast, lectures, opts) {
    opts = opts || {};
    const filtered = apply(ast, lectures);
    if (!opts.rank) return filtered;
    const q = buildSearchQuery(ast).trim();
    if (!q) {
      // No topical hints at all (e.g., pure mentor / date / location query).
      // Emit zero-score wrappers so callers get uniform [{lec, score}] shape.
      return filtered.map(l => ({ lec: l, score: 0 }));
    }
    return bm25Score(filtered, q, lectures);
  }

  function quoteIfSpace(s) {
    return /\s/.test(s) ? `"${s}"` : s;
  }

  function stringify(ast) {
    if (isEmpty(ast)) return '';
    const parts = [];
    for (const m of ast.include.mentor || []) parts.push('@' + quoteIfSpace(m));
    for (const c of ast.include.category || []) {
      const label = c === 'MRC020' ? '특강' : (c === 'MRC010' ? '멘토링' : c);
      parts.push('#' + label);
    }
    for (const d of ast.include.derivedCat || []) parts.push('#' + d);
    for (const n of ast.include.categoryNm || []) parts.push('#' + quoteIfSpace(n));
    if (ast.include.location && ast.include.location.online !== null) {
      parts.push(ast.include.location.online ? '온라인' : '오프라인');
    }
    if (ast.include.status === 'A') parts.push('접수중');
    else if (ast.include.status === 'C') parts.push('마감');
    if (ast.include.dateFrom || ast.include.dateTo) {
      const a = ast.include.dateFrom || '';
      const b = ast.include.dateTo || '';
      parts.push(a && b && a === b ? '@date:' + a : '@date:' + a + '..' + b);
    }
    if (ast.include.timeFromMin !== null || ast.include.timeToMin !== null) {
      const from = ast.include.timeFromMin !== null ? minToHHMM(ast.include.timeFromMin) : '';
      const to = ast.include.timeToMin !== null ? minToHHMM(ast.include.timeToMin) : '';
      parts.push('@time:' + from + '..' + to);
    }
    for (const t of ast.include.freeText || []) parts.push(quoteIfSpace(t));
    for (const e of ast.exclude || []) parts.push('-' + quoteIfSpace(e));
    return parts.join(' ');
  }

  const API = {
    VERSION,
    parse,
    apply,
    rank,
    stringify,
    isEmpty,
    hasKorean,
    buildKoreanFuzzy,
  };

  if (typeof window !== 'undefined') window.SWM_QUERY = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
