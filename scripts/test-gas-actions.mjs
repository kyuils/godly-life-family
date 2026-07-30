// scripts/test-gas-actions.mjs — GAS 백엔드 단위 테스트 + 보안 회귀 테스트.
//
// CLAUDE.md 「완료 기준」: 보안 불변식 1~6 각각에 대한 명시적 회귀 테스트가
// 반드시 포함되어야 하며, 이 6개가 없으면 완료를 선언하지 않는다.
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

import { createHarness, NAMES } from './gas-harness.mjs';

let pass = 0;
const failures = [];
let group = '';

function section(title) { group = title; console.log('\n--- ' + title + ' ---'); }

function t(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
    failures.push(group + ' / ' + label + ' — ' + r);
    console.log('  [FAIL] ' + label + ' — ' + r);
  } catch (e) {
    failures.push(group + ' / ' + label + ' — ' + (e && e.message ? e.message : e));
    console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
  }
}

function eq(actual, expected, what) {
  if (actual === expected) return true;
  return (what || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual);
}

// 공통 시드
const STUDENT = 'student1@example.com';
const PARENT = 'parent1@example.com';
const TEACHER = 'teacher@example.com';
const OTHER = 'student2@example.com';

function seedBase(extra = {}) {
  return Object.assign({
    students: [
      { email: STUDENT, 이름: '김학생', 학년반: '중2-1', active: 'TRUE', 가입시각: '2026-01-15', 가입경로: 'self' },
      { email: OTHER, 이름: '이학생', 학년반: '중3-2', active: 'TRUE', 가입시각: '2026-02-01', 가입경로: 'self' },
    ],
    parents: [
      { email: PARENT, 이름: '박학부모', 자녀이름: '김학생', active: 'TRUE', 가입시각: '2026-01-20', 가입경로: 'self' },
    ],
    teachers: [
      { email: TEACHER, 이름: '황교사', 역할: 'admin', active: 'TRUE', 가입시각: '2026-01-01' },
    ],
  }, extra);
}

const tok = (email) => 'mock:' + email;

// ===========================================================================
section('기본 라우팅 / 인증');
// ===========================================================================
{
  const h = createHarness(seedBase());
  t('doGet 헬스체크가 build를 반환', () => {
    const r = h.callGet();
    return r.ok === true ? eq(typeof r.build, 'string', 'build') : 'not ok';
  });
  t('알 수 없는 액션 → unknown_action', () => eq(h.callAction({ action: 'nope' }).code, 'unknown_action'));
  t('토큰 없음 → no_token', () => eq(h.callAction({ action: 'whoami' }).code, 'no_token'));
  t('잘못된 토큰 → invalid_token', () =>
    eq(h.callAction({ action: 'whoami', idToken: 'garbage' }).code, 'invalid_token'));
  t('미등재 사용자 → unauthorized + canRegister', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok('nobody@example.com') });
    if (r.code !== 'unauthorized') return 'code=' + r.code;
    return eq(r.canRegister, true, 'canRegister');
  });
  t('학생 whoami → kind=student, role=student', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(STUDENT) });
    return r.ok && r.kind === 'student' && r.role === 'student' && r.name === '김학생'
      ? true : JSON.stringify(r);
  });
  t('학부모 whoami → kind=parent, extra=자녀이름', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(PARENT) });
    return r.ok && r.kind === 'parent' && r.extra === '김학생' ? true : JSON.stringify(r);
  });
  t('교사 whoami → kind=teacher, role=admin', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(TEACHER) });
    return r.ok && r.kind === 'teacher' && r.role === 'admin' ? true : JSON.stringify(r);
  });
  t('whoami에 joinedAt 포함 (달력 하한용, 계약 §4.1)', () =>
    eq(h.callAction({ action: 'whoami', idToken: tok(STUDENT) }).joinedAt, '2026-01-15'));
}

// ===========================================================================
section('명부 판정 — active 우선 (계약 §2.4)');
// ===========================================================================
{
  // 해임된 교사: 교사 시트에 비활성 행, 학부모 시트에 활성 행
  const h = createHarness(seedBase({
    teachers: [{ email: PARENT, 이름: '전교사', 역할: 'admin', active: 'FALSE', 가입시각: '2026-01-01' }],
  }));
  t('비활성 교사 행은 무시되고 활성 학부모 행이 채택된다', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(PARENT) });
    return r.ok && r.kind === 'parent' && r.role === 'parent' ? true : JSON.stringify(r);
  });
  t('비활성 교사는 교사 전용 액션이 forbidden', () =>
    eq(h.callAction({ action: 'getMembers', idToken: tok(PARENT) }).code, 'forbidden'));
}
{
  // 교사이면서 학부모인 사람 → 교사 우선
  const h = createHarness(seedBase({
    parents: [{ email: TEACHER, 이름: '황교사', 자녀이름: '황자녀', active: 'TRUE', 가입시각: '2026-01-05' }],
  }));
  t('교사 > 학부모 우선순위', () => eq(h.callAction({ action: 'whoami', idToken: tok(TEACHER) }).kind, 'teacher'));
}
{
  const h = createHarness(seedBase({
    students: [{ email: STUDENT, 이름: '김학생', 학년반: '중2-1', active: 'FALSE', 가입시각: '2026-01-15' }],
  }));
  t('비활성 학생만 있으면 unauthorized', () =>
    eq(h.callAction({ action: 'whoami', idToken: tok(STUDENT) }).code, 'unauthorized'));
}

// ===========================================================================
section('register (계약 §4.2)');
// ===========================================================================
{
  const NEW = 'new@example.com';
  t('정상 등록 (학생)', () => {
    const h = createHarness(seedBase());
    const r = h.callAction({ action: 'register', idToken: tok(NEW), name: '신입생', kind: 'student', extra: '중1-3', code: 'hyerim2026' });
    if (!r.ok) return JSON.stringify(r);
    const rows = h.sheet(NAMES.MEMBERS_STUDENT).objects();
    const added = rows.find((x) => x.email === NEW);
    if (!added) return '학생 시트에 행이 없음';
    return added['이름'] === '신입생' && added['학년반'] === '중1-3' && added.active === 'TRUE' && added['가입경로'] === 'self'
      ? true : JSON.stringify(added);
  });
  t('정상 등록 (학부모) → 학부모 시트에 기록', () => {
    const h = createHarness(seedBase());
    const r = h.callAction({ action: 'register', idToken: tok(NEW), name: '신입학부모', kind: 'parent', extra: '김자녀', code: 'hyerim2026' });
    if (!r.ok) return JSON.stringify(r);
    const added = h.sheet(NAMES.MEMBERS_PARENT).objects().find((x) => x.email === NEW);
    return added && added['자녀이름'] === '김자녀' ? true : JSON.stringify(added);
  });
  t('등록 직후 whoami가 즉시 통과 (명부 캐시 무효화)', () => {
    const h = createHarness(seedBase());
    h.callAction({ action: 'whoami', idToken: tok(NEW) }); // 미등재 결과가 캐시됨
    h.callAction({ action: 'register', idToken: tok(NEW), name: '신입생', kind: 'student', code: 'hyerim2026' });
    return eq(h.callAction({ action: 'whoami', idToken: tok(NEW) }).ok, true, 'whoami.ok');
  });
  t('코드 불일치 → bad_code', () => {
    const h = createHarness(seedBase());
    return eq(h.callAction({ action: 'register', idToken: tok(NEW), name: 'x', kind: 'student', code: 'wrong' }).code, 'bad_code');
  });
  t('코드 정규화 (대소문자·공백 무시)', () => {
    const h = createHarness(seedBase());
    return eq(h.callAction({ action: 'register', idToken: tok(NEW), name: 'x', kind: 'student', code: '  HYERIM 2026 ' }).ok, true);
  });
  t('REGISTER_CODE 미설정 → registration_closed', () => {
    const h = createHarness(seedBase({ registerCode: null }));
    return eq(h.callAction({ action: 'register', idToken: tok(NEW), name: 'x', kind: 'student', code: 'any' }).code, 'registration_closed');
  });
  t('미설정 시 whoami.canRegister=false', () => {
    const h = createHarness(seedBase({ registerCode: null }));
    return eq(h.callAction({ action: 'whoami', idToken: tok(NEW) }).canRegister, false);
  });
  t('이미 등록된 사용자 → already_registered', () => {
    const h = createHarness(seedBase());
    return eq(h.callAction({ action: 'register', idToken: tok(STUDENT), name: 'x', kind: 'student', code: 'hyerim2026' }).code, 'already_registered');
  });
  t('비활성 사용자 재가입 → deactivated (활성화 우회 차단)', () => {
    const h = createHarness(seedBase({
      students: [{ email: STUDENT, 이름: '김학생', active: 'FALSE' }],
    }));
    return eq(h.callAction({ action: 'register', idToken: tok(STUDENT), name: 'x', kind: 'student', code: 'hyerim2026' }).code, 'deactivated');
  });
  t('이름 누락 → bad_request', () => {
    const h = createHarness(seedBase());
    return eq(h.callAction({ action: 'register', idToken: tok(NEW), name: '   ', kind: 'student', code: 'hyerim2026' }).code, 'bad_request');
  });
  t('이름 30자 초과 → bad_request', () => {
    const h = createHarness(seedBase());
    return eq(h.callAction({ action: 'register', idToken: tok(NEW), name: '가'.repeat(31), kind: 'student', code: 'hyerim2026' }).code, 'bad_request');
  });
  t('bad_code 6회 초과 → too_many_attempts (email 백오프)', () => {
    const h = createHarness(seedBase());
    let last;
    for (let i = 0; i < 8; i++) {
      last = h.callAction({ action: 'register', idToken: tok(NEW), name: 'x', kind: 'student', code: 'wrong' });
    }
    return eq(last.code, 'too_many_attempts');
  });
  t('계정을 바꿔도 전역 백오프가 막는다', () => {
    const h = createHarness(seedBase());
    let last;
    for (let i = 0; i < 25; i++) {
      last = h.callAction({ action: 'register', idToken: tok('a' + i + '@example.com'), name: 'x', kind: 'student', code: 'wrong' });
    }
    return eq(last.code, 'too_many_attempts');
  });
}

// ===========================================================================
section('setRecord / getMyRecords (계약 §2.5, §4.2)');
// ===========================================================================
{
  const h = createHarness(seedBase());
  const today = h.todayStr();
  const ym = today.slice(0, 7);

  t('첫 저장이 RECORDS_YYYY-MM 시트를 자동 생성', () => {
    const r = h.callAction({
      action: 'setRecord', idToken: tok(STUDENT), date: today,
      wordRead: true, verse: '요 3:16', resolution: '오늘 감사하기', intercession: true,
    });
    if (!r.ok) return JSON.stringify(r);
    return h.sheetNames().includes('RECORDS_' + ym) ? true : '시트 미생성: ' + h.sheetNames().join(',');
  });
  t('저장 내용이 헤더 순서대로 기록됨', () => {
    const row = h.sheet('RECORDS_' + ym).objects()[0];
    return row['날짜'] === today && row.email === STUDENT && row['이름'] === '김학생' &&
      row['구분'] === '학생' && row['말씀읽음'] === 'TRUE' && row['와닿은말씀'] === '요 3:16' &&
      row['중보기도'] === 'TRUE' ? true : JSON.stringify(row);
  });
  t('같은 날 다시 저장하면 행이 늘지 않고 갱신된다 (upsert)', () => {
    h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: false, verse: '수정됨', resolution: '', intercession: false });
    const rows = h.sheet('RECORDS_' + ym).objects();
    if (rows.length !== 1) return '행 수=' + rows.length;
    return rows[0]['와닿은말씀'] === '수정됨' && rows[0]['말씀읽음'] === 'FALSE' ? true : JSON.stringify(rows[0]);
  });
  t('기록시각은 보존되고 수정시각만 갱신', () => {
    const row = h.sheet('RECORDS_' + ym).objects()[0];
    return row['기록시각'] && row['수정시각'] && row['기록시각'] <= row['수정시각'] ? true : JSON.stringify(row);
  });
  t('어제 날짜 저장 허용', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: h.addDays(today, -1), wordRead: true, verse: '', resolution: '', intercession: false }).ok, true));
  t('내일 날짜 → bad_request', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: h.addDays(today, 1), wordRead: true }).code, 'bad_request'));
  t('2일 전 → bad_request', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: h.addDays(today, -2), wordRead: true }).code, 'bad_request'));
  t('날짜 형식 오류 → bad_request', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: '2026/07/30', wordRead: true }).code, 'bad_request'));
  t('본문 1000자 초과 → bad_request', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: '가'.repeat(1001) }).code, 'bad_request'));

  t('getMyRecords는 본인 행만 반환', () => {
    h.callAction({ action: 'setRecord', idToken: tok(OTHER), date: today, wordRead: true, verse: '남의기록' });
    const r = h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: [ym] });
    if (!r.ok) return JSON.stringify(r);
    const leaked = r.rows.filter((x) => x.verse === '남의기록');
    return leaked.length === 0 ? true : '타인 기록 유출 ' + leaked.length + '건';
  });
  t('없는 달 시트를 요청해도 오류가 아니라 빈 배열', () => {
    const r = h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: ['2019-01'] });
    return r.ok && Array.isArray(r.rows) && r.rows.length === 0 ? true : JSON.stringify(r);
  });
  t('읽기 액션은 시트를 만들지 않는다 (계약 §2.5)', () =>
    h.sheetNames().includes('RECORDS_2019-01') ? '읽기가 시트를 생성함' : true);
  t('months가 7개 이상 → bad_request', () => {
    const many = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
    return eq(h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: many }).code, 'bad_request');
  });
  t('months 형식 오류 → bad_request', () =>
    eq(h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: ['2026-7'] }).code, 'bad_request'));
  t('months 누락 → bad_request', () =>
    eq(h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT) }).code, 'bad_request'));
}

// ===========================================================================
section('경합·잠금 (계약 §2.0, §4.2)');
// ===========================================================================
{
  const h = createHarness(seedBase({ lockFails: true }));
  t('waitLock 실패는 server_error가 아니라 busy', () =>
    eq(h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: h.todayStr(), wordRead: true }).code, 'busy'));
  t('기도 추가도 busy를 반환', () =>
    eq(h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '기도' }).code, 'busy'));
}
{
  // 사람이 시트를 정렬해 행 번호가 어긋난 상황 재현 → 남의 행을 덮어쓰면 안 된다.
  const h = createHarness(seedBase());
  const today = h.todayStr();
  const ym = today.slice(0, 7);
  h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: 'A의 기록' });
  h.callAction({ action: 'setRecord', idToken: tok(OTHER), date: today, wordRead: true, verse: 'B의 기록' });

  t('read-verify-write가 행 어긋남을 잡아낸다 (직접 호출)', () => {
    const ctx = h.context;
    // STUDENT의 행 번호(2)를 OTHER의 키로 검증하면 실패해야 한다.
    const okSame = ctx.verifyRowKeys_('RECORDS_' + ym, 2, { '날짜': today, 'email': STUDENT });
    const okCross = ctx.verifyRowKeys_('RECORDS_' + ym, 2, { '날짜': today, 'email': OTHER });
    return okSame === true && okCross === false ? true : 'same=' + okSame + ' cross=' + okCross;
  });
  t('행 순서가 바뀐 뒤 저장해도 자기 행에 정확히 쓴다 (스캔이 최신 순서를 본다)', () => {
    h.sheet('RECORDS_' + ym).reverseRows(); // 사람이 시트 순서를 뒤집음
    const r = h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: 'A 갱신' });
    if (!r.ok) return JSON.stringify(r);
    const rows = h.sheet('RECORDS_' + ym).objects();
    const a = rows.find((x) => x.email === STUDENT);
    const b = rows.find((x) => x.email === OTHER);
    if (!a || !b) return '행 소실';
    if (b['와닿은말씀'] !== 'B의 기록') return 'B의 행이 덮어써짐: ' + b['와닿은말씀'];
    return a['와닿은말씀'] === 'A 갱신' ? true : 'A가 갱신되지 않음: ' + a['와닿은말씀'];
  });
}
{
  // ★ 실제 위험 구간: 스캔이 끝난 뒤 쓰기 직전에 사람이 시트를 편집하는 창.
  // LockService는 이걸 막지 못한다(사람의 UI 편집은 스크립트 실행이 아니므로).
  // read-verify-write가 없으면 여기서 남의 행이 덮어써진다 — 복구 불가한 데이터 파괴.
  const h = createHarness(seedBase());
  const today = h.todayStr();
  const ym = today.slice(0, 7);
  h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: 'A의 기록' });
  h.callAction({ action: 'setRecord', idToken: tok(OTHER), date: today, wordRead: true, verse: 'B의 기록' });

  const sheet = h.sheet('RECORDS_' + ym);
  const before = JSON.stringify(sheet.objects());

  t('스캔 직후 사람이 행 순서를 뒤집으면 conflict를 반환한다', () => {
    // 스캔은 끝났고 대상 행 번호를 손에 쥔 상태에서, 검증이 그 행을 읽기 직전에
    // 사람이 시트를 뒤집는다. 검증이 없으면 여기서 남의 행을 덮어쓴다.
    sheet.sabotageBeforeRowRead((s) => s.reverseRows());
    const r = h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: '덮어쓰기 시도' });
    return r.code === 'conflict' ? true : '기대 conflict, 실제 ' + JSON.stringify(r);
  });
  t('conflict일 때 어느 행도 손상되지 않는다', () => {
    const after = sheet.objects();
    const a = after.find((x) => x.email === STUDENT);
    const b = after.find((x) => x.email === OTHER);
    if (!a || !b) return '행 소실';
    if (b['와닿은말씀'] !== 'B의 기록') return 'B의 행이 덮어써짐: ' + b['와닿은말씀'];
    if (a['와닿은말씀'] !== 'A의 기록') return 'A의 행이 예상 밖으로 변경됨: ' + a['와닿은말씀'];
    return JSON.stringify(after.slice().sort((x, y) => String(x.email).localeCompare(y.email)))
      === JSON.stringify(JSON.parse(before).sort((x, y) => String(x.email).localeCompare(y.email)))
      ? true : '내용이 달라짐';
  });
}

// ===========================================================================
section('기도 (계약 §2.6, §4.2)');
// ===========================================================================
{
  const h = createHarness(seedBase());
  let id;
  t('기도 추가', () => {
    const r = h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '시험 잘 보게 해주세요' });
    id = r.id;
    return r.ok && typeof r.id === 'string' && r.id.length > 1 ? true : JSON.stringify(r);
  });
  t('본인 기도 목록에 보인다 (상태 open)', () => {
    const r = h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) });
    return r.ok && r.rows.length === 1 && r.rows[0].status === 'open' && r.rows[0].id === id
      ? true : JSON.stringify(r);
  });
  t('응답 체크 → answered + 응답일', () => {
    const r = h.callAction({ action: 'setPrayerAnswered', idToken: tok(STUDENT), id, answered: true });
    if (!r.ok) return JSON.stringify(r);
    const row = h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) }).rows[0];
    return row.status === 'answered' && row.answeredDate === h.todayStr() ? true : JSON.stringify(row);
  });
  t('응답 해제 → open + 응답일 비움', () => {
    h.callAction({ action: 'setPrayerAnswered', idToken: tok(STUDENT), id, answered: false });
    const row = h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) }).rows[0];
    return row.status === 'open' && row.answeredDate === '' ? true : JSON.stringify(row);
  });
  t('시트의 상태 열이 예상 밖 값이면 open으로 간주 (계약 §2.6)', () => {
    const sh = h.sheet(NAMES.PRAYERS);
    const col = sh.data[0].indexOf('상태');
    sh.data[1][col] = '완료';  // 사람이 손으로 고친 상황
    return eq(h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) }).rows[0].status, 'open');
  });
  t('삭제는 소프트 삭제 — 행은 남고 목록에서만 사라진다', () => {
    const before = h.sheet(NAMES.PRAYERS).objects().length;
    const r = h.callAction({ action: 'deletePrayer', idToken: tok(STUDENT), id });
    if (!r.ok) return JSON.stringify(r);
    const after = h.sheet(NAMES.PRAYERS).objects();
    if (after.length !== before) return '행이 물리 삭제됨';
    if (String(after[0]['삭제여부']).toUpperCase() !== 'TRUE') return '삭제여부 미표시';
    return eq(h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) }).rows.length, 0, '목록 길이');
  });
  t('빈 기도제목 → bad_request', () =>
    eq(h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '   ' }).code, 'bad_request'));
  t('1000자 초과 → bad_request', () =>
    eq(h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '가'.repeat(1001) }).code, 'bad_request'));
  t('1일 20건 상한', () => {
    const h2 = createHarness(seedBase());
    let last;
    for (let i = 0; i < 22; i++) last = h2.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '기도' + i });
    return last.code === 'bad_request' ? true : JSON.stringify(last);
  });
}

// ===========================================================================
section('교사 전용 액션 (계약 §4.2)');
// ===========================================================================
{
  const h = createHarness(seedBase());
  const today = h.todayStr();
  h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: 'S' });
  h.callAction({ action: 'setRecord', idToken: tok(PARENT), date: today, wordRead: true, verse: 'P' });
  h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '학생 기도' });

  t('교사는 전체 기록 조회 가능 + windowDays 반환', () => {
    const r = h.callAction({ action: 'getAllRecords', idToken: tok(TEACHER) });
    return r.ok && r.rows.length === 2 && r.windowDays === 60 ? true : JSON.stringify(r);
  });
  t('전체 기록에 구분(학생/학부모)이 담긴다', () => {
    const rows = h.callAction({ action: 'getAllRecords', idToken: tok(TEACHER) }).rows;
    const kinds = rows.map((x) => x.kind).sort();
    return JSON.stringify(kinds) === JSON.stringify(['학부모', '학생'].sort())
      ? true : '구분=' + JSON.stringify(kinds);
  });
  t('교사는 전체 기도 조회 가능', () => {
    const r = h.callAction({ action: 'getAllPrayers', idToken: tok(TEACHER) });
    return r.ok && r.rows.length === 1 && r.rows[0].name === '김학생' ? true : JSON.stringify(r);
  });
  t('getMembers는 활성 학생·학부모만 (교사 제외)', () => {
    const r = h.callAction({ action: 'getMembers', idToken: tok(TEACHER) });
    if (!r.ok) return JSON.stringify(r);
    const emails = r.members.map((m) => m.email).sort();
    return JSON.stringify(emails) === JSON.stringify([PARENT, OTHER, STUDENT].sort())
      ? true : JSON.stringify(emails);
  });
  t('days는 최대 180으로 제한', () =>
    eq(h.callAction({ action: 'getAllRecords', idToken: tok(TEACHER), days: 9999 }).windowDays, 180));
}

// ===========================================================================
section('★ 보안 회귀 테스트 (CLAUDE.md 완료 기준 — 불변식 1~6)');
// ===========================================================================

// --- 불변식 1: 클라이언트가 보낸 email/role/kind가 기록·판정에 반영되지 않음 ---
{
  const h = createHarness(seedBase());
  const today = h.todayStr();
  const ym = today.slice(0, 7);
  t('[1] setRecord에서 클라이언트가 보낸 email/이름/구분은 무시된다', () => {
    h.callAction({
      action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true,
      email: TEACHER, name: '해커', kind: 'teacher', 구분: '교사',
    });
    const row = h.sheet('RECORDS_' + ym).objects()[0];
    return row.email === STUDENT && row['이름'] === '김학생' && row['구분'] === '학생'
      ? true : '클라이언트 값이 반영됨: ' + JSON.stringify(row);
  });
  t('[1] whoami에서 클라이언트가 보낸 role은 무시된다', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(STUDENT), role: 'admin', kind: 'teacher' });
    return r.role === 'student' && r.kind === 'student' ? true : JSON.stringify(r);
  });
  t('[1] 클라이언트 role 위조로 교사 액션에 접근 불가', () =>
    eq(h.callAction({ action: 'getAllRecords', idToken: tok(STUDENT), role: 'admin' }).code, 'forbidden'));
  t('[1] addPrayer에서 클라이언트가 보낸 email은 무시된다', () => {
    h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '내 기도', email: OTHER });
    const row = h.sheet(NAMES.PRAYERS).objects()[0];
    return eq(String(row.email), STUDENT, 'PRAYERS.email');
  });
}

// --- 불변식 2: 교사 전용 액션이 student/parent 토큰에 forbidden ---
{
  const h = createHarness(seedBase());
  const teacherOnly = ['getAllRecords', 'getAllPrayers', 'getMembers'];
  for (const action of teacherOnly) {
    t('[2] ' + action + ' — 학생 토큰 → forbidden', () =>
      eq(h.callAction({ action, idToken: tok(STUDENT) }).code, 'forbidden'));
    t('[2] ' + action + ' — 학부모 토큰 → forbidden', () =>
      eq(h.callAction({ action, idToken: tok(PARENT) }).code, 'forbidden'));
    t('[2] ' + action + ' — 미등재 토큰 → unauthorized', () =>
      eq(h.callAction({ action, idToken: tok('nobody@example.com') }).code, 'unauthorized'));
  }
}

// --- 불변식 3: register(kind:'teacher') → bad_request, MEMBERS_교사 행 수 불변 ---
{
  const h = createHarness(seedBase());
  const before = h.sheet(NAMES.MEMBERS_TEACHER).objects().length;
  t("[3] register(kind:'teacher') → bad_request", () =>
    eq(h.callAction({ action: 'register', idToken: tok('x@example.com'), name: '침입자', kind: 'teacher', code: 'hyerim2026' }).code, 'bad_request'));
  t("[3] register(kind:'admin') → bad_request", () =>
    eq(h.callAction({ action: 'register', idToken: tok('x@example.com'), name: '침입자', kind: 'admin', code: 'hyerim2026' }).code, 'bad_request'));
  t('[3] 교사 명부 행 수가 변하지 않음', () =>
    eq(h.sheet(NAMES.MEMBERS_TEACHER).objects().length, before, '교사 행 수'));
  t('[3] 정상 등록해도 교사 명부에는 쓰이지 않는다', () => {
    h.callAction({ action: 'register', idToken: tok('y@example.com'), name: '학생', kind: 'student', code: 'hyerim2026' });
    return eq(h.sheet(NAMES.MEMBERS_TEACHER).objects().length, before, '교사 행 수');
  });
  t('[3] 자가등록자는 교사 권한을 얻지 못한다', () =>
    eq(h.callAction({ action: 'getMembers', idToken: tok('y@example.com') }).code, 'forbidden'));
}

// --- 불변식 4: 타인/존재하지 않는/삭제된 기도 id가 모두 동일하게 forbidden ---
{
  const h = createHarness(seedBase());
  const mine = h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '내 기도' }).id;
  const others = h.callAction({ action: 'addPrayer', idToken: tok(OTHER), text: '남의 기도' }).id;
  const deleted = h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '지울 기도' }).id;
  h.callAction({ action: 'deletePrayer', idToken: tok(STUDENT), id: deleted });

  const cases = [
    ['타인 소유 id', others],
    ['존재하지 않는 id', 'P-does-not-exist'],
    ['삭제된 id', deleted],
  ];
  for (const [label, badId] of cases) {
    t('[4] setPrayerAnswered — ' + label + ' → forbidden', () =>
      eq(h.callAction({ action: 'setPrayerAnswered', idToken: tok(STUDENT), id: badId, answered: true }).code, 'forbidden'));
    t('[4] deletePrayer — ' + label + ' → forbidden', () =>
      eq(h.callAction({ action: 'deletePrayer', idToken: tok(STUDENT), id: badId }).code, 'forbidden'));
  }
  t('[4] 세 경우의 응답이 완전히 동일 (존재 여부 유출 없음)', () => {
    const res = cases.map(([, badId]) =>
      JSON.stringify(h.callAction({ action: 'setPrayerAnswered', idToken: tok(STUDENT), id: badId, answered: true })));
    return res[0] === res[1] && res[1] === res[2] ? true : '응답이 다름: ' + res.join(' | ');
  });
  t('[4] 타인 기도는 내 목록에 보이지 않는다', () => {
    const rows = h.callAction({ action: 'getMyPrayers', idToken: tok(STUDENT) }).rows;
    return rows.every((r) => r.text !== '남의 기도') ? true : '타인 기도 유출';
  });
  t('[4] 타인 기도가 실제로 변경되지 않았다', () => {
    const row = h.sheet(NAMES.PRAYERS).objects().find((r) => r['기도ID'] === others);
    return String(row['상태']) === '진행중' ? true : '타인 기도가 변경됨: ' + JSON.stringify(row);
  });
  t('[4] 교사는 기도를 읽을 수 있지만 응답 체크는 불가 (본인만 — 사용자 결정)', () =>
    eq(h.callAction({ action: 'setPrayerAnswered', idToken: tok(TEACHER), id: mine, answered: true }).code, 'forbidden'));
}

// --- 불변식 5: 수식 인젝션 방어 ---
{
  const h = createHarness(seedBase());
  const today = h.todayStr();
  const ym = today.slice(0, 7);
  t("[5] '=SUM(A1)'이 작은따옴표로 접두되어 저장된다", () => {
    h.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true, verse: '=SUM(A1)', resolution: '+1+1' });
    const row = h.sheet('RECORDS_' + ym).objects()[0];
    return String(row['와닿은말씀']).startsWith("'=") && String(row['결단']).startsWith("'+")
      ? true : JSON.stringify({ v: row['와닿은말씀'], r: row['결단'] });
  });
  t('[5] 기도제목도 수식 인젝션을 방어한다', () => {
    h.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '@import(evil)' });
    const row = h.sheet(NAMES.PRAYERS).objects()[0];
    return String(row['기도제목']).startsWith("'@") ? true : JSON.stringify(row['기도제목']);
  });
  t('[5] 등록 시 이름도 방어한다', () => {
    const h2 = createHarness(seedBase());
    h2.callAction({ action: 'register', idToken: tok('z@example.com'), name: '=HYPERLINK("x")', kind: 'student', code: 'hyerim2026' });
    const row = h2.sheet(NAMES.MEMBERS_STUDENT).objects().find((r) => r.email === 'z@example.com');
    return String(row['이름']).startsWith("'=") ? true : JSON.stringify(row);
  });
}

// --- 불변식 6: 오류 응답에 시트 ID·경로·스택이 없음 ---
{
  const h = createHarness(seedBase({ deleteProps: ['SHEET_ID'] }));
  t('[6] SHEET_ID 누락 시 오류 본문에 내부 정보가 없다', () => {
    const r = h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: [h.todayStr().slice(0, 7)] });
    const s = JSON.stringify(r);
    if (r.ok) return '실패해야 하는데 성공함';
    const leaks = ['SHEET_ID', 'Sheet.gs', 'Actions.gs', 'at ', '\\\\', 'D:'].filter((x) => s.includes(x));
    return leaks.length === 0 ? true : '유출: ' + leaks.join(', ') + ' / ' + s;
  });
  t('[6] server_error 코드만 반환된다', () => {
    const r = h.callAction({ action: 'getMyRecords', idToken: tok(STUDENT), months: [h.todayStr().slice(0, 7)] });
    return eq(r.code, 'server_error');
  });
  t('[6] OAUTH_CLIENT_ID 누락 → server_misconfig (상세 없음)', () => {
    const h2 = createHarness(seedBase({ deleteProps: ['OAUTH_CLIENT_ID'] }));
    const r = h2.callAction({ action: 'whoami', idToken: tok(STUDENT) });
    return r.code === 'server_misconfig' && !r.message ? true : JSON.stringify(r);
  });
}

// ===========================================================================
section('성능 회귀 — 읽는 셀 수 (계약 §4.5)');
// ===========================================================================
{
  // 3,100행(100명 × 31일) 규모의 월 시트에서 setRecord가 전체 열을 읽지 않아야 한다.
  const ym = '2026-06';
  const bulk = [];
  for (let d = 1; d <= 31; d++) {
    for (let u = 0; u < 100; u++) {
      bulk.push({
        '날짜': '2026-06-' + String(d).padStart(2, '0'),
        email: 'u' + u + '@example.com',
        '이름': 'U' + u, '구분': '학생', '말씀읽음': 'TRUE',
        '와닿은말씀': '가'.repeat(50), '결단': '나'.repeat(50), '중보기도': 'TRUE',
        '기록시각': '2026-06-01T00:00:00.000Z', '수정시각': '2026-06-01T00:00:00.000Z',
      });
    }
  }
  const records = {}; records['RECORDS_' + ym] = bulk;
  const h = createHarness(seedBase({ records }));
  const today = h.todayStr();

  t('시드 규모 확인 (3,100행)', () => eq(h.sheet('RECORDS_' + ym).objects().length, 3100, '행 수'));

  t('setRecord 스캔이 키 열 2개만 읽는다 (전체 10열 읽기 금지)', () => {
    // 대상 달을 6월로 강제하기 위해 6월 시트에 직접 upsert가 일어나도록
    // 오늘이 6월이 아니면 이 검사는 새 시트(빈 시트)에서 이뤄지므로 의미가 없다.
    // 대신 readColumnsByHeader_를 직접 호출해 셀 수를 측정한다.
    h.resetCells();
    h.context.readColumnsByHeader_('RECORDS_' + ym, ['날짜', 'email']);
    const cells = h.counter.cellsRead;
    // 헤더 1행(10셀) + 키 열 2개 × 3100행 = 6,210셀 근처여야 한다.
    // 전체 테이블을 읽으면 31,000셀을 넘는다.
    return cells < 10000 ? true : '읽은 셀 수=' + cells + ' (전체 열을 읽고 있음)';
  });

  t('readTable_ 전체 읽기와의 차이가 실제로 크다 (회귀 감지력 확인)', () => {
    h.resetCells();
    h.context.readTable_('RECORDS_' + ym);
    const full = h.counter.cellsRead;
    h.resetCells();
    h.context.readColumnsByHeader_('RECORDS_' + ym, ['날짜', 'email']);
    const partial = h.counter.cellsRead;
    return full > partial * 2 ? true : 'full=' + full + ' partial=' + partial;
  });
}

// ===========================================================================
section('파일 평가 순서 무관성');
// ===========================================================================
{
  t('최악의 파일 순서에서도 동작한다 (GAS 편집기 순서 의존 금지)', () => {
    const h = createHarness(seedBase({ fileOrder: ['Code.gs', 'Actions.gs', 'Auth.gs', 'Sheet.gs'] }));
    const r = h.callAction({ action: 'whoami', idToken: tok(STUDENT) });
    return r.ok ? true : JSON.stringify(r);
  });
}

// ===========================================================================
console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
