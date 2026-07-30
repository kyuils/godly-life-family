// web/js/auth.js — Google Identity Services 로그인 / 로그아웃.
// 계약: §6.1 (계정 전환 시 캐시·state 전면 파기), §7 (로그아웃 버튼)

import { APP_CONFIG } from './config.js';
import * as api from './api.js';
import { state, resetUserData } from './state.js';

let onSignedIn = null;

/** 표준 오늘 — Asia/Seoul YYYY-MM-DD. 브라우저 로컬 TZ를 쓰지 않는다 (계약 §1). */
export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export function isMock() {
  return typeof APP_CONFIG.MOCK === 'string' && APP_CONFIG.MOCK.length > 0;
}

/**
 * 로그인 성공 처리.
 * 직전 세션과 이메일이 다르면 api 캐시와 state를 **동기적으로 전부 파기한 뒤** 진행한다.
 * 이 순서가 뒤바뀌면 이전 사용자의 화면 데이터가 잠깐이라도 노출된다.
 */
function applyToken(email, idToken) {
  const prev = api.getSessionEmail();
  if (prev && prev !== String(email).toLowerCase()) {
    api.clearCache();
    resetUserData();
  }
  api.setSession(email, idToken);
}

export function initGis(container, callback) {
  onSignedIn = callback;

  if (isMock()) {
    // 개발·E2E 전용. 실제 배포에서는 APP_CONFIG.MOCK이 null이어야 한다.
    applyToken(APP_CONFIG.MOCK, 'mock:' + APP_CONFIG.MOCK);
    onSignedIn();
    return;
  }

  if (!window.google || !window.google.accounts || !window.google.accounts.id) {
    container.textContent = '구글 로그인을 불러오지 못했습니다. 네트워크를 확인해 주세요.';
    return;
  }

  window.google.accounts.id.initialize({
    client_id: APP_CONFIG.OAUTH_CLIENT_ID,
    callback: function (resp) {
      const email = emailFromJwt(resp.credential);
      applyToken(email, resp.credential);
      onSignedIn();
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  window.google.accounts.id.renderButton(container, {
    theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko',
  });
}

/**
 * JWT payload에서 email만 꺼낸다.
 * ★ 이 값은 캐시 스코핑에만 쓴다. 권한 판정은 전적으로 서버가 토큰을 검증해서 한다
 *   (계약 §0.1) — 여기서 읽은 값은 신뢰 대상이 아니다.
 */
function emailFromJwt(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    const json = decodeURIComponent(
      atob(part.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); })
        .join('')
    );
    return JSON.parse(json).email || '';
  } catch (e) {
    return '';
  }
}

/** 로그아웃 — 토큰 폐기 + 캐시·state 전면 파기 + 로그인 화면 복귀 (계약 §7). */
export function signOut() {
  try {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  } catch (e) { /* ignore */ }
  api.clearSession();
  resetUserData();
  state.library = null;
  window.dispatchEvent(new CustomEvent('app:signed-out'));
}
