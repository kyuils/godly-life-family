// web/js/app.js — 부트스트랩, 화면 전환, 로그인/가입.
// 계약: §6.1(캐시 격리), §7(탭·로그아웃)

import { APP_CONFIG } from './config.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { state, resetUserData, isTeacher, bumpGeneration } from './state.js';
import * as S from './stats.js';
import { loadMyData } from './load.js';
import { el, escapeHtml, toast, closeSheet } from './ui.js';

import * as viewToday from './view-today.js';
import * as viewCalendar from './view-calendar.js';
import * as viewPrayer from './view-prayer.js';
import * as viewLibrary from './view-library.js';
import * as viewClass from './view-class.js';

const TABS = [
  { id: 'today', label: '오늘', icon: '📖' },
  { id: 'calendar', label: '달력', icon: '🗓️' },
  { id: 'prayer', label: '기도', icon: '🙏' },
  { id: 'library', label: '자료', icon: '📚' },
  { id: 'class', label: '우리반', icon: '👥', teacherOnly: true },
];

/** 내용이 바뀌면 보던 위치가 아니라 맨 위에서 시작한다. */
function scrollToTop() {
  try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
}

let shownScreen = null;

/**
 * 화면 전환 — 로그인 / 가입 / 앱 중 **하나만** 보이게 한다.
 *
 * hidden 하나로 갈리므로, css의 `[hidden]{display:none!important}`가 반드시
 * 함께 있어야 한다. 그 규칙이 없으면 .cover·.register의 display:flex가 이겨
 * 세 화면이 위아래로 이어 붙는다 (2026-07-30 실사용 신고의 원인).
 */
function show(screen) {
  ['screen-login', 'screen-register', 'screen-app'].forEach(function (id) {
    el('#' + id).hidden = (id !== screen);
  });
  // 화면이 실제로 바뀔 때만 맨 위로. 같은 화면을 다시 그리는 경우(저장 후 갱신 등)는
  // 보던 위치를 흔들지 않는다.
  if (screen !== shownScreen) {
    shownScreen = screen;
    scrollToTop();
  }
}

// ---------------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------------

/**
 * 이 탭에서 앱이 몇 번째로 «처음부터» 시작됐는지.
 *
 * 로그인 뒤에 이 숫자가 올라가 있으면, 화면이 되돌아간 것이 아니라
 * **브라우저가 페이지를 새로 읽은 것**이다. 모바일에서 로그인 창을 다녀오는
 * 사이 원래 탭이 버려지면 이런 일이 생기고, 그러면 메모리에만 있던 로그인
 * 정보가 함께 사라져 로그인 화면으로 «돌아온 것처럼» 보인다.
 * 이 둘은 고치는 방법이 완전히 다르므로 구분할 수단이 필요하다.
 *
 * 저장소(localStorage/sessionStorage)는 쓰지 않는다 — 이 앱은 어떤 사용자 데이터도
 * 기기에 남기지 않으며, 그 규칙은 npm test가 강제한다. 대신 탭 수명 동안만
 * 유지되는 window.name에 숫자 하나만 둔다(사용자 데이터가 아니다).
 */
function appStartCount() {
  try {
    const PREFIX = 'godly-start-';
    const cur = String(window.name || '');
    const prev = cur.indexOf(PREFIX) === 0 ? Number(cur.slice(PREFIX.length)) : 0;
    const n = (isFinite(prev) && prev > 0 ? prev : 0) + 1;
    window.name = PREFIX + n;
    return n;
  } catch (e) {
    return 0; // 판정 불가
  }
}
const APP_STARTS = appStartCount();

function renderLogin() {
  closeSheet();
  show('screen-login');
  const holder = el('#gis-button');
  holder.innerHTML = '';
  auth.initGis(holder, afterSignIn);
  if (APP_STARTS > 1) {
    el('#login-notice').textContent = '앱 시작 #' + APP_STARTS;
  }
}

async function afterSignIn() {
  const res = await api.call('whoami', {}, { noCache: true });

  if (res.ok) {
    state.session = res;
    const loaded = await loadMyData(auth.todayStr());
    if (!loaded.ok) { failToLogin(loaded.code); return; }
    renderApp();
    return;
  }
  if (res.code === 'unauthorized') {
    if (res.canRegister) { renderRegister(res.email); }
    else {
      show('screen-login');
      el('#login-notice').textContent =
        '등록되지 않은 계정입니다. 담임교사에게 문의해 주세요. (' + (res.email || '') + ')';
    }
    return;
  }
  show('screen-login');
  // 코드를 함께 보여 준다. 비개발자 운영자가 화면만 보고도 원인을 그대로 전달할 수
  // 있어야 docs/ops의 «이럴 때는» 표를 찾아갈 수 있다 (2026-07-30 설치 후 실제 신고:
  // «로그인이 안 되고 로그인 화면으로 돌아온다» — 화면에 코드가 없어 진단이 막혔다).
  el('#login-notice').textContent = api.errorMessage(res.code) + ' [' + res.code + ']';
}

// ---------------------------------------------------------------------------
// 자가 등록 (요구사항 5·6)
// ---------------------------------------------------------------------------

function renderRegister(email) {
  show('screen-register');
  el('#reg-account').textContent = email || '';
  el('#reg-error').textContent = '';
  el('#reg-name').value = '';
  el('#reg-extra').value = '';
  el('#reg-code').value = '';
  setKind('student');

  el('#reg-kind-student').onclick = function () { setKind('student'); };
  el('#reg-kind-parent').onclick = function () { setKind('parent'); };
  el('#reg-submit').onclick = submitRegister;
  el('#reg-cancel').onclick = function () { auth.signOut(); };
}

let regKind = 'student';

function setKind(kind) {
  regKind = kind;
  el('#reg-kind-student').classList.toggle('on', kind === 'student');
  el('#reg-kind-parent').classList.toggle('on', kind === 'parent');
  el('#reg-extra-label').textContent = kind === 'student' ? '학년·반 (선택)' : '자녀 이름 (선택)';
  el('#reg-extra').placeholder = kind === 'student' ? '예: 중2-1' : '예: 김믿음';
}

async function submitRegister() {
  const btn = el('#reg-submit');
  btn.disabled = true; // 더블 서브밋 방지
  el('#reg-error').textContent = '';
  try {
    const res = await api.call('register', {
      name: el('#reg-name').value,
      kind: regKind,               // 서버는 student/parent만 허용한다 (계약 §4.2)
      extra: el('#reg-extra').value,
      code: el('#reg-code').value,
    });
    if (!res.ok) {
      el('#reg-error').textContent = api.errorMessage(res.code);
      return;
    }
    state.session = res;           // register 성공 응답은 whoami와 같은 형태
    const loaded = await loadMyData(auth.todayStr());
    if (!loaded.ok) { failToLogin(loaded.code); return; }
    renderApp();
  } catch (e) {
    el('#reg-error').textContent = '등록하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 로드 실패 처리
// ---------------------------------------------------------------------------

/**
 * 로그인은 됐지만 내 기록을 불러오지 못한 경우.
 *
 * 화면을 «빈 앱»으로 보여주면 사용자는 기록이 사라졌다고 오해한다.
 * 무엇이 잘못됐는지 알리고, 재로그인 없이 다시 시도할 수 있게 한다.
 */
function failToLogin(code) {
  // backToLogin과 같은 수준으로 화면 상태까지 비운다 — 앞사람의 편집 대상 날짜,
  // 펼쳐 둔 기도, 열람 중이던 문서가 다음 로그인으로 이월되지 않게 (7차 검토 N2).
  resetUserData();
  viewToday.resetEditDate();
  viewToday.clearDraft();
  viewPrayer.clearDraft();
  viewCalendar.resetView();
  viewPrayer.resetView();
  viewLibrary.resetView();
  viewClass.resetView();

  // ★ 여기서 renderLogin()을 부르면 안 된다.
  // MOCK 모드(로컬 미리보기)에서 initGis가 즉시 onSignedIn을 호출하므로
  // 「로드 실패 → 로그인 화면 → 자동 로그인 → 또 실패」 무한 루프가 된다
  // (7차 검토 N1). 대신 사용자가 «다시 시도»를 누르게 한다 —
  // 실제 사용자에게도 재로그인보다 나은 회복 경로다.
  closeSheet();
  show('screen-login');
  const holder = el('#gis-button');
  holder.innerHTML = '';
  const btn = document.createElement('button');
  btn.className = 'btn primary block';
  btn.textContent = '다시 시도';
  btn.onclick = function () {
    el('#login-notice').textContent = '다시 불러오는 중...';
    btn.disabled = true;
    // 토큰은 아직 살아 있다 — 전체 재로그인 없이 로드만 다시 시도한다.
    Promise.resolve(afterSignIn()).catch(function () {
      btn.disabled = false;
      el('#login-notice').textContent = '여전히 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    });
  };
  holder.appendChild(btn);

  const CAUSE = {
    network_error: '인터넷 연결을 확인해 주세요.',
    stale_session: '로그인이 끊겼습니다. 다시 로그인해 주세요.',
    busy: '지금 접속이 몰리고 있어요.',
    // 가장 흔한 실패는 1시간 만료다. 이 경우는 재시도가 아니라 재로그인이 필요하다.
    token_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    unauthorized: '등록되지 않은 계정입니다. 담임교사에게 문의해 주세요.',
    forbidden: '권한이 없습니다.',
  };
  el('#login-notice').textContent =
    '기록을 불러오지 못했습니다. ' + (CAUSE[code] || '잠시 후 다시 시도해 주세요.') +
    ' [' + code + ']';
}

// ---------------------------------------------------------------------------
// 앱 화면
// ---------------------------------------------------------------------------

function visibleTabs() {
  return TABS.filter(function (t) { return !t.teacherOnly || isTeacher(); });
}

function renderApp() {
  show('screen-app');
  // 보관해 둔 draft가 '어제' 것이면 편집 대상을 어제로 맞춘다.
  // **로그인이 끝난 뒤**에 부른다 — 로그인 전에 부르면 앞사람의 편집 상태가
  // 뒷사람 화면을 결정한다 (4차 검토 지적).
  viewToday.restoreDraftContext();
  const s = state.session;
  el('#app-name').textContent = s.name || '';
  el('#app-kind').textContent =
    s.kind === 'teacher' ? '담임교사' : (s.kind === 'parent' ? '학부모' : '학생');

  el('#nav').innerHTML = visibleTabs().map(function (t) {
    // 기존 디자인 시스템의 .topnav button / .active 규칙을 그대로 쓴다.
    return '<button class="' + (state.tab === t.id ? 'active' : '') + '" data-tab="' + t.id + '">' +
      t.icon + ' ' + t.label + '</button>';
  }).join('');
  el('#nav').querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () { state.tab = b.dataset.tab; renderApp(); };
  });

  el('#btn-signout').onclick = function () {
    if (window.confirm('로그아웃할까요?')) auth.signOut();
  };

  renderTab();
}

let shownTab = null;

/**
 * 탭 내용 그리기.
 *
 * 탭은 «다른 페이지»다 — 탭을 옮기면 보던 위치가 아니라 맨 위에서 시작한다.
 * 반대로 같은 탭을 다시 그리는 경우(저장 후 갱신 등)에는 위치를 흔들지 않는다.
 */
function renderTab() {
  const root = el('#view');
  root.innerHTML = '';
  closeSheet();
  if (state.tab !== shownTab) {
    shownTab = state.tab;
    scrollToTop();
  }
  // 자료 탭의 지연 검색이 다른 탭 화면을 덮어쓰지 않도록 취소한다.
  viewLibrary.cancelPending();
  // 진행 중이던 비동기 렌더가 뒤늦게 이 화면을 덮어쓰지 못하게 세대를 올린다.
  bumpGeneration();
  switch (state.tab) {
    case 'today': viewToday.render(root); break;
    case 'calendar': viewCalendar.render(root); break;
    case 'prayer': viewPrayer.render(root); break;
    case 'library': viewLibrary.render(root); break;
    case 'class':
      if (!isTeacher()) { state.tab = 'today'; renderTab(); return; }
      viewClass.render(root);
      break;
    default: state.tab = 'today'; renderTab();
  }
}

// ---------------------------------------------------------------------------
// 세션 이벤트 — 캐시·state 파기 후 로그인 화면으로 (계약 §6.1)
// ---------------------------------------------------------------------------

function backToLogin(message) {
  resetUserData();
  viewToday.resetEditDate();
  viewCalendar.resetView();
  viewPrayer.resetView();
  viewLibrary.resetView();
  viewClass.resetView();
  renderLogin();
  el('#login-notice').textContent = message || '';
}

window.addEventListener('app:session-expired', function (e) {
  // 화면을 갈아엎기 전에 작성 중이던 내용을 메모리에 보관한다.
  // 재로그인하면 해당 탭이 그대로 되살린다.
  viewToday.stashDraft();
  viewPrayer.stashDraft();
  // 어떤 액션이 어떤 코드로 끊겼는지 화면에 남긴다 — 이 경로가 «로그인했는데
  // 로그인 화면으로 되돌아오는» 유일한 자동 경로다.
  const d = (e && e.detail) || {};
  const tag = d.code ? ' [' + d.code + (d.action ? '@' + d.action : '') + ']' : '';
  backToLogin('로그인이 만료되었습니다. 다시 로그인해 주세요. (쓰던 내용은 보관해 두었어요)' + tag);
});
// 같은 기기에서 다른 계정으로 로그인한 경우 — 앞사람의 임시 입력을 즉시 파기한다.
window.addEventListener('app:account-changed', function () {
  viewToday.clearDraft();
  viewPrayer.clearDraft();
});
window.addEventListener('app:signed-out', function () {
  // 본인이 명시적으로 로그아웃한 경우다. 다음 사람에게 남기지 않는다 (계약 §6.1).
  viewToday.clearDraft();
  viewPrayer.clearDraft();
  backToLogin('');
});

// ---------------------------------------------------------------------------
// 예기치 못한 오류 — 조용히 실패하지 않는다
// ---------------------------------------------------------------------------
//
// 화면을 그리는 도중 예외가 나면 여태까지는 콘솔에만 남고 사용자에게는
// «아무 일도 안 일어난 화면»으로 보였다. 비개발자 운영자에게는 진단 수단이
// 아예 없는 상태다. 무엇이 터졌는지 화면에 남긴다 (2026-07-30 설치 후 신고).
function showUnexpected(what) {
  const notice = document.getElementById('login-notice');
  if (!notice) return;
  const login = document.getElementById('screen-login');
  if (login && login.hidden) return; // 앱 화면이 정상히 떠 있으면 건드리지 않는다
  notice.textContent = '예기치 못한 오류가 났습니다. 이 문구를 담임교사에게 알려 주세요. ' +
    '[' + String(what).slice(0, 160) + ']';
}

window.addEventListener('error', function (e) {
  showUnexpected((e && e.message) || 'error');
});
window.addEventListener('unhandledrejection', function (e) {
  const r = e && e.reason;
  showUnexpected((r && (r.message || r)) || 'rejection');
});

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

function start() {
  // 두 값을 모두 검사한다. 클라이언트 ID만 빠지면 구글 로그인이 조용히 실패해
  // **버튼이 없는 표지 화면**만 남고, 원인이 콘솔에만 찍힌다.
  const missing = [];
  const gasUrl = String(APP_CONFIG.GAS_URL || '').trim();
  if (!gasUrl || gasUrl.indexOf('PASTE_') === 0) missing.push('서버 주소(GAS_URL)');

  // MOCK 모드(로컬 미리보기)는 구글 로그인을 건너뛰므로 클라이언트 ID가 필요 없다.
  if (!auth.isMock()) {
    const cid = String(APP_CONFIG.OAUTH_CLIENT_ID || '').trim();
    // placeholder만 검사하면 빈 값이나 잘못 붙여넣은 값(예: 클라이언트 «보안 비밀번호»)이
    // 그대로 통과해, 화면에 안내 없이 로그인 버튼만 안 뜨는 상태가 된다.
    // 구글 클라이언트 ID는 항상 이 접미사로 끝난다.
    if (!cid || cid.indexOf('PASTE_') === 0) {
      missing.push('구글 로그인 키(OAUTH_CLIENT_ID)');
    } else if (cid.indexOf('.apps.googleusercontent.com') < 0) {
      missing.push('구글 로그인 키(OAUTH_CLIENT_ID) — 형식이 다릅니다. ' +
        '«.apps.googleusercontent.com»으로 끝나는 «클라이언트 ID»를 넣어야 합니다');
    }
  }
  if (missing.length) {
    show('screen-login');
    el('#login-notice').textContent =
      '아직 설정되지 않은 항목이 있습니다: ' + missing.join(', ') +
      '. 설치문서(docs/ops/04번 1단계)를 완료해 주세요.';
    return;
  }
  renderLogin();
}

// 서비스워커 — 정적 자산과 참고자료만 캐시한다. GAS 호출(POST)은 절대 캐시하지 않는다 (계약 §6.2).
//
// 로컬 미리보기(localhost)에서는 등록하지 않는다. 등록해 두면 고친 코드가 아니라
// 캐시된 옛 코드가 계속 실행되어, 화면을 확인해도 사실은 옛 버전을 보게 된다
// (2026-07-30 개발 중 실제로 이 사고가 났다). 개발 중에 "테스트했는데 왜 안 되지"의
// 원인을 몇 시간 잡아먹는 종류의 문제라 아예 차단한다.
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !IS_LOCAL) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 무시 */ });
  });
} else if ('serviceWorker' in navigator && IS_LOCAL) {
  // 이전에 등록해 둔 것이 남아 있으면 지운다.
  navigator.serviceWorker.getRegistrations().then(function (rs) {
    rs.forEach(function (r) { r.unregister(); });
  }).catch(function () { /* 무시 */ });
  if (window.caches) {
    caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); })
      .catch(function () { /* 무시 */ });
  }
}

start();
