#!/usr/bin/env node
// scripts/test-inapp.mjs — 인앱 웹뷰 감지·외부 열기 주소 생성 테스트.
//
// 왜 필요한가: 카카오톡 인앱 브라우저에서 열면 구글 로그인 창을 다녀오는 사이
// 페이지가 다시 읽혀 로그인이 풀린다. 사용자에게는 «로그인이 안 된다»로 보인다
// (2026-07-31 실사용 신고). 이 판정이 틀리면 두 방향 모두 사고다:
//   - 놓치면(false negative) → 안내가 안 떠서 계속 로그인이 안 된다
//   - 과하면(false positive) → 멀쩡한 브라우저에서 «로그인 안 됩니다» 경고가 뜬다
// 특히 삼성인터넷·웨일은 정상 브라우저인데 오인하기 쉬워 경계 사례로 고정한다.

import { detectInApp, externalOpenUrl, isAndroid, isIOS } from '../web/js/inapp.js';

let pass = 0;
const failures = [];

function check(label, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
    failures.push(label + ' — ' + r);
    console.log('  [FAIL] ' + label + ' — ' + r);
  } catch (e) {
    failures.push(label + ' — ' + (e && e.message ? e.message : e));
    console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
  }
}

const UA = {
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.5',
  kakaoIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.5',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.5.0',
  naverApp: 'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.5.0)',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0.29.110',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.32.108]',

  // ↓ 전부 «정상 브라우저». 하나라도 인앱으로 오인하면 안 된다.
  samsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  whale: 'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Whale/3.24.223.18 Mobile Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
};

const APP = 'https://kyuils.github.io/godly-life-family/web/';

console.log('=== 인앱 웹뷰 감지 ===');

check('카카오톡(안드로이드/iOS)을 인앱으로 판정한다', () => {
  return (detectInApp(UA.kakaoAndroid) === 'kakaotalk' && detectInApp(UA.kakaoIOS) === 'kakaotalk')
    || '판정: ' + detectInApp(UA.kakaoAndroid) + ' / ' + detectInApp(UA.kakaoIOS);
});

check('라인·네이버앱·인스타·페북도 인앱으로 판정한다', () => {
  const got = [UA.line, UA.naverApp, UA.instagram, UA.facebook].map(detectInApp);
  return got.every(Boolean) || '판정: ' + JSON.stringify(got);
});

check('★ 삼성인터넷·웨일·크롬·사파리·데스크톱은 인앱이 아니다 (오탐 금지)', () => {
  const normals = { samsung: UA.samsung, whale: UA.whale, chrome: UA.chromeAndroid, safari: UA.safariIOS, desktop: UA.desktop };
  const wrong = Object.keys(normals).filter((k) => detectInApp(normals[k]) !== null);
  return wrong.length === 0 || '인앱으로 오인: ' + wrong.join(', ');
});

check('UA가 비어 있으면 인앱이 아니다', () => {
  return (detectInApp('') === null && detectInApp(undefined) === null && detectInApp(null) === null)
    || '빈 UA를 인앱으로 판정함';
});

console.log('\n=== 외부 브라우저 열기 주소 ===');

check('카카오톡은 openExternal 스킴을 만든다 (양 OS)', () => {
  const a = externalOpenUrl('kakaotalk', APP, UA.kakaoAndroid);
  const i = externalOpenUrl('kakaotalk', APP, UA.kakaoIOS);
  if (!a || a.indexOf('kakaotalk://web/openExternal?url=') !== 0) return '안드로이드: ' + a;
  if (!i || i.indexOf('kakaotalk://web/openExternal?url=') !== 0) return 'iOS: ' + i;
  // 주소가 인코딩되어 들어갔는지 — 그대로 붙이면 쿼리에서 잘린다
  return a.indexOf(encodeURIComponent(APP)) > 0 || '주소가 인코딩되지 않음: ' + a;
});

check('안드로이드의 다른 인앱은 intent 스킴으로 크롬을 연다', () => {
  const ua = UA.naverApp; // 안드로이드 네이버앱
  const u = externalOpenUrl('naver', APP, ua);
  if (!u || u.indexOf('intent://') !== 0) return '생성값: ' + u;
  if (u.indexOf('package=com.android.chrome') < 0) return '크롬 패키지 지정 없음: ' + u;
  // intent 스킴은 scheme을 별도로 주므로 https:// 접두가 남아 있으면 안 된다
  return u.indexOf('intent://https') < 0 || 'https 접두가 남아 있음: ' + u;
});

check('iOS의 카톡 외 인앱은 자동 전환 주소를 만들지 않는다 (복사 안내로 처리)', () => {
  return externalOpenUrl('instagram', APP, UA.instagram) === null
    || '주소를 만들어 버림: ' + externalOpenUrl('instagram', APP, UA.instagram);
});

check('★ http/https가 아닌 주소는 열지 않는다 (스킴 주입 방지)', () => {
  const bad = ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', ''];
  const leaked = bad.filter((u) => externalOpenUrl('kakaotalk', u, UA.kakaoAndroid) !== null);
  return leaked.length === 0 || '통과시킨 주소: ' + leaked.join(', ');
});

check('OS 판정이 맞다', () => {
  if (!isAndroid(UA.kakaoAndroid)) return 'kakaoAndroid를 안드로이드로 못 봄';
  if (!isIOS(UA.kakaoIOS)) return 'kakaoIOS를 iOS로 못 봄';
  if (isAndroid(UA.safariIOS)) return 'iOS 사파리를 안드로이드로 봄';
  return true;
});

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('FAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
