// web/js/view-today.js — 오늘 탭 (요구사항 1).
// 맥체인 본문 4개 + 말씀읽음 / 와닿은말씀 / 결단 / 중보기도

import * as api from './api.js';
import { state, bumpGeneration, stale } from './state.js';
import { todayStr } from './auth.js';
import { addDays } from './stats.js';
import { el, toast, escapeHtml } from './ui.js';

let editDate = null; // null이면 오늘

// 작성 중이던 입력 임시 보관.
// 구글 ID 토큰은 약 1시간이면 만료된다. 앱을 열어둔 채 긴 '결단'을 쓰고 저장하면
// token_expired → 로그인 화면 전환이 일어나는데, 그때 입력이 통째로 사라지면
// 청소년 사용자가 유일하게 긴 글을 쓰는 화면에서 데이터를 잃는다.
// (2026-07-30 최종 검토 [중대] 지적) — 메모리에만 두므로 계약 §6.1을 위반하지 않는다.
let draft = null; // { email, date, wordRead, verse, resolution, intercession }

/**
 * ★ draft에는 반드시 **소유자 email**을 함께 보관한다.
 * 이게 없으면 세션 만료 후 같은 폰에서 **다른 가족이 로그인했을 때** 앞사람이 쓰던
 * 고백문이 복원되고, 저장하면 뒷사람 이름으로 시트에 기록되어 교사 화면에까지
 * 잘못 귀속된다 — CLAUDE.md 보안 불변식 7의 직접 위반이다.
 * (세션 만료를 보완하려던 수정이 오히려 유출 경로를 만들었다 — 2026-07-30 3차 검토)
 *
 * api.getSessionEmail()은 이 시점에 이미 비워져 있으므로(clearSession이 먼저 실행됨)
 * 아직 남아 있는 state.session.email을 쓴다.
 */
export function stashDraft() {
  const w = el('#t-word');
  if (!w) return; // 오늘 탭이 화면에 없으면 보관할 것도 없다
  const owner = state.session && state.session.email;
  if (!owner) return;
  draft = {
    email: owner,
    date: targetDate(),
    wordRead: w.classList.contains('checked'),
    verse: el('#t-verse').value,
    resolution: el('#t-res').value,
    intercession: el('#t-inter').classList.contains('checked'),
  };
}

export function clearDraft() {
  draft = null;
}

function targetDate() {
  return editDate || todayStr();
}

/**
 * 보관해 둔 draft가 «어제» 것이면 편집 대상을 어제로 맞춘다.
 * 이렇게 하지 않으면 재로그인 후 조건이 어긋나 복원되지 않고, draft가 메모리에 남아
 * 나중에 사용자가 «어제 기록하기»를 누르는 순간 서버 기록 위에 엉뚱하게 덮어써진다
 * (2026-07-30 2차 검토 지적).
 */
export function restoreDraftContext() {
  if (!draft) return;
  // 주인이 다르면 편집 대상(어제/오늘)도 넘겨주지 않는다 — 내용은 아니지만
  // 앞사람의 화면 상태가 뒷사람 화면을 결정하는 것도 막는다 (4차 검토 지적).
  if (draft.email !== (state.session && state.session.email)) return;
  const today = todayStr();
  if (draft.date === today) return;                 // 그대로 오늘 화면에서 복원된다
  if (draft.date === addDays(today, -1)) {          // 어제 편집 중이었다
    editDate = draft.date;
    return;
  }
  // 로그인 화면에 둔 채 자정을 넘겨 draft가 '그저께 이전'이 된 경우.
  // 서버가 저장을 거부하는 날짜라(계약 §4.2) 복원해 봐야 "입력을 확인하세요"만 뜬다.
  // 원인을 알 수 없는 실패를 남기느니 조용히 버린다.
  draft = null;
}

function recordFor(date) {
  return state.records.find(function (r) { return r.date === date; }) || null;
}

function readingsCard(date) {
  const plan = window.MccheynePlan ? window.MccheynePlan.getReadings(date) : null;
  if (!plan) {
    return '<div class="reading-missing">오늘의 본문을 불러오지 못했습니다.</div>';
  }
  function group(title, list, cls) {
    return (
      '<div class="reading-group">' +
      '<div class="reading-group-head">' + title + '</div>' +
      list.map(function (x) {
        return '<div class="reading-card ' + cls + '">' +
          '<span class="rc-dot"></span><span class="rc-text">' + escapeHtml(x) + '</span></div>';
      }).join('') +
      '</div>'
    );
  }
  return group('가정 예배', plan.family, '') + group('개인 묵상', plan.secret, 'secret');
}

export function render(root) {
  const date = targetDate();
  const isToday = date === todayStr();
  const rec = recordFor(date);

  root.innerHTML =
    '<div class="date-caption">' +
      '<span>' + escapeHtml(formatKo(date)) + (isToday ? ' · 오늘' : ' · 어제') + '</span>' +
      '<button class="date-toggle" id="t-toggle">' + (isToday ? '어제 기록하기' : '오늘로 돌아가기') + '</button>' +
    '</div>' +
    readingsCard(date) +
    '<div class="part-pills">' +
    '<button class="check-pill read' + (rec && rec.wordRead ? ' checked' : '') + '" id="t-word" aria-pressed="' + (rec && rec.wordRead ? 'true' : 'false') + '">' +
      '<span class="check-icon">📖</span> 오늘 날주 말씀을 읽었어요' +
    '</button></div>' +
    '<div class="form-row">' +
      '<label class="form-label" for="t-verse">와닿은 말씀</label>' +
      '<textarea class="form-textarea" id="t-verse" maxlength="1000" rows="3" ' +
        'placeholder="오늘 마음에 남은 구절이나 문장을 적어보세요"></textarea>' +
    '</div>' +
    '<div class="form-row">' +
      '<label class="form-label" for="t-res">오늘의 결단</label>' +
      '<textarea class="form-textarea" id="t-res" maxlength="1000" rows="3" ' +
        'placeholder="이 말씀으로 오늘 하루를 어떻게 살지 적어보세요"></textarea>' +
    '</div>' +
    '<div class="part-pills">' +
    '<button class="check-pill prayer' + (rec && rec.intercession ? ' checked' : '') + '" id="t-inter" aria-pressed="' + (rec && rec.intercession ? 'true' : 'false') + '">' +
      '<span class="check-icon">🙏</span> 오늘 다른 사람을 위해 기도했어요' +
    '</button></div>' +
    '<div class="form-row"><button class="btn primary block" id="t-save">저장하기</button></div>';

  // textarea 값은 innerHTML이 아니라 value로 넣는다 (HTML 이스케이프 사고 방지).
  el('#t-verse').value = rec ? rec.verse : '';
  el('#t-res').value = rec ? rec.resolution : '';

  // 세션이 끊겨 재로그인한 경우, 쓰던 내용을 되살린다.
  // **같은 사람이 다시 로그인했을 때만** 복원한다 (보안 불변식 7).
  const me = state.session && state.session.email;
  if (draft && draft.email === me && draft.date === date) {
    el('#t-verse').value = draft.verse;
    el('#t-res').value = draft.resolution;
    el('#t-word').classList.toggle('checked', draft.wordRead);
    el('#t-inter').classList.toggle('checked', draft.intercession);
    draft = null;
    toast('작성 중이던 내용을 되살렸어요. 저장 버튼을 눌러 주세요.');
  }

  el('#t-toggle').onclick = function () {
    editDate = isToday ? addDays(todayStr(), -1) : null;
    render(root);
  };
  ['#t-word', '#t-inter'].forEach(function (sel) {
    el(sel).onclick = function (e) {
      const b = e.currentTarget;
      const on = b.classList.toggle('checked');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
  });
  el('#t-save').onclick = function () { save(root); };
}

async function save(root) {
  const btn = el('#t-save');
  const gen = bumpGeneration();        // 저장 중에 탭이 바뀌면 렌더를 포기한다
  btn.disabled = true;                 // 더블 서브밋 방지 (계약 §4.2)
  btn.textContent = '저장 중...';
  try {
    const res = await api.call('setRecord', {
      date: targetDate(),
      wordRead: el('#t-word').classList.contains('checked'),
      verse: el('#t-verse').value,
      resolution: el('#t-res').value,
      intercession: el('#t-inter').classList.contains('checked'),
    });
    // ★ 여기서 stale로 빠져나가면 안 된다.
    // 서버에는 저장됐는데 state.records가 옛것으로 남아, 달력이 그날을 «기록 없음»으로
    // 그린다. 사용자에게는 "저장이 안 됐다"로 보인다 — 이 검토 시리즈가 내내 쫓아온
    // «데이터 소실 착시»와 같은 결함이다 (2026-07-30 5차 검토 [중대] 지적).
    //
    // 규칙: **데이터 갱신은 항상 수행하고, stale은 화면 그리기·토스트만 막는다.**
    if (!res.ok) {
      if (!stale(gen)) toast(api.errorMessage(res.code));
      return;
    }
    const fresh = await api.call('getMyRecords', { months: state.months }, { noCache: true });
    if (fresh.ok) {
      state.records = fresh.rows;
      // statsRecords는 «로그인 시 확보한 창»이 기준이다(state.js). 달력에서 과거로
      // 이동해 months가 좁아진 상태로 덮어쓰면 연속기록이 갑자기 줄어 보인다.
      // 이번 달이 창에 들어 있을 때만 갱신한다 (5차 검토 N5).
      if (state.months.indexOf(targetDate().slice(0, 7)) >= 0) state.statsRecords = fresh.rows;
    }
    if (stale(gen)) return;            // 데이터는 갱신했다. 화면만 덮어쓰지 않는다.
    toast('저장했습니다.');
    render(root);
  } catch (e) {
    // 오프라인·네트워크 실패: 큐잉하지 않고 즉시 알린다. 입력 내용은 화면에 남는다 (계약 §6.3).
    if (!stale(gen)) toast('저장하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (!stale(gen)) {
      btn.disabled = false;
      btn.textContent = '저장하기';
    }
  }
}

export function formatKo(dateStr) {
  const p = String(dateStr).split('-');
  return Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일';
}

export function resetEditDate() {
  editDate = null;
}
