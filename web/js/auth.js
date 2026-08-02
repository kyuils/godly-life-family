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
  // ★ api 세션도 state.session도 로그아웃·만료 시 **같은 턴에** 비워진다.
  //   그래서 그 둘만 보는 폴백은 실제로는 한 번도 동작하지 않는 死코드였다
  //   (7차 검토에서 지적받아 정정). 계정 전환을 감지하려면 «지워지지 않는 기록»이
  //   필요하다 — api.getLastEmail()이 그 목적으로만 존재한다.
  const prev = api.getSessionEmail() || api.getLastEmail() || null;
  if (prev && prev !== String(email).toLowerCase()) {
    api.clearCache();
    resetUserData();
    // 화면 모듈이 들고 있는 임시 입력(draft)까지 파기하라고 알린다.
    // 여기서 뷰를 직접 import하면 순환 참조가 되므로 이벤트로 전달한다.
    window.dispatchEvent(new CustomEvent('app:account-changed'));
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
let gisPollTimer = null;

function whenGisReady(onReady, onTimeout) {
  // 재진입(세션 만료 → 로그인 화면 재렌더) 시 인터벌이 누적되지 않도록 항상 정리한다.
  if (gisPollTimer) { clearInterval(gisPollTimer); gisPollTimer = null; }
  if (gisReady()) { onReady(); return; }
  let waited = 0;
  const step = 250;
  const limit = 15000; // 15초까지 기다린다 (느린 모바일 회선 대비)
  gisPollTimer = setInterval(function () {
    if (gisReady()) { clearInterval(gisPollTimer); gisPollTimer = null; onReady(); return; }
    waited += step;
    if (waited >= limit) { clearInterval(gisPollTimer); gisPollTimer = null; onTimeout(); }
  }, step);
}

/**
 * @param opts.autoSelect 구글 «자동 로그인»을 허용할지 (기본 false).
 *
 * ★ 왜 기본이 false인가 (보안 불변식 7 / 계약 §6.4)
 *   이 앱은 로그인 정보를 **기기에 저장하지 않는다.** 그래서 새로고침·앱 재실행마다
 *   로그인 화면으로 돌아갔다 (2026-08-02 실사용 신고). 구글 GIS의 auto_select는
 *   저장 없이 이 문제를 푼다 — 이미 승인한 계정이 **하나뿐일 때만** 구글이 조용히
 *   토큰을 되돌려 준다. 그래도 «앱을 켤 때»에만 켠다:
 *   로그아웃 직후에도 켜면 방금 로그아웃한 사람이 즉시 다시 로그인되어
 *   공용 휴대폰에서 세션을 끊을 수단이 사라진다.
 *   (signOut()의 disableAutoSelect()가 한 겹 더 막지만, 그 한 겹에만 기대지 않는다)
 */
export function initGis(container, callback, opts) {
  onSignedIn = callback;
  const autoSelect = !!(opts && opts.autoSelect);

  if (isMock()) {
    // 개발·E2E 전용. 실제 배포에서는 APP_CONFIG.MOCK이 null이어야 한다.
    applyToken(APP_CONFIG.MOCK, 'mock:' + APP_CONFIG.MOCK);
    onSignedIn();
    return;
  }

  container.textContent = '로그인 준비 중...';
  whenGisReady(
    function () { container.textContent = ''; renderGisButton(container, autoSelect); },
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

function renderGisButton(container, autoSelect) {
  window.google.accounts.id.initialize({
    client_id: APP_CONFIG.OAUTH_CLIENT_ID,
    callback: function (resp) {
      const email = emailFromJwt(resp.credential);
      applyToken(email, resp.credential);
      onSignedIn();
    },
    // 승인된 구글 세션이 **하나뿐일** 때만 사용자 조작 없이 토큰을 돌려준다.
    // 이 «하나뿐» 조건이 공용 휴대폰에서 이 기능을 쓸 수 있게 하는 근거다:
    // 가족 계정이 둘 이상이면 구글이 계정 선택창을 띄운다.
    auto_select: autoSelect,
    // ★ button_auto_select는 **켜지 않는다.**
    //   구글 문서가 보장하는 조건이 auto_select와 다르다 — 「활성 세션이 있는
    //   재방문자를 계정 선택창 없이 로그인시킨다」이고 «계정이 하나뿐일 때»라는
    //   단서가 없다. 그러면 이런 일이 생긴다:
    //     엄마가 로그아웃하지 않고 앱을 닫는다 → 아이가 **자기 계정으로 들어가려고
    //     로그인 버튼을 직접 누른다** → 계정 선택창 없이 엄마 계정으로 들어간다.
    //   로그아웃을 안 했으니 disableAutoSelect()도 걸리지 않는다.
    //   신고 ①(로그인이 두 번 필요해 보임)은 로딩 화면으로 이미 해결됐으므로
    //   이 위험을 감수해서 얻을 것이 없다.
    cancel_on_tap_outside: true,
  });
  window.google.accounts.id.renderButton(container, {
    theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko',
  });

  if (autoSelect) {
    // 자동 로그인·One Tap을 실제로 띄우는 것은 prompt()다. initialize()만으로는
    // 아무 일도 일어나지 않는다.
    //
    // ★ 여기서 성공을 가정하지 않는다. 구글이 자동 로그인을 건너뛰는 경우가 많다:
    //   승인된 계정이 둘 이상, 구글에 로그아웃 상태, 직전 자동 로그인 후 10분 이내,
    //   One Tap을 여러 번 닫아 쿨다운에 걸린 경우.
    //   그때는 아무 일도 일어나지 않고 **아래에 이미 그려 둔 로그인 버튼이 남는다.**
    //   그래서 prompt()를 버튼보다 **뒤에** 부른다 — 순서를 바꾸면 자동 로그인이
    //   막힌 사용자에게 버튼 없는 화면이 잠깐 보인다.
    try { window.google.accounts.id.prompt(); } catch (e) { /* 버튼으로 로그인하면 된다 */ }
  }
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
