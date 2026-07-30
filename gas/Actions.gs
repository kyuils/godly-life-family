// Actions.gs — 계약 §4의 액션 핸들러.
// 계약: docs/specs/2026-07-30-api-contract.md §4
//
// 공통 규칙 (계약 §4.2):
//   - 읽기: 없는 RECORDS_YYYY-MM 시트는 빈 배열. 읽기는 시트를 만들지 않는다.
//   - 쓰기: LockService 잠금 안에서, read-verify-write로 보호. waitLock 실패는 busy.
//   - 모든 조회는 검증된 토큰 email로 필터한다. 클라이언트가 보낸 값은 무시한다.

const MAX_TEXT_LEN = 1000;      // 와닿은말씀 / 결단 / 기도제목
const MAX_NAME_LEN = 30;
const MAX_EXTRA_LEN = 30;
const MAX_MONTHS = 6;           // getMyRecords (계약 §3.1)
const MAX_ALL_RECORD_DAYS = 180;
const MAX_ALL_PRAYER_DAYS = 366;
const PRAYER_DAILY_LIMIT = 20;  // 계약 §2.6
const PRAYER_ACTIVE_LIMIT = 100;

const LOCK_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// 잠금 — waitLock은 실패 시 예외를 던진다. 반드시 감싸서 busy로 변환한다.
// 감싸지 않으면 doPost의 catch로 올라가 server_error가 되고, 사용자는 원인을 알 수 없다.
// ---------------------------------------------------------------------------

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, code: 'busy' };
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// 행 <-> 와이어 객체 변환
// ---------------------------------------------------------------------------

function rowToMyRecord_(r) {
  return {
    date: formatDate_(r['날짜']),
    wordRead: boolFromCell_(r['말씀읽음']),
    verse: String(r['와닿은말씀'] || ''),
    resolution: String(r['결단'] || ''),
    intercession: boolFromCell_(r['중보기도']),
    updatedAt: String(r['수정시각'] || ''),
  };
}

function rowToAllRecord_(r) {
  const o = rowToMyRecord_(r);
  o.email = String(r.email || '').toLowerCase().trim();
  o.name = String(r['이름'] || '');
  o.kind = String(r['구분'] || '');
  return o;
}

// 상태: '응답됨' 외의 모든 값은 open으로 간주한다 (계약 §2.6 —
// 사람이 시트에서 '완료' 등으로 고쳐도 앱이 깨지지 않도록).
function statusFromCell_(v) {
  return String(v || '').trim() === '응답됨' ? 'answered' : 'open';
}

function rowToPrayer_(r) {
  return {
    id: String(r['기도ID'] || ''),
    createdDate: formatDate_(r['등록일']),
    text: String(r['기도제목'] || ''),
    status: statusFromCell_(r['상태']),
    answeredDate: formatDate_(r['응답일']),
    updatedAt: String(r['수정시각'] || ''),
  };
}

function rowToAllPrayer_(r) {
  const o = rowToPrayer_(r);
  o.email = String(r.email || '').toLowerCase().trim();
  o.name = String(r['이름'] || '');
  o.kind = String(r['구분'] || '');
  return o;
}

function isDeletedRow_(r) {
  return boolFromCell_(r['삭제여부']);
}

// ---------------------------------------------------------------------------
// whoami / register
// ---------------------------------------------------------------------------

function registerCodeRaw_() {
  return PropertiesService.getScriptProperties().getProperty('REGISTER_CODE');
}

function canRegister_() {
  const code = registerCodeRaw_();
  return !!(code && String(code).trim().length > 0);
}

// 코드 비교 정규화: 양쪽 모두 trim + 소문자화 + 내부 공백 제거 (계약 §4.2).
function normalizeCode_(s) {
  return String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
}

function authOk_(auth) {
  return {
    ok: true,
    email: auth.email,
    name: auth.name,
    role: auth.role,
    kind: auth.kind,
    extra: auth.extra,
    joinedAt: auth.joinedAt,
  };
}

function handleWhoami(body) {
  const auth = authenticate(body);
  if (!auth.ok) {
    // canRegister는 unauthorized 경로에만 붙인다. token_expired 등 다른 코드에는
    // 붙이지 않는다 (계약 §4.2 — additive/하위호환).
    if (auth.code === 'unauthorized') {
      return { ok: false, code: 'unauthorized', email: auth.email, canRegister: canRegister_() };
    }
    return auth;
  }
  return authOk_(auth);
}

const REG_FAIL_PREFIX = 'REGFAIL_v1_';
const REG_FAIL_GLOBAL_KEY = 'REGFAIL_GLOBAL_v1';
const REG_FAIL_WINDOW = 600;        // 10분
const REG_FAIL_EMAIL_MAX = 5;
const REG_FAIL_GLOBAL_MAX = 20;

function regFailCount_(key) {
  const v = CacheService.getScriptCache().get(key);
  return v ? Number(v) || 0 : 0;
}

function regFailBump_(key) {
  const cache = CacheService.getScriptCache();
  const next = regFailCount_(key) + 1;
  try { cache.put(key, String(next), REG_FAIL_WINDOW); } catch (e) { /* ignore */ }
}

// 세 명부 시트 전부를 원시 스캔한다(active 무관). lookupMember를 쓰지 않는 이유:
// 비활성 행도 중복으로 잡아야 하고(재가입으로 활성화하는 우회를 막는다),
// 명부 캐시의 영향을 받지 않아야 하기 때문이다 (계약 §4.2).
function findAnyMemberRow_(lowerEmail) {
  const sheets = [
    { name: SHEET_NAMES.MEMBERS_TEACHER, kind: 'teacher' },
    { name: SHEET_NAMES.MEMBERS_PARENT, kind: 'parent' },
    { name: SHEET_NAMES.MEMBERS_STUDENT, kind: 'student' },
  ];
  let inactiveHit = null;
  for (let i = 0; i < sheets.length; i++) {
    const rows = readTable_(sheets[i].name).rows;
    for (let j = 0; j < rows.length; j++) {
      if (String(rows[j].email || '').toLowerCase().trim() !== lowerEmail) continue;
      if (isActive_(rows[j].active)) return { found: true, active: true };
      inactiveHit = { found: true, active: false };
    }
  }
  return inactiveHit || { found: false, active: false };
}

function handleRegister(body) {
  const v = verifyIdToken(body && body.idToken);
  if (!v.ok) return v;
  const email = v.email;

  // 1) kind 검증 — teacher는 어떤 경우에도 거부한다.
  //    교사 권한은 MEMBERS_교사 시트를 사람이 직접 편집해야만 부여된다 (보안 불변식 3).
  const kind = body && body.kind;
  if (kind !== 'student' && kind !== 'parent') {
    return { ok: false, code: 'bad_request', message: 'kind must be student or parent' };
  }

  // 2) 이름/extra 검증 (백오프 카운터와 무관 — 코드 추측 시도가 아니므로)
  const name = cleanText_(body && body.name, false);
  if (!name || codePointLength_(name) > MAX_NAME_LEN) {
    return { ok: false, code: 'bad_request', message: 'name required (1-30)' };
  }
  const extra = cleanText_(body && body.extra, false);
  if (codePointLength_(extra) > MAX_EXTRA_LEN) {
    return { ok: false, code: 'bad_request', message: 'extra too long' };
  }

  // 3) 백오프 2단 — email 단위만 두면 계정을 바꿔가며 무제한 시도할 수 있다 (계약 §4.2).
  // 비교는 >= 다. > 로 두면 카운터가 MAX에 도달한 뒤에도 한 번 더 통과해서
  // 계약(§4.2 "5회 초과 시 차단")보다 1회 느슨해진다.
  const emailKey = REG_FAIL_PREFIX + email;
  if (regFailCount_(emailKey) >= REG_FAIL_EMAIL_MAX) return { ok: false, code: 'too_many_attempts' };
  if (regFailCount_(REG_FAIL_GLOBAL_KEY) >= REG_FAIL_GLOBAL_MAX) return { ok: false, code: 'too_many_attempts' };

  // 4) 등록 폐쇄 검사
  if (!canRegister_()) return { ok: false, code: 'registration_closed' };

  // 5) 코드 대조
  if (normalizeCode_(body && body.code) !== normalizeCode_(registerCodeRaw_())) {
    regFailBump_(emailKey);
    regFailBump_(REG_FAIL_GLOBAL_KEY);
    return { ok: false, code: 'bad_code' };
  }

  // 6) 중복 검사 → append. 스캔부터 append까지 전체를 잠금 안에서 (중복 가입 레이스 방지).
  return withLock_(function () {
    const hit = findAnyMemberRow_(email);
    if (hit.found && hit.active) return { ok: false, code: 'already_registered' };
    if (hit.found && !hit.active) return { ok: false, code: 'deactivated' };

    const sheetName = kind === 'parent' ? SHEET_NAMES.MEMBERS_PARENT : SHEET_NAMES.MEMBERS_STUDENT;
    const headerKey = kind === 'parent' ? 'MEMBERS_PARENT' : 'MEMBERS_STUDENT';
    const extraHeader = kind === 'parent' ? '자녀이름' : '학년반';

    const sh = ensureSheet_(sheetName, HEADERS[headerKey]);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

    // 위치 기반 배열이 아니라 헤더 순서에서 만든다 — 사람이 명부에 열을 하나 삽입해도
    // 값이 밀려 들어가지 않는다 (계약 §0, §4.2).
    const obj = {
      'email': email,
      '이름': sanitizeCell_(name),
      'active': 'TRUE',
      '가입시각': todayStr_(),
      '가입경로': 'self',
    };
    obj[extraHeader] = sanitizeCell_(extra);
    appendRow_(sheetName, rowFromObj_(headers, obj));

    invalidateMemberCache_(email);
    return {
      ok: true,
      email: email,
      name: name,
      role: kind,
      kind: kind,
      extra: extra,
      joinedAt: todayStr_(),
    };
  });
}

// ---------------------------------------------------------------------------
// 기록 (RECORDS_YYYY-MM)
// ---------------------------------------------------------------------------

function handleGetMyRecords(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;

  const months = body && body.months;
  if (!Array.isArray(months) || months.length < 1 || months.length > MAX_MONTHS) {
    return { ok: false, code: 'bad_request', message: 'months must be 1-' + MAX_MONTHS + ' items' };
  }
  for (let i = 0; i < months.length; i++) {
    if (!isValidYm_(months[i])) return { ok: false, code: 'bad_request', message: 'bad month: ' + months[i] };
  }

  let rows = [];
  for (let i = 0; i < months.length; i++) {
    // 없는 시트는 빈 배열 — 오류가 아니다 (계약 §4.2 읽기 공통 규정).
    const t = readTable_(recordsSheetName_(months[i]));
    for (let j = 0; j < t.rows.length; j++) {
      if (String(t.rows[j].email || '').toLowerCase().trim() === auth.email) {
        rows.push(rowToMyRecord_(t.rows[j]));
      }
    }
  }
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { ok: true, rows: rows };
}

function handleSetRecord(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;

  const date = body && body.date;
  if (!isValidDateStr_(date)) {
    return { ok: false, code: 'bad_request', message: 'date required (yyyy-MM-dd)' };
  }
  const today = todayStr_();
  if (date !== today && date !== addDaysToDateStr_(today, -1)) {
    return { ok: false, code: 'bad_request', message: 'date must be today or yesterday' };
  }

  const verse = cleanText_(body && body.verse, true);
  const resolution = cleanText_(body && body.resolution, true);
  if (codePointLength_(verse) > MAX_TEXT_LEN || codePointLength_(resolution) > MAX_TEXT_LEN) {
    return { ok: false, code: 'bad_request', message: 'text too long' };
  }

  const sheetName = recordsSheetName_(ymOf_(date));

  return withLock_(function () {
    const sh = ensureSheet_(sheetName, HEADERS.RECORDS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

    // upsert 스캔은 키 열 2개만 읽는다. 전체 열을 읽으면 락 보유 시간이 수 배로 늘어난다
    // (계약 §4.2/§4.5 — 이 규칙은 test-gas-actions의 셀 카운트 테스트가 지킨다).
    const scan = readColumnsByHeader_(sheetName, ['날짜', 'email']);
    let existing = null;
    for (let i = 0; i < scan.rows.length; i++) {
      const r = scan.rows[i];
      if (formatDate_(r['날짜']) === date &&
          String(r.email || '').toLowerCase().trim() === auth.email) {
        existing = r;
        break;
      }
    }

    const now = nowIso_();
    const obj = {
      '날짜': date,
      'email': auth.email,
      // 명부는 사람이 손으로 편집한다 — 거기서 온 이름도 정제해서 전파한다
      // (불변식 5: 시트에 쓰는 '모든' 자유 텍스트).
      '이름': sanitizeCell_(auth.name),
      '구분': kindLabel_(auth.kind),
      '말씀읽음': body.wordRead === true ? 'TRUE' : 'FALSE',
      '와닿은말씀': sanitizeCell_(verse),
      '결단': sanitizeCell_(resolution),
      '중보기도': body.intercession === true ? 'TRUE' : 'FALSE',
      '기록시각': now,
      '수정시각': now,
    };

    if (existing) {
      // read-verify-write: 사람이 시트를 정렬했다면 이 행은 이미 남의 행일 수 있다.
      if (!verifyRowKeys_(sheetName, existing._rowIndex, { '날짜': date, 'email': auth.email })) {
        return { ok: false, code: 'conflict' };
      }
      // 기록시각은 최초 생성 시각을 보존한다.
      const full = sh.getRange(existing._rowIndex, 1, 1, headers.length).getValues()[0];
      const createdIdx = headers.indexOf('기록시각');
      if (createdIdx >= 0 && full[createdIdx]) obj['기록시각'] = full[createdIdx];
      updateRowByIndex_(sheetName, existing._rowIndex, rowFromObj_(headers, obj));
    } else {
      appendRow_(sheetName, rowFromObj_(headers, obj));
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// 기도 (PRAYERS)
// ---------------------------------------------------------------------------

function newPrayerId_() {
  return 'P' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 16);
}

function handleGetMyPrayers(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  const rows = readTable_(SHEET_NAMES.PRAYERS).rows
    .filter(function (r) {
      return String(r.email || '').toLowerCase().trim() === auth.email && !isDeletedRow_(r);
    })
    .map(rowToPrayer_);
  rows.sort(function (a, b) { return a.createdDate < b.createdDate ? 1 : a.createdDate > b.createdDate ? -1 : 0; });
  return { ok: true, rows: rows };
}

function handleAddPrayer(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;

  const text = cleanText_(body && body.text, true);
  if (!text || codePointLength_(text) > MAX_TEXT_LEN) {
    return { ok: false, code: 'bad_request', message: 'text required (1-' + MAX_TEXT_LEN + ')' };
  }

  return withLock_(function () {
    const sh = ensureSheet_(SHEET_NAMES.PRAYERS, HEADERS.PRAYERS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const today = todayStr_();

    const mine = readTable_(SHEET_NAMES.PRAYERS).rows.filter(function (r) {
      return String(r.email || '').toLowerCase().trim() === auth.email && !isDeletedRow_(r);
    });
    // 상한 (계약 §2.6) — 장난성 대량 등록이 교사 화면과 스캔 비용을 오염시키지 않도록.
    if (mine.length >= PRAYER_ACTIVE_LIMIT) {
      return { ok: false, code: 'bad_request', message: 'too many active prayers' };
    }
    const todayCount = mine.filter(function (r) { return formatDate_(r['등록일']) === today; }).length;
    if (todayCount >= PRAYER_DAILY_LIMIT) {
      return { ok: false, code: 'bad_request', message: 'daily prayer limit reached' };
    }

    const id = newPrayerId_();
    appendRow_(SHEET_NAMES.PRAYERS, rowFromObj_(headers, {
      '기도ID': id,
      '등록일': today,
      'email': auth.email,
      // 명부는 사람이 손으로 편집한다 — 거기서 온 이름도 정제해서 전파한다
      // (불변식 5: 시트에 쓰는 '모든' 자유 텍스트).
      '이름': sanitizeCell_(auth.name),
      '구분': kindLabel_(auth.kind),
      '기도제목': sanitizeCell_(text),
      '상태': '진행중',
      '응답일': '',
      '수정시각': nowIso_(),
      '삭제여부': '',
    }));
    return { ok: true, id: id };
  });
}

/**
 * 본인 소유의 미삭제 기도 행을 찾는다.
 *
 * 존재하지 않는 id, 남의 id, 삭제된 id를 **전부 동일하게** forbidden으로 돌린다
 * (계약 §4.2 — 존재 여부 유출 방지). 호출부는 반환값이 null이면 forbidden을 낸다.
 */
function findOwnPrayerRow_(id, email) {
  if (!id || typeof id !== 'string') return null;
  const rows = readTable_(SHEET_NAMES.PRAYERS).rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r['기도ID'] || '').trim() !== id.trim()) continue;
    if (String(r.email || '').toLowerCase().trim() !== email) return null;
    if (isDeletedRow_(r)) return null;
    return r;
  }
  return null;
}

// 기도 행의 특정 열만 바꿔 쓴다. read-verify-write 적용.
function updatePrayerRow_(rowIndex, id, changes) {
  const sh = getSheetOrNull_(SHEET_NAMES.PRAYERS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (!verifyRowKeys_(SHEET_NAMES.PRAYERS, rowIndex, { '기도ID': id })) {
    return { ok: false, code: 'conflict' };
  }
  const current = sh.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach(function (h, i) { obj[h] = current[i]; });
  Object.keys(changes).forEach(function (k) { obj[k] = changes[k]; });
  obj['수정시각'] = nowIso_();
  updateRowByIndex_(SHEET_NAMES.PRAYERS, rowIndex, rowFromObj_(headers, obj));
  return { ok: true };
}

function handleSetPrayerAnswered(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  const id = body && body.id;
  const answered = body && body.answered === true;

  return withLock_(function () {
    const row = findOwnPrayerRow_(id, auth.email);
    if (!row) return { ok: false, code: 'forbidden' };
    return updatePrayerRow_(row._rowIndex, String(id).trim(), {
      '상태': answered ? '응답됨' : '진행중',
      '응답일': answered ? todayStr_() : '',
    });
  });
}

function handleDeletePrayer(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  const id = body && body.id;

  return withLock_(function () {
    const row = findOwnPrayerRow_(id, auth.email);
    if (!row) return { ok: false, code: 'forbidden' };
    // 소프트 삭제 — 실제 행은 지우지 않는다 (계약 §2.6/§2.7).
    return updatePrayerRow_(row._rowIndex, String(id).trim(), { '삭제여부': 'TRUE' });
  });
}

// ---------------------------------------------------------------------------
// 교사 전용
// ---------------------------------------------------------------------------

function clampDays_(v, def, max) {
  const n = Number(v);
  if (!v || !isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

function handleGetAllRecords(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  if (!isTeacher_(auth)) return { ok: false, code: 'forbidden' };

  const days = clampDays_(body && body.days, 60, MAX_ALL_RECORD_DAYS);
  const today = todayStr_();
  const from = addDaysToDateStr_(today, -(days - 1));
  const months = ymRange_(from, today);

  const rows = [];
  for (let i = 0; i < months.length; i++) {
    const t = readTable_(recordsSheetName_(months[i]));
    for (let j = 0; j < t.rows.length; j++) {
      const d = formatDate_(t.rows[j]['날짜']);
      if (d >= from && d <= today) rows.push(rowToAllRecord_(t.rows[j]));
    }
  }
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  // windowDays: 프론트는 창을 가득 채운 streak를 "60+"로 표기한다 (계약 §4.2).
  return { ok: true, rows: rows, windowDays: days };
}

function handleGetAllPrayers(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  if (!isTeacher_(auth)) return { ok: false, code: 'forbidden' };

  const days = clampDays_(body && body.days, 180, MAX_ALL_PRAYER_DAYS);
  const from = addDaysToDateStr_(todayStr_(), -(days - 1));

  const rows = readTable_(SHEET_NAMES.PRAYERS).rows
    .filter(function (r) { return !isDeletedRow_(r) && formatDate_(r['등록일']) >= from; })
    .map(rowToAllPrayer_);
  rows.sort(function (a, b) { return a.createdDate < b.createdDate ? 1 : a.createdDate > b.createdDate ? -1 : 0; });
  return { ok: true, rows: rows };
}

function handleGetMembers(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  if (!isTeacher_(auth)) return { ok: false, code: 'forbidden' };

  const out = [];
  const specs = [
    { name: SHEET_NAMES.MEMBERS_STUDENT, kind: 'student', extraHeader: '학년반' },
    { name: SHEET_NAMES.MEMBERS_PARENT, kind: 'parent', extraHeader: '자녀이름' },
  ];
  for (let i = 0; i < specs.length; i++) {
    const rows = readTable_(specs[i].name).rows;
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      if (!r.email || !isActive_(r.active)) continue;
      out.push({
        email: String(r.email).toLowerCase().trim(),
        name: String(r['이름'] || ''),
        kind: specs[i].kind,
        extra: String(r[specs[i].extraHeader] || ''),
        joinedAt: formatDate_(r['가입시각']),
      });
    }
  }
  return { ok: true, members: out };
}
