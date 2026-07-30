// web/js/view-prayer.js — 기도 탭 (요구사항 3).
//
// 담임교사에게 요청하는 기도. 본인과 교사만 볼 수 있다(서버가 강제 — 계약 §4.2).
// 화면 규칙 (계약 §7):
//   - 월별 섹션으로 묶고 최신 월이 위
//   - 미응답: 카드를 펼친 상태로 상시 표시
//   - 응답됨: "7월 12일 · 응답됨" 한 줄로 접고, 누르면 펼침
//   - 응답 체크는 본인만 (사용자 결정 2026-07-30)

import * as api from './api.js';
import { state, bumpGeneration, stale } from './state.js';
import * as S from './stats.js';
import { el, escapeHtml, nl2br, toast, shortDate, ymLabel } from './ui.js';

// 사용자가 펼쳐 둔 "응답됨" 카드 id. 렌더 사이에 유지한다.
const expanded = new Set();

// 작성 중이던 기도제목(최대 1000자). 세션 만료로 화면이 갈아엎히면 여기 보관했다가
// 재로그인 후 되살린다 — «오늘» 탭과 동일한 이유다(계약 §6.3 취지).
let draft = null; // { email, text }

/** ★ 소유자 email을 함께 보관한다 — 이유는 view-today.js의 stashDraft 주석 참조. */
export function stashDraft() {
  const ta = el('#p-new');
  const owner = state.session && state.session.email;
  if (ta && owner && ta.value.trim()) draft = { email: owner, text: ta.value };
}

export function clearDraft() {
  draft = null;
}

export function render(root) {
  const groups = S.groupPrayersByMonth(state.prayers);
  const openCount = state.prayers.filter(function (p) { return p.status === 'open'; }).length;

  root.innerHTML =
    '<div class="form-row">' +
      '<label class="form-label" for="p-new">담임교사에게 요청하는 기도</label>' +
      '<textarea class="form-textarea" id="p-new" rows="3" maxlength="1000" ' +
        'placeholder="기도 부탁드릴 내용을 적어주세요"></textarea>' +
      '<div class="form-hint">본인과 담임교사만 볼 수 있어요.</div>' +
      '<button class="btn primary block" id="p-add">기도 요청하기</button>' +
    '</div>' +
    (state.prayers.length
      ? '<div class="prayer-counter">기도 중인 제목 <b>' + openCount + '</b>개</div>' +
        groups.map(groupHtml).join('')
      : '<div class="empty-note">아직 요청한 기도가 없어요.</div>');

  // 같은 사람이 다시 로그인했을 때만 복원한다 (보안 불변식 7).
  if (draft && draft.email === (state.session && state.session.email)) {
    el('#p-new').value = draft.text;
    draft = null;
    toast('작성 중이던 기도 제목을 되살렸어요.');
  }

  el('#p-add').onclick = add;
  bindCards(root);
}

function groupHtml(g) {
  return (
    '<div class="section-head"><span>' + ymLabel(g.ym) + '</span></div>' +
    g.items.map(cardHtml).join('')
  );
}

function cardHtml(p) {
  const isOpen = p.status === 'open';
  // 응답된 기도는 접어 두되, 사용자가 열어 둔 것은 유지한다.
  const showBody = isOpen || expanded.has(p.id);

  if (!showBody) {
    return (
      '<button class="prayer-collapsed" data-toggle="' + escapeHtml(p.id) + '">' +
        '<span class="prayer-date">' + escapeHtml(shortDate(p.answeredDate || p.createdDate)) + '</span>' +
        '<span class="prayer-answered-tag">응답됨</span>' +
        '<span class="prayer-chevron">›</span>' +
      '</button>'
    );
  }

  return (
    '<div class="prayer-card' + (isOpen ? ' open' : ' answered') + '">' +
      '<div class="prayer-top">' +
        '<span class="prayer-date">' + escapeHtml(shortDate(p.createdDate)) + ' 요청</span>' +
        (isOpen
          ? '<span class="prayer-status-open">기도 중</span>'
          : '<span class="prayer-answered-tag">' + escapeHtml(shortDate(p.answeredDate)) + ' 응답됨</span>') +
      '</div>' +
      '<div class="prayer-text">' + nl2br(escapeHtml(p.text)) + '</div>' +
      '<div class="prayer-actions">' +
        '<button class="btn sm" data-answer="' + escapeHtml(p.id) + '" data-to="' + (isOpen ? '1' : '0') + '">' +
          (isOpen ? '응답받았어요' : '다시 기도 중으로') +
        '</button>' +
        '<button class="btn sm danger" data-del="' + escapeHtml(p.id) + '">삭제</button>' +
        (isOpen ? '' : '<button class="btn sm ghost" data-toggle="' + escapeHtml(p.id) + '">접기</button>') +
      '</div>' +
    '</div>'
  );
}

function bindCards(root) {
  root.querySelectorAll('[data-toggle]').forEach(function (b) {
    b.onclick = function () {
      const id = b.dataset.toggle;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      render(root);
    };
  });
  root.querySelectorAll('[data-answer]').forEach(function (b) {
    b.onclick = function () { setAnswered(b.dataset.answer, b.dataset.to === '1', root, b); };
  });
  root.querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = function () { remove(b.dataset.del, root, b); };
  });
}

async function reload(root, gen) {
  const owner = api.getSessionEmail();
  const res = await api.call('getMyPrayers', {}, { noCache: true });
  // 세션이 파기된 뒤 늦게 도착한 응답으로 state를 되살리지 않는다 (6차 검토 ②).
  if (api.getSessionEmail() !== owner) return;
  if (res.ok) state.prayers = res.rows;
  if (gen !== undefined && stale(gen)) return;  // 그 사이 다른 탭으로 이동했다
  render(root);
}

async function add() {
  const ta = el('#p-new');
  const text = ta.value.trim();
  if (!text) { toast('기도 제목을 입력해 주세요.'); return; }
  const btn = el('#p-add');
  const gen = bumpGeneration();
  btn.disabled = true;
  try {
    const res = await api.call('addPrayer', { text: text });
    // 데이터 갱신(reload)은 항상 수행한다. stale은 화면·토스트만 막는다 (5차 검토 N2).
    if (!res.ok) {
      if (!stale(gen)) toast(api.errorMessage(res.code));
      return;
    }
    ta.value = '';
    if (!stale(gen)) toast('기도 요청을 등록했어요.');
    await reload(el('#view'), gen);
  } catch (e) {
    if (!stale(gen)) toast('등록하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (!stale(gen)) btn.disabled = false;
  }
}

async function setAnswered(id, answered, root, btn) {
  const gen = bumpGeneration();
  btn.disabled = true;
  try {
    const res = await api.call('setPrayerAnswered', { id: id, answered: answered });
    if (!res.ok) {
      if (!stale(gen)) toast(api.errorMessage(res.code));
      return;
    }
    if (answered) expanded.delete(id); // 응답 처리하면 접힌 상태로 보인다
    if (!stale(gen)) toast(answered ? '응답받은 기도로 옮겼어요.' : '다시 기도 중으로 되돌렸어요.');
    await reload(root, gen);
  } catch (e) {
    if (!stale(gen)) toast('처리하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (!stale(gen)) btn.disabled = false;
  }
}

async function remove(id, root, btn) {
  if (!window.confirm('이 기도 제목을 삭제할까요?')) return;
  const gen = bumpGeneration();
  btn.disabled = true;
  try {
    const res = await api.call('deletePrayer', { id: id });
    // ★ 여기서 빠져나가면 목록에 지운 기도가 남고, 사용자가 다시 «삭제»를 눌렀을 때
    // 서버가 forbidden을 내어 **«권한이 없습니다»** 가 뜬다 — 자기 기도를 지우는데.
    if (!res.ok) {
      if (!stale(gen)) toast(api.errorMessage(res.code));
      return;
    }
    expanded.delete(id);
    if (!stale(gen)) toast('삭제했어요.');
    await reload(root, gen);
  } catch (e) {
    if (!stale(gen)) toast('삭제하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    if (!stale(gen)) btn.disabled = false;
  }
}

export function resetView() {
  expanded.clear();
}
