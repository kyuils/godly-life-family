// Sheet.gs — 시트 I/O + 날짜 유틸.
// 계약: docs/specs/2026-07-30-api-contract.md §0, §1, §2
//
// 선행 저장소 kyuils/godly-life-check 의 Sheet.gs 패턴을 계승하되 다음이 다르다:
//   - 명부가 3개 시트 (학생/학부모/교사)
//   - RECORDS가 월별 시트 (RECORDS_YYYY-MM) — 읽기는 없으면 빈 배열, 생성은 쓰기에서만
//   - 읽기·쓰기 모두 헤더 이름 기반 (선행 저장소는 쓰기 일부가 위치 기반이었다)
//   - read-verify-write: 사람이 시트를 정렬해 행 번호가 어긋났을 때 남의 행을 덮어쓰지 않도록

const SHEET_NAMES = {
  MEMBERS_STUDENT: 'MEMBERS_학생',
  MEMBERS_PARENT: 'MEMBERS_학부모',
  MEMBERS_TEACHER: 'MEMBERS_교사',
  PRAYERS: 'PRAYERS',
};

const RECORDS_PREFIX = 'RECORDS_';

const HEADERS = {
  MEMBERS_STUDENT: ['email', '이름', '학년반', 'active', '가입시각', '가입경로'],
  MEMBERS_PARENT: ['email', '이름', '자녀이름', 'active', '가입시각', '가입경로'],
  MEMBERS_TEACHER: ['email', '이름', '역할', 'active', '가입시각'],
  RECORDS: ['날짜', 'email', '이름', '구분', '말씀읽음', '와닿은말씀', '결단', '중보기도', '기록시각', '수정시각'],
  PRAYERS: ['기도ID', '등록일', 'email', '이름', '구분', '기도제목', '상태', '응답일', '수정시각', '삭제여부'],
};

// ---------------------------------------------------------------------------
// 스프레드시트 접근
// ---------------------------------------------------------------------------

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID Script Property not set');
  return SpreadsheetApp.openById(id);
}

// 읽기용 — 시트가 없으면 null. 계약 §4.2: 없는 RECORDS_YYYY-MM은 오류가 아니다.
function getSheetOrNull_(name) {
  return getSpreadsheet_().getSheetByName(name) || null;
}

// 쓰기용 — 없으면 헤더와 함께 생성한다. 반드시 LockService 잠금 안에서 호출할 것
// (락 없이 생성하면 헤더 없는 시트가 동시에 만들어질 수 있다 — 계약 §2.5).
function ensureSheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

// ---------------------------------------------------------------------------
// 헤더 이름 기반 읽기
// ---------------------------------------------------------------------------

// 전체 테이블. 반환 row는 헤더 텍스트로 키를 갖고 _rowIndex(1-based, 헤더=1)를 포함한다.
// 시트가 없으면 { headers: [], rows: [] } — 예외를 던지지 않는다.
function readTable_(name) {
  const sh = getSheetOrNull_(name);
  if (!sh) return { headers: [], rows: [] };
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return { headers: [], rows: [] };
  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (lastRow < 2) return { headers: headers, rows: [] };
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const rows = values.map(function (row, i) {
    const obj = { _rowIndex: i + 2 };
    headers.forEach(function (h, j) { obj[h] = row[j]; });
    return obj;
  });
  return { headers: headers, rows: rows };
}

// 지정한 열만 읽는다. setRecord의 upsert 스캔이 전체 열을 읽지 않도록 하기 위한 것
// (계약 §4.2/§4.5 — 락 보유 시간과 읽는 셀 수를 줄인다).
// 반환: { headers, rows: [{_rowIndex, <name>: value, ...}] }
function readColumnsByHeader_(name, wanted) {
  const sh = getSheetOrNull_(name);
  if (!sh) return { headers: [], rows: [] };
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return { headers: [], rows: [] };
  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (lastRow < 2) return { headers: headers, rows: [] };

  const n = lastRow - 1;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ _rowIndex: i + 2 });

  for (let w = 0; w < wanted.length; w++) {
    const h = wanted[w];
    const col = headers.indexOf(h) + 1;
    if (col < 1) continue; // 없는 열은 undefined로 남긴다
    const colValues = sh.getRange(2, col, n, 1).getValues();
    for (let i = 0; i < n; i++) rows[i][h] = colValues[i][0];
  }
  return { headers: headers, rows: rows };
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

function rowFromObj_(headers, obj) {
  return headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
}

function appendRow_(name, headerOrderedValues) {
  getSheetOrNull_(name).appendRow(headerOrderedValues);
}

function updateRowByIndex_(name, rowIndex, headerOrderedValues) {
  const sh = getSheetOrNull_(name);
  sh.getRange(rowIndex, 1, 1, headerOrderedValues.length).setValues([headerOrderedValues]);
}

/**
 * read-verify-write (계약 §4.2).
 *
 * LockService는 같은 스크립트의 동시 실행만 직렬화한다. 사람이 스프레드시트 UI에서
 * 정렬·행삽입·행삭제를 하면 우리가 스캔으로 얻은 _rowIndex가 이미 다른 사람의 행을
 * 가리킬 수 있고, 그대로 쓰면 남의 기록을 덮어쓴다(복구 불가한 데이터 파괴).
 * 쓰기 직전에 대상 행의 키 열을 다시 읽어 일치를 확인한다.
 *
 * @param expected {날짜:'2026-07-30', email:'a@b.c'} 형태의 키-값 맵
 * @return true면 일치, false면 어긋남(호출부는 conflict를 반환해야 한다)
 */
function verifyRowKeys_(name, rowIndex, expected) {
  const sh = getSheetOrNull_(name);
  if (!sh) return false;
  if (rowIndex < 2 || rowIndex > sh.getLastRow()) return false;
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const row = sh.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  const keys = Object.keys(expected);
  for (let i = 0; i < keys.length; i++) {
    const h = keys[i];
    const col = headers.indexOf(h);
    if (col < 0) return false;
    const actual = h === '날짜' ? formatDate_(row[col]) : String(row[col] || '').trim();
    const want = h === 'email' ? String(expected[h]).toLowerCase() : String(expected[h]);
    const got = h === 'email' ? actual.toLowerCase() : actual;
    if (got !== want) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 셀 값 해석
// ---------------------------------------------------------------------------

// active 열 규칙: 빈 값은 active, FALSE/NO/0/N만 비활성 (선행 저장소 isActive_ 그대로).
function isActive_(v) {
  if (v === undefined || v === null || v === '') return true;
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).trim().toUpperCase();
  return s !== 'FALSE' && s !== 'NO' && s !== '0' && s !== 'N';
}

// realm에 독립적인 Date 판별. `instanceof Date`는 다른 realm(테스트 vm 샌드박스)에서
// 만들어진 진짜 Date를 놓친다. [[Class]] 태그는 realm 독립적이다.
function isDateLike_(v) {
  return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Date]';
}

// 수식 인젝션 방어. Sheets는 = + - @ 로 시작하는 셀을 수식으로 평가하므로 ' 를 붙여
// 문자열로 저장한다 (계약 §0, 보안 불변식 5).
function sanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || isDateLike_(v)) return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function boolFromCell_(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null || v === '') return false;
  return String(v).trim().toUpperCase() === 'TRUE';
}

// Date 셀 → 'yyyy-MM-dd' (Asia/Seoul). 항상 문자열로 쓰지만 Sheets가 셀 서식에 따라
// Date 객체로 돌려주는 경우가 있어 양쪽을 정규화한다 (계약 §1).
function formatDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (isDateLike_(v)) return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  return String(v).trim();
}

// ---------------------------------------------------------------------------
// 날짜 유틸 (계약 §1)
// ---------------------------------------------------------------------------

function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

function nowIso_() {
  return new Date().toISOString();
}

// 'yyyy-MM-dd' 문자열 위의 순수 달력 연산. UTC 자정을 중립 기준점으로만 쓰므로
// 타임존 의존이 없다.
function addDaysToDateStr_(dateStr, days) {
  const parts = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function isValidDateStr_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidYm_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
}

function ymOf_(dateStr) {
  return String(dateStr).slice(0, 7);
}

function recordsSheetName_(ym) {
  return RECORDS_PREFIX + ym;
}

// fromDate ~ toDate(포함)가 걸치는 'YYYY-MM' 목록을 오름차순으로.
function ymRange_(fromDate, toDate) {
  const out = [];
  let y = Number(fromDate.slice(0, 4));
  let m = Number(fromDate.slice(5, 7));
  const endY = Number(toDate.slice(0, 4));
  const endM = Number(toDate.slice(5, 7));
  // 안전장치: 무한 루프 방지 (최대 400개월)
  for (let guard = 0; guard < 400; guard++) {
    if (y > endY || (y === endY && m > endM)) break;
    out.push(y + '-' + String(m).padStart(2, '0'));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 문자열 / 캐시
// ---------------------------------------------------------------------------

// 코드포인트 길이. 이모지·한자 확장 등 서로게이트 쌍을 1자로 센다.
function codePointLength_(s) {
  return Array.from(String(s)).length;
}

// 개행·제어문자 제거 + trim. 이름/기도제목 같은 사용자 입력 정제용.
function cleanText_(s, allowNewline) {
  // 정규식에 제어문자를 escape로 적으면 편집기·전송 계층이 실제 제어문자로 바꿔
  // 소스에 박아 넣는 사고가 난다(2026-07-30 실제 발생). 문자코드로 직접 걸러낸다.
  // allowNewline이면 개행(10)만 보존하고 나머지 제어문자는 공백으로 바꾼다.
  const src = String(s === null || s === undefined ? '' : s);
  const LF = String.fromCharCode(10);
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c >= 32 && c !== 127) { out += src.charAt(i); continue; }
    out += (allowNewline && c === 10) ? LF : ' ';
  }
  return out.replace(/  +/g, ' ').trim();
}

// CacheService.put은 값당 100KB 제한이 있다. 넘으면 던지지 말고 캐시를 건너뛴다.
function safeCachePut_(cache, key, value, seconds) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (s.length > 95000) return false;
    cache.put(key, s, seconds);
    return true;
  } catch (e) {
    return false;
  }
}

function safeCacheGet_(cache, key) {
  try {
    const raw = cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function safeCacheRemove_(cache, key) {
  try { cache.remove(key); } catch (e) { /* ignore */ }
}
