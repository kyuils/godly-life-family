// scripts/test-gas-actions.mjs — GAS 백엔드 단위 테스트 + 보안 회귀 테스트.
//
// CLAUDE.md 「완료 기준」: 보안 불변식 1~6 각각에 대한 명시적 회귀 테스트가
// 반드시 포함되어야 하며, 이 6개가 없으면 완료를 선언하지 않는다.
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

import { createHarness, NAMES, HEADERS, ALL_GAS_FILES } from './gas-harness.mjs';
import { readFileSync } from 'node:fs';

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
const MEMBER = 'member1@example.com';   // 혜림교회 성도 (v1.2)

function seedBase(extra = {}) {
  return Object.assign({
    students: [
      { email: STUDENT, 이름: '김학생', 학년반: '중2-1', active: 'TRUE', 가입시각: '2026-01-15', 가입경로: 'self' },
      { email: OTHER, 이름: '이학생', 학년반: '중3-2', active: 'TRUE', 가입시각: '2026-02-01', 가입경로: 'self' },
    ],
    parents: [
      { email: PARENT, 이름: '박학부모', 자녀이름: '김학생', active: 'TRUE', 가입시각: '2026-01-20', 가입경로: 'self' },
    ],
    members: [
      { email: MEMBER, 이름: '최성도', 소속전도회: '한나전도회', active: 'TRUE', 가입시각: '2026-03-01', 가입경로: 'self' },
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
  t('계약 §4.2대로 bad_code 5회까지만 허용, 6회째 차단 (email 백오프)', () => {
    const h = createHarness(seedBase());
    const codes = [];
    for (let i = 0; i < 7; i++) {
      codes.push(h.callAction({ action: 'register', idToken: tok(NEW), name: 'x', kind: 'student', code: 'wrong' }).code);
    }
    // 1~5회째는 bad_code, 6회째부터 too_many_attempts 여야 한다.
    const first5 = codes.slice(0, 5).every((c) => c === 'bad_code');
    const blocked = codes.slice(5).every((c) => c === 'too_many_attempts');
    return (first5 && blocked) || JSON.stringify(codes);
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

// --- 불변식 1-b: 토큰 클레임 검증 (aud / iss / exp / email_verified) ---
// 이 앱의 GAS 엔드포인트는 ANYONE_ANONYMOUS로 인터넷 전체에 열려 있다.
// aud 검사가 사라지면 "아무 구글 앱에서 발급받은 ID 토큰"으로 로그인이 뚫린다.
// 명부에 이름만 있으면 완전한 계정 탈취가 된다 — 인증의 급소다.
{
  const h = createHarness(seedBase());
  const cases = [
    ['다른 앱에서 발급된 토큰(aud 불일치)', 'badaud:' + STUDENT, 'aud_mismatch'],
    ['발급자가 구글이 아님(iss 불일치)', 'badiss:' + STUDENT, 'iss_mismatch'],
    ['만료된 토큰', 'expired:' + STUDENT, 'token_expired'],
    ['이메일 미인증 계정', 'unverified:' + STUDENT, 'email_unverified'],
    ['이메일이 없는 토큰', 'noemail:' + STUDENT, 'email_unverified'],
  ];
  for (const [label, token, expected] of cases) {
    t('[1-b] ' + label + ' → ' + expected, () =>
      eq(h.callAction({ action: 'whoami', idToken: token }).code, expected));
    t('[1-b] ' + label + ' — 기록 저장도 거부', () =>
      h.callAction({ action: 'setRecord', idToken: token, date: h.todayStr(), wordRead: true }).ok === false
        ? true : '저장이 통과함');
  }
  t("[1-b] iss가 'https://accounts.google.com' 이어도 통과한다 (구글이 실제로 쓰는 값)", () =>
    eq(h.callAction({ action: 'whoami', idToken: 'issurl:' + STUDENT }).ok, true));
  t('[1-b] ★ 토큰 캐시가 만료된 토큰을 되살리지 않는다', () => {
    // 이 검사가 의미를 가지려면 **같은 토큰 문자열**로 캐시를 채운 뒤 그 토큰이
    // 만료되어야 한다. 다른 프리픽스 토큰을 쓰면 다이제스트 키가 달라져
    // Auth.gs의 캐시 히트 분기를 아예 밟지 못한다(= 공허한 테스트).
    // 수명 60초 토큰으로 캐시를 채운다(토큰 캐시 TTL은 300초라 캐시가 토큰보다 오래 산다).
    const h2 = createHarness(seedBase());
    const shortTok = 'short:' + STUDENT;
    if (!h2.callAction({ action: 'whoami', idToken: shortTok }).ok) return '캐시 준비 실패';
    h2.advanceClock(120);   // 2분 경과 — 토큰은 만료, 캐시 엔트리는 아직 살아 있다
    return eq(h2.callAction({ action: 'whoami', idToken: shortTok }).code, 'token_expired');
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
  t('[5] ★ 명부에 손으로 넣은 수식 이름이 RECORDS/PRAYERS로 전파되지 않는다', () => {
    // 명부는 사람이 직접 편집한다. 거기 =HYPERLINK(...)를 넣으면 기록 시트로 번진다.
    const h3 = createHarness(seedBase({
      students: [{ email: STUDENT, 이름: '=HYPERLINK("evil","x")', active: 'TRUE', 가입시각: '2026-01-15' }],
    }));
    const today = h3.todayStr();
    h3.callAction({ action: 'setRecord', idToken: tok(STUDENT), date: today, wordRead: true });
    h3.callAction({ action: 'addPrayer', idToken: tok(STUDENT), text: '기도' });
    const rec = h3.sheet('RECORDS_' + today.slice(0, 7)).objects()[0];
    const pray = h3.sheet(NAMES.PRAYERS).objects()[0];
    if (!String(rec['이름']).startsWith("'=")) return 'RECORDS 이름 미정제: ' + rec['이름'];
    if (!String(pray['이름']).startsWith("'=")) return 'PRAYERS 이름 미정제: ' + pray['이름'];
    return true;
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
  // ★ 시드를 "이번 달" 시트로 만든다 — 그래야 실제 setRecord가 이 시트를 대상으로 삼는다.
  //   고정된 과거 달로 시드하면 setRecord는 빈 새 시트에 쓰게 되고, 테스트는 헬퍼를
  //   직접 호출하는 우회 검사로 전락한다(2026-07-30 최종 검토 [중대] 지적).
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })
    .format(new Date()).slice(0, 7);
  const bulk = [];
  const daysInMonth = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    for (let u = 0; u < 100; u++) {
      const date = ym + '-' + String(d).padStart(2, '0');
      bulk.push({
        '날짜': date,
        email: 'u' + u + '@example.com',
        '이름': 'U' + u, '구분': '학생', '말씀읽음': 'TRUE',
        '와닿은말씀': '가'.repeat(50), '결단': '나'.repeat(50), '중보기도': 'TRUE',
        '기록시각': date + 'T00:00:00.000Z', '수정시각': date + 'T00:00:00.000Z',
      });
    }
  }
  const records = {}; records['RECORDS_' + ym] = bulk;
  const h = createHarness(seedBase({ records }));
  const today = h.todayStr();
  const expectedRows = daysInMonth * 100;

  t('시드 규모 확인 (' + expectedRows + '행 = 100명 × ' + daysInMonth + '일)', () =>
    eq(h.sheet('RECORDS_' + ym).objects().length, expectedRows, '행 수'));

  t('★ 실제 setRecord가 읽는 셀 수 — 키 열 2개만 (전체 10열 읽기 금지)', () => {
    h.resetCells();
    const r = h.callAction({
      action: 'setRecord', idToken: tok(STUDENT), date: today,
      wordRead: true, verse: '성능 측정', resolution: '', intercession: false,
    });
    if (!r.ok) return '저장 실패: ' + JSON.stringify(r);
    const cells = h.counter.cellsRead;
    // 헤더 + 키 열 2개 × N행 ≈ 2N. 전체 테이블을 읽으면 10N이 된다.
    // 신규 행 append 경로이므로 read-verify-write의 행 읽기는 없다.
    const limit = expectedRows * 4;
    return cells < limit
      ? true
      : '읽은 셀 수=' + cells + ' (상한 ' + limit + ') — 전체 열을 읽고 있습니다';
  });

  t('★ 기존 행 갱신(upsert) 경로도 전체 열을 읽지 않는다', () => {
    // 위에서 만든 행을 다시 저장 → 이번엔 update 경로 + read-verify-write가 탄다.
    h.resetCells();
    const r = h.callAction({
      action: 'setRecord', idToken: tok(STUDENT), date: today,
      wordRead: true, verse: '성능 측정 2회차', resolution: '', intercession: false,
    });
    if (!r.ok) return '저장 실패: ' + JSON.stringify(r);
    const cells = h.counter.cellsRead;
    const limit = expectedRows * 4;
    return cells < limit
      ? true
      : '읽은 셀 수=' + cells + ' (상한 ' + limit + ')';
  });

  t('회귀 감지력 확인 — 전체 읽기로 바꾸면 상한을 넘는다', () => {
    // readTable_(전체 열)이 실제로 상한을 초과하는지 확인해, 위 두 테스트가
    // 느슨해서 통과한 것이 아님을 보인다.
    h.resetCells();
    h.context.readTable_('RECORDS_' + ym);
    const full = h.counter.cellsRead;
    return full >= expectedRows * 4
      ? true
      : '전체 읽기=' + full + ' — 상한(' + (expectedRows * 4) + ')이 너무 느슨해 회귀를 못 잡습니다';
  });
}

// ===========================================================================
section('Setup.gs (비개발자가 직접 실행하는 파일)');
// ===========================================================================
{
  // Setup.gs는 런타임 라우터를 타지 않아 다른 테스트가 전혀 건드리지 않는다.
  // 그런데 이 파일은 **비개발자가 GAS 편집기에서 직접 ▶ 실행하는 유일한 파일**이다.
  // 구문 오류가 있으면 설치 첫 단계에서 막히고, 원인을 스스로 진단할 수 없다.
  t('구문 오류 없이 로드되고 다른 파일을 깨뜨리지 않는다', () => {
    const h = createHarness(seedBase({ fileOrder: ALL_GAS_FILES }));
    const r = h.callAction({ action: 'whoami', idToken: tok(STUDENT) });
    return r.ok ? true : JSON.stringify(r);
  });
  t('setupAll / protectDataSheets 함수가 실제로 정의되어 있다', () => {
    const h = createHarness(seedBase({ fileOrder: ALL_GAS_FILES }));
    const missing = ['setupAll', 'setupProperties_', 'setupTabs_', 'protectDataSheets', 'ensureTab_']
      .filter((f) => typeof h.context[f] !== 'function');
    return missing.length === 0 || '정의되지 않음: ' + missing.join(', ');
  });
  t('Setup.gs가 Sheet.gs의 상수(SHEET_NAMES/HEADERS)를 그대로 쓴다', () => {
    // 헤더를 Setup.gs에 따로 복사해 두면 스키마가 갈라진다.
    const src = readFileSync(new URL('../gas/Setup.gs', import.meta.url), 'utf8');
    if (/const\s+SETUP_\w*HEADERS/.test(src)) return 'Setup.gs가 헤더를 따로 정의하고 있음';
    return /HEADERS\.MEMBERS_STUDENT/.test(src) || 'Sheet.gs의 HEADERS를 쓰지 않음';
  });
}

// ===========================================================================
section('★ 가입 3분류 — 성도(member) (v1.2)');
// ===========================================================================
//
// 성도는 «우리반»이 아니다. 날주·달력·자료만 쓰고 기도 요청은 쓸 수 없다(계약 §2.2b).
// 여기서 보는 것은 «권한이 새지 않는가»와 «데이터가 위조되지 않는가»이다.
{
  const h = createHarness(seedBase());
  const TODAY = h.todayStr();

  t('성도가 로그인하면 kind/role이 member다', () => {
    const r = h.callAction({ action: 'whoami', idToken: tok(MEMBER) });
    if (!r.ok) return JSON.stringify(r);
    return eq(r.kind, 'member', 'kind') || eq(r.role, 'member', 'role') ||
      eq(r.extra, '한나전도회', 'extra');
  });

  t('★ 성도는 교사 전용 액션 3개에 전부 forbidden', () => {
    const acts = ['getMembers', 'getAllRecords', 'getAllPrayers'];
    const bad = acts.filter((a) => h.callAction({ action: a, idToken: tok(MEMBER) }).code !== 'forbidden');
    return bad.length === 0 || '통과해버린 액션: ' + bad.join(', ');
  });

  t('★ 성도는 기도 액션 4개에 전부 forbidden', () => {
    const calls = [
      { action: 'getMyPrayers' },
      { action: 'addPrayer', text: '기도제목' },
      { action: 'setPrayerAnswered', id: 'x', answered: true },
      { action: 'deletePrayer', id: 'x' },
    ];
    const bad = calls
      .map((c) => Object.assign({ idToken: tok(MEMBER) }, c))
      .filter((c) => h.callAction(c).code !== 'forbidden')
      .map((c) => c.action);
    return bad.length === 0 || '통과해버린 액션: ' + bad.join(', ');
  });

  t('성도도 날주는 쓸 수 있다 (getMyRecords / setRecord)', () => {
    const g = h.callAction({ action: 'getMyRecords', idToken: tok(MEMBER), months: [TODAY.slice(0, 7)] });
    if (!g.ok) return 'getMyRecords: ' + JSON.stringify(g);
    const w = h.callAction({
      action: 'setRecord', idToken: tok(MEMBER),
      date: TODAY, wordRead: true, verse: '', resolution: '', intercession: false,
    });
    return w.ok ? true : 'setRecord: ' + JSON.stringify(w);
  });
}

{
  const h = createHarness(seedBase());
  const TODAY = h.todayStr();
  h.callAction({
    action: 'setRecord', idToken: tok(MEMBER),
    date: TODAY, wordRead: true, verse: '', resolution: '', intercession: false,
  });

  t('★ 성도의 기록은 구분이 «성도»로 남는다 (학생으로 위조되지 않음)', () => {
    const sh = h.sheet('RECORDS_' + TODAY.slice(0, 7));
    const headers = sh.data[0];
    const iEmail = headers.indexOf('email');
    const iKind = headers.indexOf('구분');
    const rows = sh.data.slice(1).filter((r) => String(r[iEmail]).toLowerCase() === MEMBER);
    if (!rows.length) return '성도 기록 행이 없다';
    return eq(String(rows[0][iKind]), '성도', '구분');
  });

  t('★ 교사의 «우리반»에 성도가 나타나지 않는다', () => {
    const recs = h.callAction({ action: 'getAllRecords', idToken: tok(TEACHER), days: 60 });
    if (!recs.ok) return JSON.stringify(recs);
    const leaked = recs.rows.filter((r) => String(r.email).toLowerCase() === MEMBER);
    if (leaked.length) return 'getAllRecords에 성도 기록이 ' + leaked.length + '건 섞였다';

    const mem = h.callAction({ action: 'getMembers', idToken: tok(TEACHER) });
    if (!mem.ok) return JSON.stringify(mem);
    const inList = mem.members.filter((m) => String(m.email).toLowerCase() === MEMBER);
    return inList.length === 0 || 'getMembers에 성도가 들어 있다';
  });

  t('★ getMembers 응답에 학교가 들어 있지 않다 (시트에만 둔다)', () => {
    const r = h.callAction({ action: 'getMembers', idToken: tok(TEACHER) });
    if (!r.ok) return JSON.stringify(r);
    return /"school"|학교/.test(JSON.stringify(r)) ? '응답에 학교가 있다' : true;
  });
}

{
  t('★ 성도 email이 학생으로 재가입할 수 없다 (already_registered)', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    const r = h.callAction({
      action: 'register', idToken: tok(MEMBER),
      kind: 'student', name: '최성도', extra: '중1-1', code: 'hyerim2026',
    });
    return eq(r.code, 'already_registered');
  });

  t('★ register(kind:member)로 성도 명부에 등재된다', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    const before = h.sheet('MEMBERS_성도').data.length;
    const r = h.callAction({
      action: 'register', idToken: tok('newmember@example.com'),
      kind: 'member', name: '새성도', extra: '드보라전도회', code: 'hyerim2026',
    });
    if (!r.ok) return JSON.stringify(r);
    const data = h.sheet('MEMBERS_성도').data;
    if (data.length !== before + 1) return '행 수 ' + before + ' → ' + data.length;
    return eq(String(data[data.length - 1][data[0].indexOf('소속전도회')]), '드보라전도회', '소속전도회');
  });

  t('★ register(kind:teacher)는 여전히 거부된다 (보안 불변식 3)', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    const before = h.sheet('MEMBERS_교사').data.length;
    const r = h.callAction({
      action: 'register', idToken: tok('evil@example.com'),
      kind: 'teacher', name: '가짜교사', extra: '', code: 'hyerim2026',
    });
    if (r.code !== 'bad_request') return 'code=' + r.code;
    return eq(h.sheet('MEMBERS_교사').data.length, before, '교사 행 수');
  });

  t('★ 학생 가입 시 학교가 «올바른 열»에 저장된다', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    const r = h.callAction({
      action: 'register', idToken: tok('newstudent@example.com'),
      kind: 'student', name: '새학생', extra: '중1-3', school: '혜림중학교', code: 'hyerim2026',
    });
    if (!r.ok) return JSON.stringify(r);
    const data = h.sheet('MEMBERS_학생').data;
    const headers = data[0];
    const row = data[data.length - 1];
    if (headers.indexOf('학교') < 0) return '학교 열이 없다';
    return eq(String(row[headers.indexOf('학교')]), '혜림중학교', '학교') ||
      eq(String(row[headers.indexOf('학년반')]), '중1-3', '학년반') ||
      eq(String(row[headers.indexOf('active')]), 'TRUE', 'active');
  });

  t('★ 학부모·성도가 school을 보내도 어디에도 저장되지 않는다', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    h.callAction({
      action: 'register', idToken: tok('p2@example.com'),
      kind: 'parent', name: '학부모2', extra: '김학생', school: '몰래학교', code: 'hyerim2026',
    });
    h.callAction({
      action: 'register', idToken: tok('m2@example.com'),
      kind: 'member', name: '성도2', extra: '한나전도회', school: '몰래학교', code: 'hyerim2026',
    });
    const blob = JSON.stringify(h.sheet('MEMBERS_학부모').data) +
      JSON.stringify(h.sheet('MEMBERS_성도').data);
    return blob.indexOf('몰래학교') < 0 || '시트에 school 값이 새어 들어갔다';
  });

  t('★ 구 헤더(학교 열 없음)에 학생 가입 → server_misconfig (조용한 누락 금지)', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    // setupAll을 아직 실행하지 않은 상태를 재현한다 — 헤더에서 «학교»만 뗀다.
    const sh = h.sheet('MEMBERS_학생');
    const i = sh.data[0].indexOf('학교');
    sh.data.forEach((row) => row.splice(i, 1));
    const r = h.callAction({
      action: 'register', idToken: tok('newstudent2@example.com'),
      kind: 'student', name: '새학생2', extra: '중2-2', school: '혜림중학교', code: 'hyerim2026',
    });
    return eq(r.code, 'server_misconfig');
  });

  t('★ 학교·소속전도회에도 수식 인젝션 방어가 걸린다 (불변식 5)', () => {
    const h = createHarness(seedBase({ registerCode: 'hyerim2026' }));
    h.callAction({
      action: 'register', idToken: tok('s9@example.com'),
      kind: 'student', name: '학생9', extra: '중3-1', school: '=SUM(A1)', code: 'hyerim2026',
    });
    h.callAction({
      action: 'register', idToken: tok('m9@example.com'),
      kind: 'member', name: '성도9', extra: '=SUM(A1)', code: 'hyerim2026',
    });
    const st = h.sheet('MEMBERS_학생').data;
    const mb = h.sheet('MEMBERS_성도').data;
    const school = String(st[st.length - 1][st[0].indexOf('학교')]);
    const group = String(mb[mb.length - 1][mb[0].indexOf('소속전도회')]);
    if (school.charAt(0) !== String.fromCharCode(39)) return '학교: ' + school;
    if (group.charAt(0) !== String.fromCharCode(39)) return '소속전도회: ' + group;
    return true;
  });
}

{
  t('★ 우선순위 전수 — 교사 › 학부모 › 학생 › 성도', () => {
    const dup = (email) => [{ email: email, 이름: '겹침', 소속전도회: 'x', active: 'TRUE', 가입시각: '2026-03-01', 가입경로: 'self' }];
    const cases = [
      { label: '성도+교사', email: TEACHER, want: 'teacher' },
      { label: '학부모+성도', email: PARENT, want: 'parent' },
      { label: '학생+성도', email: STUDENT, want: 'student' },
    ];
    const bad = [];
    cases.forEach((c) => {
      const h = createHarness(seedBase({ members: dup(c.email) }));
      const r = h.callAction({ action: 'whoami', idToken: tok(c.email) });
      if (!r.ok || r.kind !== c.want) bad.push(c.label + '→' + (r.kind || r.code));
    });
    return bad.length === 0 || bad.join(', ');
  });

  t('★ 비활성 성도는 unauthorized (활성 행만 후보)', () => {
    const h = createHarness(seedBase({
      members: [{ email: MEMBER, 이름: '최성도', 소속전도회: '한나전도회', active: 'FALSE', 가입시각: '2026-03-01', 가입경로: 'self' }],
    }));
    return eq(h.callAction({ action: 'whoami', idToken: tok(MEMBER) }).code, 'unauthorized');
  });
}

{
  t('★ 하네스 스키마가 Sheet.gs와 어긋나지 않는다 (양방향 키 비교)', () => {
    // 하네스는 Sheet.gs의 스키마를 «사본»으로 들고 있다. 갈라지면 테스트가
    // 실제와 다른 스키마 위에서 통과해 버린다 — 그러면 검증이 무의미해진다.
    // const로 선언한 값은 vm 컨텍스트에 노출되지 않으므로 소스에서 직접 읽는다.
    const src = readFileSync(new URL('../gas/Sheet.gs', import.meta.url), 'utf8');
    const literal = (name) => {
      const m = new RegExp('const ' + name + ' = (\\{[\\s\\S]*?\\n\\});').exec(src);
      if (!m) return null;
      return new Function('return (' + m[1] + ')')();
    };
    const gasHeaders = literal('HEADERS');
    const gasNames = literal('SHEET_NAMES');
    if (!gasHeaders || !gasNames) return 'Sheet.gs에서 HEADERS/SHEET_NAMES를 읽지 못했다';
    const problems = [];

    const kA = Object.keys(HEADERS).sort();
    const kB = Object.keys(gasHeaders).sort();
    if (kA.join(',') !== kB.join(',')) {
      problems.push('HEADERS 키: harness[' + kA.join(',') + '] vs gas[' + kB.join(',') + ']');
    }
    kA.filter((k) => kB.indexOf(k) >= 0).forEach((k) => {
      if (HEADERS[k].join('|') !== gasHeaders[k].join('|')) problems.push('HEADERS.' + k + ' 값 불일치');
    });

    const nA = Object.keys(NAMES).sort();
    const nB = Object.keys(gasNames).sort();
    if (nA.join(',') !== nB.join(',')) {
      problems.push('SHEET_NAMES 키: harness[' + nA.join(',') + '] vs gas[' + nB.join(',') + ']');
    }
    nA.filter((k) => nB.indexOf(k) >= 0).forEach((k) => {
      if (NAMES[k] !== gasNames[k]) problems.push('SHEET_NAMES.' + k + ' 값 불일치');
    });

    return problems.length === 0 || problems.join(' / ');
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
