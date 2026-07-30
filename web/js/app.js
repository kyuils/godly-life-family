// web/js/app.js — 부트스트랩, 화면 전환, 로그인/가입.
// 계약: §6.1(캐시 격리), §7(탭·로그아웃)

import { APP_CONFIG } from './config.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { state, resetUserData, isTeacher } from './state.js';
import * as S from './stats.js';
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

function show(screen) {
  ['screen-login', 'screen-register', 'screen-app'].forEach(function (id) {
    el('#' + id).hidden = (id !== screen);
  });
}

// ---------------------------------------------------------------------------
// 로그인
// ---------------------------------------------------------------------------

function renderLogin() {
  closeSheet();
  show('screen-login');
  const holder = el('#gis-button');
  holder.innerHTML = '';
  auth.initGis(holder, afterSignIn);
}

async function afterSignIn() {
  const res = await api.call('whoami', {}, { noCache: true });

  if (res.ok) {
    state.session = res;
    await loadMyData();
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
  el('#login-notice').textContent = api.errorMessage(res.code);
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
    await loadMyData();
    renderApp();
  } catch (e) {
    el('#reg-error').textContent = '등록하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 데이터 로드
// ---------------------------------------------------------------------------

/**
 * 본인 기록·기도 로드.
 * streak가 로드된 가장 이른 달의 1일까지 닿아 있으면 이전 달을 더 불러온다 (계약 §3.1).
 * 날짜가 아니라 데이터로 판정하므로 긴 연속기록이 잘리지 않는다.
 */
async function loadMyData() {
  const today = auth.todayStr();
  let months = S.defaultMonths(today);

  let res = await api.call('getMyRecords', { months: months }, { noCache: true });
  if (!res.ok) { toast(api.errorMessage(res.code)); return; }
  let rows = res.rows;

  let guard = 0;
  while (S.streakNeedsMoreMonths(rows, today, months) && months.length < 6 && guard++ < 6) {
    months = S.extendMonths(months, 6);
    res = await api.call('getMyRecords', { months: months }, { noCache: true });
    if (!res.ok) break;
    rows = res.rows;
  }

  state.months = months;
  state.records = rows;
  // 6개월을 다 쓰고도 더 필요하면 화면에 '+'를 붙인다.
  state.streakCapped = S.streakNeedsMoreMonths(rows, today, months);

  const p = await api.call('getMyPrayers', {}, { noCache: true });
  state.prayers = p.ok ? p.rows : [];
}

// ---------------------------------------------------------------------------
// 앱 화면
// ---------------------------------------------------------------------------

function visibleTabs() {
  return TABS.filter(function (t) { return !t.teacherOnly || isTeacher(); });
}

function renderApp() {
  show('screen-app');
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

function renderTab() {
  const root = el('#view');
  root.innerHTML = '';
  closeSheet();
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

window.addEventListener('app:session-expired', function () {
  backToLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
});
window.addEventListener('app:signed-out', function () {
  backToLogin('');
});

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

function start() {
  if (APP_CONFIG.GAS_URL.indexOf('PASTE_') === 0) {
    show('screen-login');
    el('#login-notice').textContent =
      '아직 서버 주소가 설정되지 않았습니다. docs/ops/ 문서의 설치 절차를 완료해 주세요.';
    return;
  }
  renderLogin();
}

// 서비스워커 — 정적 자산과 참고자료만 캐시한다. GAS 호출(POST)은 절대 캐시하지 않는다 (계약 §6.2).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 무시 */ });
  });
}

start();
