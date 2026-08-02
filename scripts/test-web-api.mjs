#!/usr/bin/env node
// scripts/test-web-api.mjs — 프론트 API 계층의 **동작** 테스트.
//
// 왜 필요한가:
//   계약 §6.1 / CLAUDE.md 불변식 7(캐시 격리)은 이 앱에서 가장 개연성 높은 사고 경로다
//   — 가정에서 한 휴대폰을 학생과 학부모가 함께 쓴다. 그런데 지금까지 이 규칙은
//   check-web.mjs의 **정규식 검사**로만 담보되고 있었다. 정규식은 "코드에 그 글자가 있는가"를
//   볼 뿐 "실제로 격리되는가"는 보지 못하고, 의미가 같은 리팩터링에도 깨져 오탐을 낸다.
//   여기서는 실제로 A로 캐시를 채우고 B로 전환해 A의 데이터가 안 나오는지 확인한다.
//   (2026-07-30 최종 검토 [중대] 지적)
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

// --- 브라우저 전역 최소 스텁 (api.js가 참조하는 것만) ---
const events = [];
globalThis.window = {
  dispatchEvent(e) { events.push(e.type); },
};
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
}

let nextResponse = { ok: true, rows: [] };
let fetchCount = 0;
globalThis.fetch = async function () {
  fetchCount += 1;
  const body = nextResponse;
  return { ok: true, json: async () => body };
};

const api = await import('../web/js/api.js');

let pass = 0;
const failures = [];

function t(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then((r) => {
      if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
      failures.push(label + ' — ' + r);
      console.log('  [FAIL] ' + label + ' — ' + r);
    })
    .catch((e) => {
      failures.push(label + ' — ' + (e && e.message ? e.message : e));
      console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
    });
}

console.log('=== 프론트 API 동작 테스트 ===\n');

console.log('--- 캐시 기본 동작 ---');

await t('읽기 액션은 캐시된다 (같은 요청은 서버를 다시 부르지 않음)', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok-a');
  nextResponse = { ok: true, rows: ['A의 기도'] };
  const before = fetchCount;
  await api.call('getMyPrayers', {});
  const mid = fetchCount;
  await api.call('getMyPrayers', {});
  const after = fetchCount;
  return (mid === before + 1 && after === mid) || 'fetch 호출 ' + (after - before) + '회 (기대 1회)';
});

await t('noCache 옵션이면 캐시를 건너뛴다', async () => {
  const before = fetchCount;
  await api.call('getMyPrayers', {}, { noCache: true });
  return fetchCount === before + 1 || '캐시를 건너뛰지 않음';
});

console.log('\n--- ★ 계정 전환 격리 (가족 공용 기기) ---');

await t('★ 계정을 바꾸면 앞 사용자의 캐시가 나오지 않는다', async () => {
  api.clearSession();
  api.setSession('child@example.com', 'tok-child');
  nextResponse = { ok: true, rows: ['자녀의 기도제목'] };
  const first = await api.call('getMyPrayers', {});
  if (first.rows[0] !== '자녀의 기도제목') return '준비 실패';

  // 부모가 같은 폰에서 로그인
  api.setSession('parent@example.com', 'tok-parent');
  nextResponse = { ok: true, rows: ['부모의 기도제목'] };
  const second = await api.call('getMyPrayers', {});

  if (second.rows[0] === '자녀의 기도제목') return '★ 자녀 데이터가 부모에게 노출됨';
  return second.rows[0] === '부모의 기도제목' || '예상 밖: ' + JSON.stringify(second);
});

await t('★ 계정 전환 시 서버를 실제로 다시 부른다 (캐시 히트 아님)', async () => {
  api.clearSession();
  api.setSession('u1@example.com', 't1');
  nextResponse = { ok: true, rows: ['u1'] };
  await api.call('getMyRecords', { months: ['2026-07'] });
  const before = fetchCount;
  api.setSession('u2@example.com', 't2');
  nextResponse = { ok: true, rows: ['u2'] };
  await api.call('getMyRecords', { months: ['2026-07'] });
  return fetchCount === before + 1 || '계정 전환 후 캐시를 그대로 씀';
});

await t('★ 같은 계정으로 되돌아와도 이전 캐시가 되살아나지 않는다', async () => {
  api.clearSession();
  api.setSession('back@example.com', 't1');
  nextResponse = { ok: true, rows: ['옛날 값'] };
  await api.call('getMyPrayers', {});
  api.setSession('other@example.com', 't2');       // 전환 → 파기
  nextResponse = { ok: true, rows: ['남의 값'] };
  await api.call('getMyPrayers', {});
  api.setSession('back@example.com', 't3');        // 되돌아옴
  nextResponse = { ok: true, rows: ['새 값'] };
  const r = await api.call('getMyPrayers', {});
  return r.rows[0] === '새 값' || '되살아난 캐시: ' + JSON.stringify(r.rows);
});

await t('로그아웃(clearSession)하면 캐시가 비워진다', async () => {
  api.clearSession();
  api.setSession('x@example.com', 't');
  nextResponse = { ok: true, rows: ['x의 값'] };
  await api.call('getMyPrayers', {});
  api.clearSession();
  api.setSession('x@example.com', 't');            // 같은 사람이 다시 로그인
  nextResponse = { ok: true, rows: ['새로 받은 값'] };
  const r = await api.call('getMyPrayers', {});
  return r.rows[0] === '새로 받은 값' || '로그아웃 후에도 캐시가 남음';
});

console.log('\n--- 쓰기 후 무효화 ---');

await t('setRecord 후 getMyRecords 캐시가 무효화된다', async () => {
  api.clearSession();
  api.setSession('w@example.com', 't');
  nextResponse = { ok: true, rows: ['이전'] };
  await api.call('getMyRecords', { months: ['2026-07'] });
  nextResponse = { ok: true };
  await api.call('setRecord', { date: '2026-07-30', wordRead: true });
  nextResponse = { ok: true, rows: ['갱신됨'] };
  const r = await api.call('getMyRecords', { months: ['2026-07'] });
  return r.rows[0] === '갱신됨' || '무효화되지 않음: ' + JSON.stringify(r.rows);
});

await t('기도 쓰기 후 getMyPrayers 캐시가 무효화된다', async () => {
  api.clearSession();
  api.setSession('w2@example.com', 't');
  nextResponse = { ok: true, rows: ['이전'] };
  await api.call('getMyPrayers', {});
  nextResponse = { ok: true, id: 'P1' };
  await api.call('addPrayer', { text: '새 기도' });
  nextResponse = { ok: true, rows: ['새 기도'] };
  const r = await api.call('getMyPrayers', {});
  return r.rows[0] === '새 기도' || '무효화되지 않음';
});

console.log('\n--- 네트워크 실패 정규화 ---');

await t('★ fetch가 던지면 예외가 아니라 network_error 응답이 온다', async () => {
  // 이게 없으면 호출부(afterSignIn/loadMyData/달력/우리반)가 res.ok 분기를 타지 못하고
  // 처리되지 않은 rejection으로 사라져 **화면이 말없이 멈춘다.**
  // GAS를 '사용자로 실행'으로 잘못 배포했을 때 실제로 발생하는 경로다.
  api.clearSession();
  api.setSession('n@example.com', 't');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    const r = await api.call('whoami', {}, { noCache: true });
    if (r === undefined || r === null) return '응답이 없음(예외가 새어나감)';
    return (r.ok === false && r.code === 'network_error') || JSON.stringify(r);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('HTTP 오류 응답(500 등)도 network_error로 정규화된다', async () => {
  api.clearSession();
  api.setSession('n2@example.com', 't');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const r = await api.call('whoami', {}, { noCache: true });
    return (r && r.ok === false && r.code === 'network_error') || JSON.stringify(r);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('network_error 문구가 인터넷과 배포 설정을 함께 안내한다', () => {
  const m = api.errorMessage('network_error');
  return (m.indexOf('인터넷') >= 0 && m.indexOf('설정') >= 0) || m;
});

console.log('\n--- busy 재시도 (저녁 몰림 대비) ---');

await t('busy를 받으면 재시도해서 최종 성공을 돌려준다', async () => {
  // 저녁에 여러 명이 동시에 저장하면 서버 잠금 대기가 길어져 busy가 온다(계약 §4.2).
  // 사용자에게 오류를 보여주기 전에 앱이 스스로 두 번까지 다시 시도해야 한다.
  api.clearSession();
  api.setSession('b@example.com', 't');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const body = calls < 3 ? { ok: false, code: 'busy' } : { ok: true, saved: true };
    return { ok: true, json: async () => body };
  };
  try {
    const r = await api.call('setRecord', { date: '2026-07-30', wordRead: true });
    if (calls < 3) return '재시도하지 않음 (호출 ' + calls + '회)';
    return (r && r.ok === true) || '최종 결과가 성공이 아님: ' + JSON.stringify(r);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('busy가 계속되면 재시도를 멈추고 busy를 그대로 돌려준다 (무한 재시도 금지)', async () => {
  api.clearSession();
  api.setSession('b2@example.com', 't');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ ok: false, code: 'busy' }) };
  };
  try {
    const r = await api.call('setRecord', { date: '2026-07-30', wordRead: true });
    if (calls > 3) return '재시도가 3회를 넘음 (' + calls + '회)';
    return (r && r.code === 'busy') || JSON.stringify(r);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('busy 안내 문구가 사용자에게 이해되는 말이다', () => {
  const m = api.errorMessage('busy');
  return (m.indexOf('busy') < 0 && m.length > 5) || m;
});

console.log('\n--- 세션 만료 ---');

await t('token_expired면 세션을 버리고 이벤트를 쏜다', async () => {
  api.clearSession();
  api.setSession('e@example.com', 't');
  events.length = 0;
  nextResponse = { ok: false, code: 'token_expired' };
  const r = await api.call('whoami', {});
  if (r.code !== 'token_expired') return '코드 전달 실패';
  if (events.indexOf('app:session-expired') < 0) return '이벤트 미발생';
  return api.getSessionEmail() === null || '세션이 남아 있음';
});

await t('오류 메시지는 내부 코드를 그대로 노출하지 않는다', () => {
  const msg = api.errorMessage('server_error');
  return (msg.indexOf('server_error') < 0 && msg.length > 5) || '코드가 그대로 노출됨: ' + msg;
});

await t('모르는 코드에도 안내 문구를 준다', () => {
  const msg = api.errorMessage('완전히_새로운_코드');
  return (typeof msg === 'string' && msg.length > 5) || '빈 메시지';
});

// ---------------------------------------------------------------------------
// ★ 흐름 고정 (계약 §6.5) — 2026-08-02 신고의 근본 원인
//
// 정적 검사로는 «epoch라는 글자가 있는가»밖에 못 본다. 여기서는 실제로
// 흐름 도중에 계정을 갈아끼우고, **남의 토큰이 실린 요청이 나가지 않는지**
// 나간 요청 목록으로 확인한다.
// ---------------------------------------------------------------------------
console.log('\n--- ★ 로그인 흐름 고정 (계정 혼선 차단) ---');

// 나가는 요청의 토큰을 기록하도록 fetch 스텁을 확장한다.
const sentTokens = [];
const baseFetch = globalThis.fetch;
globalThis.fetch = async function (u, opts) {
  try { sentTokens.push(JSON.parse(opts.body).idToken); } catch (e) { sentTokens.push(null); }
  return baseFetch(u, opts);
};

await t('★ 흐름 도중 계정이 바뀌면 남의 토큰으로 요청하지 않는다', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A');
  const epoch = api.getSessionEpoch();

  nextResponse = { ok: true, rows: [] };
  sentTokens.length = 0;
  const first = await api.call('whoami', {}, { noCache: true, epoch: epoch });
  if (!first.ok) return '첫 요청이 실패했다';

  // 구글 콜백이 한 번 더 도착해 전역 토큰이 B로 바뀐 상황
  api.setSession('b@example.com', 'tok:B');

  const second = await api.call('getMyRecords', { months: ['2026-08'] }, { noCache: true, epoch: epoch });
  if (second.ok) return '세대가 어긋났는데 요청이 통과했다';
  if (second.code !== 'stale_session') return '코드가 stale_session이 아니다: ' + second.code;

  // ★ 이것이 핵심 — 요청 자체가 **나가지 않아야** 한다. 나갔다면 이미 B 토큰이 실렸다.
  if (sentTokens.indexOf('tok:B') >= 0) return 'B 계정 토큰이 실린 요청이 나갔다';
  return sentTokens.length === 1 || '보낸 요청 수가 1이 아니다: ' + sentTokens.length;
});

await t('★ 같은 계정의 새 토큰은 흐름을 끊지 않는다 (중복 클릭)', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A1');
  const epoch = api.getSessionEpoch();
  // 같은 사람이 한 번 더 눌러 새 토큰이 발급된 경우 — 흐름을 죽이면 안 된다.
  api.setSession('a@example.com', 'tok:A2');
  nextResponse = { ok: true, rows: [] };
  sentTokens.length = 0;
  const r = await api.call('getMyRecords', { months: ['2026-08'] }, { noCache: true, epoch: epoch });
  if (!r.ok) return '같은 계정인데 끊겼다: ' + r.code;
  return sentTokens[0] === 'tok:A2' || '더 새 토큰을 쓰지 않았다: ' + sentTokens[0];
});

await t('★ 로그아웃도 세대를 올려 진행 중이던 흐름을 끊는다', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A');
  const epoch = api.getSessionEpoch();
  api.clearSession();
  sentTokens.length = 0;
  const r = await api.call('getMyRecords', { months: ['2026-08'] }, { noCache: true, epoch: epoch });
  if (r.ok) return '로그아웃 뒤에도 요청이 통과했다';
  return sentTokens.length === 0 || '로그아웃 뒤에 요청이 나갔다';
});

// ★★ 2026-08-02 검토자 에이전트가 재현으로 잡은 [중대] 결함의 회귀 테스트.
//
// 세대 검사가 **함수 진입 시 1회뿐**이면 busy 재시도(1초·3초 대기)가 그 검사를
// 통째로 우회한다. 위의 «흐름 도중 계정이 바뀌면» 테스트는 재시도를 한 번도
// 태우지 않아 **통과하면서도 이 구멍을 놓쳤다** — 결함과 같은 모양의 구멍이
// 테스트에도 있었다. 그래서 여기서는 busy를 일부러 만들어 재시도를 태운다.
await t('★★ busy 재시도 중 계정이 바뀌어도 남의 토큰으로 재전송하지 않는다', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A');
  const epoch = api.getSessionEpoch();

  sentTokens.length = 0;
  // 첫 응답은 busy — 재시도 루프에 진입한다.
  nextResponse = { ok: false, code: 'busy' };
  const p = api.call('register', { name: 'A가입력한이름', kind: 'student' }, { epoch: epoch });

  // 백오프(1초) 대기 중에 다른 계정의 콜백이 도착해 전역 토큰이 B로 바뀐다.
  await new Promise(function (r) { setTimeout(r, 200); });
  api.setSession('b@example.com', 'tok:B');
  nextResponse = { ok: true, email: 'b@example.com' };   // 재전송이 나가면 «성공»해 버린다

  const res = await p;

  // ★ 핵심 — 재전송이 **나가지 않아야** 한다. 나갔다면 이미 시트에 B가 등재됐다.
  if (sentTokens.indexOf('tok:B') >= 0) {
    return 'B 계정 토큰으로 재전송됐다 (보낸 토큰: ' + JSON.stringify(sentTokens) + ')';
  }
  if (res.ok) return '세대가 어긋났는데 성공을 돌려줬다';
  return res.code === 'stale_session' || '코드가 stale_session이 아니다: ' + res.code;
});

await t('★★ 같은 계정이면 busy 재시도가 정상적으로 이어진다 (위 방어의 과잉 차단 방지)', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A');
  const epoch = api.getSessionEpoch();

  sentTokens.length = 0;
  nextResponse = { ok: false, code: 'busy' };
  const p = api.call('getMyRecords', { months: ['2026-08'] }, { noCache: true, epoch: epoch });
  await new Promise(function (r) { setTimeout(r, 200); });
  // 같은 사람의 새 토큰 — 끊으면 안 된다.
  api.setSession('a@example.com', 'tok:A2');
  nextResponse = { ok: true, rows: [] };

  const res = await p;
  if (!res.ok) return '같은 계정인데 재시도가 끊겼다: ' + res.code;
  return sentTokens.length >= 2 || '재시도가 실제로 일어나지 않아 검사가 무의미하다: ' +
    JSON.stringify(sentTokens);
});

await t('세대를 안 넘기면 예전처럼 그대로 동작한다 (하위호환)', async () => {
  api.clearSession();
  api.setSession('a@example.com', 'tok:A');
  nextResponse = { ok: true, rows: [] };
  const r = await api.call('getMyRecords', { months: ['2026-08'] }, { noCache: true });
  return r.ok || '세대 없이 부른 요청이 막혔다: ' + r.code;
});

globalThis.fetch = baseFetch;

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
