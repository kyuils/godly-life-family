// scripts/gas-harness.mjs — gas/*.gs를 Node vm 컨텍스트에 GAS 전역 모의체와 함께
// 올려서, 실제 백엔드 로직을 Apps Script 밖에서 단위 테스트할 수 있게 한다.
//
// 선행 저장소 kyuils/godly-life-check 의 harness를 계승하고 다음을 추가했다:
//   - 월별 RECORDS 시트 (동적 생성: insertSheet)
//   - 명부 3개 시트 + PRAYERS
//   - Utilities.getUuid()
//   - 읽은 셀 수 카운터 (계약 §4.5 — 시간이 아니라 셀 수로 회귀를 잡는다)
//   - LockService 실패 주입 (busy 경로 테스트)
//   - 사람이 시트를 정렬한 상황 재현 (conflict 경로 테스트)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAS_DIR = path.join(__dirname, '..', 'gas');

// GAS는 .gs 파일을 편집기 순서대로 평가한다. 배포자가 그 순서를 신경 쓰지 않아도 되도록
// 어떤 순서에서도 동작해야 한다 — 테스트가 최악의 순서도 돌려본다.
const GAS_FILES = ['Sheet.gs', 'Auth.gs', 'Actions.gs', 'Code.gs'];

export const HEADERS = {
  MEMBERS_STUDENT: ['email', '이름', '학년반', 'active', '가입시각', '가입경로'],
  MEMBERS_PARENT: ['email', '이름', '자녀이름', 'active', '가입시각', '가입경로'],
  MEMBERS_TEACHER: ['email', '이름', '역할', 'active', '가입시각'],
  RECORDS: ['날짜', 'email', '이름', '구분', '말씀읽음', '와닿은말씀', '결단', '중보기도', '기록시각', '수정시각'],
  PRAYERS: ['기도ID', '등록일', 'email', '이름', '구분', '기도제목', '상태', '응답일', '수정시각', '삭제여부'],
};

export const NAMES = {
  MEMBERS_STUDENT: 'MEMBERS_학생',
  MEMBERS_PARENT: 'MEMBERS_학부모',
  MEMBERS_TEACHER: 'MEMBERS_교사',
  PRAYERS: 'PRAYERS',
};

// ---- Mock Sheet -------------------------------------------------------------

class MockSheet {
  constructor(headers, objRows, counter) {
    const rows = (objRows || []).map((o) => headers.map((h) => (o[h] === undefined ? '' : o[h])));
    this.data = [headers.slice(), ...rows];
    this.counter = counter;
    this.protections = [];
  }
  getName() { return this._name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.length ? this.data[0].length : 0; }
  getRange(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    const self = this;
    return {
      getValues() {
        // 계약 §4.5: 읽는 셀 수를 센다. setRecord의 스캔이 전체 열을 읽으면
        // 이 수치가 튀고 테스트가 실패한다.
        if (self.counter) self.counter.cellsRead += numRows * numCols;
        // 계약 §2.0: "스캔이 끝난 뒤 쓰기 직전에 사람이 시트를 편집한" 상황을 재현한다.
        // 이 창은 LockService로 막을 수 없는 유일한 경합이고(사람의 UI 편집은 스크립트
        // 실행이 아니다), read-verify-write가 막아야 하는 바로 그 대상이다.
        //
        // 읽기 횟수를 세지 않고 "본문 한 행 전체를 읽는 호출"을 신호로 쓴다 —
        // 그것이 verifyRowKeys_의 대상 행 읽기이기 때문이다. 헤더 읽기 횟수가
        // 바뀌어도 테스트가 조용히 무의미해지지 않는다.
        if (self._sabotageBeforeRowRead && numRows === 1 && numCols > 1 && row >= 2) {
          const fn = self._sabotageBeforeRowRead;
          self._sabotageBeforeRowRead = null;
          fn(self);
        }
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rr = row - 1 + r;
          const arr = [];
          for (let c = 0; c < numCols; c++) {
            const cc = col - 1 + c;
            const v = self.data[rr] ? self.data[rr][cc] : undefined;
            arr.push(v === undefined ? '' : v);
          }
          out.push(arr);
        }
        return out;
      },
      setValues(values) {
        for (let r = 0; r < values.length; r++) {
          const rr = row - 1 + r;
          while (self.data.length <= rr) self.data.push([]);
          for (let c = 0; c < values[r].length; c++) {
            self.data[rr][col - 1 + c] = values[r][c];
          }
        }
        return this;
      },
      setDataValidation() { return this; },
      setFontWeight() { return this; },
    };
  }
  appendRow(values) { this.data.push(values.slice()); }
  setFrozenRows() { return this; }
  // 사람이 스프레드시트 UI에서 행 순서를 바꾼 상황을 재현한다 (계약 §2.0 / conflict 테스트용).
  // 정렬은 이미 정렬된 데이터에서 아무것도 바꾸지 못할 수 있어, 확실히 순서가 바뀌는
  // 역순 뒤집기를 쓴다 — 테스트가 "아무 일도 안 일어난 상태"를 통과로 세지 않도록.
  reverseRows() {
    this.data = [this.data[0], ...this.data.slice(1).reverse()];
  }
  // 다음번 "본문 한 행 전체 읽기"(= verifyRowKeys_의 대상 행 읽기) 직전에 fn(sheet)을
  // 한 번 실행한다. 스캔 완료 후 쓰기 직전이라는 실제 위험 구간을 재현하기 위한 것.
  sabotageBeforeRowRead(fn) {
    this._sabotageBeforeRowRead = fn;
  }
  objects() {
    const headers = this.data[0];
    return this.data.slice(1).map((row) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = row[i]; });
      return o;
    });
  }
}

// ---- Mock globals -----------------------------------------------------------

function createUtilities(uuidCounter) {
  return {
    formatDate(date, tz, pattern) {
      if (pattern !== 'yyyy-MM-dd') throw new Error('unsupported pattern: ' + pattern);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(date);
    },
    computeDigest(_a, value) {
      return Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest());
    },
    base64EncodeWebSafe(bytes) {
      return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    getUuid() {
      uuidCounter.n += 1;
      return 'aaaaaaaa-bbbb-cccc-dddd-' + String(uuidCounter.n).padStart(12, '0');
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
  };
}

// `mock:<email>` 토큰은 항상 유효로 취급하고, 그 외는 400(invalid_token).
function createUrlFetchApp() {
  return {
    fetch(url) {
      let idToken = '';
      try { idToken = new URL(url).searchParams.get('id_token') || ''; } catch (e) { /* ignore */ }
      if (idToken.startsWith('mock:')) {
        const body = {
          aud: 'mock-client',
          iss: 'accounts.google.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          email: idToken.slice(5),
          email_verified: 'true',
        };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      }
      return { getResponseCode: () => 400, getContentText: () => '{"error":"invalid_token"}' };
    },
  };
}

export function createHarness(seed = {}) {
  const counter = { cellsRead: 0 };
  const uuidCounter = { n: 0 };
  const sheetsByName = {};

  function makeSheet(name, headers, rows) {
    const s = new MockSheet(headers, rows, counter);
    s._name = name;
    sheetsByName[name] = s;
    return s;
  }

  makeSheet(NAMES.MEMBERS_STUDENT, HEADERS.MEMBERS_STUDENT, seed.students);
  makeSheet(NAMES.MEMBERS_PARENT, HEADERS.MEMBERS_PARENT, seed.parents);
  makeSheet(NAMES.MEMBERS_TEACHER, HEADERS.MEMBERS_TEACHER, seed.teachers);
  if (seed.prayers) makeSheet(NAMES.PRAYERS, HEADERS.PRAYERS, seed.prayers);

  // records: { 'RECORDS_2026-07': [ {...}, ... ] }
  Object.keys(seed.records || {}).forEach((name) => {
    makeSheet(name, HEADERS.RECORDS, seed.records[name]);
  });

  const scriptProps = { SHEET_ID: 'mock', OAUTH_CLIENT_ID: 'mock-client' };
  if (Object.prototype.hasOwnProperty.call(seed, 'registerCode')) {
    if (seed.registerCode !== null) scriptProps.REGISTER_CODE = seed.registerCode;
  } else {
    scriptProps.REGISTER_CODE = 'hyerim2026';
  }
  if (seed.scriptProps) Object.assign(scriptProps, seed.scriptProps);
  if (seed.deleteProps) seed.deleteProps.forEach((k) => { delete scriptProps[k]; });

  const cacheStore = new Map();
  const lockState = { fail: !!seed.lockFails, acquired: 0, released: 0 };

  const sandbox = {
    console: { error() {}, log() {} },
    SpreadsheetApp: {
      openById() {
        return {
          getSheetByName: (n) => sheetsByName[n] || null,
          insertSheet: (n) => makeSheet(n, [], []),
          getSheets: () => Object.values(sheetsByName),
          deleteSheet: (s) => { delete sheetsByName[s._name]; },
        };
      },
      newDataValidation: () => ({
        requireValueInList: function () { return this; },
        setAllowInvalid: function () { return this; },
        build: () => ({}),
      }),
      ProtectionType: { SHEET: 'SHEET' },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(scriptProps, k) ? scriptProps[k] : null),
        setProperty: (k, v) => { scriptProps[k] = v; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (lockState.fail) throw new Error('Could not acquire lock');
          lockState.acquired += 1;
        },
        releaseLock() { lockState.released += 1; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cacheStore.get(k);
          if (!e) return null;
          if (Date.now() > e.expiresAt) { cacheStore.delete(k); return null; }
          return e.value;
        },
        put(k, v, sec) {
          cacheStore.set(k, { value: String(v), expiresAt: Date.now() + (Number(sec) || 600) * 1000 });
        },
        remove(k) { cacheStore.delete(k); },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } }),
    },
    Utilities: createUtilities(uuidCounter),
    UrlFetchApp: createUrlFetchApp(),
  };

  const context = vm.createContext(sandbox);
  for (const file of (seed.fileOrder || GAS_FILES)) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, file), 'utf8'), context, { filename: file });
  }

  return {
    callAction(body) {
      return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body || {}) } }).getContent());
    },
    callGet() { return JSON.parse(context.doGet({}).getContent()); },
    sheet(name) { return sheetsByName[name]; },
    sheetNames() { return Object.keys(sheetsByName); },
    context,
    counter,
    lockState,
    cacheStore,
    resetCells() { counter.cellsRead = 0; },
    todayStr() { return context.todayStr_(); },
    addDays(d, n) { return context.addDaysToDateStr_(d, n); },
  };
}
