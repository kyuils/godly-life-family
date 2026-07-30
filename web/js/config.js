// web/js/config.js — 배포 설정.
//
// 이 값들은 프론트에 공개되는 값이다(비밀값 아님):
//   - GAS_URL: Apps Script 웹앱 주소
//   - OAUTH_CLIENT_ID: 구글 로그인 클라이언트 ID (브라우저에 노출되는 것이 정상)
// 시트 ID·등록 코드는 절대 여기 두지 않는다 — 서버(스크립트 속성)에만 둔다.
//
// MOCK: 개발·E2E 전용. 문자열이면 구글 로그인을 건너뛰고 그 이메일의 사용자로 진입한다.
//       커밋 전 반드시 null로 되돌린다 — scripts/check-web.mjs가 검사한다.

export const APP_CONFIG = {
  GAS_URL: 'PASTE_GAS_WEBAPP_URL_HERE',
  OAUTH_CLIENT_ID: 'PASTE_OAUTH_CLIENT_ID_HERE',
  MOCK: null,
};
