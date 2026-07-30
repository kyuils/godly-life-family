// web/js/load.js — 로그인 직후 내 데이터 로드.
//
// app.js에서 분리한 이유: 이 함수의 **실패 처리**가 이 앱에서 가장 흔한 사고 경로였다.
// 로그인 순간 회선이 한 번 흔들리면, 예전에는 오류 표시 없이
//   «연속 0일 / 이번달 0%» 와 «아직 요청한 기도가 없어요»
// 를 보여줬다. 200일 기록한 학생에게 「사라졌다」로 보이는 화면이다.
//
// app.js는 DOM·location에 묶여 있어 Node에서 import할 수 없다. 그래서 이 로직만
// 떼어내 `scripts/test-web-views.mjs`가 직접 실행해 검증한다 — 규칙을 문서가 아니라
// 테스트가 지키게 하기 위함이다 (2026-07-30 7차 검토 지적).

import * as api from './api.js';
import { state } from './state.js';
import * as S from './stats.js';

/**
 * 본인 기록·기도를 불러와 state에 채운다.
 *
 * streak가 로드된 가장 이른 달의 1일까지 닿아 있으면 이전 달을 더 불러온다 (계약 §3.1).
 * 날짜가 아니라 데이터로 판정하므로 긴 연속기록이 잘리지 않는다.
 *
 * @param todayStr 표준 오늘 (Asia/Seoul YYYY-MM-DD)
 * @return { ok: true } | { ok: false, code }
 *
 * ★ 실패를 «빈 데이터»로 갈음하지 않는다. 호출부는 ok가 false면 앱 화면을 그리면 안 된다.
 */
export async function loadMyData(todayStr) {
  const today = todayStr;
  // 응답을 state에 쓰기 전에 «이 요청을 시작한 사람»이 아직 로그인 상태인지 확인한다.
  // 세션이 파기된 뒤 늦게 도착한 응답이 state를 되살리면, 다음에 로그인한 가족에게
  // 앞사람 기록이 보일 수 있다 (보안 불변식 7).
  const owner = api.getSessionEmail();
  let months = S.defaultMonths(today);

  let res = await api.call('getMyRecords', { months: months }, { noCache: true });
  if (!res.ok) return { ok: false, code: res.code };
  let rows = res.rows;

  // 실제로 응답을 받은 달만 '보유'로 기록한다. 확장 요청이 실패했는데 늘어난 months를
  // 그대로 대입하면, 달력에서 그 달로 갔을 때 재로드 방어가 작동하지 않고
  // 한 달 전체가 «기록 없음»으로 그려진다.
  let loadedMonths = months;

  let guard = 0;
  while (S.streakNeedsMoreMonths(rows, today, loadedMonths) && loadedMonths.length < 6 && guard++ < 6) {
    const next = S.extendMonths(loadedMonths, 6);
    res = await api.call('getMyRecords', { months: next }, { noCache: true });
    if (!res.ok) break;                // 실패하면 loadedMonths는 직전 성공 상태로 남는다
    loadedMonths = next;
    rows = res.rows;
  }
  months = loadedMonths;

  if (api.getSessionEmail() !== owner) return { ok: false, code: 'stale_session' };

  state.months = months;
  state.records = rows;
  state.statsRecords = rows;   // 지표 기준 창 고정 (달력 이동에 영향받지 않음)
  // 6개월을 다 쓰고도 더 필요하면 화면에 '+'를 붙인다.
  state.streakCapped = S.streakNeedsMoreMonths(rows, today, months);

  const p = await api.call('getMyPrayers', {}, { noCache: true });
  // 기도 로드 실패도 «기도 없음»으로 갈음하지 않는다.
  if (!p.ok) return { ok: false, code: p.code };
  if (api.getSessionEmail() !== owner) return { ok: false, code: 'stale_session' };
  state.prayers = p.rows;
  return { ok: true };
}
