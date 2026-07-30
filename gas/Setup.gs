// Setup.gs — 최초 1회 초기화 도우미. 런타임에는 쓰이지 않는다.
//
// 사용법 (docs/ops/03-deploy-gas.md 참고):
//   1) 아래 SETUP_* 값을 채운다 (시트 ID, OAuth 클라이언트 ID, 담임교사 계정).
//   2) GAS 편집기에서 함수 선택 → setupAll → 실행. 최초 실행 시 권한 승인 창이 뜬다.
//   3) 실행 로그에 "SETUP COMPLETE"가 나오면 끝. 여러 번 실행해도 안전하다(멱등).
//
// 매달 새로 생기는 RECORDS_YYYY-MM 시트를 보호하려면 protectDataSheets()를 가끔 실행한다.

// 데이터 스프레드시트 ID (구글 드라이브에서 만든 시트의 주소창에서 복사)
const SETUP_SHEET_ID = 'PASTE_SHEET_ID_HERE';

// OAuth 클라이언트 ID (docs/ops/01-setup-google-cloud.md 에서 발급)
const SETUP_OAUTH_CLIENT_ID = 'PASTE_CLIENT_ID_HERE';

// 최초 관리자(담임교사) — MEMBERS_교사 탭이 새로 만들어질 때 이 계정을 admin으로 등록한다.
const SETUP_ADMIN_EMAIL = 'PASTE_ADMIN_EMAIL_HERE';
const SETUP_ADMIN_NAME = '담임교사';

// 자가 등록 코드. 이 값을 코드에 남겨 두지 않는 것을 권장한다 — 코드 자체가 접근 통제
// 게이트이기 때문이다. placeholder 상태로 실행하면 등록은 폐쇄(registration_closed)로
// 남고, 나중에 스크립트 속성에서 REGISTER_CODE를 직접 설정하면 열린다.
// 가입 기간이 끝나면 **빈 값으로 지워 등록을 폐쇄**한다 (docs/ops/06-operations.md).
const SETUP_REGISTER_CODE = 'PASTE_REGISTER_CODE_HERE';

function setupAll() {
  setupProperties_();
  setupTabs_();
  protectDataSheets();
  Logger.log('SETUP COMPLETE — 명부 3개 탭, PRAYERS 탭, Script Properties가 준비되었습니다.');
}

function setupProperties_() {
  const props = PropertiesService.getScriptProperties();

  if (SETUP_SHEET_ID && SETUP_SHEET_ID !== 'PASTE_SHEET_ID_HERE') {
    props.setProperty('SHEET_ID', SETUP_SHEET_ID);
    Logger.log('Script Properties: SHEET_ID 설정 완료');
  } else {
    Logger.log('!! SHEET_ID가 placeholder입니다 — SETUP_SHEET_ID를 채우고 다시 실행하세요.');
  }

  // ★ 반드시 trim한다. 붙여넣을 때 딸려 오는 앞뒤 공백 하나 때문에 토큰의 aud와
  //   달라지고, 사용자에게는 로그인 후 모든 동작이 실패하는 것으로 나타난다.
  //   문서로 안내하기 전에 코드로 없앨 수 있는 고장이다 (5차 검토 N7).
  const clientId = String(SETUP_OAUTH_CLIENT_ID || '').trim();
  if (clientId && clientId !== 'PASTE_CLIENT_ID_HERE') {
    props.setProperty('OAUTH_CLIENT_ID', clientId);
    Logger.log('Script Properties: OAUTH_CLIENT_ID 설정 완료');
    if (clientId.indexOf('.apps.googleusercontent.com') < 0) {
      Logger.log('!! 경고: OAUTH_CLIENT_ID가 «.apps.googleusercontent.com»으로 끝나지 않습니다. ' +
        '«클라이언트 ID»가 맞는지 확인하세요(«클라이언트 보안 비밀번호»가 아닙니다).');
    }
  } else {
    Logger.log('!! OAUTH_CLIENT_ID가 placeholder입니다 — 01 문서에서 발급 후 다시 실행하세요.');
  }

  // REGISTER_CODE는 미설정일 때만 넣는다 — 운영 중 바꾼 값을 덮어쓰지 않는다.
  const existing = props.getProperty('REGISTER_CODE');
  const constUsable = SETUP_REGISTER_CODE &&
    SETUP_REGISTER_CODE !== 'PASTE_REGISTER_CODE_HERE' &&
    String(SETUP_REGISTER_CODE).trim().length > 0;
  if (existing && String(existing).trim().length > 0) {
    Logger.log('Script Properties: REGISTER_CODE 기존 값 유지(운영 중 변경값 보존)');
  } else if (constUsable) {
    props.setProperty('REGISTER_CODE', String(SETUP_REGISTER_CODE).trim());
    Logger.log('Script Properties: REGISTER_CODE 설정 완료');
  } else {
    Logger.log('Script Properties: REGISTER_CODE 미설정 — 등록 폐쇄 상태(registration_closed).');
  }
}

function setupTabs_() {
  const ss = SpreadsheetApp.openById(SETUP_SHEET_ID);

  ensureTab_(ss, SHEET_NAMES.MEMBERS_STUDENT, HEADERS.MEMBERS_STUDENT);
  ensureTab_(ss, SHEET_NAMES.MEMBERS_PARENT, HEADERS.MEMBERS_PARENT);
  const teacherCreated = ensureTab_(ss, SHEET_NAMES.MEMBERS_TEACHER, HEADERS.MEMBERS_TEACHER);
  ensureTab_(ss, SHEET_NAMES.PRAYERS, HEADERS.PRAYERS);

  // 역할 열 드롭다운 (오타 방지. 서버는 공백·대소문자를 허용하지만 오타는 못 막는다)
  const teachers = ss.getSheetByName(SHEET_NAMES.MEMBERS_TEACHER);
  const roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['teacher', 'admin'], true)
    .setAllowInvalid(true)
    .build();
  teachers.getRange(2, 3, 200, 1).setDataValidation(roleRule);

  // 새로 만든 경우에만 최초 관리자 등록
  if (teacherCreated && SETUP_ADMIN_EMAIL && SETUP_ADMIN_EMAIL !== 'PASTE_ADMIN_EMAIL_HERE') {
    teachers.appendRow([String(SETUP_ADMIN_EMAIL).toLowerCase().trim(), SETUP_ADMIN_NAME, 'admin', 'TRUE', todayStr_()]);
    Logger.log('MEMBERS_교사: 최초 관리자 등록 — ' + SETUP_ADMIN_EMAIL);
  }

  ['Sheet1', '시트1'].forEach(function (name) {
    const s = ss.getSheetByName(name);
    if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

/**
 * RECORDS_* 와 PRAYERS 시트를 보호한다 (소유자만 편집 가능).
 *
 * 계약 §2.0: 이 시트들을 사람이 정렬·행삽입·행삭제하면, 앱이 스캔으로 얻은 행 번호가
 * 다른 사람의 행을 가리키게 되어 남의 기록을 덮어쓸 수 있다. 앱은 read-verify-write로
 * 2차 방어를 하지만, 1차 방어는 애초에 사람이 못 건드리게 하는 것이다.
 *
 * RECORDS 시트는 매달 자동 생성되므로 이 함수를 가끔(예: 분기마다) 다시 실행한다.
 * 멱등하다 — 이미 보호된 시트는 건너뛴다.
 */
function protectDataSheets() {
  const ss = SpreadsheetApp.openById(SETUP_SHEET_ID);
  const sheets = ss.getSheets();
  let done = 0;
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const name = sh.getName();
    const isData = name === SHEET_NAMES.PRAYERS || name.indexOf(RECORDS_PREFIX) === 0;
    if (!isData) continue;
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0) continue;
    const p = sh.protect().setDescription('앱 전용 — 정렬·행삽입·행삭제 금지 (계약 §2.0)');
    p.removeEditors(p.getEditors());
    done++;
  }
  Logger.log('protectDataSheets: ' + done + '개 시트 보호 설정');
}

// 탭이 없으면 만들고 헤더를 기록. 반환값: 새로 만들었는지 여부.
function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const headerOk = headers.every(function (h, i) { return String(current[i]) === h; });
  if (!headerOk) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return created;
}
