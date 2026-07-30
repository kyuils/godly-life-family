// web/js/stats.js — 지표 계산 (계약 §3).
//
// 순수 함수만 둔다. DOM·네트워크·전역 상태에 접근하지 않으므로 Node에서 그대로
// 단위 테스트할 수 있다 (scripts/test-stats.mjs).
//
// rows 형태: [{ date:'YYYY-MM-DD', wordRead:bool, intercession:bool, ... }]
// "기록한 날" = 그 날짜 행의 wordRead === true. (텍스트·중보기도만 있는 날은 미포함)

/** 'YYYY-MM-DD' 문자열 위의 순수 달력 연산. UTC 자정을 중립 기준점으로만 쓴다. */
export function addDays(dateStr, days) {
  const p = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return (
    dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  );
}

/** 0=월요일 … 6=일요일 (KST 달력 기준, 문자열 연산만 사용) */
export function weekdayMon0(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0=일
  return (dow + 6) % 7;
}

/** 그 주(월~일)의 월요일 */
export function mondayOf(dateStr) {
  return addDays(dateStr, -weekdayMon0(dateStr));
}

export function ymOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

/** 해당 달의 1일 */
export function firstOfMonth(dateStr) {
  return ymOf(dateStr) + '-01';
}

/** 기록한 날짜(wordRead=true)의 Set */
export function doneDateSet(rows) {
  const s = new Set();
  (rows || []).forEach(function (r) {
    if (r && r.wordRead === true && r.date) s.add(r.date);
  });
  return s;
}

/**
 * 연속 기록 일수 (계약 §3).
 * 오늘부터 거슬러 올라가며 센다. 오늘 미기록이면 어제부터 센다 —
 * 오늘은 아직 기회가 남았으므로 끊지 않는다.
 */
export function computeStreak(rows, todayStr) {
  const done = doneDateSet(rows);
  let cursor = done.has(todayStr) ? todayStr : addDays(todayStr, -1);
  let n = 0;
  // 상한: 계약 §3.1의 6개월 로드 한계보다 넉넉하되 무한 루프는 막는다.
  while (done.has(cursor) && n < 4000) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/**
 * 로드된 데이터로 계산한 streak가 더 늘어날 여지가 있는지 (계약 §3.1).
 * 연속 구간이 로드된 가장 이른 달의 1일까지 닿아 있으면 이전 달을 더 불러와야 한다.
 * 날짜가 아니라 데이터로 판정한다 — 날짜 기준 규칙은 긴 streak를 잘라먹는다.
 */
export function streakNeedsMoreMonths(rows, todayStr, loadedMonths) {
  if (!loadedMonths || !loadedMonths.length) return false;
  const earliest = loadedMonths.slice().sort()[0];
  const streak = computeStreak(rows, todayStr);
  if (streak === 0) return false;
  const done = doneDateSet(rows);
  const start = done.has(todayStr) ? todayStr : addDays(todayStr, -1);
  const oldest = addDays(start, -(streak - 1));
  return oldest === earliest + '-01';
}

function rateOver(rows, fromStr, toStr) {
  const done = doneDateSet(rows);
  let total = 0;
  let hit = 0;
  let cur = fromStr;
  // from~to(포함) 경과 일수. 상한은 안전장치.
  for (let guard = 0; guard < 400 && cur <= toStr; guard++) {
    total += 1;
    if (done.has(cur)) hit += 1;
    cur = addDays(cur, 1);
  }
  return { done: hit, total: total, pct: total ? Math.round((hit / total) * 100) : 0 };
}

/** 이번 주(월~일) 경과 일수 중 기록한 날 비율 */
export function weeklyRate(rows, todayStr) {
  return rateOver(rows, mondayOf(todayStr), todayStr);
}

/** 이번 달 경과 일수 중 기록한 날 비율 */
export function monthlyRate(rows, todayStr) {
  return rateOver(rows, firstOfMonth(todayStr), todayStr);
}

/** 최근 days일 중 중보기도한 날 수 (streak·달성률에 미포함 — 별도 카운터) */
export function intercessionCount(rows, todayStr, days) {
  const n = days || 7;
  const set = new Set();
  (rows || []).forEach(function (r) {
    if (r && r.intercession === true && r.date) set.add(r.date);
  });
  let hit = 0;
  for (let i = 0; i < n; i++) {
    if (set.has(addDays(todayStr, -i))) hit += 1;
  }
  return hit;
}

/**
 * 달력 한 달치 셀 배열 (계약 §7 — 월요일 시작).
 * 반환: [{ date, day, inMonth:bool, state:'done'|'miss'|'future'|'pad' }]
 * 'pad'는 앞뒤 빈 칸(이전/다음 달 자리)이다.
 */
export function monthGrid(rows, ym, todayStr) {
  const first = ym + '-01';
  const lead = weekdayMon0(first);
  const daysInMonth = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const done = doneDateSet(rows);

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ date: '', day: 0, inMonth: false, state: 'pad' });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = ym + '-' + String(d).padStart(2, '0');
    let state;
    if (date > todayStr) state = 'future';
    else if (done.has(date)) state = 'done';
    else state = 'miss';
    cells.push({ date: date, day: d, inMonth: true, state: state });
  }
  while (cells.length % 7 !== 0) cells.push({ date: '', day: 0, inMonth: false, state: 'pad' });
  return cells;
}

/** 기도 목록을 등록월(YYYY-MM)로 묶는다. 최신 월이 먼저 (계약 §7). */
export function groupPrayersByMonth(prayers) {
  const map = new Map();
  (prayers || []).forEach(function (p) {
    const ym = ymOf(p.createdDate || '');
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(p);
  });
  const out = [];
  Array.from(map.keys()).sort().reverse().forEach(function (ym) {
    const items = map.get(ym).slice();
    // 같은 달 안에서는 미응답을 위로, 그 다음 최신순.
    items.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return a.createdDate < b.createdDate ? 1 : a.createdDate > b.createdDate ? -1 : 0;
    });
    out.push({ ym: ym, items: items });
  });
  return out;
}

/** 계약 §3.1 — 프론트가 기본으로 요청할 월 목록 [이번달, 지난달] */
export function defaultMonths(todayStr) {
  return [ymOf(todayStr), ymOf(addDays(firstOfMonth(todayStr), -1))];
}

/** 로드된 월 목록에 이전 달을 하나 더한다 (최대 maxMonths개) */
export function extendMonths(months, maxMonths) {
  const max = maxMonths || 6;
  if (months.length >= max) return months;
  const earliest = months.slice().sort()[0];
  const prev = ymOf(addDays(earliest + '-01', -1));
  return months.concat([prev]);
}
