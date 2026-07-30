// scripts/test-stats.mjs — 지표 순수 함수 검증 (계약 §3, §3.1, §7).
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

import * as S from '../web/js/stats.js';

let pass = 0;
const failures = [];
let group = '';

function section(t) { group = t; console.log('\n--- ' + t + ' ---'); }
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
function eq(a, b, what) {
  if (a === b) return true;
  return (what || 'value') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a);
}

// 날짜 목록 → rows
function rowsFor(dates, opts = {}) {
  return dates.map((d) => ({ date: d, wordRead: true, intercession: !!opts.intercession }));
}

section('날짜 유틸');
t('addDays 기본', () => eq(S.addDays('2026-07-30', 1), '2026-07-31'));
t('addDays 월 경계', () => eq(S.addDays('2026-07-31', 1), '2026-08-01'));
t('addDays 연 경계(역방향)', () => eq(S.addDays('2027-01-01', -1), '2026-12-31'));
t('addDays 윤년 2/29', () => eq(S.addDays('2028-02-28', 1), '2028-02-29'));
t('addDays 평년 2/28 → 3/1', () => eq(S.addDays('2026-02-28', 1), '2026-03-01'));
t('weekdayMon0: 2026-07-30은 목요일(3)', () => eq(S.weekdayMon0('2026-07-30'), 3));
t('mondayOf: 목요일 → 같은 주 월요일', () => eq(S.mondayOf('2026-07-30'), '2026-07-27'));
t('mondayOf: 월요일이면 자기 자신', () => eq(S.mondayOf('2026-07-27'), '2026-07-27'));
t('mondayOf: 일요일 → 그 주 월요일', () => eq(S.mondayOf('2026-08-02'), '2026-07-27'));
t('firstOfMonth', () => eq(S.firstOfMonth('2026-07-30'), '2026-07-01'));

section('streak (계약 §3)');
t('오늘 기록 완료 + 3일 연속 = 3', () =>
  eq(S.computeStreak(rowsFor(['2026-07-28', '2026-07-29', '2026-07-30']), '2026-07-30'), 3));
t('오늘 미기록이어도 어제까지 연속이면 끊지 않는다', () =>
  eq(S.computeStreak(rowsFor(['2026-07-28', '2026-07-29']), '2026-07-30'), 2));
t('어제도 미기록이면 0', () =>
  eq(S.computeStreak(rowsFor(['2026-07-27', '2026-07-28']), '2026-07-30'), 0));
t('기록 없음 → 0', () => eq(S.computeStreak([], '2026-07-30'), 0));
t('중간에 빈 날이 있으면 거기서 끊긴다', () =>
  eq(S.computeStreak(rowsFor(['2026-07-25', '2026-07-26', '2026-07-29', '2026-07-30']), '2026-07-30'), 2));
t('wordRead=false인 날은 기록한 날이 아니다', () => {
  const rows = [
    { date: '2026-07-29', wordRead: true },
    { date: '2026-07-30', wordRead: false, verse: '텍스트만 있음' },
  ];
  return eq(S.computeStreak(rows, '2026-07-30'), 1);
});
t('중보기도만 한 날은 기록한 날이 아니다', () => {
  const rows = [{ date: '2026-07-30', wordRead: false, intercession: true }];
  return eq(S.computeStreak(rows, '2026-07-30'), 0);
});
t('월 경계를 넘어 이어진다', () => {
  const dates = [];
  for (let d = 28; d <= 31; d++) dates.push('2026-07-' + d);
  for (let d = 1; d <= 3; d++) dates.push('2026-08-0' + d);
  return eq(S.computeStreak(rowsFor(dates), '2026-08-03'), 7);
});
t('연 경계를 넘어 이어진다', () => {
  const dates = ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
  return eq(S.computeStreak(rowsFor(dates), '2027-01-02'), 4);
});

section('streak 월 확장 판정 (계약 §3.1 — 데이터 기준)');
t('연속 구간이 로드된 가장 이른 달의 1일에 닿으면 더 불러와야 한다', () => {
  const dates = [];
  for (let d = 1; d <= 31; d++) dates.push('2026-07-' + String(d).padStart(2, '0'));
  for (let d = 1; d <= 8; d++) dates.push('2026-08-0' + d);
  return eq(S.streakNeedsMoreMonths(rowsFor(dates), '2026-08-08', ['2026-08', '2026-07']), true);
});
t('연속 구간이 달 중간에서 끊기면 더 불러올 필요 없다', () => {
  const dates = [];
  for (let d = 10; d <= 31; d++) dates.push('2026-07-' + d);
  for (let d = 1; d <= 8; d++) dates.push('2026-08-0' + d);
  return eq(S.streakNeedsMoreMonths(rowsFor(dates), '2026-08-08', ['2026-08', '2026-07']), false);
});
t('streak가 0이면 더 불러올 필요 없다', () =>
  eq(S.streakNeedsMoreMonths([], '2026-08-08', ['2026-08', '2026-07']), false));
t('★ 긴 연속기록 사용자가 1월 8일에 8일로 잘리지 않는다 (검토 지적 5번)', () => {
  // 2026-07-01 ~ 2027-01-08 연속 기록(192일). 서버는 "요청한 달"의 행만 돌려주므로
  // 프론트가 가진 rows도 로드한 달로 제한된다 — 그 상황을 그대로 재현한다.
  const TODAY = '2027-01-08';
  const all = [];
  let cur = '2026-07-01';
  while (cur <= TODAY) { all.push(cur); cur = S.addDays(cur, 1); }
  const serverRows = (months) => rowsFor(all.filter((d) => months.indexOf(S.ymOf(d)) >= 0));

  let months = S.defaultMonths(TODAY); // ['2027-01','2026-12']
  if (S.computeStreak(serverRows(months), TODAY) !== 39) {
    // 12/1~1/8 = 39일. 기본 2개월만 보면 여기서 멈춘다.
    return '초기 streak=' + S.computeStreak(serverRows(months), TODAY);
  }

  // 데이터 기준 판정이 "더 필요"라고 답하는 동안 계속 확장한다.
  let guard = 0;
  while (S.streakNeedsMoreMonths(serverRows(months), TODAY, months) && months.length < 6 && guard++ < 10) {
    months = S.extendMonths(months, 6);
  }

  if (months.length !== 6) return '월을 끝까지 확장하지 않음: ' + JSON.stringify(months);
  // 2026-08-01 ~ 2027-01-08 = 161일. 8일이 아니라 161일로 나와야 한다.
  const streak = S.computeStreak(serverRows(months), TODAY);
  return streak === 161 ? true : 'streak=' + streak + ' (기대 161)';
});
t('6개월 상한에 걸렸는지 판정할 수 있다 (화면에 180일+ 표기용)', () => {
  const TODAY = '2027-01-08';
  const all = [];
  let cur = '2026-07-01';
  while (cur <= TODAY) { all.push(cur); cur = S.addDays(cur, 1); }
  const months = ['2027-01', '2026-12', '2026-11', '2026-10', '2026-09', '2026-08'];
  const rows = rowsFor(all.filter((d) => months.indexOf(S.ymOf(d)) >= 0));
  // 상한에 걸린 상태 = 아직도 "더 필요"라고 답한다 → 화면은 '+' 를 붙인다.
  return eq(S.streakNeedsMoreMonths(rows, TODAY, months), true);
});
t('defaultMonths는 [이번달, 지난달]', () =>
  eq(JSON.stringify(S.defaultMonths('2027-01-08')), JSON.stringify(['2027-01', '2026-12'])));
t('extendMonths가 연 경계를 넘는다', () =>
  eq(JSON.stringify(S.extendMonths(['2027-01', '2026-12'], 6)), JSON.stringify(['2027-01', '2026-12', '2026-11'])));
t('extendMonths는 상한을 넘지 않는다', () => {
  const six = ['2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01'];
  return eq(S.extendMonths(six, 6).length, 6);
});

section('달성률 (계약 §3)');
t('주간: 월~목 4일 경과 중 2일 기록 = 50%', () => {
  const r = S.weeklyRate(rowsFor(['2026-07-27', '2026-07-29']), '2026-07-30');
  return r.done === 2 && r.total === 4 && r.pct === 50 ? true : JSON.stringify(r);
});
t('주간: 경과 일수만 센다 (남은 요일 제외)', () =>
  eq(S.weeklyRate([], '2026-07-27').total, 1, '월요일의 total'));
t('★ 주간이 월 경계를 걸쳐도 전월 일자를 포함한다', () => {
  // 2026-08-01은 토요일 → 그 주 월요일은 2026-07-27
  const r = S.weeklyRate(rowsFor(['2026-07-27', '2026-07-28', '2026-08-01']), '2026-08-01');
  return r.total === 6 && r.done === 3 ? true : JSON.stringify(r);
});
t('월간: 30일 경과 중 15일 기록 = 50%', () => {
  const dates = [];
  for (let d = 1; d <= 15; d++) dates.push('2026-07-' + String(d).padStart(2, '0'));
  const r = S.monthlyRate(rowsFor(dates), '2026-07-30');
  return r.done === 15 && r.total === 30 && r.pct === 50 ? true : JSON.stringify(r);
});
t('기록 0건이면 0% (0으로 나누지 않음)', () => {
  const r = S.monthlyRate([], '2026-07-01');
  return r.total === 1 && r.done === 0 && r.pct === 0 ? true : JSON.stringify(r);
});

section('중보기도 카운터 (계약 §3)');
t('최근 7일 중 3일', () =>
  eq(S.intercessionCount(rowsFor(['2026-07-28', '2026-07-29', '2026-07-30'], { intercession: true }), '2026-07-30', 7), 3));
t('7일 밖의 기도는 세지 않는다', () =>
  eq(S.intercessionCount(rowsFor(['2026-07-01'], { intercession: true }), '2026-07-30', 7), 0));
t('intercession=false는 세지 않는다', () =>
  eq(S.intercessionCount(rowsFor(['2026-07-30'], { intercession: false }), '2026-07-30', 7), 0));

section('달력 그리드 (계약 §7)');
t('2026-07은 1일이 수요일 → 앞 여백 2칸', () => {
  const cells = S.monthGrid([], '2026-07', '2026-07-30');
  return cells[0].state === 'pad' && cells[1].state === 'pad' && cells[2].day === 1
    ? true : JSON.stringify(cells.slice(0, 3));
});
t('셀 수가 7의 배수', () => eq(S.monthGrid([], '2026-07', '2026-07-30').length % 7, 0));
t('그 달의 날짜가 모두 들어있다 (7월=31일)', () =>
  eq(S.monthGrid([], '2026-07', '2026-07-30').filter((c) => c.inMonth).length, 31));
t('2월(평년)은 28일', () =>
  eq(S.monthGrid([], '2026-02', '2026-07-30').filter((c) => c.inMonth).length, 28));
t('2월(윤년 2028)은 29일', () =>
  eq(S.monthGrid([], '2028-02', '2028-07-30').filter((c) => c.inMonth).length, 29));
t('기록한 날은 done, 안 한 날은 miss, 미래는 future', () => {
  const cells = S.monthGrid(rowsFor(['2026-07-29']), '2026-07', '2026-07-30');
  const byDate = {};
  cells.forEach((c) => { if (c.date) byDate[c.date] = c.state; });
  return byDate['2026-07-29'] === 'done' && byDate['2026-07-30'] === 'miss' && byDate['2026-07-31'] === 'future'
    ? true : JSON.stringify({ d29: byDate['2026-07-29'], d30: byDate['2026-07-30'], d31: byDate['2026-07-31'] });
});
t('오늘도 미기록이면 miss (future 아님)', () => {
  const cells = S.monthGrid([], '2026-07', '2026-07-15');
  return eq(cells.find((c) => c.date === '2026-07-15').state, 'miss');
});

section('기도 월별 묶음 (계약 §7)');
{
  const prayers = [
    { id: 'a', createdDate: '2026-07-05', status: 'answered', text: 'A' },
    { id: 'b', createdDate: '2026-07-20', status: 'open', text: 'B' },
    { id: 'c', createdDate: '2026-06-10', status: 'open', text: 'C' },
    { id: 'd', createdDate: '2026-07-28', status: 'answered', text: 'D' },
  ];
  const g = S.groupPrayersByMonth(prayers);
  t('월별로 묶인다', () => eq(g.length, 2));
  t('최신 월이 먼저', () => eq(g[0].ym, '2026-07'));
  t('같은 달 안에서 미응답이 위로', () => eq(g[0].items[0].id, 'b'));
  t('응답된 것끼리는 최신순', () => {
    const answered = g[0].items.filter((x) => x.status === 'answered').map((x) => x.id);
    return eq(JSON.stringify(answered), JSON.stringify(['d', 'a']));
  });
  t('빈 입력은 빈 배열', () => eq(S.groupPrayersByMonth([]).length, 0));
}

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
