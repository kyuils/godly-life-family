#!/usr/bin/env node
// scripts/test-web-calendar.mjs — 달력 탭의 **월 이동 상태 전이** 테스트.
//
// 왜 필요한가:
//   비동기 렌더 경합을 막으려고 넣은 세대 카운터(state.js `bumpGeneration`/`stale`)가
//   달력에 **"기록이 통째로 사라진 것처럼 보이는"** 결함을 만들었다.
//   이전 달을 불러오는 중에 탭을 바꾸면 `viewYm`만 새 달을 가리키고 `state.records`는
//   갱신되지 않아, 돌아왔을 때 그 달 전체가 «기록 없음»으로 그려졌다.
//   사용자에게는 데이터 소실로 보이고 되살릴 UI 경로도 없다.
//   (2026-07-30 4차 검토 [중대] — 이 파일은 그 회귀를 붙잡아 두기 위한 것이다)
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

// --- 최소 DOM 스텁 -----------------------------------------------------------
const nodes = new Map();
const handlers = new Map();

function makeNode(id) {
  const classes = new Set();
  return {
    id,
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    value: '', textContent: '', disabled: false, dataset: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute() {}, appendChild() {}, remove() {}, focus() {}, setSelectionRange() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    set onclick(fn) { handlers.set(this.id, fn); },
    get onclick() { return handlers.get(this.id); },
  };
}

function resetDom(ids) {
  nodes.clear(); handlers.clear();
  ids.forEach((id) => nodes.set(id, makeNode(id)));
}

globalThis.document = {
  querySelector(sel) { return nodes.get(String(sel).replace('#', '')) || null; },
  querySelectorAll() { return []; },
  createElement: (t) => makeNode(t),
  body: { appendChild() {} },
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = { dispatchEvent() {}, addEventListener() {}, confirm: () => true };
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent { constructor(t) { this.type = t; } };
}
globalThis.MccheynePlan = null;

// --- 서버 응답 제어 -----------------------------------------------------------
// 7월에만 기록이 있고, 5월 요청은 우리가 원할 때까지 응답을 붙잡아 둔다.
const JULY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);

function ymBack(ym, n) {
  let y = Number(ym.slice(0, 4)); let m = Number(ym.slice(5, 7)) - n;
  while (m < 1) { m += 12; y -= 1; }
  return y + '-' + String(m).padStart(2, '0');
}
const M1 = ymBack(JULY, 1);   // 지난달 (초기 로드에 포함됨)
const M2 = ymBack(JULY, 2);   // 그 전달 (서버 왕복 필요)

// ★ 이번 달의 **오늘 이전** 날짜만 심는다.
// 고정으로 1·2·3일을 쓰면 매달 1일·2일에 그 날짜가 «미래»가 되어(stats.js) 테스트가
// 원인 불명으로 깨진다. 비개발자가 배포 점검에서 만나면 가장 나쁜 종류의 실패다
// (2026-07-30 5차 검토 지적).
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

function addDays(dateStr, n) {
  const p = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0');
}

const seedDates = [];
for (let i = 0; i < 3; i++) {
  const d = addDays(TODAY, -i);
  if (d.slice(0, 7) === JULY) seedDates.push(d);   // 이번 달 안쪽만
}
const EXPECTED_MARKS = seedDates.length;           // 달 초에는 1~2건일 수 있다

const recordsByMonth = {};
recordsByMonth[JULY] = seedDates.map((d) => ({
  date: d, wordRead: true, verse: '', resolution: '', intercession: false, updatedAt: '',
}));

let holdRelease = null;   // 붙잡아 둔 응답을 놓아 주는 함수
let holdNext = false;

globalThis.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body);
  const rows = [];
  (body.months || []).forEach((m) => { (recordsByMonth[m] || []).forEach((r) => rows.push(r)); });
  const payload = { ok: true, rows: rows };
  if (holdNext) {
    holdNext = false;
    await new Promise((resolve) => { holdRelease = resolve; });
  }
  return { ok: true, json: async () => payload };
};

const { state, bumpGeneration } = await import('../web/js/state.js');
const api = await import('../web/js/api.js');
const viewCalendar = await import('../web/js/view-calendar.js');

let pass = 0;
const failures = [];

function t(label, fn) {
  return Promise.resolve().then(fn).then((r) => {
    if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
    failures.push(label + ' — ' + r); console.log('  [FAIL] ' + label + ' — ' + r);
  }).catch((e) => {
    failures.push(label + ' — ' + (e && e.message ? e.message : e));
    console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
  });
}

const IDS = ['view', 'cal-prev', 'cal-next'];

function setup() {
  resetDom(IDS);
  api.clearSession();
  api.setSession('u@example.com', 't');
  state.session = { email: 'u@example.com', name: 'U', role: 'student', kind: 'student', joinedAt: '2020-01-01' };
  state.months = [JULY, M1];
  state.records = recordsByMonth[JULY].slice();
  state.statsRecords = state.records.slice();
  viewCalendar.resetView();
  viewCalendar.render(document.querySelector('#view'));
}

/** 현재 그려진 화면에서 «기록함» 표시 개수 (달력 그리드 안쪽만) */
function doneMarks() {
  const html = document.querySelector('#view').innerHTML;
  const grid = html.split('cal-legend')[0];   // 범례의 견본 마크는 제외
  return (grid.match(/day-mark done/g) || []).length;
}

function shownYm() {
  const html = document.querySelector('#view').innerHTML;
  const m = html.match(/(\d{4})년 (\d{1,2})월/);
  return m ? m[1] + '-' + String(m[2]).padStart(2, '0') : null;
}

console.log('=== 달력 월 이동 상태 전이 테스트 ===\n');

await t('초기 화면은 이번 달과 심어 둔 기록 ' + EXPECTED_MARKS + '건을 보여준다', () => {
  setup();
  return (shownYm() === JULY && doneMarks() === EXPECTED_MARKS) ||
    '월=' + shownYm() + ' 기록=' + doneMarks() + ' (기대 ' + EXPECTED_MARKS + ')';
});

await t('이미 로드된 지난달로는 즉시 이동한다', async () => {
  handlers.get('cal-prev')();
  await new Promise((r) => setTimeout(r, 10));
  return shownYm() === M1 || '월=' + shownYm();
});

await t('★ 미로드 달을 불러오는 중 탭이 바뀌면 이동하지 않는다', async () => {
  // 5월(미로드)로 이동 시도 → 응답을 붙잡아 둔 사이 다른 탭으로 전환(세대 증가)
  holdNext = true;
  const moving = handlers.get('cal-prev')();
  await new Promise((r) => setTimeout(r, 10));
  bumpGeneration();                      // app.js renderTab()이 하는 일 = 탭 전환
  if (holdRelease) holdRelease();        // 이제 응답 도착
  await moving;
  await new Promise((r) => setTimeout(r, 10));

  // 화면을 다시 그린다(= 달력 탭으로 복귀)
  viewCalendar.render(document.querySelector('#view'));
  await new Promise((r) => setTimeout(r, 10));

  if (shownYm() === M2) return '★ 중단됐는데도 ' + M2 + '로 이동함 — 빈 달력이 그려진다';
  return shownYm() === M1 || '예상 밖의 달: ' + shownYm();
});

await t('★ 복귀 후에도 그 달의 기록이 온전히 보인다 (데이터 소실 착시 없음)', async () => {
  // M1은 기록이 없는 달이므로 이번 달로 돌아가 확인한다
  handlers.get('cal-next')();
  await new Promise((r) => setTimeout(r, 10));
  return (shownYm() === JULY && doneMarks() === EXPECTED_MARKS) ||
    '월=' + shownYm() + ' 기록=' + doneMarks() + ' (기대 ' + EXPECTED_MARKS + ')';
});

await t('중단 뒤에도 정상적인 이전 달 이동이 다시 된다', async () => {
  handlers.get('cal-prev')();            // M1
  await new Promise((r) => setTimeout(r, 10));
  handlers.get('cal-prev')();            // M2 — 이번엔 붙잡지 않는다
  await new Promise((r) => setTimeout(r, 30));
  if (shownYm() !== M2) return '이동 실패: ' + shownYm();
  return state.months.indexOf(M2) >= 0 || 'state.months에 반영되지 않음';
});

await t('보고 있는 달은 항상 로드된 달이다 (빈 달력이 그려질 수 없다)', () => {
  return state.months.indexOf(shownYm()) >= 0 ||
    '표시 중인 ' + shownYm() + '이 로드 목록에 없음: ' + JSON.stringify(state.months);
});

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
