// scripts/test-install.mjs — «앱으로 설치하기» 판정 검증.
//
// install.js는 DOM 없이 판정만 하므로 Node에서 그대로 돌린다.
// 화면을 열어 봐야만 알 수 있는 것을 여기서 미리 잡는 것이 목적이다.
//
// ★ 로컬·미리보기에서는 이 기능을 «눈으로» 확인할 수 없다. app.js가 localhost에서
//   서비스워커를 등록하지 않는데, 크롬의 설치 요건이 서비스워커이기 때문이다.
//   즉 beforeinstallprompt가 로컬에서는 아예 발화하지 않는다.
//   그래서 판정 로직만이라도 여기서 고정해 둔다.

import { installMode, isIos, installCopy, runInstallPrompt, isStandalone } from '../web/js/install.js';

let pass = 0;
const failures = [];

// ★ async 검사를 섞어 쓴다. Promise를 그냥 반환하면 `r === true`가 거짓이라
//   «통과하지도 실패하지도 않는» 검사가 되므로, await로 받아 판정한다.
async function t(label, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) { pass++; console.log('  [PASS] ' + label); return; }
    failures.push(label + ' — ' + r);
    console.log('  [FAIL] ' + label + ' — ' + r);
  } catch (e) {
    failures.push(label + ' — ' + (e && e.message ? e.message : e));
    console.log('  [FAIL] ' + label + ' — ' + (e && e.message ? e.message : e));
  }
}

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  kakao: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.4.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

console.log('\n=== 설치 안내 판정 ===');

await t('설치 이벤트가 있으면 prompt (안드로이드 크롬·삼성·데스크톱)', () => {
  const bad = ['androidChrome', 'samsung', 'desktopChrome']
    .filter((k) => installMode(UA[k], { standalone: false, hasPrompt: true }) !== 'prompt');
  return bad.length === 0 || bad.join(', ');
});

await t('★ iOS는 이벤트가 없다 → ios 안내 (크롬·사파리 모두 WebKit)', () => {
  const bad = ['iphoneSafari', 'iphoneChrome']
    .filter((k) => installMode(UA[k], { standalone: false, hasPrompt: false }) !== 'ios');
  return bad.length === 0 || bad.join(', ');
});

await t('★ 파이어폭스 안드로이드는 manual — 아무 안내도 안 뜨면 안 된다', () =>
  installMode(UA.firefoxAndroid, { standalone: false, hasPrompt: false }) === 'manual' ||
  installMode(UA.firefoxAndroid, { standalone: false, hasPrompt: false }));

await t('★ 카카오톡 인앱은 none (설치가 불가능한데 안내하면 안 된다)', () => {
  const m = installMode(UA.kakao, { standalone: false, hasPrompt: false });
  if (m !== 'none') return 'hasPrompt=false에서 ' + m;
  // 인앱인데 이벤트가 잡혔더라도 인앱 판정이 이긴다
  const m2 = installMode(UA.kakao, { standalone: false, hasPrompt: true });
  return m2 === 'none' || 'hasPrompt=true에서 ' + m2;
});

await t('★ 이미 설치돼 있으면 어떤 환경이든 none', () => {
  const bad = Object.keys(UA)
    .filter((k) => installMode(UA[k], { standalone: true, hasPrompt: true }) !== 'none');
  return bad.length === 0 || bad.join(', ');
});

await t('UA가 비어 있어도 죽지 않는다', () => {
  const m = installMode('', { standalone: false, hasPrompt: false });
  return m === 'manual' || m;
});

await t('env를 안 넘겨도 죽지 않는다', () => {
  const m = installMode(UA.androidChrome);
  return m === 'manual' || m;
});

await t('isIos — 아이폰/아이패드만', () => {
  if (!isIos(UA.iphoneSafari)) return 'iphone을 못 잡는다';
  if (!isIos('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)')) return 'ipad를 못 잡는다';
  if (isIos(UA.androidChrome)) return '안드로이드를 iOS로 잡는다';
  if (isIos(UA.desktopChrome)) return '데스크톱을 iOS로 잡는다';
  return true;
});

console.log('\n=== 안내 문구 ===');

await t('mode마다 문구가 있고 none만 비어 있다', () => {
  const bad = [];
  ['prompt', 'ios', 'manual'].forEach((m) => {
    const c = installCopy(m);
    if (!c || !c.title || !c.desc) bad.push(m);
  });
  if (installCopy('none') !== null) bad.push('none이 null이 아니다');
  return bad.length === 0 || bad.join(', ');
});

await t('★ 버튼 글자는 prompt에만 있다 (iOS·수동은 누를 게 없다)', () => {
  if (!installCopy('prompt').action) return 'prompt에 버튼 글자가 없다';
  if (installCopy('ios').action) return 'iOS에 누를 수 없는 버튼이 생긴다';
  if (installCopy('manual').action) return 'manual에 누를 수 없는 버튼이 생긴다';
  return true;
});

await t('문구에 «홈 화면에 추가»가 들어간다 (사용자가 찾을 말)', () => {
  const bad = ['prompt', 'ios', 'manual'].filter((m) => {
    const c = installCopy(m);
    return (c.desc + ' ' + c.action).indexOf('홈 화면에 추가') < 0;
  });
  return bad.length === 0 || bad.join(', ');
});

console.log('\n=== 설치 실행 ===');

await t('★ prompt는 한 번만 쓰고 버려진다 (제스처당 1회 제한)', async () => {
  let calls = 0;
  const win = { __bip: { prompt() { calls++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) } };
  const first = await runInstallPrompt(win);
  if (first !== true) return '첫 호출이 false';
  if (win.__bip !== null) return '이벤트를 비우지 않았다';
  const second = await runInstallPrompt(win);
  if (second !== false) return '두 번째 호출이 true';
  return calls === 1 || 'prompt를 ' + calls + '번 불렀다';
});

await t('이벤트가 없으면 false를 돌려준다', async () =>
  (await runInstallPrompt({})) === false || 'true를 돌려줬다');

await t('prompt가 예외를 던져도 죽지 않는다', async () =>
  (await runInstallPrompt({ __bip: { prompt() { throw new Error('boom'); } } })) === false || 'false가 아니다');

console.log('\n=== 설치 여부 판정 ===');

await t('iOS navigator.standalone을 본다', () =>
  isStandalone({ navigator: { standalone: true } }) === true || 'false를 돌려준다');

await t('★ standalone·minimal-ui·fullscreen을 모두 설치로 본다', () => {
  const bad = ['standalone', 'minimal-ui', 'fullscreen'].filter((m) => {
    const win = { navigator: {}, matchMedia: (q) => ({ matches: q.indexOf(m) >= 0 }) };
    return isStandalone(win) !== true;
  });
  return bad.length === 0 || bad.join(', ');
});

await t('브라우저 탭이면 false', () =>
  isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }) === false || 'true를 돌려준다');

await t('matchMedia가 없어도 죽지 않는다', () =>
  isStandalone({ navigator: {} }) === false || 'true를 돌려준다');

// ---------------------------------------------------------------------------
console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
