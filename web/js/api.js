// web/js/api.js — GAS 백엔드 호출 + 캐시.
// 계약: docs/specs/2026-07-30-api-contract.md §4, §6.1
//
// ★ 보안 규정 (계약 §6.1 / CLAUDE.md 불변식 7)
// 이 앱은 가정에서 한 휴대폰을 학생과 학부모가 공유하는 것이 기본 시나리오다.
// 계정을 바꿨을 때 캐시가 남으면 자녀의 기도제목이 부모 화면에 뜬다.
//   1) 캐시 키에 세션 email을 접두한다.
//   2) 캐시는 메모리(Map)에만 둔다 — localStorage/sessionStorage 금지.
//   3) 로그아웃·세션만료·계정 전환 시 전부 파기한다.

import { APP_CONFIG } from './config.js';

const CACHE_TTL_MS = 2 * 60 * 1000;

// 모듈 스코프 Map — 탭을 닫으면 사라진다. 저장소에 남기지 않는다.
const cache = new Map();

let currentEmail = null;   // 캐시 스코핑 키
let currentToken = null;

// ★ 계정 전환 감지 **전용**. clearSession()에도 지우지 않는다.
// 로그아웃·세션만료는 currentEmail을 비우므로, 그것만 보면
// «로그아웃 → 다른 가족이 로그인»을 감지하지 못한다(그때가 가장 위험한 순간인데).
// 캐시 키에는 절대 쓰지 않는다 — 어디까지나 «직전에 누구였나»의 기록이다.
let lastEmail = null;

// 쓰기 액션이 무효화해야 할 읽기 액션 (계약 §6.1)
const WRITE_INVALIDATES = {
  setRecord: ['getMyRecords', 'getAllRecords'],
  addPrayer: ['getMyPrayers', 'getAllPrayers'],
  setPrayerAnswered: ['getMyPrayers', 'getAllPrayers'],
  deletePrayer: ['getMyPrayers', 'getAllPrayers'],
  register: ['whoami'],
};

const READ_ACTIONS = new Set([
  'whoami', 'getMyRecords', 'getMyPrayers', 'getAllRecords', 'getAllPrayers', 'getMembers',
]);

export function setSession(email, idToken) {
  const lower = email ? String(email).toLowerCase() : null;
  // 계정이 바뀌면 이전 사용자의 캐시를 즉시 파기한다.
  if (currentEmail && currentEmail !== lower) clearCache();
  currentEmail = lower;
  if (lower) lastEmail = lower;
  currentToken = idToken || null;
}

export function getSessionEmail() {
  return currentEmail;
}

/** 직전에 로그인했던 사람(로그아웃 후에도 남는다). 계정 전환 감지 전용. */
export function getLastEmail() {
  return lastEmail;
}

export function clearCache() {
  cache.clear();
}

/** 로그아웃·세션만료 시 호출. 토큰과 캐시를 모두 버린다. */
export function clearSession() {
  currentEmail = null;
  currentToken = null;
  clearCache();
}

function cacheKey(action, params) {
  // email 접두가 없으면 계정 전환 시 남의 데이터를 돌려주게 된다.
  return (currentEmail || '-') + '|' + action + '|' + JSON.stringify(params || {});
}

function invalidateFor(action) {
  const targets = WRITE_INVALIDATES[action];
  if (!targets) return;
  Array.from(cache.keys()).forEach(function (k) {
    const parts = k.split('|');
    if (targets.indexOf(parts[1]) >= 0) cache.delete(k);
  });
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function post(action, params) {
  const body = Object.assign({ action: action, idToken: currentToken }, params || {});
  const res = await fetch(APP_CONFIG.GAS_URL, {
    method: 'POST',
    // text/plain 이어야 CORS preflight가 발생하지 않는다 (계약 §4).
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

/**
 * 네트워크·CORS 실패를 **예외가 아니라 응답 객체로** 정규화한다.
 *
 * ★ 이게 없으면 화면이 말없이 멈춘다.
 * 호출부는 전부 `res.ok`를 보도록 되어 있는데, fetch가 throw하면 그 분기를 타지 못하고
 * 처리되지 않은 rejection으로 사라진다. 특히 GAS 웹앱을 "사용자로 실행"으로 잘못
 * 배포하면 구글이 200 대신 로그인 리다이렉트를 돌려주고 브라우저가 CORS 오류로 만든다
 * → **로그인 버튼을 눌러도 아무 일도 일어나지 않는다.** 비개발자는 진단할 수단이 없다.
 * (2026-07-30 2차 검토 [중대] 지적)
 */
async function postSafe(action, params) {
  try {
    return await post(action, params);
  } catch (e) {
    return { ok: false, code: 'network_error' };
  }
}

/**
 * 액션 호출. 읽기 액션은 2분 캐시, busy는 지수 백오프로 최대 2회 재시도한다.
 * 세션 만료 계열 코드는 app:session-expired 이벤트를 쏘고 그대로 반환한다.
 */
export async function call(action, params, opts) {
  const options = opts || {};
  const useCache = READ_ACTIONS.has(action) && !options.noCache;
  const key = cacheKey(action, params);

  if (useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  let result;
  const backoff = [1000, 3000];
  for (let attempt = 0; ; attempt++) {
    result = await postSafe(action, params);
    // busy는 저녁 피크에 잠금 대기가 길어질 때 나온다 (계약 §4.2).
    if (result && result.code === 'busy' && attempt < backoff.length) {
      await sleep(backoff[attempt]);
      continue;
    }
    break;
  }

  const EXPIRED = ['token_expired', 'invalid_token', 'no_token'];
  if (result && result.ok === false && EXPIRED.indexOf(result.code) >= 0) {
    clearSession();
    window.dispatchEvent(new CustomEvent('app:session-expired'));
    return result;
  }

  if (result && result.ok) {
    if (useCache) cache.set(key, { at: Date.now(), value: result });
    invalidateFor(action);
  }
  return result;
}

/** 사용자에게 보여줄 오류 문구. 내부 코드를 그대로 노출하지 않는다. */
export function errorMessage(code) {
  const MAP = {
    busy: '지금 접속이 몰리고 있어요. 잠시 후 다시 시도해 주세요.',
    network_error: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. 계속 그러면 담임교사에게 알려주세요 — 서버 배포 설정(설치문서 03번 5단계) 문제일 수 있습니다.',
    conflict: '방금 기록이 저장되지 않았어요. 잠시 후 다시 시도해 주세요.',
    forbidden: '권한이 없습니다.',
    unauthorized: '등록되지 않은 계정입니다.',
    bad_request: '입력한 내용을 다시 확인해 주세요.',
    bad_code: '등록 코드가 올바르지 않습니다.',
    already_registered: '이미 등록된 계정입니다.',
    deactivated: '사용이 중지된 계정입니다. 담임교사에게 문의해 주세요.',
    too_many_attempts: '시도가 너무 많습니다. 10분 후 다시 시도해 주세요.',
    registration_closed: '지금은 가입을 받지 않습니다. 담임교사에게 문의해 주세요.',
    server_misconfig: '서버 설정이 완료되지 않았습니다. 담임교사에게 알려주세요.',
    token_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    // ★ 설치 시 가장 흔한 실수: 구글 로그인 키(클라이언트 ID)를 두 곳
    //   (gas/Setup.gs 와 web/js/config.js)에 붙여넣는데 값이 서로 다른 경우.
    //   문구가 없으면 "문제가 발생했습니다"로만 끝나 원인을 영영 못 찾는다
    //   (2026-07-30 4차 검토 [중대] 지적).
    aud_mismatch: '구글 로그인 키가 서버와 앱에서 서로 다릅니다. 담임교사에게 알려주세요. (설치문서 01·03·04번의 클라이언트 ID가 같은 값인지 확인)',
    iss_mismatch: '로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.',
    tokeninfo_failed: '구글 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    invalid_token: '로그인 정보가 올바르지 않습니다. 다시 로그인해 주세요.',
    email_unverified: '이메일 인증이 완료되지 않은 구글 계정입니다. 다른 계정으로 시도해 주세요.',
    server_error: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  };
  return MAP[code] || '문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}
