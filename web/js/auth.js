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

function gisReady() {
  return !!(window.google && window.google.accounts && window.google.accounts.id);
}

/**
 * 구글 로그인(GIS) 스크립트가 준비될 때까지 기다린다.
 *
 * ★ 이 대기가 없으면 로그인 버튼이 아예 뜨지 않는 경로가 열린다.
 * index.html에서 app.js는 type="module"(암묵적 defer)이라 문서 파싱 직후 실행되는데,
 * GIS 스크립트는 async 교차출처라 네트워크가 느리면 그보다 늦게 도착한다.
 * 그러면 initGis가 window.google을 못 찾고 그대로 포기해 버린다 — 새로고침 말고는
 * 복구 수단이 없고, 빠른 회선에서는 재현되지 않아 점검을 통과해 버린다.
 * (2026-07-30 최종 검토에서 [치명]으로 지적된 결함)
 */
function whenGisReady(onReady, onTimeout) {
  if (gisReady()) { onReady(); return; }
  let waited = 0;
  const step = 250;
  const limit = 15000; // 15초까지 기다린다 (느린 모바일 회선 대비)
  const timer = setInterval(function () {
    if (gisReady()) { clearInterval(timer); onReady(); return; }
    waited += step;
    if (waited >= limit) { clearInterval(timer); onTimeout(); }
  }, step);
}

export function initGis(container, callback) {
  onSignedIn = callback;

  if (isMock()) {
    // 개발·E2E 전용. 실제 배포에서는 APP_CONFIG.MOCK이 null이어야 한다.
    applyToken(APP_CONFIG.MOCK, 'mock:' + APP_CONFIG.MOCK);
    onSignedIn();
    return;
  }

  container.textContent = '로그인 준비 중...';
  whenGisReady(
    function () { container.textContent = ''; renderGisButton(container); },
    function () {
      container.innerHTML = '';
      const btn = document.createElement('button');
      btn.className = 'btn primary block';
      btn.textContent = '다시 시도';
      btn.onclick = function () { location.reload(); };
      container.appendChild(btn);
      const p = document.createElement('p');
      p.className = 'login-notice';
      p.textContent = '구글 로그인을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
      container.appendChild(p);
    }
  );
}

function renderGisButton(container) {
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
