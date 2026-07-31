// web/js/inapp.js — «앱 안의 브라우저»(인앱 웹뷰) 감지와 외부 브라우저 열기.
//
// 왜 필요한가 (2026-07-31 실사용 신고의 실제 원인):
//   카카오톡에서 링크를 바로 누르면 카톡 안의 브라우저로 열린다. 이 안에서
//   구글 로그인 창을 다녀오면 **원래 페이지가 통째로 다시 읽힌다.** 이 앱은
//   로그인 정보를 기기에 저장하지 않고 메모리에만 두므로(보안 불변식 7),
//   페이지가 다시 읽히는 순간 로그인 상태가 함께 사라진다.
//   사용자에게는 «계정을 골랐는데 로그인 화면으로 돌아온다»로 보인다.
//
//   저장소에 토큰을 남기면 이 증상은 사라지지만, 그것은 한 휴대폰을 가족이
//   공유하는 이 앱의 기본 시나리오에서 앞사람 기록이 뒷사람에게 보이는 문을
//   여는 일이다. 그래서 **저장하지 않고, 바깥 브라우저로 열게 안내한다.**
//
// 이 파일은 DOM에 의존하지 않는다 — Node에서 그대로 불러 테스트한다.

/**
 * 인앱 웹뷰 종류를 판정한다. 일반 브라우저면 null.
 * @param {string} ua navigator.userAgent
 * @return {'kakaotalk'|'line'|'naver'|'instagram'|'facebook'|'daum'|null}
 */
export function detectInApp(ua) {
  const s = String(ua || '');
  if (/KAKAOTALK/i.test(s)) return 'kakaotalk';
  if (/\bLine\//i.test(s)) return 'line';
  // 네이버 앱은 UA에 NAVER(inapp; ...) 형태로 붙는다. 단순히 'NAVER'만 보면
  // 웨일 브라우저(정상 브라우저)까지 인앱으로 오인한다.
  if (/NAVER\(inapp/i.test(s)) return 'naver';
  if (/Instagram/i.test(s)) return 'instagram';
  if (/FBAN|FBAV/i.test(s)) return 'facebook';
  if (/DaumApps/i.test(s)) return 'daum';
  return null;
}

export function isAndroid(ua) {
  return /Android/i.test(String(ua || ''));
}

export function isIOS(ua) {
  return /iPhone|iPad|iPod/i.test(String(ua || ''));
}

/**
 * 바깥 브라우저로 여는 주소를 만든다. 만들 수 없으면 null
 * (그 경우 화면은 «주소 복사»만 안내한다).
 *
 * @param {string} kind detectInApp 결과
 * @param {string} url  현재 페이지 주소 (https)
 * @param {string} ua   navigator.userAgent
 */
export function externalOpenUrl(kind, url, ua) {
  const target = String(url || '');
  if (!/^https?:\/\//i.test(target)) return null;

  // 카카오톡은 자체 스킴으로 «기본 브라우저로 열기»를 제공한다. 양 OS 공통.
  if (kind === 'kakaotalk') {
    return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(target);
  }

  // 안드로이드는 intent 스킴으로 크롬을 직접 지정할 수 있다.
  if (isAndroid(ua)) {
    const withoutScheme = target.replace(/^https?:\/\//i, '');
    return 'intent://' + withoutScheme +
      '#Intent;scheme=https;package=com.android.chrome;end';
  }

  // iOS의 다른 인앱 웹뷰는 표준적인 전환 수단이 없다 — 주소 복사로 안내한다.
  return null;
}
