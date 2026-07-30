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

console.log('\n--- 세션 만료 / busy 재시도 ---');

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

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
