#!/usr/bin/env node
// scripts/test-web-views.mjs — 화면 모듈의 **보안·상태 동작** 테스트.
//
// 왜 필요한가:
//   «세션 만료 시 입력 보존»(draft) 기능이 이 앱의 최상위 보안 규칙을 깨뜨릴 뻔했다.
//   draft를 소유자와 묶지 않으면, 가족이 공용 폰에서 계정을 바꿨을 때
//   **앞사람의 고백문이 뒷사람 화면에 복원되고 뒷사람 이름으로 저장된다**
//   (CLAUDE.md 보안 불변식 7 위반, 2026-07-30 3차 검토 지적).
//   문구나 정적 검사로는 이런 상태 전이를 잡을 수 없어 실제로 실행해 확인한다.
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

// --- 최소 DOM 스텁 (화면 모듈이 만지는 것만) ---------------------------------
const nodes = new Map();
const handlers = new Map();

function makeNode(id) {
  const classes = new Set();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    placeholder: '',
    selectionStart: 0,
    hidden: false,
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    setAttribute() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild() {},
    remove() {},
    focus() {},
    setSelectionRange() {},
    set onclick(fn) { handlers.set(this.id, fn); },
    get onclick() { return handlers.get(this.id); },
  };
}

function resetDom(ids) {
  nodes.clear();
  handlers.clear();
  ids.forEach((id) => nodes.set(id, makeNode(id)));
}

globalThis.document = {
  querySelector(sel) { return nodes.get(sel.replace('#', '')) || null; },
  querySelectorAll() { return []; },
  createElement: (t) => makeNode(t),
  body: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = { dispatchEvent() {}, addEventListener() {}, confirm: () => true };
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent { constructor(t) { this.type = t; } };
}
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, rows: [] }) });
globalThis.MccheynePlan = null;

const { state, bumpGeneration } = await import('../web/js/state.js');
const api = await import('../web/js/api.js');
const viewToday = await import('../web/js/view-today.js');
const viewPrayer = await import('../web/js/view-prayer.js');

let pass = 0;
const failures = [];

function report(label, r) {
  if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
  failures.push(label + ' — ' + r);
  console.log('  [FAIL] ' + label + ' — ' + r);
}

function reportErr(label, e) {
  const msg = e && e.message ? e.message : e;
  failures.push(label + ' — ' + msg);
  console.log('  [FAIL] ' + label + ' — ' + msg);
}

// 동기·비동기 검사 모두 받는다.
function t(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then((v) => report(label, v)).catch((e) => reportErr(label, e));
    }
    report(label, r);
  } catch (e) {
    reportErr(label, e);
  }
  return undefined;
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

const TODAY_IDS = ['t-word', 't-inter', 't-verse', 't-res', 't-toggle', 't-save', 'view'];

/** «오늘» 탭에서 A가 글을 쓰다가 세션이 만료된 상황을 만든다. */
function stashAsUser(email, verse) {
  resetDom(TODAY_IDS);
  state.session = { email: email, name: 'X', role: 'student', kind: 'student' };
  document.querySelector('#t-verse').value = verse;
  document.querySelector('#t-res').value = '결단 ' + verse;
  viewToday.stashDraft();
}

/** 로그인한 사용자로 «오늘» 탭을 그린 뒤 와닿은말씀 칸의 값을 돌려준다. */
function renderAs(email) {
  resetDom(TODAY_IDS);
  state.session = { email: email, name: 'Y', role: 'student', kind: 'student' };
  viewToday.render(document.querySelector('#view'));
  return document.querySelector('#t-verse').value;
}

console.log('=== 화면 모듈 보안·상태 테스트 ===\n');
console.log('--- ★ draft 계정 격리 (가족 공용 폰) ---');

t('★ A가 쓰던 글이 B에게 복원되지 않는다', () => {
  viewToday.clearDraft();
  stashAsUser('child@example.com', '자녀의 사적인 고백');
  const shown = renderAs('parent@example.com');
  return shown === '' || '★ 유출: B 화면에 "' + shown + '"';
});

t('★ 유출되지 않은 draft가 B의 저장에 섞이지 않는다', () => {
  const res = document.querySelector('#t-res').value;
  return res === '' || '결단 칸에 남음: ' + res;
});

t('같은 사람이 다시 로그인하면 복원된다 (기능은 살아 있어야 함)', () => {
  viewToday.clearDraft();
  stashAsUser('child@example.com', '내가 쓰던 글');
  const shown = renderAs('child@example.com');
  return shown === '내가 쓰던 글' || '복원되지 않음: "' + shown + '"';
});

t('복원은 한 번만 일어난다 (두 번째 렌더에는 남지 않음)', () => {
  const again = renderAs('child@example.com');
  return again === '' || '두 번째 렌더에도 복원됨: ' + again;
});

t('★ 계정 전환 이벤트로 파기하면 원래 주인에게도 복원되지 않는다', () => {
  viewToday.clearDraft();
  stashAsUser('child@example.com', '파기 대상');
  viewToday.clearDraft();               // app:account-changed 핸들러가 하는 일
  const shown = renderAs('child@example.com');
  return shown === '' || '파기되지 않음: ' + shown;
});

t('세션이 없으면 draft를 만들지 않는다', () => {
  viewToday.clearDraft();
  resetDom(TODAY_IDS);
  state.session = null;
  document.querySelector('#t-verse').value = '세션 없이 쓴 글';
  viewToday.stashDraft();
  const shown = renderAs('someone@example.com');
  return shown === '' || 'draft가 만들어짐: ' + shown;
});

console.log('\n--- ★ 기도 탭 draft 격리 ---');

const PRAYER_IDS = ['p-new', 'p-add', 'view'];

function stashPrayerAs(email, text) {
  resetDom(PRAYER_IDS);
  state.session = { email: email, name: 'X', role: 'student', kind: 'student' };
  document.querySelector('#p-new').value = text;
  viewPrayer.stashDraft();
}

function renderPrayerAs(email) {
  resetDom(PRAYER_IDS);
  state.session = { email: email, name: 'Y', role: 'student', kind: 'student' };
  state.prayers = [];
  viewPrayer.render(document.querySelector('#view'));
  return document.querySelector('#p-new').value;
}

t('★ A의 기도제목이 B에게 복원되지 않는다', () => {
  viewPrayer.clearDraft();
  stashPrayerAs('child@example.com', '자녀의 기도제목');
  const shown = renderPrayerAs('parent@example.com');
  return shown === '' || '★ 유출: "' + shown + '"';
});

t('같은 사람에게는 복원된다', () => {
  viewPrayer.clearDraft();
  stashPrayerAs('child@example.com', '내 기도제목');
  const shown = renderPrayerAs('child@example.com');
  return shown === '내 기도제목' || '복원되지 않음: "' + shown + '"';
});

console.log('\n--- draft 날짜 처리 ---');

t('오늘 draft는 restoreDraftContext 후에도 살아 있다', () => {
  viewToday.clearDraft();
  stashAsUser('a@example.com', '오늘 글');
  viewToday.restoreDraftContext();
  const shown = renderAs('a@example.com');
  return shown === '오늘 글' || '오늘 draft가 사라짐: "' + shown + '"';
});

t('restoreDraftContext는 draft가 없을 때 안전하다', () => {
  viewToday.clearDraft();
  viewToday.restoreDraftContext();
  return renderAs('a@example.com') === '' || '없는 draft가 복원됨';
});

// ※ "그저께 이전 draft를 버린다"(view-today.js restoreDraftContext의 마지막 분기)는
//   로그인 화면에 둔 채 자정을 두 번 넘겨야 도달하므로 시간 조작 없이는 재현할 수 없다.
//   프로덕션 코드에 테스트 전용 훅을 넣지 않기 위해 여기서는 검증하지 않는다 —
//   미검증 분기임을 명시해 둔다.

console.log('\n--- ★ 화면이 바뀌어도 데이터는 갱신된다 ---');

// 이 두 항목이 6차 검토까지 이어진 «저장했는데 사라진 것처럼 보임»의 회귀 방어다.
// 규칙: 데이터 갱신은 (같은 사람일 때) 항상 수행하고, stale은 화면 그리기만 막는다.

await t('★ 저장 중 탭이 바뀌어도 state.records에 그날 기록이 반영된다', async () => {
  const today = todayStr();
  resetDom(TODAY_IDS);
  state.session = { email: 'save@example.com', name: 'S', role: 'student', kind: 'student' };
  state.months = [today.slice(0, 7)];
  state.records = [];
  state.statsRecords = [];
  api.clearSession();
  api.setSession('save@example.com', 't');

  // setRecord → getMyRecords 순서로 응답한다.
  let call = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    call += 1;
    const body = call === 1
      ? { ok: true }
      : { ok: true, rows: [{ date: today, wordRead: true, verse: '저장됨', resolution: '', intercession: false, updatedAt: '' }] };
    return { ok: true, json: async () => body };
  };

  try {
    const root = document.querySelector('#view');
    viewToday.render(root);                      // 핸들러 연결
    document.querySelector('#t-verse').value = '저장됨';
    document.querySelector('#t-word').classList.add('checked');
    const saving = handlers.get('t-save')();     // 저장 시작
    bumpGeneration();                 // 저장 왕복 중에 탭 전환
    await saving;
    const hit = state.records.find((r) => r.date === today);
    if (!hit) return '★ state.records에 반영되지 않음 — 달력이 «기록 없음»으로 그린다';
    return hit.wordRead === true || '말씀읽음이 반영되지 않음';
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('★ 세션이 파기된 뒤 도착한 응답은 state를 되살리지 않는다', async () => {
  const today = todayStr();
  resetDom(TODAY_IDS);
  state.session = { email: 'gone@example.com', name: 'G', role: 'student', kind: 'student' };
  state.months = [today.slice(0, 7)];
  state.records = [];
  api.clearSession();
  api.setSession('gone@example.com', 't');

  let call = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) api.clearSession();   // 저장 왕복 중에 세션 만료/로그아웃
    const body = call === 1
      ? { ok: true }
      : { ok: true, rows: [{ date: today, wordRead: true, verse: '앞사람 글', resolution: '', intercession: false, updatedAt: '' }] };
    return { ok: true, json: async () => body };
  };

  try {
    const root = document.querySelector('#view');
    viewToday.render(root);
    document.querySelector('#t-verse').value = '앞사람 글';
    document.querySelector('#t-word').classList.add('checked');
    await handlers.get('t-save')();
    const leaked = state.records.find((r) => r.verse === '앞사람 글');
    return !leaked || '★ 파기된 세션의 응답이 state에 남음 — 다음 사람에게 보일 수 있다';
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log('\n--- 저장 시각 표기 ---');

t('formatKo가 사람이 읽는 날짜를 만든다', () =>
  viewToday.formatKo('2026-07-30') === '2026년 7월 30일'
    ? true : viewToday.formatKo('2026-07-30'));

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
