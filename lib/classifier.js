// classifier.js — SWM-native taxonomy (multi-label)
// Rules ported from staging/swm_cluster_v2.py (971 lectures, etc≈22%).
// Exposed as window.SWM_CLASSIFY. Call `classify({title, description})` for an
// array of matches. Empty array returns the `etc` fallback entry.

(function () {
  'use strict';

  const RULES = [
    { id: 'security',    emoji: '🔒',  label: '보안',
      re: /보안(?!.*그로스)|웹해킹|\bCTF\b|취약점|pentest|XSS|SSRF|암호학/i },
    { id: 'game',        emoji: '🎮',  label: '게임/그래픽스',
      re: /게임(?!.*그로스)|Unity\b|Unreal\b|언리얼|그래픽스|셰이더|버튜버/i },
    { id: 'blockchain',  emoji: '⛓️',  label: '블록체인',
      re: /블록체인|Web3\b|NFT|스마트\s*컨트랙트|DeFi|Ethereum|Solana/i },
    { id: 'mobile',      emoji: '📱',  label: '모바일',
      re: /iOS|Android|Flutter|Swift\b|Kotlin|React\s*Native|모바일\s*앱/i },
    { id: 'ai',          emoji: '🤖',  label: 'AI/LLM',
      re: /\bAI\b|\bML\b|\bLLM\b|\bGPT\b|\bRAG\b|딥러닝|머신러닝|생성형|NLP|에이전트|프롬프트|agentic|vision|추론|임베딩|파운데이션|파인튜닝|transformer|Physical\s*AI|\bMCP\b|diffusion|CLIP|Qwen|Gemma|VLM|바이브코딩|Agentic|인공지능/i },
    { id: 'data',        emoji: '📊',  label: '데이터',
      re: /데이터\s*엔지니어|빅데이터|\bETL\b|Airflow|Spark|Hadoop|Pandas|\bSQL\b|데이터\s*분석|데이터\s*파이프라인|Warehouse|\bDBT\b|DW\b|DB\s/i },
    { id: 'backend',     emoji: '⚙️',  label: '백엔드/시스템',
      re: /백엔드|Backend|\bMSA\b|마이크로서비스|Kafka|메시지\s*큐|\bAPI\b|아키텍처|트래픽|스파이크|분산\s*시스템|시스템\s*설계|성능|\bSRE\b|로그|메트릭|Spring\b|Django|Rails|Nest|GraphQL|Redis|도메인\s*설계|DDD/i },
    { id: 'frontend',    emoji: '🌐',  label: '프론트엔드',
      re: /프론트엔드|Frontend|React\b|Vue\b|Next\b|Svelte|Nuxt|Laravel|\bTypescript\b|\bJavascript\b/i },
    { id: 'cloud',       emoji: '☁️',  label: '클라우드/인프라',
      re: /\bAWS\b|\bGCP\b|Azure|클라우드|쿠버네티스|\bK8s\b|Docker|컨테이너|인프라|Serverless|Terraform|\bVPC\b/i },
    { id: 'devops',      emoji: '🛠️',  label: 'DevOps',
      re: /DevOps|CI\/CD|Observability|옵저버빌리티|모니터링|관측|배포\s|젠킨스|GitHub\s*Actions|ArgoCD/i },
    { id: 'startup',     emoji: '🚀',  label: '창업/비즈',
      re: /창업|스타트업|\bIR\b|피치|\bVC\b|엑싯|사업(화|성)|\bBM\b|비즈니스\s*모델|\bMVP\b|수익화|매출|\bPMF\b|\bTAM\b|\bGTM\b|시장|투자|금융|마케팅|\bSEO\b|고객(?=.*모|.*확보)/i },
    { id: 'idea',        emoji: '💡',  label: '아이디어/기획',
      re: /아이디에이션|아이디어(?!.*게임)|기획|\bPM\b|\bPO\b|프로덕트|제품\s|로드맵|\bUX\b|유저\s*리서|사용자\s*조사|퍼소나|경험맵|요구사항|문제\s*정의|고객\s*리서|Market|인사이트|리써치/i },
    { id: 'team',        emoji: '🤝',  label: '팀/프로세스',
      re: /팀\s*빌딩|팀\s*매칭|팀\s*구성|팀\s*멘토링|회고|KPT|스프린트|협업|피드백|팀플레이|인간관계|소프트파워|소통/i },
    { id: 'career',      emoji: '💼',  label: '커리어',
      re: /커리어|이력서|면접|취업|이직|\b회고\b|연봉|포트폴리오|인터뷰|\bWomen\s*in\s*Tech|성장/i },
    { id: 'cs',          emoji: '📘',  label: 'CS/알고리즘',
      re: /자료구조|알고리즘|코딩\s*테스트|\bLeetcode\b|CS\s*기초|네트워크\s*기초|운영체제\s*기초|디자인\s*패턴/i },
    { id: 'os',          emoji: '🖥️',  label: 'OS/임베디드',
      re: /커널|임베디드|펌웨어|시스템\s*프로그래밍|리눅스\s*커널|\bRTOS\b/i },
    { id: 'soma',        emoji: '🍊',  label: '소마 프로세스',
      re: /소마|\bSOMA\b|마에스트로|연수생|오피스아워|사전\s*검토|오픈\s*스프린트|멘토가\s*되는|멘토로서|프로젝트\s*주제|빌드업|\bOpenClaw\b/i },
    { id: 'dev_general', emoji: '👩‍💻', label: '개발 일반',
      re: /개발(?!.*게임)|프로그래밍|소프트웨어\s*엔지니어|엔지니어링|코드\s*리뷰|리팩토링|테스트\s*코드|\bExposed\b/i },
  ];

  const ETC = { id: 'etc', emoji: '📌', label: '기타' };

  function classify(lec) {
    const title = (lec && lec.title) || '';
    const desc = (lec && lec.description) || '';
    const haystack = `${title} ${desc}`;
    const out = [];
    for (const rule of RULES) {
      if (rule.re.test(haystack)) {
        out.push({ id: rule.id, emoji: rule.emoji, label: rule.label });
      }
    }
    return out.length ? out : [ETC];
  }

  const VERSION = '2026-04-19';

  // In-memory cache: skip re-running 18 regex × N lectures when title/description
  // haven't changed. `_cv` tags a lecture object as classified at VERSION.
  function injectInto(lectures) {
    if (!lectures) return;
    for (const l of Object.values(lectures)) {
      if (l._cv === VERSION && Array.isArray(l.derivedCategories)) continue;
      const cats = classify(l);
      l.derivedCategories = cats.map(c => c.id);
      l.derivedChips = cats.slice(0, 3);
      l._cv = VERSION;
    }
  }

  function invalidate(lec) {
    if (lec) lec._cv = null;
  }

  window.SWM_CLASSIFY = {
    RULES,
    ETC,
    classify,
    injectInto,
    invalidate,
    VERSION,
  };
})();
