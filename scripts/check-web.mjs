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
    .split('\n')
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

check('setSession이 이메일 변경을 감지해 캐시를 비운다', () =>
  /currentEmail\s*&&\s*currentEmail\s*!==/.test(api) || 'api.setSession에 계정 전환 감지가 없음');

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
  const ids = ['screen-login', 'screen-register', 'screen-app'];
  const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
  return missing.length === 0 || 'index.html에 없는 화면: ' + missing.join(', ');
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
