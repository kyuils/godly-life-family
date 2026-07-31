// web/js/install.js — «앱으로 설치하기» 안내 판정 (2026-07-31 요청).
//
// 요청: "가입고 로그인시 앱 형태로 설치되게 안내 해줘"
//
// ★ 이 파일에는 DOM이 없다. 판정만 순수 함수로 두어 Node에서 검증한다
//   (scripts/test-install.mjs). inapp.js와 같은 방식이다 — 그렇게 해서
//   «웨일을 인앱으로 오판» 같은 것을 화면 없이 잡아 왔다.
//
// ★ 브라우저 저장소를 쓰지 않는다. 안내는 로그인·가입 화면에만 있고 로그인하면
//   사라지므로 «닫음» 상태를 남길 필요가 없다. (localStorage는 보안 불변식 7의
//   자동 가드가 web/js 전체에서 금지한다 — scripts/check-web.mjs)

import { detectInApp } from './inapp.js';

/**
 * 어떤 안내를 보여 줄지 정한다.
 *
 * @param {string} ua                 navigator.userAgent
 * @param {{standalone:boolean, hasPrompt:boolean}} env
 * @returns {'prompt'|'ios'|'manual'|'none'}
 *
 *  prompt — 브라우저가 설치를 대신 띄워 준다 (안드로이드 크롬·삼성인터넷·데스크톱 크롬)
 *  ios    — iOS는 자동 설치가 없다. «공유 → 홈 화면에 추가»를 손으로 알려 준다
 *  manual — 설치는 되는데 이벤트가 없는 브라우저 (파이어폭스 등). 메뉴 위치를 알려 준다
 *  none   — 이미 설치됐거나, 인앱 브라우저라 설치 자체가 불가능하다
 */
export function installMode(ua, env) {
  const e = env || {};
  if (e.standalone) return 'none';           // 이미 앱으로 실행 중
  if (detectInApp(ua)) return 'none';        // 카톡 등 — 여기서는 설치가 안 된다.
                                             // 이 화면엔 이미 «브라우저로 열기» 안내가 있다.
  if (e.hasPrompt) return 'prompt';
  if (isIos(ua)) return 'ios';
  return 'manual';
}

/** iOS 판정. 아이패드는 iPadOS 13+부터 UA가 Mac과 같아져서 터치 개수로 가른다. */
export function isIos(ua) {
  const s = String(ua || '');
  if (/iPhone|iPad|iPod/i.test(s)) return true;
  return false;
}

/**
 * 안내 문구. 화면에 그대로 나가는 말이라 여기 모아 둔다.
 * iOS는 브라우저마다 공유 버튼 위치가 달라 «공유 버튼»으로만 지칭한다.
 */
export function installCopy(mode) {
  if (mode === 'prompt') {
    return {
      title: '앱처럼 쓰실 수 있어요',
      desc: '홈 화면에 추가하면 주소창 없이 바로 열립니다.',
      action: '홈 화면에 추가',
    };
  }
  if (mode === 'ios') {
    return {
      title: '앱처럼 쓰실 수 있어요',
      desc: '아래 공유 버튼을 누른 뒤 «홈 화면에 추가»를 선택하세요.',
      action: '',
    };
  }
  if (mode === 'manual') {
    return {
      title: '앱처럼 쓰실 수 있어요',
      desc: '브라우저 메뉴(⋮)에서 «앱 설치» 또는 «홈 화면에 추가»를 선택하세요.',
      action: '',
    };
  }
  return null;
}

/**
 * 브라우저가 스태시해 둔 설치 이벤트를 꺼내 실행한다.
 *
 * ★ 이벤트는 app.js보다 먼저 발화할 수 있다. index.html의 <head>에서 미리
 *   잡아 window.__bip에 넣어 두므로 여기서는 꺼내 쓰기만 한다.
 *   prompt()는 사용자 제스처 안에서 한 번만 유효하므로 쓴 뒤 지운다.
 *
 * @returns {Promise<boolean>} 설치 창을 띄웠으면 true
 */
export async function runInstallPrompt(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  const ev = w && w.__bip;
  if (!ev || typeof ev.prompt !== 'function') return false;
  w.__bip = null;
  try {
    ev.prompt();
    if (ev.userChoice) await ev.userChoice;
    return true;
  } catch (e) {
    return false;
  }
}

/** 지금 앱(전체화면)으로 실행 중인가. */
export function isStandalone(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  // iOS 사파리는 표준 display-mode 대신 navigator.standalone을 쓴다.
  if (w.navigator && w.navigator.standalone === true) return true;
  if (typeof w.matchMedia !== 'function') return false;
  // minimal-ui·fullscreen으로 설치된 경우도 «이미 설치»로 본다.
  return ['standalone', 'minimal-ui', 'fullscreen'].some(function (m) {
    try { return w.matchMedia('(display-mode: ' + m + ')').matches; } catch (e) { return false; }
  });
}
