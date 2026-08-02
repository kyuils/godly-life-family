#!/usr/bin/env node
// scripts/check-web.mjs — 프론트엔드 정적 검사.
//
// 목적 (계약 §6.1 / CLAUDE.md 완료 기준):
//   1) 개발용 MOCK 설정이 커밋에 섞여 들어가지 않게 막는다.
//   2) 프론트 캐시가 email로 스코핑되고 메모리에만 있는지 확인한다
//      — 이걸 어기면 가족이 폰을 공유할 때 남의 기도제목이 보인다.
//   3) 모듈 import 경로가 실재하는지, 참조한 자산이 있는지 확인한다.
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL CHECKS PASSED".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const JS = path.join(WEB, 'js');

let pass = 0;
const failures = [];

function check(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
    failures.push(label + ' — ' + r);
    console.log('  [FAIL] ' + label + ' — ' + r);
  } catch (e) {
    failures.push(label + ' — ' + (e && e.message ? e.message : e));
    console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
  }
}

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * 주석을 제거한 코드만 남긴다.
 * 이 검사기는 "금지어가 소스에 있는가"를 보는데, 주석에서 그 금지어를 *설명*하는
 * 문장까지 걸리면 오탐이 난다. 오탐을 내는 검사기는 곧 무시당하므로 정확해야 한다.
 * ('//'가 ':' 뒤에 오는 경우는 https:// 같은 URL이므로 주석으로 보지 않는다)
 */
function codeOnly(src) {
  return String(src)
    // ★ 줄 주석을 먼저 지운다. 순서를 바꾸면, 주석 안에 쓴 경로("web/data/*.json")의
    //   '/*' 가 블록 주석 시작으로 오인돼 그 뒤 코드를 통째로 삼킨다(2026-07-30 실제 발생).
    //
    // ★★ split을 /\r?\n/ 로 하는 이유 (2026-07-31 실제 발생):
    //   윈도우에서 파일이 CRLF로 저장되면 '\n'으로만 자를 때 각 줄 끝에 '\r'이 남는다.
    //   그런데 정규식의 '.' 은 '\r'을 매칭하지 않으므로(줄 종결자다) '//.*$' 가
    //   **한 줄도 매칭되지 않는다.** 그러면 줄 주석이 하나도 제거되지 않아,
    //   주석에 적어 둔 이름·금지어가 전부 «코드»로 오인된다.
    //   실제로 state.js 주석의 resetAll()·renderTab()이 호출로 잡혀 검사가 터졌다.
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

console.log('=== 프론트엔드 정적 검사 ===\n');

// --- 1) 배포 설정이 placeholder 상태인가 -----------------------------------
console.log('--- 배포 설정 (커밋 사고 방지) ---');
const config = codeOnly(read(path.join(JS, 'config.js')));

check('config.js의 MOCK이 null (개발용 로그인 우회가 켜진 채 커밋 금지)', () => {
  const m = config.match(/MOCK\s*:\s*([^,\n]+)/);
  if (!m) return 'MOCK 항목을 찾지 못함';
  const v = m[1].trim();
  return v === 'null' || 'MOCK=' + v + ' — 커밋 전 null로 되돌리세요';
});

check('config.js의 GAS_URL이 로컬 주소가 아님', () => {
  const m = config.match(/GAS_URL\s*:\s*'([^']*)'/);
  if (!m) return 'GAS_URL 항목을 찾지 못함';
  const v = m[1];
  if (v.indexOf('/api') === 0 || v.indexOf('localhost') >= 0) {
    return "GAS_URL='" + v + "' — 미리보기 설정이 남아 있습니다";
  }
  return true;
});

check('OAUTH_CLIENT_ID 형식을 프론트·서버 양쪽에서 검사한다', () => {
  // placeholder만 보면 빈 값·오붙여넣기를 통과시켜, 안내 없이 로그인 버튼만
  // 안 뜨는 상태가 된다. 서버(Setup.gs)는 붙여넣기 공백까지 trim해야 한다 —
  // 공백 하나로 aud가 어긋나 로그인 후 모든 동작이 실패한다 (5차 검토 N7).
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const setup = codeOnly(read(path.join(ROOT, 'gas', 'Setup.gs')));
  const missing = [];
  if (!/apps\.googleusercontent\.com/.test(app)) missing.push('app.js 접미사 검사');
  if (!/apps\.googleusercontent\.com/.test(setup)) missing.push('Setup.gs 접미사 경고');
  if (!/SETUP_OAUTH_CLIENT_ID[^;]*\)\s*\.trim\(\)|String\(SETUP_OAUTH_CLIENT_ID[\s\S]{0,40}trim\(\)/.test(setup)) {
    missing.push('Setup.gs의 클라이언트 ID trim');
  }
  return missing.length === 0 || '없음: ' + missing.join(', ');
});

check('config.js에 시트 ID·등록 코드가 없다 (서버에만 두어야 함)', () => {
  const bad = ['SHEET_ID', 'REGISTER_CODE', 'docs.google.com/spreadsheets'];
  const hit = bad.filter((b) => config.indexOf(b) >= 0);
  return hit.length === 0 || '발견: ' + hit.join(', ');
});

// --- 2) 캐시 격리 (계약 §6.1) ----------------------------------------------
console.log('\n--- 캐시 격리 (가족 공용 기기 대비) ---');
const api = codeOnly(read(path.join(JS, 'api.js')));

check('캐시 키에 세션 email이 접두된다', () => {
  const m = api.match(/function cacheKey\([\s\S]*?\n\}/);
  if (!m) return 'cacheKey 함수를 찾지 못함';
  return /currentEmail/.test(m[0]) || 'cacheKey가 currentEmail을 쓰지 않음';
});

check('캐시가 localStorage/sessionStorage를 쓰지 않는다', () => {
  const hit = ['localStorage', 'sessionStorage', 'indexedDB'].filter((s) => api.indexOf(s) >= 0);
  return hit.length === 0 || '발견: ' + hit.join(', ');
});

check('어떤 프론트 파일도 토큰·기록을 브라우저 저장소에 남기지 않는다', () => {
  const offenders = [];
  fs.readdirSync(JS).filter((f) => f.endsWith('.js')).forEach((f) => {
    if (f === 'mccheyne-plan.js') return; // 성경읽기표 데이터(계승 파일)
    const s = codeOnly(read(path.join(JS, f)));
    if (/localStorage|sessionStorage|document\.cookie/.test(s)) offenders.push(f);
  });
  return offenders.length === 0 || '발견: ' + offenders.join(', ');
});

check('계정 전환·로그아웃 시 캐시를 파기하는 코드가 있다', () => {
  const auth = codeOnly(read(path.join(JS, 'auth.js')));
  const hasSwitch = /clearCache\(\)/.test(auth) && /resetUserData\(\)/.test(auth);
  const hasSignOut = /clearSession\(\)/.test(auth);
  return (hasSwitch && hasSignOut) || 'auth.js에 캐시 파기 경로가 없음';
});

check('setSession이 계정 전환을 감지해 캐시를 비운다', () => {
  // ★ 예전에는 «currentEmail && currentEmail !==» 라는 **문장 모양**을 정규식으로 봤다.
  //   2026-08-02에 의미가 똑같은 리팩터링(if로 묶어 세대 증가를 함께 처리)만으로
  //   이 검사가 깨져 오탐을 냈다. 모양이 아니라 «함수 안에서 비교와 파기가 함께
  //   일어나는가»를 본다. 실제 격리 **동작**은 scripts/test-web-api.mjs가 검증한다.
  const body = fnBodyOf(api, 'setSession');
  if (!body) return 'setSession을 찾지 못함';
  if (!/currentEmail\s*!==\s*lower/.test(body)) return '계정 전환 비교가 없음';
  return /clearCache\(\)/.test(body) || '계정이 바뀔 때 캐시를 비우지 않는다';
});

// --- 3) 서비스워커 (계약 §6.2) ---------------------------------------------
console.log('\n--- 서비스워커 ---');
const sw = codeOnly(read(path.join(WEB, 'sw.js')));
check('GET이 아닌 요청(=GAS POST)은 가로채지 않는다', () =>
  /req\.method\s*!==\s*'GET'/.test(sw) || 'POST 제외 로직이 없음');
check('다른 출처(구글 로그인·GAS)는 캐시하지 않는다', () =>
  /url\.origin\s*!==\s*self\.location\.origin/.test(sw) || '출처 검사가 없음');
check('skipWaiting + clients.claim으로 즉시 교체된다', () =>
  (/skipWaiting/.test(sw) && /clients\.claim/.test(sw)) || '즉시 활성화 로직이 없음');
check('캐시명에 BUILD_TAG가 들어간다', () =>
  /CACHE\s*=\s*'[^']*'\s*\+\s*BUILD_TAG/.test(sw) || '캐시명이 버전과 무관함');

// 계약 §6.2 — 자산 성격별 전략. 이 검사가 없으면 다음 사람이 계약을 읽고
// cache-first로 되돌려도 아무도 못 잡는다(그러면 '고쳤는데 안 바뀜'이 재발한다).
check('참고자료·아이콘은 cache-first로 분기한다', () =>
  (/isImmutableAsset/.test(sw) && /\/data\//.test(sw) && /\/icons\//.test(sw)) ||
  '자산별 분기(isImmutableAsset)가 없음');
check('앱 코드는 network-first다 (cache-first 고착 방지)', () =>
  /networkFirst\s*\(/.test(sw) || 'networkFirst 경로가 없음');
check('network-first에 타임아웃 레이스가 있다', () =>
  (/Promise\.race/.test(sw) && /setTimeout/.test(sw)) ||
  '타임아웃이 없어 불안정한 회선에서 앱 시작이 매달릴 수 있음');
check('오프라인 폴백은 navigate 요청에만 index.html을 준다', () =>
  /req\.mode\s*===\s*'navigate'/.test(sw) ||
  'JS 요청에 HTML을 돌려주면 MIME 오류로 빈 화면이 된다');
check('localhost에서는 서비스워커를 등록하지 않는다', () => {
  const app = codeOnly(read(path.join(JS, 'app.js')));
  return (/localhost/.test(app) && /unregister\(\)/.test(app)) ||
    'app.js에 localhost 예외가 없음 — 개발 중 옛 코드가 실행된다';
});

// --- 4) XSS 방어 ------------------------------------------------------------
console.log('\n--- 출력 이스케이프 ---');
check('사용자 입력을 innerHTML에 넣는 화면 파일이 escapeHtml을 쓴다', () => {
  const views = fs.readdirSync(JS).filter((f) => f.indexOf('view-') === 0);
  const missing = views.filter((f) => {
    const s = codeOnly(read(path.join(JS, f)));
    return /innerHTML/.test(s) && !/escapeHtml/.test(s);
  });
  return missing.length === 0 || 'escapeHtml 미사용: ' + missing.join(', ');
});

check('await 뒤 화면을 다시 그리는 뷰는 stale 가드를 쓴다', () => {
  // 비동기 응답이 늦게 도착해 **이미 다른 탭으로 바뀐 화면**을 덮어쓰는 사고를 막는다.
  const offenders = [];
  fs.readdirSync(JS).filter((f) => f.indexOf('view-') === 0).forEach((f) => {
    const s = codeOnly(read(path.join(JS, f)));
    const hasAwait = /await\s/.test(s);
    const redraws = /innerHTML|render\(/.test(s);
    if (hasAwait && redraws && !/stale\(/.test(s)) offenders.push(f);
  });
  return offenders.length === 0 || 'stale 가드 없음: ' + offenders.join(', ');
});

// 데이터를 받아 오는 await 형태를 모두 찾는다.
// api.call만 보면 Promise.all([...])·fetch(...)로 감싼 경우를 놓친다 —
// 실제로 view-class.js가 그 형태로 검사를 통과하면서 규칙을 어기고 있었다 (6차 검토 ④).
const AWAIT_FETCH = /await\s+(?:api\.call|fetch|Promise\.all)\s*\(/g;
function findNextAwaitCall(src, from) {
  AWAIT_FETCH.lastIndex = from;
  const m = AWAIT_FETCH.exec(src);
  return m ? m.index : -1;
}

check('★ 받아 온 응답을 stale 가드로 버리지 않는다', () => {
  // ★ 이 검사가 진짜다. "파일 어딘가에 stale이 있는가"는 가드를 **잘못된 자리**에 둔
  //   결함을 잡지 못한다(5차 검토에서 실제로 5경로 발생).
  //
  //   금지 형태:  const res = await api.call(...);
  //              if (stale(gen)) return;        // ← 방금 받은 res를 버린다
  //
  //   여기서 빠져나가면 서버에는 저장/삭제됐는데 로컬 데이터가 옛것으로 남아,
  //   사용자에게는 «저장이 안 됐다» «지웠는데 그대로다»로 보인다.
  //   규칙: 데이터 갱신은 항상 수행하고, stale은 화면 그리기·토스트만 막는다.
  const offenders = [];
  // app.js는 stale을 import하지 않으므로 이 규칙이 트리거될 수 없다 —
  // 넣어 두면 «검사하고 있다»는 착각만 준다(7차 검토 지적). 대상은 뷰 + load.js.
  const targets = fs.readdirSync(JS).filter((f) => f.indexOf('view-') === 0).concat(['load.js']);
  targets.forEach((f) => {
    const src = codeOnly(read(path.join(JS, f)));
    let at = 0;
    for (;;) {
      const call = findNextAwaitCall(src, at);
      if (call < 0) break;
      // 여는 괄호부터 짝이 맞는 닫는 괄호를 찾는다.
      let k = src.indexOf('(', call);
      let depth = 0;
      for (; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') { depth--; if (depth === 0) break; }
      }
      const after = src.slice(k + 1).replace(/^[;\s]+/, '');
      if (/^if\s*\(\s*stale\s*\(/.test(after)) {
        offenders.push(f);
        break;
      }
      at = call + 1;
    }
  });
  return offenders.length === 0 ||
    '응답 직후 stale로 빠져나감(받은 데이터가 버려짐): ' + offenders.join(', ');
});

check('draft를 보관하는 뷰는 소유자 email로 격리한다', () => {
  // 보관해 둔 입력이 계정 전환 후 다른 사람에게 복원되면 불변식 7 위반이다.
  const offenders = [];
  fs.readdirSync(JS).filter((f) => f.indexOf('view-') === 0).forEach((f) => {
    const s = codeOnly(read(path.join(JS, f)));
    if (!/stashDraft/.test(s)) return;
    if (!/draft\.email/.test(s)) offenders.push(f);
  });
  return offenders.length === 0 || 'draft 소유자 검사 없음: ' + offenders.join(', ');
});

check('인증 실패 코드가 모두 사용자 문구를 갖는다', () => {
  // 문구가 없으면 "문제가 발생했습니다"로만 끝나 비개발자가 원인을 찾지 못한다.
  const required = [
    'aud_mismatch', 'iss_mismatch', 'tokeninfo_failed', 'invalid_token',
    'email_unverified', 'token_expired', 'unauthorized', 'forbidden',
    'busy', 'conflict', 'network_error', 'server_misconfig',
  ];
  const missing = required.filter((c) => !new RegExp('\\b' + c + '\\s*:').test(api));
  return missing.length === 0 || '문구 없음: ' + missing.join(', ');
});

check('★ 로드 실패를 «빈 데이터»로 갈음하지 않는다 (load.js)', () => {
  // 이 앱에서 가장 흔한 사고: 로그인 순간 회선이 흔들리면 오류 표시 없이
  // «연속 0일» «기도 없음»이 뜬다. 실패는 반드시 호출부로 전파되어야 한다.
  const src = codeOnly(read(path.join(JS, 'load.js')));
  const problems = [];

  // (a) 실패를 기본값으로 갈음하는 삼항 (`p.ok ? p.rows : []`)
  if (/\.ok\s*\?[^:]*:\s*\[\s*\]/.test(src)) {
    problems.push('실패를 빈 배열로 갈음하는 삼항이 있음');
  }
  // (b) api.call 호출 수만큼 실패 반환이 있어야 한다
  const calls = (src.match(/await\s+api\.call\(/g) || []).length;
  const fails = (src.match(/return\s*\{\s*ok:\s*false/g) || []).length;
  if (calls > 0 && fails < 2) {
    problems.push('api.call ' + calls + '곳인데 실패 반환이 ' + fails + '곳뿐');
  }
  // (c) 성공 경로가 명시적으로 ok:true를 돌려줘야 한다
  if (!/return\s*\{\s*ok:\s*true/.test(src)) {
    problems.push('성공 시 { ok: true } 반환이 없음');
  }
  return problems.length === 0 || problems.join(', ');
});

check('★ loadMyData 실패 시 앱 화면을 그리지 않는다 (app.js)', () => {
  const app = codeOnly(read(path.join(JS, 'app.js')));
  // loadMyData 호출부마다 !loaded.ok 분기가 있어야 한다.
  const calls = (app.match(/await\s+loadMyData\(/g) || []).length;
  const guards = (app.match(/!\s*loaded\.ok/g) || []).length;
  if (calls === 0) return 'loadMyData 호출을 찾지 못함';
  return calls === guards ||
    'loadMyData ' + calls + '곳 중 실패 분기는 ' + guards + '곳뿐 — 나머지는 빈 화면을 그린다';
});

check('★ 화면 전환(hidden)을 CSS가 무력화하지 않는다', () => {
  // 이 앱의 화면 3개(로그인·가입·앱)는 오직 hidden 속성으로 갈린다.
  // 그런데 hidden의 display:none은 «브라우저 기본 스타일»이라, 우리 CSS의
  // .cover{display:flex} 한 줄이 그것을 그대로 이긴다. 그러면 hidden을 걸어도
  // 화면이 계속 보이고 세 화면이 위아래로 이어 붙는다.
  //
  // 실제로 그 상태로 배포되어 «로그인이 안 된다»로 신고됐다 (2026-07-30).
  // 로그인은 성공하고 서버 응답도 정상이었는데 맨 위 로그인 화면이 그대로
  // 보였을 뿐이다 — 어떤 테스트도 이걸 잡지 못했기에 규칙으로 세운다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const css = read(path.join(WEB, 'css', 'app.css'));

  const switchesByHidden = /\.hidden\s*=/.test(app);
  if (!switchesByHidden) return true; // 전환 방식이 바뀌었다면 이 규칙은 해당 없음

  // [hidden] 에 display:none 이 !important 로 걸려 있어야 한다.
  const rule = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/i.test(css);
  if (!rule) {
    return 'app.js는 hidden으로 화면을 바꾸는데 css에 «[hidden]{display:none !important}»가 없다';
  }

  // 화면 컨테이너에 display를 지정하는 클래스가 실제로 존재하는지도 확인해 둔다
  // (존재한다면 위 규칙이 없을 때 반드시 깨진다는 뜻이므로 규칙의 근거가 된다).
  const html = read(path.join(WEB, 'index.html'));
  const ids = ['screen-login', 'screen-loading', 'screen-register', 'screen-app'];
  const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
  return missing.length === 0 || 'index.html에 없는 화면: ' + missing.join(', ');
});

check('★ 검사기 자기점검 — 주석 제거가 CRLF에서도 동작한다', () => {
  // 이 검사기의 거의 모든 규칙이 codeOnly()에 의존한다. 여기가 조용히 망가지면
  // 주석에 적어 둔 이름·금지어가 «코드»로 오인되고(오탐), 반대로 주석 처리된
  // 코드가 살아 있는 것으로 보인다(미탐). 2026-07-31에 실제로 CRLF 파일에서
  // 줄 주석이 하나도 제거되지 않는 상태였다 — '.' 은 '\r'을 매칭하지 않는다.
  // 이 저장소에 실제로 존재할 수 있는 두 형식만 본다. CR만 쓰는 줄바꿈은
  // git이 만들지 않으므로 검사 대상이 아니다(넣으면 늘 실패하는 검사가 된다).
  const cases = [
    ['LF',   'const a = 1;\n// 주석 안의 doSomething()\nconst b = 2;'],
    ['CRLF', 'const a = 1;\r\n// 주석 안의 doSomething()\r\nconst b = 2;'],
  ];
  const bad = cases
    .filter(([, src]) => codeOnly(src).includes('doSomething'))
    .map(([name]) => name);
  if (bad.length) return '주석이 제거되지 않는 줄바꿈 형식: ' + bad.join(', ');

  // URL의 '//'는 주석이 아니다 (기존 동작 유지 확인)
  if (!codeOnly("const u = 'https://example.com/x';").includes('example.com')) {
    return "https:// 를 주석으로 잘못 지운다";
  }
  return true;
});

check('★ 홈 아이콘 4개가 실제 탭과 연결된다', () => {
  // 홈 카드의 data-tab에 오탈자가 있으면 «눌러도 아무 일도 안 일어나는 칸»이
  // 생긴다. 화면을 봐야만 알 수 있는 종류라 정적으로 대조해 둔다.
  const home = codeOnly(read(path.join(JS, 'view-home.js')));
  const app = codeOnly(read(path.join(JS, 'app.js')));

  const cardTabs = [...home.matchAll(/tab:\s*'([a-z]+)'/g)].map((m) => m[1]);
  if (cardTabs.length !== 4) return '홈 카드가 4개가 아니다: ' + cardTabs.length + '개';

  // app.js의 TABS 배열에서 id 수집
  const tabsBlock = /const TABS = \[([\s\S]*?)\];/.exec(app);
  if (!tabsBlock) return 'app.js에서 TABS 배열을 찾지 못함';
  const tabIds = [...tabsBlock[1].matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);

  const orphan = cardTabs.filter((t) => !tabIds.includes(t));
  if (orphan.length) return 'TABS에 없는 목적지: ' + orphan.join(', ') + ' (있는 탭: ' + tabIds.join(', ') + ')';

  // 홈은 탭이 아니어야 한다 — 탭이 6개가 되면 누르기 어려워진다
  if (tabIds.includes('home')) return '홈이 TABS에 들어가 있다 — 탭 수가 늘면 탭이 작아진다';

  // renderTab이 home을 실제로 처리하는지
  return /case 'home'/.test(app) || "renderTab에 case 'home'이 없다 — 홈이 빈 화면이 된다";
});

check('★ 가입 화면의 분류 버튼·입력칸이 코드와 화면에 모두 있다', () => {
  // renderRegister/setKind는 el('#reg-kind-…')·el('#reg-school-row')를 무조건
  // 참조한다. ui.js의 el()은 없으면 null을 돌려주므로, id가 하나만 어긋나도
  // null.onclick / null.classList 에서 TypeError가 나고 화면이 «처음 오셨네요»
  // 에서 멈춘 채 버튼이 죽는다. 이 화면은 **모든 신규 가입자가 반드시 지나는
  // 유일한 길**이라 조용히 깨지면 아무도 가입하지 못한다.
  const html = read(path.join(WEB, 'index.html'));
  const app = codeOnly(read(path.join(JS, 'app.js')));

  const block = /const REG_KINDS = \{([\s\S]*?)\n\};/.exec(app);
  if (!block) return 'app.js에서 REG_KINDS를 찾지 못함';
  const kinds = [...block[1].matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]);
  if (!kinds.length) return 'REG_KINDS가 비어 있다';

  // 코드의 분류 ↔ 화면의 버튼을 «양방향»으로 대조한다. 한쪽만 보면 화면에만
  // 있는 유령 버튼(눌러도 반응 없음)을 놓친다.
  const htmlKinds = [...html.matchAll(/id="reg-kind-([a-z]+)"/g)].map((m) => m[1]);
  const missing = kinds.filter((k) => !htmlKinds.includes(k));
  if (missing.length) return 'index.html에 없는 분류 버튼: ' + missing.map((k) => '#reg-kind-' + k).join(', ');
  const ghost = htmlKinds.filter((k) => !kinds.includes(k));
  if (ghost.length) return 'REG_KINDS에 없는 버튼: ' + ghost.join(', ') + ' (눌러도 아무 일도 안 일어난다)';

  // 계약 §2.1: 학교는 학생에게만 보인다 — 그 토글 대상이 실제로 있어야 한다.
  const ids = ['reg-kind-student', 'reg-school-row', 'reg-school', 'reg-extra-label', 'reg-extra', 'reg-name', 'reg-code', 'reg-submit', 'reg-cancel'];
  const gone = ids.filter((id) => !html.includes('id="' + id + '"'));
  if (gone.length) return 'index.html에 없는 요소: ' + gone.join(', ');

  // school: true 인 분류가 학생 하나뿐인지 (학부모 화면에 학교가 뜨면 요청 위반)
  const withSchool = [...block[1].matchAll(/^\s{2}([a-z]+):.*school:\s*true/gm)].map((m) => m[1]);
  return withSchool.join(',') === 'student' ||
    '학교 칸이 보이는 분류가 student가 아니다: [' + withSchool.join(', ') + ']';
});

check('★ 가입 화면 제목이 배경에 묻히지 않는다', () => {
  // .cover-title은 «검은 표지 박스» 전용 흰색 글자다. 가입 화면(밝은 배경)이 이
  // class를 재사용하는데 색을 되돌리지 않으면 «처음 오셨네요»가 통째로 사라진다.
  // 화면을 열어 봐야만 보이는 종류라 정적으로 묶어 둔다 (2026-07-31 실제로 발생).
  const html = read(path.join(WEB, 'index.html'));
  const css = read(path.join(WEB, 'css', 'app.css'));

  const reg = /<section[^>]*id="screen-register"[\s\S]*?<\/section>/.exec(html);
  if (!reg) return 'index.html에서 가입 화면(section#screen-register)을 찾지 못함';
  if (!reg[0].includes('cover-title')) return true;   // 재사용하지 않으면 이 위험이 없다

  // .cover-title이 실제로 밝은 색(=어두운 배경 전용)인지 먼저 확인한다.
  const coverRule = /\.cover-title\s*\{([^}]*)\}/.exec(css);
  if (!coverRule) return 'app.css에서 .cover-title 규칙을 찾지 못함';
  if (!/color\s*:\s*#(?:F|f)/.test(coverRule[1])) return true;   // 밝은 색이 아니면 문제없다

  // 그렇다면 «가입 화면의 제목»을 겨냥해 색을 되돌리는 규칙이 있어야 한다.
  // ★ 선택자를 정확히 봐야 한다. 처음에 «.register로 시작하고 color가 있는 규칙»으로
  //   느슨하게 검사했더니 .register-sub{color:…} 같은 이웃 규칙에 걸려 늘 통과했다.
  //   통과하지만 아무것도 검증하지 않는 검사였다.
  const titleRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, sel, body]) => {
    const s = sel.trim();
    const targetsRegisterTitle = /\.register[\w-]*\s*[.\s>]\s*(h1|cover-title)/.test(s) ||
      /\.register[\w-]*\.cover-title/.test(s);
    return targetsRegisterTitle && /(^|;|\s)color\s*:/.test(body);
  });
  return !!titleRule ||
    '.cover-title이 흰색인데 가입 화면 제목의 색을 되돌리는 규칙이 없다 — «처음 오셨네요»가 안 보인다';
});

check('★ 인앱 브라우저 안내가 화면과 코드에 모두 있다', () => {
  // 카카오톡 인앱 브라우저에서는 구글 로그인 창을 다녀오는 사이 페이지가 다시
  // 읽혀 로그인이 풀린다. 안내가 빠지면 사용자는 «로그인이 안 된다»만 겪는다
  // (2026-07-31 실사용 신고의 실제 원인).
  const html = read(path.join(WEB, 'index.html'));
  const app = codeOnly(read(path.join(JS, 'app.js')));

  const ids = ['inapp-banner', 'inapp-open', 'inapp-copy'];
  const missing = ids.filter((id) => !html.includes('id="' + id + '"'));
  if (missing.length) return 'index.html에 없는 요소: ' + missing.join(', ');

  // 기본은 숨김이어야 한다 — 일반 브라우저에서 경고가 뜨면 안 된다
  if (!/id="inapp-banner"[^>]*\shidden/.test(html)) {
    return '#inapp-banner가 기본 hidden이 아니다 — 일반 브라우저에도 경고가 뜬다';
  }

  const fns = ['detectInApp', 'externalOpenUrl', 'setupInAppBanner'];
  const notUsed = fns.filter((f) => !app.includes(f));
  return notUsed.length === 0 || 'app.js가 쓰지 않는 함수: ' + notUsed.join(', ');
});

check('★ 메뉴(#nav)가 본문(#view)보다 앞에 있다', () => {
  // .topnav는 제목줄 바로 아래에 붙도록 만든 스타일이라, 마크업에서 본문 뒤에
  // 두면 화면 맨 아래에 깔린다. 그러면 탭이 보이지 않아 다른 화면으로 갈
  // 방법이 사라진다 (2026-07-30 실사용 신고: «메뉴가 아래 있어서 안 보인다»).
  const html = read(path.join(WEB, 'index.html'));
  const iNav = html.indexOf('id="nav"');
  const iView = html.indexOf('id="view"');
  if (iNav < 0 || iView < 0) return '#nav 또는 #view를 찾지 못함';
  return iNav < iView ||
    '메뉴가 본문 뒤에 있다 — 화면 맨 아래에 깔려 탭이 보이지 않는다';
});

check('★ 탭 버튼은 손가락으로 누를 만큼 크다', () => {
  // 탭 하나하나가 다른 화면으로 가는 문이다. 글자만 작게 한 줄로 두면
  // 휴대폰에서 누르기 어렵다. 아이콘·글자를 각각의 span으로 나누어
  // 세로로 쌓는 구조를 유지한다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const css = read(path.join(WEB, 'css', 'app.css'));
  const marks = ['tab-icon', 'tab-label'].filter((c) => !app.includes(c));
  if (marks.length) return 'app.js가 탭을 그릴 때 빠뜨린 요소: ' + marks.join(', ');
  const styled = ['tab-icon', 'tab-label'].filter((c) => !new RegExp('\\.' + c + '\\s*\\{').test(css));
  if (styled.length) return 'css에 크기 규칙이 없는 요소: ' + styled.join(', ');

  // ★ 위 검사만으로는 «아이콘을 18px, 글자를 10px로 줄여도» 그대로 통과한다.
  //   실제로 사용자가 신고한 것은 «작아서 못 누른다»이므로 크기를 직접 본다.
  //   2026-07-31에 «탭을 제목줄 한 줄에 넣자»는 요청이 있었는데, 그렇게 하면
  //   교사 5탭 기준 한 탭이 30~36px가 되어 이 검사가 막아야 하는 바로 그 상태가 된다.
  const iconSize = /\.topnav\s+\.tab-icon\s*\{[^}]*font-size\s*:\s*([\d.]+)rem/.exec(css);
  if (!iconSize) return '.topnav .tab-icon의 font-size(rem)를 찾지 못했다';
  if (Number(iconSize[1]) < 1.25) {
    return '탭 아이콘이 ' + iconSize[1] + 'rem으로 작다 (1.25rem = 20px 이상 유지)';
  }

  // 탭이 제목줄 안으로 들어가면 폭이 절반 이하가 된다 — 마크업에서 막는다.
  const html = read(path.join(WEB, 'index.html'));
  const bar = /<div class="appbar-inner">([\s\S]*?)<\/div>\s*<\/header>/.exec(html);
  if (bar && /id="nav"/.test(bar[1])) {
    return '메뉴(#nav)가 제목줄 안에 있다 — 교사 5탭 기준 한 탭이 30~36px가 된다';
  }
  return true;
});

check('★ 제목줄은 흘러가고 메뉴만 화면 위에 고정된다', () => {
  // 2026-07-31 요청: "아래 내용이 많이 보이게".
  // .appbar가 sticky로 돌아가면 제목줄 56px가 다시 상시 점유가 되어
  // 요청이 조용히 되돌려진다 — 화면을 스크롤해 봐야만 알 수 있다.
  const css = read(path.join(WEB, 'css', 'app.css'));

  const appbar = /\.appbar\s*\{([^}]*)\}/.exec(css);
  if (!appbar) return 'app.css에서 .appbar 규칙을 찾지 못했다';
  if (/position\s*:\s*sticky|position\s*:\s*fixed/.test(appbar[1])) {
    return '.appbar가 화면에 고정돼 있다 — 제목줄이 흘러가야 아래 내용이 더 보인다';
  }

  const topnav = /\.topnav\s*\{([^}]*)\}/.exec(css);
  if (!topnav) return 'app.css에서 .topnav 규칙을 찾지 못했다';
  if (!/position\s*:\s*sticky/.test(topnav[1])) return '.topnav가 sticky가 아니다 — 메뉴가 위로 사라진다';
  // 제목줄이 흘러가므로 top에서 --appbar-h를 빼야 한다. 남겨 두면 메뉴가
  // 화면 위에서 56px 아래에 붙어 그만큼이 빈 채로 남는다.
  if (/top\s*:[^;]*--appbar-h/.test(topnav[1])) {
    return '.topnav의 top이 아직 제목줄 높이만큼 내려가 있다 — 위에 빈 띠가 생긴다';
  }
  return true;
});

check('★ 앱으로 설치하기 안내가 화면과 코드에 모두 있다', () => {
  // 2026-07-31 요청: "가입고 로그인시 앱 형태로 설치되게 안내".
  const html = read(path.join(WEB, 'index.html'));
  const app = codeOnly(read(path.join(JS, 'app.js')));

  // 로그인 화면과 가입 화면 «둘 다»에 자리가 있어야 한다 (요청 원문이 «가입고 로그인시»).
  const ids = ['install-banner', 'install-go', 'install-banner-reg', 'install-go-reg'];
  const missing = ids.filter((id) => !html.includes('id="' + id + '"'));
  if (missing.length) return 'index.html에 없는 요소: ' + missing.join(', ');

  // 기본은 숨김 — 이미 설치했거나 카톡 안이면 떠서는 안 된다.
  if (!/id="install-banner"[^>]*\shidden/.test(html)) return '#install-banner가 기본 hidden이 아니다';

  // ★ beforeinstallprompt를 <head>에서 미리 잡아야 한다. app.js는 module이라
  //   defer로 늦게 도는데, 캐시된 재방문에서는 이벤트가 그 전에 발화한다.
  //   놓치면 안내가 «떴다 안 떴다» 한다.
  const head = /<head>([\s\S]*?)<\/head>/.exec(html);
  if (!head) return 'index.html에 <head>가 없다';
  // ★ 단어만 찾으면 안 된다. 바로 위 주석에 «beforeinstallprompt»가 적혀 있어서,
  //   등록 코드를 지워도 주석에 걸려 통과한다(되돌리기 검증에서 실제로 놓쳤다).
  //   실제 등록 호출을 본다.
  if (!/addEventListener\s*\(\s*['"]beforeinstallprompt['"]/.test(head[1])) {
    return '<head>에서 beforeinstallprompt를 잡지 않는다 — 안내가 간헐적으로 안 뜬다';
  }
  // 잡아서 어디에 두는지까지 본다 — install.js가 읽는 자리와 맞아야 한다.
  if (!/__bip/.test(head[1])) return '<head>가 설치 이벤트를 window.__bip에 담지 않는다';

  const fns = ['installMode', 'installCopy', 'runInstallPrompt', 'isStandalone', 'setupInstallBanner'];
  const notUsed = fns.filter((f) => !app.includes(f));
  return notUsed.length === 0 || 'app.js가 쓰지 않는 함수: ' + notUsed.join(', ');
});

check('★ 자료 화면 머리줄이 다른 화면과 섞이지 않는다', () => {
  // ☰를 오른쪽 끝에 두려면 flex 배치가 필요한데, .section-head는 달력·우리반·
  // 기도 화면이 함께 쓰는 class다. 거기에 배치를 주면 세 화면이 같이 바뀐다.
  const lib = codeOnly(read(path.join(JS, 'view-library.js')));
  const css = read(path.join(WEB, 'css', 'app.css'));

  if (!/class="lib-head"/.test(lib)) return 'view-library가 .lib-head를 쓰지 않는다';
  if (/lib-menu[\s\S]{0,200}class="section-head"/.test(lib) ||
      /class="section-head"[\s\S]{0,200}lib-menu/.test(lib)) {
    return '자료 머리줄이 아직 .section-head를 쓴다 — 다른 화면까지 바뀐다';
  }
  const head = /\.lib-head\s*\{([^}]*)\}/.exec(css);
  if (!head) return 'app.css에 .lib-head 규칙이 없다';
  if (!/display\s*:\s*flex/.test(head[1])) return '.lib-head가 flex가 아니다 — ☰가 왼쪽에 몰린다';

  // ★ 스크롤해도 남아 있어야 한다 (2026-07-31 2차 신고: "자료를 스크롤해서 올리면
  //   선택하는 메뉴가 같이 올라가서 안 보이게 돼"). 이 줄에 ☰가 있어서, 사라지면
  //   다른 자료로 갈 방법이 없어진다.
  if (!/position\s*:\s*sticky/.test(head[1])) {
    return '.lib-head가 sticky가 아니다 — 스크롤하면 ☰가 사라져 다른 자료로 갈 수 없다';
  }
  // 탭 줄 높이만큼 내려와야 한다. 0이면 탭 줄에 가려 반쯤 숨는다.
  if (!/top\s*:[^;]*--topnav-h/.test(head[1])) {
    return '.lib-head의 top이 탭 줄 높이(--topnav-h)를 쓰지 않는다 — 탭에 가린다';
  }
  // 배경이 없으면 본문이 이 줄 뒤로 비쳐 지나간다.
  if (!/background\s*:/.test(head[1])) return '.lib-head에 배경색이 없다 — 본문이 뒤로 비친다';

  // --topnav-h는 탭 수(3·4·5)와 글자 크기에 따라 달라진다. 실제로 재야 한다.
  const app2 = codeOnly(read(path.join(JS, 'app.js')));
  if (!/setProperty\s*\(\s*['"]--topnav-h['"]/.test(app2)) {
    return 'app.js가 --topnav-h를 실측해 넣지 않는다 — 탭 수가 바뀌면 틈이 벌어진다';
  }

  // 제목이 남는 폭을 다 먹어야 ☰가 오른쪽 끝으로 밀린다.
  const title = /\.lib-head-title\s*\{([^}]*)\}/.exec(css);
  if (!title || !/flex\s*:\s*1/.test(title[1])) {
    return '.lib-head-title에 flex:1이 없다 — ☰가 오른쪽 끝으로 가지 않는다';
  }
  return true;
});

check('★ 자료 ☰ 시트가 좌우 2단이고 각 단이 따로 스크롤된다', () => {
  const lib = codeOnly(read(path.join(JS, 'view-library.js')));
  const css = read(path.join(WEB, 'css', 'app.css'));

  // ★ CSS만으로는 안 된다. 제목·버튼이 평면으로 나열된 상태에서 부모에 grid를
  //   주면 그 전부가 좌우로 «번갈아» 꽂힌다. 두 단을 감싸는 래퍼가 필수다.
  const cols = (lib.match(/class="nav-col"/g) || []).length;
  if (cols !== 2) return 'view-library의 .nav-col 래퍼가 ' + cols + '개다 (2개여야 좌우로 갈린다)';

  const sheet = /\.nav-sheet\s*\{([^}]*)\}/.exec(css);
  if (!sheet) return 'app.css에 .nav-sheet 규칙이 없다';
  if (!/grid-template-columns/.test(sheet[1])) return '.nav-sheet가 2단이 아니다';
  // 높이 상한이 없으면 각 단이 내용만큼 늘어나 시트 전체가 스크롤된다.
  if (!/max-height/.test(sheet[1])) return '.nav-sheet에 max-height가 없다 — 단별 스크롤이 동작하지 않는다';

  const body = /\.nav-col-body\s*\{([^}]*)\}/.exec(css);
  if (!body) return 'app.css에 .nav-col-body 규칙이 없다';
  if (!/overflow-y\s*:\s*auto/.test(body[1])) return '.nav-col-body가 스크롤되지 않는다';
  // grid 자식의 기본 min-height:auto 때문에 이것이 없으면 줄어들지 않는다.
  if (!/min-height\s*:\s*0/.test(body[1])) return '.nav-col-body에 min-height:0이 없다 — 단별 스크롤이 동작하지 않는다';
  return true;
});

check('★ 화면·탭을 옮기면 맨 위에서 시작한다', () => {
  // 탭은 «다른 페이지»다. 옮겼는데 앞 화면의 스크롤 위치가 남아 있으면
  // 내용이 중간부터 보여 «화면이 안 바뀐 것»처럼 읽힌다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  if (!/function\s+scrollToTop\s*\(/.test(app)) return 'scrollToTop 정의가 없다';

  // ★ 정의부(`function scrollToTop()`)를 먼저 지우고 센다.
  //   그러지 않으면 정의부가 호출 1건으로 잡혀, 실제 호출이 하나 빠져도
  //   개수가 맞아 검사가 통과해 버린다 (이 규칙을 돌연변이 검증하다 발견).
  const body = app.replace(/function\s+scrollToTop\s*\(\s*\)/g, 'FN_DEF');

  // show()와 renderTab() **각각**에서 불려야 한다. 총 개수만 세면 한쪽에
  // 두 번 불러도 통과하므로 함수별로 확인한다.
  const fnBody = (name) => {
    const m = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(body);
    if (!m) return null;
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') { depth--; if (depth === 0) return body.slice(m.index, i + 1); }
    }
    return null;
  };

  const missing = ['show', 'renderTab'].filter((name) => {
    const b = fnBody(name);
    return !b || !/scrollToTop\(\)/.test(b);
  });
  return missing.length === 0 ||
    'scrollToTop을 부르지 않는 함수: ' + missing.join(', ') + ' — 화면 전환과 탭 전환 모두에서 불러야 한다';
});

check('★ 호출하는 함수가 실제로 정의되어 있다 (편집 사고 방지)', () => {
  // 리팩터링 중 블록을 잘라내다 함수가 통째로 사라져도 구문 검사는 통과한다
  // (실제로 발생: failToLogin이 삭제됐는데 모든 검사가 PASS였다).
  // 파일 안에서 호출하는 지역 함수가 정의되어 있는지 확인한다.
  const problems = [];
  fs.readdirSync(JS).filter((f) => f.endsWith('.js') && f !== 'mccheyne-plan.js').forEach((f) => {
    const src = codeOnly(read(path.join(JS, f)));
    const defined = new Set();
    let m;
    const defRe = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
    while ((m = defRe.exec(src))) defined.add(m[1]);
    const constRe = /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = constRe.exec(src))) defined.add(m[1]);
    // 함수 매개변수도 «정의된 이름»이다. 빠뜨리면 콜백 인자(onReady 등)가 오탐된다.
    const paramRe = /(?:function\s*[A-Za-z_$][\w$]*\s*\(([^)]*)\)|function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>)/g;
    while ((m = paramRe.exec(src))) {
      const list = m[1] || m[2] || m[3] || '';
      list.split(',').forEach((x) => {
        const n = x.trim().split(/[=\s]/)[0].replace(/[{}[\].]/g, '');
        if (n) defined.add(n);
      });
    }
    const importRe = /import\s*(?:\*\s*as\s*([A-Za-z_$][\w$]*)|\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*from/g;
    while ((m = importRe.exec(src))) {
      if (m[1]) defined.add(m[1]);
      if (m[2]) m[2].split(',').forEach((x) => defined.add(x.trim().split(/\s+as\s+/).pop().trim()));
      if (m[3]) defined.add(m[3]);
    }
    // 호출 지점: `이름(` 형태 중 `.`으로 이어지지 않은 것만
    const callRe = /(?:^|[^.\w$])([a-z_$][\w$]*)\s*\(/g;
    const BUILTIN = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
      'require', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean',
      'atob', 'btoa', 'decodeURIComponent', 'encodeURIComponent', 'alert', 'confirm',
    ]);
    while ((m = callRe.exec(src))) {
      const name = m[1];
      if (BUILTIN.has(name) || defined.has(name)) continue;
      problems.push(f + ':' + name);
    }
  });
  const uniq = Array.from(new Set(problems));
  return uniq.length === 0 || '정의되지 않은 호출: ' + uniq.join(', ');
});

// --- 5) 모듈 그래프 ---------------------------------------------------------
console.log('\n--- 모듈·자산 참조 ---');
check('모든 상대 import 경로가 실재한다', () => {
  const broken = [];
  fs.readdirSync(JS).filter((f) => f.endsWith('.js')).forEach((f) => {
    const s = read(path.join(JS, f));
    const re = /from\s+'(\.\/[^']+)'/g;
    let m;
    while ((m = re.exec(s))) {
      if (!fs.existsSync(path.join(JS, m[1]))) broken.push(f + ' -> ' + m[1]);
    }
  });
  return broken.length === 0 || broken.join(', ');
});

check('index.html이 참조하는 로컬 파일이 실재한다', () => {
  const html = read(path.join(WEB, 'index.html'));
  const refs = [];
  const re = /(?:src|href)="(?!https?:|#)([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(WEB, r)));
  return missing.length === 0 || '없음: ' + missing.join(', ');
});

check('manifest가 참조하는 아이콘이 실재한다', () => {
  const mf = JSON.parse(read(path.join(WEB, 'manifest.webmanifest')));
  const missing = mf.icons.map((i) => i.src).filter((s, i, a) => a.indexOf(s) === i)
    .filter((s) => !fs.existsSync(path.join(WEB, s)));
  return missing.length === 0 || '없음: ' + missing.join(', ');
});

check('참고자료 index.json의 파일이 모두 실재한다', () => {
  const idx = JSON.parse(read(path.join(WEB, 'data', 'index.json')));
  const missing = idx.map((e) => e.file).filter((f) => !fs.existsSync(path.join(WEB, 'data', f)));
  return missing.length === 0 || '없음: ' + missing.join(', ');
});

// --- 6) 문법 --------------------------------------------------------------
console.log('\n--- 문법 ---');
check('모든 web/js 파일이 구문 오류 없이 파싱된다', () => {
  const bad = [];
  fs.readdirSync(JS).filter((f) => f.endsWith('.js')).forEach((f) => {
    const s = read(path.join(JS, f));
    if (f === 'mccheyne-plan.js') {
      try { new Function(s); } catch (e) { bad.push(f + ': ' + e.message); }
      return;
    }
    // ES module은 Function으로 못 만드므로 import/export를 지운 뒤 확인한다.
    // export 키워드만 떼어낸다 — 'export async function', 'export default' 등
    // 모든 형태를 다루려면 뒤에 오는 토큰을 열거하지 않는 편이 안전하다.
    const stripped = s
      .replace(/^\s*import[\s\S]*?;$/gm, '')
      .replace(/^\s*export\s*\{[^}]*\}\s*;?$/gm, '')
      .replace(/^(\s*)export\s+default\s+/gm, '$1')
      .replace(/^(\s*)export\s+/gm, '$1');
    try { new Function(stripped); } catch (e) { bad.push(f + ': ' + e.message); }
  });
  return bad.length === 0 || bad.join(' | ');
});

// ---------------------------------------------------------------------------
// v1.4 — 로그인 흐름 (2026-08-02 실사용 신고 2건)
//   ① "로그인하면 로그인 페이지가 다시 나오고, 다시 로그인해야 들어가진다"
//   ② "새로고침하면 다시 로그인하라고 뜬다"
// ---------------------------------------------------------------------------

/** 소스에서 함수 하나의 본문을 통째로 잘라낸다(중괄호 균형). 없으면 null. */
function fnBodyOf(src, name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(src);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  return null;
}

check('★ 로그인 진행 중에 화면이 즉시 바뀐다 (신고 ①)', () => {
  // 구글 콜백 뒤 앱 화면까지 서버 왕복이 2~4번(실측 회당 1.3~2.0초) 있다.
  // 그동안 로그인 화면을 그대로 두면 «실패했다»로 읽혀 사용자가 다시 누른다.
  // 그래서 whoami를 **부르기 전에** 화면이 바뀌어 있어야 한다 — 순서가 핵심이다.
  const html = read(path.join(WEB, 'index.html'));
  if (!/id="screen-loading"/.test(html)) return 'index.html에 #screen-loading이 없다';
  if (!/id="loading-desc"/.test(html)) return '#loading-desc(진행 문구)가 없다';
  // 응답이 오지 않을 때 갇히지 않을 탈출구.
  if (!/id="loading-back"/.test(html)) return '#loading-back(되돌아가기)이 없다';

  const app = codeOnly(read(path.join(JS, 'app.js')));
  if (!/SCREENS\s*=\s*\[[^\]]*'screen-loading'/.test(app)) {
    return "show()가 다루는 화면 목록에 'screen-loading'이 없다 — 다른 화면으로 가도 안 감춰진다";
  }
  const body = fnBodyOf(app, 'afterSignIn');
  if (!body) return 'afterSignIn을 찾지 못함';
  const atLoading = body.indexOf('showLoading(');
  const atCall = body.indexOf("api.call('whoami'");
  if (atLoading < 0) return 'afterSignIn이 showLoading()을 부르지 않는다';
  if (atCall < 0) return "afterSignIn에서 api.call('whoami')를 찾지 못함";
  return atLoading < atCall ||
    'showLoading()이 whoami 호출보다 뒤에 있다 — 기다리는 동안 로그인 화면이 그대로 남는다';
});

check('★ 로그인 흐름이 겹쳐 돌지 않는다 (신고 ①)', () => {
  // 자동 로그인·One Tap·버튼 클릭에서 콜백이 각각 올 수 있다. 겹치면 서버 왕복이
  // 두 벌 돌고 늦게 끝난 쪽이 화면을 덮어쓴다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'afterSignIn');
  if (!body) return 'afterSignIn을 찾지 못함';
  if (!/if\s*\(\s*signingIn\s*\)\s*return/.test(body)) {
    return 'afterSignIn에 진행 중 가드(if (signingIn) return)가 없다';
  }
  if (!/signingIn\s*=\s*true/.test(body)) return 'signingIn을 true로 세우지 않는다';
  // ★ 이 검사가 진짜다. finally가 없으면 예외 한 번에 이후 모든 로그인이
  //   조용히 무시된다 — 사용자에게는 «버튼을 눌러도 아무 반응이 없다»가 된다.
  const fin = /finally\s*\{[\s\S]*?signingIn\s*=\s*false/.test(body);
  if (!fin) return 'signingIn을 finally에서 풀지 않는다 — 예외가 나면 영영 잠긴다';

  // 20초 «돌아가기»로 흐름을 버려도 fetch는 취소되지 않는다. 늦게 도착한 응답이
  // renderApp()을 불러 방금 돌아온 로그인 화면을 덮어쓰는 것을 막아야 한다.
  // (loadMyData의 owner 검사로는 못 막는다 — 세션 email이 그대로다)
  if (!/seq\s*=\s*\+\+\s*signInSeq/.test(body)) return 'afterSignIn이 흐름 세대(signInSeq)를 잡지 않는다';
  const awaits = (body.match(/await\s/g) || []).length;
  const guards = (body.match(/if\s*\(\s*abandoned\(\)\s*\)\s*return/g) || []).length;
  return guards >= awaits ||
    'await ' + awaits + '곳 중 버려짐 검사는 ' + guards + '곳뿐 — 버려진 흐름이 화면을 덮어쓴다';
});

check('★ 자동 로그인은 앱을 켤 때만 켠다 (신고 ② / 불변식 7)', () => {
  // 새로고침해도 다시 로그인하지 않게 하되, **로그아웃 직후에는 절대 켜지지 않아야**
  // 한다. 켜지면 방금 로그아웃한 사람이 즉시 다시 로그인되어, 공용 휴대폰에서
  // 계정을 끊을 수단이 사라진다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const auth = codeOnly(read(path.join(JS, 'auth.js')));

  // auth.js는 opts로 받아 그대로 GIS에 넘긴다. 상수 true를 박으면 안 된다.
  if (/auto_select\s*:\s*true/.test(auth)) {
    return 'auth.js가 auto_select를 항상 true로 박았다 — 로그아웃 뒤에도 자동 로그인된다';
  }
  if (!/auto_select\s*:\s*autoSelect/.test(auth)) return 'auth.js가 auto_select를 인자로 받지 않는다';

  // ★ button_auto_select는 켜면 안 된다 (계약 §6.4).
  //   구글이 보장하는 조건이 auto_select와 다르다 — «승인된 계정이 하나뿐일 때»라는
  //   단서가 없어서, 앞사람이 로그아웃하지 않고 앱을 닫았을 때 다음 사람이
  //   **자기 계정으로 들어가려고 버튼을 눌러도** 계정 선택창 없이 앞사람 계정으로 들어간다.
  if (/button_auto_select\s*:\s*(?!false)/.test(auth)) {
    return 'button_auto_select를 켰다 — 공용 휴대폰에서 앞사람 계정으로 들어가는 문이 된다';
  }
  if (!/\.prompt\(\)/.test(auth)) return 'prompt() 호출이 없다 — initialize()만으로는 자동 로그인이 일어나지 않는다';

  // app.js에서 autoSelect:true를 넘기는 곳은 start() **한 곳뿐**이어야 한다.
  const trues = (app.match(/autoSelect\s*:\s*true/g) || []).length;
  if (trues !== 1) return 'autoSelect:true를 넘기는 곳이 ' + trues + '곳 — start() 한 곳이어야 한다';
  const start = fnBodyOf(app, 'start');
  if (!start) return 'start()를 찾지 못함';
  if (!/autoSelect\s*:\s*true/.test(start)) return 'autoSelect:true가 start() 밖에 있다';

  // 로그아웃·세션만료 복귀 경로가 renderLogin()을 인자 없이 부르는지 확인한다.
  const back = fnBodyOf(app, 'backToLogin');
  if (!back) return 'backToLogin()을 찾지 못함';
  return /renderLogin\(\s*\)/.test(back) ||
    'backToLogin이 renderLogin()에 인자를 넘긴다 — 로그아웃 직후 자동 로그인될 수 있다';
});

check('★ 로그아웃이 구글 자동 로그인을 끈다 (불변식 7)', () => {
  // disableAutoSelect()는 구글 쪽에 «이 사용자는 로그아웃했다»를 남긴다.
  // 이게 빠지면 로그아웃 후 새로고침만으로 같은 계정이 되살아난다.
  const auth = codeOnly(read(path.join(JS, 'auth.js')));
  const body = fnBodyOf(auth, 'signOut');
  if (!body) return 'signOut()을 찾지 못함';
  return /disableAutoSelect\(\)/.test(body) ||
    'signOut()이 disableAutoSelect()를 부르지 않는다';
});

check('★ 로그인 정보를 기기에 저장하지 않는다 (불변식 7)', () => {
  // 신고 ②를 «토큰을 localStorage에 저장»으로 푸는 것이 가장 쉬운 유혹이다.
  // 그러면 가족이 공유하는 휴대폰에서 앞사람 계정으로 앱이 열린다.
  const offenders = ['auth.js', 'api.js', 'app.js'].filter((f) => {
    const s = codeOnly(read(path.join(JS, f)));
    return /localStorage|sessionStorage|indexedDB|document\.cookie/.test(s);
  });
  return offenders.length === 0 ||
    '기기 저장소를 쓰는 파일: ' + offenders.join(', ') + ' — 자동 로그인은 구글 auto_select로 푼다';
});

// ---------------------------------------------------------------------------
// v1.5 — 로그인 흐름의 계정 혼선 + 가입 화면 (2026-08-02 신고·검토)
// ---------------------------------------------------------------------------

check('★ 한 로그인 흐름은 한 계정 토큰으로만 나간다 (계약 §6.5)', () => {
  // 신고된 결함: whoami는 A 계정, 기록 조회는 B 계정 토큰으로 나가
  // «가입한 적 없는 계정인데 등록되지 않은 계정입니다»가 떴다.
  const apiSrc = codeOnly(read(path.join(JS, 'api.js')));
  const callBody = fnBodyOf(apiSrc, 'call');
  if (!callBody) return 'api.call을 찾지 못함';

  // ★ 검사가 있는 것만으로는 부족하다 — **요청을 만들기 전에** 있어야 한다.
  //   뒤에 두면 이미 남의 토큰이 실린 요청이 나간 뒤다.
  const atGuard = callBody.indexOf('options.epoch');
  const atSend = callBody.search(/postSafe\(|post\(/);
  if (atGuard < 0) return 'api.call에 세대(epoch) 대조가 없다';
  if (atSend >= 0 && atGuard > atSend) return '세대 대조가 요청 전송보다 뒤에 있다';
  if (!/sessionEpoch/.test(apiSrc)) return 'sessionEpoch가 없다';
  if (!/export function getSessionEpoch/.test(apiSrc)) return 'getSessionEpoch를 내보내지 않는다';

  // load.js의 **모든** api.call이 세대를 넘겨야 한다. 하나만 빠져도 그 요청이 샌다.
  const loadSrc = codeOnly(read(path.join(JS, 'load.js')));
  const calls = loadSrc.match(/api\.call\([^;]*?\)/g) || [];
  const without = calls.filter((c) => !/epoch/.test(c));
  if (calls.length === 0) return 'load.js에서 api.call을 찾지 못함';
  return without.length === 0 ||
    'load.js의 api.call ' + calls.length + '곳 중 ' + without.length + '곳이 세대를 안 넘긴다';
});

check('★ 로그인 흐름은 첫 요청 전에 세대를 잡는다 (계약 §6.5)', () => {
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'afterSignIn');
  if (!body) return 'afterSignIn을 찾지 못함';
  // submitRegister 쪽과 같은 이유로 «대입»을 본다 (아래 주석 참조).
  const atEpoch = body.search(/const\s+epoch\s*=\s*api\.getSessionEpoch\(\)/);
  const atAwait = body.indexOf('await ');
  if (atEpoch < 0) return 'afterSignIn의 epoch가 api.getSessionEpoch()에서 나오지 않는다';
  if (atAwait >= 0 && atEpoch > atAwait) {
    return '세대를 첫 await 뒤에 잡는다 — 이미 다른 계정으로 바뀐 뒤일 수 있다';
  }
  // [^)]* 로 쓰면 안 된다 — 인자로 들어가는 auth.todayStr()의 닫는 괄호에서 멈춘다.
  if (!/loadMyData\([^;]*epoch/.test(body)) return 'afterSignIn이 loadMyData에 세대를 넘기지 않는다';

  // ★ 가입도 같은 규칙을 따라야 한다. 예전에는 이 검사가 afterSignIn만 봐서,
  //   submitRegister가 규칙 밖에 있는 것을 잡지 못했다
  //   (2026-08-02 검토자 에이전트가 실행으로 재현).
  const reg = fnBodyOf(app, 'submitRegister');
  if (!reg) return 'submitRegister를 찾지 못함';
  // ★ «어딘가에 getSessionEpoch가 있는가»로는 부족하다 — stale() 같은 헬퍼가
  //   그 낱말을 갖고 있으면, 정작 넘기는 값을 undefined로 바꿔도 통과한다.
  //   (api.call은 epoch가 undefined면 검사를 통째로 건너뛴다 → 방어가 꺼진다)
  //   **세대 변수가 실제로 getSessionEpoch()에서 나오는지** 본다.
  const rEpoch = reg.search(/const\s+epoch\s*=\s*api\.getSessionEpoch\(\)/);
  const rAwait = reg.indexOf('await ');
  if (rEpoch < 0) return 'submitRegister의 epoch가 api.getSessionEpoch()에서 나오지 않는다';
  if (rAwait >= 0 && rEpoch > rAwait) {
    return 'submitRegister가 세대를 첫 await 뒤에 잡는다 — 이미 계정이 바뀐 뒤일 수 있다';
  }
  // register 호출과 loadMyData **둘 다** 세대를 받아야 한다.
  // ★ /api\.call\('register'[\s\S]*?epoch/ 로 쓰면 안 된다 — 호출 인자에서 세대를
  //   빼도 함수 뒷부분의 loadMyData(…, epoch)에 걸려 통과한다(돌연변이 검증에서 발견).
  //   **그 호출의 인자 범위 안**만 본다.
  const at = reg.indexOf("api.call('register'");
  if (at < 0) return "submitRegister에서 api.call('register')를 찾지 못함";
  const end = reg.indexOf(');', at);
  const regCall = end < 0 ? reg.slice(at) : reg.slice(at, end);
  if (!/epoch/.test(regCall)) return 'register 호출에 세대를 넘기지 않는다';
  if (!/loadMyData\([^;]*epoch\s*\)/.test(reg)) return 'submitRegister가 loadMyData에 세대를 넘기지 않는다';
  // ★ 요청에 «그 자리에서 다시 읽은» 세대를 넘기면 보호가 무의미하다 —
  //   기다리는 사이 계정이 바뀌었다면 바뀐 뒤의 세대를 잡게 된다.
  //   («지금 세대가 처음과 다른가»를 비교하려고 다시 읽는 것은 정상이므로,
  //    호출 횟수를 세는 대신 **요청 인자로 들어가는지**만 본다)
  if (/loadMyData\([^;]*getSessionEpoch/.test(reg) ||
      /api\.call\('register'[\s\S]*?\}\s*,\s*\{[^}]*getSessionEpoch/.test(reg)) {
    return 'submitRegister가 요청에 세대를 그 자리에서 다시 읽어 넘긴다';
  }
  return true;
});

check('★ 나중에 온 구글 계정이 이긴다 (계약 §6.5)', () => {
  // 겹쳐 온 콜백을 그냥 버리면, auth.js가 이미 갈아끼운 새 토큰으로 옛 흐름이
  // 남은 요청을 보낸다. 사용자가 방금 고른 계정으로 다시 시작해야 한다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const auth = codeOnly(read(path.join(JS, 'auth.js')));
  if (!/onSignedIn\(\s*email\s*\)/.test(auth)) {
    return 'auth.js가 콜백에 계정(email)을 넘기지 않는다 — 같은 계정인지 판단할 수 없다';
  }
  if (!/onSignedIn\(\s*APP_CONFIG\.MOCK\s*\)/.test(auth)) {
    return 'MOCK 경로가 계정을 넘기지 않는다 (개발 화면만 다르게 동작한다)';
  }
  const body = fnBodyOf(app, 'onCredential');
  if (!body) return 'onCredential이 없다';
  if (!/signingInEmail/.test(body)) return '같은 계정인지 비교하지 않는다';
  if (!/signInSeq\s*\+=\s*1/.test(body)) return '다른 계정일 때 옛 흐름을 버리지 않는다';
  return /initGis\([^)]*onCredential/.test(app) || 'initGis에 onCredential을 넘기지 않는다';
});

check('★ 버려진 흐름이 정상 화면 위에 오류를 덧씌우지 않는다', () => {
  // afterSignIn에서 «버려짐 검사»가 failToLogin보다 **먼저** 와야 한다.
  // 순서가 뒤집히면 버려진 흐름의 stale_session이 새 흐름의 앱 화면을 덮는다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'afterSignIn');
  if (!body) return 'afterSignIn을 찾지 못함';
  const atAbandon = body.indexOf('if (abandoned()) return;\n      if (!loaded.ok)');
  if (atAbandon >= 0) return true;
  // 공백이 달라졌을 수 있으니 느슨하게 한 번 더 본다.
  const m = /if\s*\(abandoned\(\)\)\s*return;\s*if\s*\(!loaded\.ok\)/.test(body.replace(/\s+/g, ' ')
    .replace(/if \(abandoned\(\)\) return; if \(!loaded\.ok\)/, 'if (abandoned()) return; if (!loaded.ok)'));
  return m || 'loadMyData 뒤에서 버려짐 검사가 failToLogin보다 먼저 오지 않는다';
});

check('★ 무관한 오류가 진행 중인 로그인을 취소하지 않는다', () => {
  // showUnexpected는 window의 **모든** error/unhandledrejection을 받는다
  // (확장프로그램 오류 포함). 여기서 흐름을 버리거나 화면을 갈아엎으면
  // 멀쩡한 로그인이 취소되어 「두 번 로그인해야 한다」가 되살아난다 —
  // v1.4.0이 고친 바로 그 신고다. 대신 «갇히지 않게»만 보장한다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'showUnexpected');
  if (!body) return 'showUnexpected를 찾지 못함';
  const touches = [
    [/signInSeq/, '흐름 세대(signInSeq)'],
    [/signingIn\s*=/, '진행 중 잠금(signingIn)'],
    [/show\('screen-login'\)/, '화면 전환(show)'],
  ].filter(([re]) => re.test(body)).map(([, name]) => name);
  if (touches.length) {
    return 'showUnexpected가 로그인 흐름을 건드린다: ' + touches.join(', ') +
      ' — 무관한 오류 하나로 정상 로그인이 취소된다';
  }
  // 대신 갇히지 않을 출구는 반드시 있어야 한다.
  if (!/offerEscape\(\)/.test(body)) {
    return '로딩 화면에서 탈출 버튼을 내주지 않는다(offerEscape 호출 없음) — 오류가 나면 그 화면에 갇힌다';
  }

  // ★ 여기까지는 «내주는가»만 본다. 예전에는 이 검사가 «loading-back이라는 글자가
  //   있는가»뿐이어서, 내주자마자 showLoading이 도로 감추는 것을 놓쳤다
  //   (2026-08-02 검토자 에이전트가 브라우저 재현으로 지적).
  //   showLoading은 한 흐름에서 두 번 불리므로, «이미 내줬으면 감추지 않는다»가
  //   함께 있어야 실제로 보장된다.
  const offer = fnBodyOf(app, 'offerEscape');
  if (!offer || !/escapeOffered\s*=\s*true/.test(offer)) {
    return 'offerEscape가 «내줬다»를 기록하지 않는다';
  }
  const loading = fnBodyOf(app, 'showLoading');
  if (!loading) return 'showLoading을 찾지 못함';
  if (!/if\s*\(escapeOffered\)\s*return/.test(loading)) {
    return 'showLoading이 escapeOffered를 보지 않는다 — 내준 탈출구를 다음 단계에서 도로 감춘다';
  }
  // 감추는 문장이 그 가드보다 **뒤에** 있어야 한다.
  return loading.indexOf('if (escapeOffered) return') < loading.indexOf('back.hidden = true') ||
    'back.hidden = true가 escapeOffered 가드보다 앞에 있다 — 가드가 무력하다';
});

check('★ 로드 실패 화면에 계정을 바꿀 수단이 있다 (막다른 골목 방지)', () => {
  // 실패 코드가 만료 계열이 아니면(unauthorized·forbidden·deactivated·server_error)
  // app:session-expired가 뜨지 않아 renderLogin()이 다시 불리지 않는다.
  // 이 화면에는 구글 로그인 버튼이 없으므로 «다시 시도 → 또 실패»만 반복되고
  // 로그아웃도 계정 전환도 못 한다. 공용 휴대폰에서 뒷사람이 들어올 방법이 없어진다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'failToLogin');
  if (!body) return 'failToLogin을 찾지 못함';
  if (!/holder\.innerHTML\s*=\s*''/.test(body)) return true; // 버튼을 지우지 않는다면 해당 없음
  return /signOut\(\)/.test(body) ||
    '로그인 버튼을 지우면서 로그아웃·계정전환 수단을 두지 않았다 — 새로고침 말고 빠져나갈 길이 없다';
});

check('★ 분류를 바꾸면 가운데 칸을 비운다 (가입 검토 ①)', () => {
  // 학생으로 «중2-1»을 적고 학부모로 바꾸면 시트 «자녀이름» 열에 «중2-1»이 저장됐다.
  // 서버는 이걸 막을 수 없다 — 세 분류 모두 자유 텍스트라 값만 보고 구분이 안 된다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'setKind');
  if (!body) return 'setKind를 찾지 못함';
  if (!/#reg-extra'\)\.value\s*=\s*''/.test(body)) {
    return 'setKind가 #reg-extra를 비우지 않는다 — 앞 분류의 값이 다른 열에 저장된다';
  }
  // ★ 「changed라는 낱말이 어딘가 있는가」로는 부족하다 — 조건을 떼어내고
  //   변수만 남겨도 통과해 버린다(이 규칙을 돌연변이 검증하다 발견).
  //   **비우는 그 문장이** changed로 감싸여 있는지 본다. 무조건 비우면
  //   같은 분류를 다시 누른 사용자가 적던 내용을 잃는다.
  return /if\s*\(\s*changed\s*\)[^\n]*#reg-extra'\)\.value\s*=\s*''/.test(body) ||
    '#reg-extra를 비우는 문장이 «분류가 바뀌었을 때»로 감싸여 있지 않다';
});

check('★ 빈 칸을 서버로 보내지 않는다 (가입 검토 ④)', () => {
  // 빈 코드 제출도 서버는 «틀린 코드»로 세어 백오프를 올린다. 전역 카운터가
  // 10분 20회라, 반 전체가 함께 가입할 때 시도도 안 한 사람까지 잠긴다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'submitRegister');
  if (!body) return 'submitRegister를 찾지 못함';
  const atName = body.search(/#reg-name'\)\.value[^;]*trim\(\)/);
  const atCode = body.search(/#reg-code'\)\.value[^;]*trim\(\)/);
  const atCall = body.indexOf("api.call('register'");
  if (atName < 0 || atCode < 0) return '이름·코드 빈칸 검사가 없다';
  if (atCall < 0) return "api.call('register')를 찾지 못함";
  return (atName < atCall && atCode < atCall) ||
    '빈칸 검사가 register 호출보다 뒤에 있다 — 이미 백오프를 소진한 뒤다';
});

check('★ 가입 성공 뒤 실패에 «등록되지 않은 계정»이라 하지 않는다 (가입 검토 ②)', () => {
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'submitRegister');
  if (!body) return 'submitRegister를 찾지 못함';
  if (/failToLogin\(/.test(body)) {
    return 'submitRegister가 failToLogin을 직접 부른다 — 방금 가입한 사람에게 ' +
      '「등록되지 않은 계정입니다」가 뜬다';
  }
  if (!/failAfterRegister\(/.test(body)) return '가입 직후 실패 처리가 없다';
  const fn = fnBodyOf(app, 'failAfterRegister');
  if (!fn) return 'failAfterRegister가 없다';
  return /가입은 완료/.test(fn) || '«가입은 완료되었습니다»를 먼저 말하지 않는다';
});

check('★ 가입 화면도 오류 코드를 함께 보여 준다 (가입 검토 ⑧)', () => {
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'submitRegister');
  if (!body) return 'submitRegister를 찾지 못함';
  return /#reg-error'\)\.textContent\s*=\s*api\.errorMessage\(res\.code\)\s*\+/.test(body) ||
    '가입 화면 오류에 코드가 병기되지 않는다 — docs/ops의 조치표를 찾아갈 수 없다';
});

check('★ 분류 선택 상태가 보조기기에 전달된다 (가입 검토 ⑤)', () => {
  const html = read(path.join(WEB, 'index.html'));
  const app = codeOnly(read(path.join(JS, 'app.js')));
  if (!/class="kind-choices"[^>]*role="group"/.test(html)) {
    return '.kind-choices에 role="group"이 없다';
  }
  const btns = (html.match(/id="reg-kind-\w+"[^>]*aria-pressed/g) || []).length;
  if (btns !== 3) return '분류 버튼 3개 중 aria-pressed 초기값이 있는 것은 ' + btns + '개';
  const body = fnBodyOf(app, 'setKind');
  return (body && /aria-pressed/.test(body)) || 'setKind가 aria-pressed를 갱신하지 않는다';
});

check('★ «다시 시도» 버튼이 영구 비활성으로 죽지 않는다', () => {
  // whoami가 EXPIRED가 아닌 코드(network_error 등)로 실패하면 #gis-button 홀더를
  // 다시 그리지 않는다. 그때 catch에서만 버튼을 풀면 disabled인 채로 남아
  // 회선이 복구돼도 눌리지 않는다 — 새로고침 말고 회복 수단이 없다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  const body = fnBodyOf(app, 'failToLogin');
  if (!body) return 'failToLogin을 찾지 못함';
  if (!/btn\.disabled\s*=\s*true/.test(body)) return true; // 비활성화하지 않으면 해당 없음
  return /\.then\(function \(\) \{ btn\.disabled = false; \}\)/.test(body) ||
    '재시도 버튼을 성공·실패 양쪽에서 풀지 않는다 (catch에서만 풀면 막다른 길이 된다)';
});

check('★ 오류가 없으면 가입 화면의 붉은 상자가 보이지 않는다 (가입 검토 ⑥)', () => {
  const css = read(path.join(WEB, 'css', 'app.css'));
  return /\.register-error:empty\s*\{[^}]*display\s*:\s*none/.test(css) ||
    '.register-error:empty 규칙이 없다 — 오류가 없어도 빈 붉은 띠가 늘 보인다';
});

check('★ 시트 열 이름과 화면 문구의 불일치가 코드에 명시돼 있다', () => {
  // 화면은 «혜림교회 소속부서», 시트 열은 «소속전도회»다(2026-08-02 사용자 결정).
  // 근거를 코드에 남기지 않으면 다음 사람이 «오타»로 보고 고쳐 실데이터를 깬다.
  const app = codeOnly(read(path.join(JS, 'app.js')));
  if (!/혜림교회 소속부서/.test(app)) return '가입 화면 문구가 «혜림교회 소속부서»가 아니다';
  const gas = path.join(ROOT, 'gas');
  const actions = read(path.join(gas, 'Actions.gs'));
  const auth2 = read(path.join(gas, 'Auth.gs'));
  const missing = [];
  if (!/의도된 것|의도된 불일치/.test(actions)) missing.push('gas/Actions.gs');
  if (!/의도된 불일치|의도된 것/.test(auth2)) missing.push('gas/Auth.gs');
  return missing.length === 0 ||
    '불일치가 의도임을 밝힌 주석이 없는 파일: ' + missing.join(', ');
});

check('소스에 제어문자가 리터럴로 박혀 있지 않다', () => {
  const bad = [];
  const dirs = [JS, path.join(WEB, 'css')];
  dirs.forEach((d) => {
    fs.readdirSync(d).forEach((f) => {
      const s = read(path.join(d, f));
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) { bad.push(f); return; }
      }
    });
  });
  return bad.length === 0 || bad.join(', ');
});

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
