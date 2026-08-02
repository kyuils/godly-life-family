// web/js/app.js — 부트스트랩, 화면 전환, 로그인/가입.
// 계약: §6.1(캐시 격리), §7(탭·로그아웃)

import { APP_CONFIG } from './config.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { state, resetUserData, isTeacher, isPrayerUser, bumpGeneration } from './state.js';
import * as S from './stats.js';
import { loadMyData } from './load.js';
import { el, escapeHtml, toast, closeSheet } from './ui.js';
import { detectInApp, externalOpenUrl } from './inapp.js';
import { installMode, installCopy, runInstallPrompt, isStandalone } from './install.js';

import * as viewHome from './view-home.js';
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
 * 화면 전환 — 로그인 / 로그인중 / 가입 / 앱 중 **하나만** 보이게 한다.
 *
 * hidden 하나로 갈리므로, css의 `[hidden]{display:none!important}`가 반드시
 * 함께 있어야 한다. 그 규칙이 없으면 .cover·.register의 display:flex가 이겨
 * 네 화면이 위아래로 이어 붙는다 (2026-07-30 실사용 신고의 원인).
 */
const SCREENS = ['screen-login', 'screen-loading', 'screen-register', 'screen-app'];

function show(screen) {
  SCREENS.forEach(function (id) {
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
 * 카카오톡 등 «앱 안의 브라우저»로 열었을 때 안내를 띄운다.
 *
 * 그 안에서는 구글 로그인 창을 다녀오는 사이 이 페이지가 통째로 다시 읽히고,
 * 메모리에만 두는 로그인 정보가 함께 사라진다. 그래서 로그인이 «되지 않는
 * 것»처럼 보인다 — 2026-07-31 실사용 신고의 실제 원인이었다.
 * 토큰을 기기에 저장하면 증상은 없어지지만, 한 휴대폰을 가족이 공유하는
 * 이 앱에서는 앞사람 기록이 뒷사람에게 새는 문이 된다(보안 불변식 7).
 * 그래서 저장하지 않고 바깥 브라우저로 열도록 안내한다.
 */
/**
 * 탭 줄의 실제 높이를 재어 --topnav-h에 넣는다.
 *
 * 자료 화면의 «‹ 제목 ☰» 줄이 이 값만큼 아래에 붙어 따라온다
 * (2026-07-31 신고: "자료를 스크롤해서 올리면 선택하는 메뉴가 같이 올라가서
 *  안 보이게 돼"). 그 줄에 ☰가 있어서 사라지면 다른 자료로 갈 수 없다.
 *
 * ★ 숫자를 CSS에 박지 않는 이유: 탭 수가 분류마다 다르고(성도 3·학생 4·교사 5),
 *   사용자가 글자 크기를 키우면 줄 높이도 달라진다. 박아 두면 그만큼 틈이
 *   벌어지거나 겹친다.
 */
function measureNav() {
  const nav = el('#nav');
  if (!nav) return;
  const h = Math.round(nav.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty('--topnav-h', h + 'px');
}

/**
 * «앱으로 설치하기» 안내 (2026-07-31 요청: "가입고 로그인시 앱 형태로 설치되게 안내").
 *
 * 로그인 화면과 가입 화면 두 곳에서 같은 함수를 쓴다. 홈에 두지 않는 이유:
 *  - 요청 원문이 «가입고 로그인시»다
 *  - 홈에 띠를 얹으면 같은 날 되찾은 세로 공간을 그 자리에서 도로 까먹는다
 *  - 로그인하면 사라지는 화면이라 «닫음» 상태를 저장할 필요가 없다
 *    (브라우저 저장소는 보안 불변식 7 때문에 web/js에서 쓸 수 없다)
 */
function setupInstallBanner(bannerSel, buttonSel) {
  const banner = el(bannerSel);
  if (!banner) return;

  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const mode = installMode(ua, {
    standalone: isStandalone(window),
    hasPrompt: !!window.__bip,
  });
  const copy = installCopy(mode);
  if (!copy) { banner.hidden = true; return; }

  banner.hidden = false;
  banner.querySelector('.install-title').textContent = copy.title;
  banner.querySelector('.install-desc').textContent = copy.desc;

  const btn = el(buttonSel);
  if (!btn) return;
  if (!copy.action) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.textContent = copy.action;
  btn.onclick = async function () {
    // prompt()는 사용자 제스처 안에서 한 번만 유효하다. 쓰고 나면 버튼을 감춘다.
    const shown = await runInstallPrompt(window);
    if (shown) banner.hidden = true;
    else toast('브라우저 메뉴에서 «홈 화면에 추가»를 선택해 주세요.');
  };
}

function setupInAppBanner() {
  const banner = el('#inapp-banner');
  if (!banner) return;

  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const kind = detectInApp(ua);
  if (!kind) { banner.hidden = true; return; }

  banner.hidden = false;
  const here = location.href;
  const openUrl = externalOpenUrl(kind, here, ua);
  const openBtn = el('#inapp-open');
  const copyBtn = el('#inapp-copy');

  if (openUrl) {
    openBtn.hidden = false;
    openBtn.onclick = function () { location.href = openUrl; };
  } else {
    // iOS의 일부 인앱 웹뷰는 표준적인 전환 수단이 없다 — 복사만 안내한다.
    openBtn.hidden = true;
  }

  copyBtn.onclick = function () {
    const done = function () { toast('주소를 복사했어요. 크롬·사파리에 붙여넣어 주세요.'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(here).then(done, function () { promptCopy(here); });
        return;
      }
    } catch (e) { /* 아래 폴백 */ }
    promptCopy(here);
  };
}

/** 클립보드를 못 쓰는 환경 — 주소를 골라 복사할 수 있게 보여 준다. */
function promptCopy(url) {
  try { window.prompt('이 주소를 복사해 크롬·사파리에서 열어 주세요.', url); }
  catch (e) { toast('주소: ' + url); }
}

/**
 * 로그인 화면.
 *
 * @param opts.autoSelect 구글 «자동 로그인»(auto_select)을 허용할지.
 *   **앱을 처음 켤 때만 true**다. 로그아웃·세션만료로 되돌아온 경우에는 false —
 *   로그아웃한 사람이 곧바로 다시 로그인되면 공용 휴대폰에서 계정을 끊을 수단이 없어진다
 *   (보안 불변식 7). 자세한 근거는 계약 §6.4.
 */
function renderLogin(opts) {
  closeSheet();
  show('screen-login');
  setupInAppBanner();
  setupInstallBanner('#install-banner', '#install-go');
  const holder = el('#gis-button');
  holder.innerHTML = '';
  auth.initGis(holder, onCredential, { autoSelect: !!(opts && opts.autoSelect) });
}

/**
 * 구글이 새 자격증명을 줬을 때. 버튼 클릭·One Tap·자동 로그인이 **모두** 여기로 온다.
 *
 * ★ 왜 그냥 afterSignIn을 부르지 않는가 (2026-08-02 신고의 근본 원인)
 *   콜백은 겹쳐서 도착할 수 있다(자동 로그인이 도는 사이 사용자가 버튼을 누르는 등).
 *   예전에는 `if (signingIn) return`으로 **두 번째 콜백을 통째로 버렸는데**, 그 사이
 *   auth.js의 applyToken은 이미 전역 토큰을 새 계정으로 갈아끼운 뒤였다. 그래서
 *   «진행 중이던 A 계정 흐름이 B 계정 토큰으로 남은 요청을 보내는» 상태가 됐고,
 *   가입한 적 없는 계정에게 「등록되지 않은 계정입니다」가 떴다.
 *   이제는 **나중에 온 계정이 이긴다** — 사용자가 방금 고른 계정이 그것이기 때문이다.
 */
function onCredential(email) {
  const lower = String(email || '').toLowerCase();
  if (signingIn) {
    // 같은 계정이면 중복 클릭이다. 진행 중인 흐름을 그대로 두는 편이 빠르다.
    if (lower && lower === signingInEmail) return;
    // 다른 계정이다 — 진행 중이던 흐름을 버린다. 버리지 않으면 그 흐름의 남은
    // 요청이 새 계정 토큰으로 나가고, 화면도 늦게 도착해 덮어쓴다.
    signInSeq += 1;
  }
  signingIn = false;
  afterSignIn(lower || undefined);
}

// ---------------------------------------------------------------------------
// 로그인 진행 중 화면
// ---------------------------------------------------------------------------
//
// ★ 왜 필요한가 (2026-08-02 실사용 신고: "로그인하면 로그인 페이지가 다시 나오고,
//   한 번 더 로그인하면 조금 뒤에 들어가진다")
//
//   구글 콜백 이후 앱 화면까지 서버 왕복이 2~4번 있다(whoami → getMyRecords →
//   [월 확장] → getMyPrayers). 실측 왕복 1회가 1.3~2.0초이므로 합쳐서 3~8초다.
//   그동안 화면은 **로그인 화면 그대로**였다. 사용자에게는 «아무 일도 안 일어났다»
//   = «다시 로그인 화면» 으로 읽히고, 로그인 버튼을 한 번 더 누르게 된다.
//   그 두 번째 시도가 끝날 때쯤 첫 번째 흐름이 도착해 앱이 열리므로
//   «두 번 해야 된다»는 인상이 굳는다.

let loadingTimer = null;

function showLoading(message) {
  show('screen-loading');
  el('#loading-desc').textContent = message;

  // 서버가 끝내 응답하지 않을 때 이 화면에 갇히지 않도록 탈출구를 둔다.
  // 처음부터 보이면 «눌러야 하나?» 하고 진행 중인 로그인을 스스로 끊게 되므로 늦게 낸다.
  const back = el('#loading-back');
  back.hidden = true;
  back.onclick = function () {
    // ★ 진행 중이던 흐름을 «버린다»고 표시한다.
    //   fetch는 취소되지 않으므로, 늦게 도착한 응답이 renderApp()을 불러
    //   방금 돌아온 로그인 화면을 덮어쓰는 일이 실제로 생긴다.
    //   loadMyData의 owner 검사로는 못 막는다 — 세션을 지운 것이 아니라
    //   사용자가 화면만 되돌린 것이라 email이 그대로다.
    //   (renderTab이 bumpGeneration/stale로 푸는 것과 같은 종류의 문제다)
    signInSeq += 1;
    signingIn = false;          // 진행 중 표시를 풀어야 다시 로그인할 수 있다
    signingInEmail = null;
    clearLoading();
    backToLogin('');
  };
  if (loadingTimer) clearTimeout(loadingTimer);
  loadingTimer = setTimeout(function () { back.hidden = false; }, 20000);
}

function clearLoading() {
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
}

// 로그인 흐름이 진행 중인지. 구글 콜백은 자동 로그인·버튼 클릭·One Tap에서
// 각각 올 수 있어 겹칠 수 있다. 겹치면 서버 왕복이 두 벌 돌고,
// 늦게 끝난 쪽이 화면을 덮어쓴다.
let signingIn = false;

// 진행 중인 흐름이 **어느 계정**의 것인지. 겹쳐 온 콜백이 같은 계정인지 판단한다.
let signingInEmail = null;

// 이 로그인 흐름의 세대. 흐름을 버릴 때 올린다
// («돌아가기» · 다른 계정 콜백 도착 · 예기치 못한 오류).
// 버려진 흐름은 응답이 뒤늦게 도착해도 화면을 건드리지 않는다.
let signInSeq = 0;

async function afterSignIn(email) {
  if (signingIn) return;
  signingIn = true;
  signingInEmail = (email === undefined || email === null)
    ? api.getSessionEmail()
    : String(email).toLowerCase();
  const seq = ++signInSeq;
  // ★ 세션 세대는 **첫 await 이전에** 잡는다. 뒤에서 읽으면 이미 다른 계정으로
  //   갈아끼워진 뒤일 수 있어, 엉뚱한 계정에 흐름을 고정하게 된다 (계약 §6.5).
  const epoch = api.getSessionEpoch();
  const abandoned = function () { return seq !== signInSeq; };
  try {
    // ★ try 안에서 부른다. 밖에 두면 여기서 예외가 났을 때 finally를 거치지 않아
    //   signingIn이 true로 잠긴 채 남고, 이후 모든 로그인 시도가 조용히 무시된다.
    showLoading('로그인 정보를 확인하고 있어요');
    const res = await api.call('whoami', {}, { noCache: true, epoch: epoch });
    if (abandoned()) return;

    if (res.ok) {
      state.session = res;
      showLoading('기록을 불러오고 있어요');
      const loaded = await loadMyData(auth.todayStr(), epoch);
      // ★ 버려짐 검사가 반드시 **먼저**다. 순서를 바꾸면, 버려진 흐름이
      //   stale_session으로 끝나면서 새 흐름이 띄운 정상 앱 화면 위에
      //   「로그인이 끊겼습니다」를 덧씌운다.
      if (abandoned()) return;
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
  } finally {
    // 예외로 빠져나가도 반드시 푼다. 안 그러면 이후 모든 로그인 시도가 조용히 무시된다.
    // 단, **버려진 흐름은 새 흐름의 잠금을 풀면 안 된다** — 늦게 끝난 옛 요청이
    // 방금 시작한 로그인의 진행 표시를 지워 버리면 두 흐름이 다시 겹친다.
    if (!abandoned()) {
      clearLoading();
      signingIn = false;
      signingInEmail = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 자가 등록 (요구사항 5·6)
// ---------------------------------------------------------------------------

/**
 * 분류별 가입 화면 정의 (2026-07-31 3분류 확대).
 *
 * 한 곳에 모아 두는 이유: 라벨·placeholder·보이는 칸이 코드 여기저기 흩어지면
 * 분류를 하나 더할 때 어딘가를 반드시 빠뜨린다.
 */
const REG_KINDS = {
  student: { extraLabel: '학년·반 (선택)', extraHint: '예: 중2-1', school: true },
  parent: { extraLabel: '자녀 이름 (선택)', extraHint: '예: 김믿음', school: false },
  // ★ 화면 문구는 «혜림교회 소속부서»지만 시트 열 이름은 여전히 «소속전도회»다.
  //   (2026-08-02 사용자 결정 — 이미 가입한 성도의 데이터를 건드리지 않기 위해
  //    화면 문구만 바꿨다. 시트 열을 바꾸려면 사람이 직접 헤더를 고쳐야 한다.
  //    계약 §2.2b 참조. 이 불일치를 «오타»로 보고 고치지 말 것.)
  member: { extraLabel: '혜림교회 소속부서 (선택)', extraHint: '예: 청년부', school: false },
};

function renderRegister(email) {
  show('screen-register');
  setupInstallBanner('#install-banner-reg', '#install-go-reg');
  el('#reg-account').textContent = email || '';
  el('#reg-error').textContent = '';
  el('#reg-name').value = '';
  el('#reg-extra').value = '';
  el('#reg-school').value = '';
  el('#reg-code').value = '';
  setKind('student');

  Object.keys(REG_KINDS).forEach(function (k) {
    el('#reg-kind-' + k).onclick = function () { setKind(k); };
  });
  el('#reg-submit').onclick = submitRegister;
  el('#reg-cancel').onclick = function () { auth.signOut(); };
}

let regKind = 'student';

function setKind(kind) {
  const cfg = REG_KINDS[kind] || REG_KINDS.student;
  const next = REG_KINDS[kind] ? kind : 'student';
  const changed = next !== regKind;
  regKind = next;

  Object.keys(REG_KINDS).forEach(function (k) {
    const btn = el('#reg-kind-' + k);
    btn.classList.toggle('on', k === regKind);
    // 선택 상태를 색으로만 표시하면 화면낭독기 사용자는 지금 무엇이 골라져 있는지
    // 알 방법이 없다. 세 버튼은 index.html에서 role="group"으로 묶여 있다.
    btn.setAttribute('aria-pressed', k === regKind ? 'true' : 'false');
  });
  el('#reg-extra-label').textContent = cfg.extraLabel;
  el('#reg-extra').placeholder = cfg.extraHint;

  // ★ 분류가 **실제로 바뀌면** 가운데 칸을 비운다.
  //   이 칸은 분류마다 의미가 다르다(학년·반 / 자녀 이름 / 소속부서). 안 비우면
  //   학생으로 «중2-1»을 적었다가 학부모로 바꾼 사람의 시트 «자녀이름» 열에
  //   «중2-1»이 저장된다. 담임교사는 그 값이 왜 거기 있는지 알 수 없다.
  //   서버는 이것을 막을 수 없다 — 세 분류 모두 자유 텍스트라 값만 보고는
  //   «엉뚱한 칸의 값»인지 구분할 방법이 없다. 그래서 여기가 유일한 방어선이다.
  //   같은 분류를 다시 눌렀을 때는 비우지 않는다(입력 중이던 내용을 잃는다).
  if (changed) el('#reg-extra').value = '';

  // 고르지 않은 분류의 칸은 아예 감춘다 — 요청: "학부모 가입인데 학교 입력 안 뜨게"
  el('#reg-school-row').hidden = !cfg.school;
  if (!cfg.school) el('#reg-school').value = '';
}

async function submitRegister() {
  const btn = el('#reg-submit');

  // ★ 빈 칸은 **서버에 보내지 않는다.**
  //   서버는 빈 코드도 «틀린 코드»로 세어 백오프 카운터를 올린다(계약 §4.2).
  //   코드를 아직 못 받은 사람이 일단 눌러보는 것만으로 5회를 채워 10분 잠기고,
  //   전역 카운터는 10분에 20회라 **주일에 반 전체가 함께 가입할 때 아직 시도도
  //   안 한 사람까지 같이 잠긴다.** 여기서 막는 것이 유일한 예방이다.
  if (!String(el('#reg-name').value).trim()) {
    el('#reg-error').textContent = '이름을 입력해 주세요.';
    el('#reg-name').focus();
    return;
  }
  if (!String(el('#reg-code').value).trim()) {
    el('#reg-error').textContent = '등록 코드를 입력해 주세요. 담임교사에게 받으실 수 있습니다.';
    el('#reg-code').focus();
    return;
  }

  btn.disabled = true; // 더블 서브밋 방지
  el('#reg-error').textContent = '';
  try {
    const res = await api.call('register', {
      name: el('#reg-name').value,
      kind: regKind,               // 서버는 student/parent/member만 허용한다 (계약 §4.2)
      extra: el('#reg-extra').value,
      // 학교는 학생일 때만 보낸다. 서버도 다른 kind가 보내면 무시한다(이중 방어).
      school: regKind === 'student' ? el('#reg-school').value : '',
      code: el('#reg-code').value,
    });
    if (!res.ok) {
      // 로그인 화면과 같은 이유로 코드를 병기한다 — 비개발자 운영자가 화면만 보고
      // docs/ops의 «이럴 때는» 표를 찾아갈 수 있어야 한다. 가입 화면만 빠져 있었다.
      el('#reg-error').textContent = api.errorMessage(res.code) + ' [' + res.code + ']';
      return;
    }
    state.session = res;           // register 성공 응답은 whoami와 같은 형태
    const loaded = await loadMyData(auth.todayStr(), api.getSessionEpoch());
    // ★ 가입은 이미 **성공**했다. 여기서 failToLogin을 그대로 쓰면
    //   「등록되지 않은 계정입니다」가 떠서, 명부에 올라간 사람이 가입에 실패한 줄 안다.
    //   그래서 «가입은 끝났다»를 먼저 말하는 전용 경로를 쓴다.
    if (!loaded.ok) { failAfterRegister(loaded.code); return; }
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
 * **가입은 성공했는데** 곧이어 기록을 불러오지 못한 경우.
 *
 * ★ failToLogin을 그대로 쓰면 안 된다. 그 문구는 «로그인 경로» 전용이라
 *   「등록되지 않은 계정입니다」가 뜨는데, 이 사람은 방금 명부에 올라갔다.
 *   그러면 가입이 실패한 줄 알고 또 가입을 시도하고(→ already_registered),
 *   담임교사에게 «가입이 안 된다»고 연락하게 된다.
 *   무엇보다 먼저 **«가입은 끝났다»** 를 말해 줘야 한다.
 *   (2026-08-02 가입 화면 검토 지적)
 */
function failAfterRegister(code) {
  failToLogin(code, {
    lead: '가입은 완료되었습니다. 다만 기록을 불러오지 못했어요. ',
    // 방금 명부에 올라간 사람에게 «등록되지 않은 계정»은 사실이 아니다.
    // 서버 명부 캐시가 아직 갱신되지 않았을 때 나올 수 있는 코드다.
    cause: { unauthorized: '잠시 후 «다시 시도»를 눌러 주세요.' },
  });
}

/**
 * 로그인은 됐지만 내 기록을 불러오지 못한 경우.
 *
 * 화면을 «빈 앱»으로 보여주면 사용자는 기록이 사라졌다고 오해한다.
 * 무엇이 잘못됐는지 알리고, 재로그인 없이 다시 시도할 수 있게 한다.
 *
 * @param opts.lead  앞머리 문구를 갈아끼운다 (가입 직후 경로 — failAfterRegister)
 * @param opts.cause 특정 코드의 설명만 덮어쓴다
 */
function failToLogin(code, opts) {
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

  const o = opts || {};
  const CAUSE = {
    network_error: '인터넷 연결을 확인해 주세요.',
    stale_session: '로그인이 끊겼습니다. 다시 로그인해 주세요.',
    busy: '지금 접속이 몰리고 있어요.',
    // 가장 흔한 실패는 1시간 만료다. 이 경우는 재시도가 아니라 재로그인이 필요하다.
    token_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    unauthorized: '등록되지 않은 계정입니다. 담임교사에게 문의해 주세요.',
    forbidden: '권한이 없습니다.',
  };
  const cause = (o.cause && o.cause[code]) || CAUSE[code] || '잠시 후 다시 시도해 주세요.';
  el('#login-notice').textContent =
    (o.lead || '기록을 불러오지 못했습니다. ') + cause + ' [' + code + ']';
}

// ---------------------------------------------------------------------------
// 앱 화면
// ---------------------------------------------------------------------------

function visibleTabs() {
  return TABS.filter(function (t) {
    if (t.teacherOnly && !isTeacher()) return false;
    // 성도는 기도 요청 기능이 없다 (계약 §2.2b). 서버가 막으므로 탭을 두면
    // 눌러도 오류만 보게 된다.
    if (t.id === 'prayer' && !isPrayerUser()) return false;
    return true;
  });
}

function renderApp() {
  show('screen-app');
  // 보관해 둔 draft가 '어제' 것이면 편집 대상을 어제로 맞춘다.
  // **로그인이 끝난 뒤**에 부른다 — 로그인 전에 부르면 앞사람의 편집 상태가
  // 뒷사람 화면을 결정한다 (4차 검토 지적).
  viewToday.restoreDraftContext();
  const s = state.session;
  el('#app-name').textContent = s.name || '';
  const KIND_LABEL = { teacher: '담임교사', parent: '학부모', student: '학생', member: '성도' };
  el('#app-kind').textContent = KIND_LABEL[s.kind] || '';

  el('#nav').innerHTML = visibleTabs().map(function (t) {
    // 아이콘 위 / 글자 아래. 휴대폰에서 누를 면적을 넉넉히 잡기 위한 배치다.
    // (TABS는 이 파일 안의 상수라 사용자 입력이 섞이지 않는다)
    return '<button class="' + (state.tab === t.id ? 'active' : '') + '" data-tab="' + t.id + '">' +
      '<span class="tab-icon">' + t.icon + '</span>' +
      '<span class="tab-label">' + t.label + '</span>' +
      '</button>';
  }).join('');
  el('#nav').querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () { state.tab = b.dataset.tab; renderApp(); };
  });
  measureNav();

  // 제목줄의 앱 이름 = 홈으로 가는 문. 홈을 탭으로 넣으면 교사 탭이 6개가 되어
  // 직전에 고친 «탭이 작다» 문제가 되살아난다.
  el('#app-home').onclick = function () {
    if (state.tab === 'home') return;
    state.tab = 'home';
    renderApp();
  };

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
    case 'home':
      viewHome.render(root, function (tab) { state.tab = tab; renderApp(); });
      break;
    case 'today': viewToday.render(root); break;
    case 'calendar': viewCalendar.render(root); break;
    case 'library': viewLibrary.render(root); break;
    case 'prayer':
      // class 탭과 대칭인 방어. 상태가 어긋나 성도가 이 탭에 오면 오늘로 돌린다.
      if (!isPrayerUser()) { state.tab = 'today'; renderTab(); return; }
      viewPrayer.render(root);
      break;
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

// 화면을 돌리거나 글자 크기를 바꾸면 탭 줄 높이가 달라진다 — 다시 잰다.
// (자료 머리줄이 이 값만큼 아래에 붙으므로, 안 재면 틈이 벌어지거나 겹친다)
window.addEventListener('resize', measureNav);

window.addEventListener('app:session-expired', function (e) {
  // 화면을 갈아엎기 전에 작성 중이던 내용을 메모리에 보관한다.
  // 재로그인하면 해당 탭이 그대로 되살린다.
  viewToday.stashDraft();
  viewPrayer.stashDraft();
  // 어떤 액션이 어떤 코드로 끊겼는지 화면에 남긴다 — 이 경로가 «로그인했는데
  // 로그인 화면으로 되돌아오는» 유일한 자동 경로다.
  const d = (e && e.detail) || {};
  const tag = d.code ? ' [' + d.code + (d.action ? '@' + d.action : '') + ']' : '';
  // ★ 가입 화면에서 만료된 경우 «보관해 두었어요»는 거짓말이다 — 보관 대상은
  //   오늘·기도 탭의 draft뿐이고, 가입 화면의 이름·코드는 다시 로그인하면 비어 있다.
  //   담임교사에게 코드를 받으려고 이 화면에서 기다리다 만료되는 일이 실제로 생긴다.
  const onRegister = !el('#screen-register').hidden;
  const kept = onRegister
    ? '(입력하신 내용은 다시 적어 주셔야 합니다)'
    : '(쓰던 내용은 보관해 두었어요)';
  backToLogin('로그인이 만료되었습니다. 다시 로그인해 주세요. ' + kept + tag);
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
  const loading = document.getElementById('screen-loading');

  // ★ 로그인 진행 중(로딩 화면)에 터진 오류를 그대로 두면 도는 원 안에 갇힌다.
  //   로딩 화면에는 문구를 놓을 자리가 없으므로 로그인 화면으로 되돌린 뒤 남긴다.
  //   (이 분기가 없으면 아래 «login.hidden이면 반환»에 걸려 오류가 조용히 사라진다)
  if (loading && !loading.hidden) {
    clearLoading();
    // ★ 세대를 함께 올린다. 잠금만 풀면 진행 중이던 흐름이 «버려지지 않은 채»
    //   살아 있어서, 새 흐름과 둘이 동시에 달리게 된다 (2026-08-02 검토 지적).
    signInSeq += 1;
    signingIn = false;
    signingInEmail = null;
    show('screen-login');
  } else if (login && login.hidden) {
    return; // 앱 화면이 정상히 떠 있으면 건드리지 않는다
  }
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
  // ★ 앱을 켜는 이 한 곳에서만 «자동 로그인»을 허용한다 (계약 §6.4).
  //   새로고침·앱 재실행으로 메모리의 로그인 정보가 사라졌을 때, 구글이
  //   이미 승인된 계정을 조용히 되돌려 주어 로그인 화면을 다시 보지 않게 한다.
  //   토큰을 기기에 저장하지 않으므로 보안 불변식 7을 건드리지 않는다.
  renderLogin({ autoSelect: true });
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
