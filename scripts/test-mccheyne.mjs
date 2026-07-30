// scripts/test-mccheyne.mjs
// M'Cheyne(1842, classic) 365일 성경읽기표 검증 스크립트.
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED" 출력.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const planPath = path.join(__dirname, '..', 'web', 'js', 'mccheyne-plan.js');

// require는 ESM에서 createRequire로.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MccheynePlan = require(planPath);

let passCount = 0;
let failCount = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passCount++;
    console.log('  [PASS] ' + name);
  } catch (e) {
    failCount++;
    failures.push({ name, error: e });
    console.log('  [FAIL] ' + name);
    console.log('         ' + (e && e.message ? e.message : e));
  }
}

// 개역개정 66권 표준 명칭 (한글, 통용).
const VALID_BOOK_NAMES = [
  '창세기', '출애굽기', '레위기', '민수기', '신명기', '여호수아', '사사기', '룻기',
  '사무엘상', '사무엘하', '열왕기상', '열왕기하', '역대상', '역대하', '에스라', '느헤미야',
  '에스더', '욥기', '시편', '잠언', '전도서', '아가', '이사야', '예레미야',
  '예레미야애가', '에스겔', '다니엘', '호세아', '요엘', '아모스', '오바댜', '요나',
  '미가', '나훔', '하박국', '스바냐', '학개', '스가랴', '말라기',
  '마태복음', '마가복음', '누가복음', '요한복음', '사도행전', '로마서', '고린도전서', '고린도후서',
  '갈라디아서', '에베소서', '빌립보서', '골로새서', '데살로니가전서', '데살로니가후서',
  '디모데전서', '디모데후서', '디도서', '빌레몬서', '히브리서', '야고보서', '베드로전서', '베드로후서',
  '요한일서', '요한이서', '요한삼서', '유다서', '요한계시록'
];
assert.equal(VALID_BOOK_NAMES.length, 66, 'sanity: 66 book names expected');

// 정렬(길이 내림차순) - 접두어 매칭용 ("요한일서" 계열이 "요한복음"과 헷갈리지 않도록 전체 문자열 매칭 사용)
function extractBookName(reading) {
  // reading 예: "창세기 9-10장", "시편 78:1-37", "예레미야 36,45장"
  const spaceIdx = reading.indexOf(' ');
  if (spaceIdx === -1) return null;
  return reading.slice(0, spaceIdx);
}

// 날짜 -> 월/일 doy 계산용 (2026년은 평년)
const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function doyOf(month, day) {
  return CUM_DAYS[month - 1] + day;
}

console.log('=== M\'Cheyne 365일 성경읽기표 검증 ===\n');

// ---------------------------------------------------------------------------
// 1. 365일 전부 존재, 각 day family 2 + secret 2 (빈 값 없음)
// ---------------------------------------------------------------------------
console.log('[1] 365일 전체 존재 + family2/secret2 비어있지 않음');
check('365일 모두 getReadings가 유효한 결과를 반환', () => {
  for (let doy = 1; doy <= 365; doy++) {
    // doy -> 월/일 역산 (평년 기준)
    let month = 1;
    for (let mm = 12; mm >= 1; mm--) {
      if (doy > CUM_DAYS[mm - 1]) { month = mm; break; }
    }
    const day = doy - CUM_DAYS[month - 1];
    const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const result = MccheynePlan.getReadings(dateStr);
    assert.ok(result, `day ${doy} (${dateStr}) should return a result`);
    assert.equal(result.day, doy, `day ${doy} (${dateStr}) result.day mismatch: got ${result.day}`);
    assert.ok(Array.isArray(result.family) && result.family.length === 2, `day ${doy} family must have 2 entries`);
    assert.ok(Array.isArray(result.secret) && result.secret.length === 2, `day ${doy} secret must have 2 entries`);
    for (const s of [...result.family, ...result.secret]) {
      assert.equal(typeof s, 'string', `day ${doy} reading must be string`);
      assert.ok(s.trim().length > 0, `day ${doy} reading must not be empty`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. 1/1 = 창세기 1 / 마태복음 1 / 에스라 1 / 사도행전 1
// ---------------------------------------------------------------------------
console.log('\n[2] 1/1 표준 시작 확인');
check('2026-01-01 => family:[창세기 1장, 마태복음 1장], secret:[에스라 1장, 사도행전 1장]', () => {
  const r = MccheynePlan.getReadings('2026-01-01');
  assert.ok(r);
  assert.equal(r.day, 1);
  assert.deepEqual(r.family, ['창세기 1장', '마태복음 1장']);
  assert.deepEqual(r.secret, ['에스라 1장', '사도행전 1장']);
});

// ---------------------------------------------------------------------------
// 3. 12/31 확인 (소스 대조: 말라기 4장, 요한계시록 22장 등)
// ---------------------------------------------------------------------------
console.log('\n[3] 12/31 확인');
check('2026-12-31 => day 365, family:[역대하 36장, 요한계시록 22장], secret:[말라기 4장, 요한복음 21장]', () => {
  const r = MccheynePlan.getReadings('2026-12-31');
  assert.ok(r);
  assert.equal(r.day, 365);
  assert.deepEqual(r.family, ['역대하 36장', '요한계시록 22장']);
  assert.deepEqual(r.secret, ['말라기 4장', '요한복음 21장']);
});

// ---------------------------------------------------------------------------
// 4. 한국어 책명만 사용(영어 알파벳 미포함), 66권 매핑 외 책명 없음
// ---------------------------------------------------------------------------
console.log('\n[4] 한국어 책명 전용 + 66권 매핑 외 책명 없음');
check('모든 본문 문자열에 영어 알파벳(A-Za-z)이 없어야 함', () => {
  for (let doy = 1; doy <= 365; doy++) {
    let month = 1;
    for (let mm = 12; mm >= 1; mm--) {
      if (doy > CUM_DAYS[mm - 1]) { month = mm; break; }
    }
    const day = doy - CUM_DAYS[month - 1];
    const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const r = MccheynePlan.getReadings(dateStr);
    for (const s of [...r.family, ...r.secret]) {
      assert.ok(!/[A-Za-z]/.test(s), `"${s}" (day ${doy}) contains ASCII letters`);
    }
  }
});
check('모든 본문의 책명이 개역개정 66권 목록 안에 있어야 함', () => {
  const unknown = new Set();
  for (let doy = 1; doy <= 365; doy++) {
    let month = 1;
    for (let mm = 12; mm >= 1; mm--) {
      if (doy > CUM_DAYS[mm - 1]) { month = mm; break; }
    }
    const day = doy - CUM_DAYS[month - 1];
    const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const r = MccheynePlan.getReadings(dateStr);
    for (const s of [...r.family, ...r.secret]) {
      const book = extractBookName(s);
      if (!book || !VALID_BOOK_NAMES.includes(book)) unknown.add(book + ' <- ' + s);
    }
  }
  assert.equal(unknown.size, 0, '알 수 없는 책명 발견: ' + [...unknown].join(', '));
});

// ---------------------------------------------------------------------------
// 5. getReadings 정상 반환 / 2/29 == 2/28 / 잘못된 입력 -> null
// ---------------------------------------------------------------------------
console.log('\n[5] 2026-07-18 정상 반환 / 2/29==2/28 / 잘못된 입력 -> null');
check('getReadings("2026-07-18")는 day 199의 유효한 결과를 반환', () => {
  const r = MccheynePlan.getReadings('2026-07-18');
  assert.ok(r);
  assert.equal(r.day, doyOf(7, 18));
  assert.deepEqual(r.family, ['사사기 1장', '사도행전 5장']);
  assert.deepEqual(r.secret, ['예레미야 14장', '마태복음 28장']);
});
check('getReadings("2026-02-29")는 getReadings("2026-02-28")과 동일 (윤년 아닌 해라도 처리)', () => {
  const feb29 = MccheynePlan.getReadings('2026-02-29');
  const feb28 = MccheynePlan.getReadings('2026-02-28');
  assert.ok(feb29);
  assert.ok(feb28);
  assert.deepEqual(feb29, feb28);
});
check('윤년(2024)의 2/29도 동일하게 처리', () => {
  const feb29 = MccheynePlan.getReadings('2024-02-29');
  const feb28 = MccheynePlan.getReadings('2024-02-28');
  assert.deepEqual(feb29, feb28);
});
check('잘못된 입력들은 모두 null 반환', () => {
  const badInputs = [
    'not-a-date',
    '2026/07/18',
    '2026-13-01',   // 존재하지 않는 월
    '2026-00-10',   // 월 0
    '2026-04-31',   // 4월 31일 없음
    '2026-02-30',   // 2월 30일 없음
    '',
    null,
    undefined,
    12345,
    '2026-7-18',    // 0-padding 없음 (계약: YYYY-MM-DD 고정폭)
    '2026-01-00',   // 일 0
  ];
  for (const input of badInputs) {
    const r = MccheynePlan.getReadings(input);
    assert.equal(r, null, `input ${JSON.stringify(input)} should return null, got ${JSON.stringify(r)}`);
  }
});

// ---------------------------------------------------------------------------
// 6. 책 등장 횟수 sanity check (신약/시편 2회, 그 외 구약 1회 통독)
// ---------------------------------------------------------------------------
console.log('\n[6] 책 등장 횟수 sanity check');
function countBookOccurrences(bookName) {
  let count = 0;
  for (let doy = 1; doy <= 365; doy++) {
    let month = 1;
    for (let mm = 12; mm >= 1; mm--) {
      if (doy > CUM_DAYS[mm - 1]) { month = mm; break; }
    }
    const day = doy - CUM_DAYS[month - 1];
    const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const r = MccheynePlan.getReadings(dateStr);
    for (const s of [...r.family, ...r.secret]) {
      if (extractBookName(s) === bookName) count++;
    }
  }
  return count;
}
check('마태복음(28장)은 연 2회 통독 => 56회 등장', () => {
  assert.equal(countBookOccurrences('마태복음'), 56);
});
check('요한계시록(22장)은 연 2회 통독 => 44회 등장', () => {
  assert.equal(countBookOccurrences('요한계시록'), 44);
});
check('창세기는 구약 1회 통독 대상 (48~50회 등장, 일부 챕터 병합으로 50 미만 가능)', () => {
  const n = countBookOccurrences('창세기');
  assert.ok(n >= 45 && n <= 50, `창세기 등장 횟수 ${n}가 예상 범위(45~50) 밖`);
});
check('시편은 신약과 함께 연 2회 통독 대상이므로 100회 이상 등장', () => {
  const n = countBookOccurrences('시편');
  assert.ok(n >= 100, `시편 등장 횟수 ${n}가 예상보다 적음`);
});

// ---------------------------------------------------------------------------
console.log('\n=== 결과 ===');
console.log(`PASS: ${passCount}, FAIL: ${failCount}`);
if (failCount > 0) {
  console.log('\nFAILED TESTS:');
  for (const f of failures) console.log(' - ' + f.name);
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
  process.exit(0);
}
