// Code.gs — 진입점 + 액션 라우터.
// 계약: docs/specs/2026-07-30-api-contract.md §4, §8.3

// GAS 배포 반영 여부 확인용. 코드를 실질적으로 바꿀 때마다 올린다.
// GET /exec 로 접속했을 때 이 값이 보이면 최신 코드가 배포된 것이다 (계약 §8.3).
//
// ※ web/sw.js 의 BUILD_TAG와는 **서로 독립된 값**이다. 연동되지 않는다.
//   저쪽은 프론트 캐시명, 이쪽은 GAS 배포 확인용이다 (계약 §6.2 마지막 주석).
const BUILD_TAG = 'v1.2.0';

// 호출 시점에 해석한다(파일 평가 시점이 아니라). GAS는 .gs 파일을 편집기 순서대로
// 평가하는데, 배포자가 그 순서를 신경 쓰지 않아도 되게 하려는 것이다.
function getHandler_(action) {
  const ACTIONS = {
    whoami: handleWhoami,
    register: handleRegister,
    getMyRecords: handleGetMyRecords,
    setRecord: handleSetRecord,
    getMyPrayers: handleGetMyPrayers,
    addPrayer: handleAddPrayer,
    setPrayerAnswered: handleSetPrayerAnswered,
    deletePrayer: handleDeletePrayer,
    getAllRecords: handleGetAllRecords,
    getAllPrayers: handleGetAllPrayers,
    getMembers: handleGetMembers,
  };
  return ACTIONS[action] || null;
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const handler = body.action ? getHandler_(body.action) : null;
    if (!handler) {
      return jsonOut({ ok: false, code: 'unknown_action' });
    }
    return jsonOut(handler(body));
  } catch (err) {
    // 진단을 위해 서버 로그에는 전부 남기되, 클라이언트에는 일반화된 코드만 돌려준다.
    // 내부 메시지에는 시트 ID·파일 경로·스택 조각이 섞일 수 있다 (보안 불변식 6).
    console.error('[server_error]', err && err.stack ? err.stack : err);
    return jsonOut({ ok: false, code: 'server_error' });
  }
}

function doGet(e) {
  // 헬스체크 전용. HTML은 GitHub Pages가 호스팅한다.
  return jsonOut({ ok: true, service: 'godly-life-family', build: BUILD_TAG });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
