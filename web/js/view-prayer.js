// web/js/view-prayer.js — 기도 탭 (요구사항 3).
//
// 담임교사에게 요청하는 기도. 본인과 교사만 볼 수 있다(서버가 강제 — 계약 §4.2).
// 화면 규칙 (계약 §7):
//   - 월별 섹션으로 묶고 최신 월이 위
//   - 미응답: 카드를 펼친 상태로 상시 표시
//   - 응답됨: "7월 12일 · 응답됨" 한 줄로 접고, 누르면 펼침
//   - 응답 체크는 본인만 (사용자 결정 2026-07-30)

import * as api from './api.js';
import { state } from './state.js';
import * as S from './stats.js';
import { el, escapeHtml, nl2br, toast, shortDate, ymLabel } from './ui.js';

// 사용자가 펼쳐 둔 "응답됨" 카드 id. 렌더 사이에 유지한다.
const expanded = new Set();

// 작성 중이던 기도제목(최대 1000자). 세션 만료로 화면이 갈아엎히면 여기 보관했다가
// 재로그인 후 되살린다 — «오늘» 탭과 동일한 이유다(계약 §6.3 취지).
let draft = null;

export function stashDraft() {
  const ta = el('#p-new');
  if (ta && ta.value.trim()) draft = ta.value;
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

  if (draft) {
    el('#p-new').value = draft;
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

async function reload(root) {
  const res = await api.call('getMyPrayers', {}, { noCache: true });
  if (res.ok) state.prayers = res.rows;
  render(root);
}

async function add() {
  const ta = el('#p-new');
  const text = ta.value.trim();
  if (!text) { toast('기도 제목을 입력해 주세요.'); return; }
  const btn = el('#p-add');
  btn.disabled = true;
  try {
    const res = await api.call('addPrayer', { text: text });
    if (!res.ok) { toast(api.errorMessage(res.code)); return; }
    ta.value = '';
    toast('기도 요청을 등록했어요.');
    await reload(el('#view'));
  } catch (e) {
    toast('등록하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    btn.disabled = false;
  }
}

async function setAnswered(id, answered, root, btn) {
  btn.disabled = true;
  try {
    const res = await api.call('setPrayerAnswered', { id: id, answered: answered });
    if (!res.ok) { toast(api.errorMessage(res.code)); return; }
    if (answered) expanded.delete(id); // 응답 처리하면 접힌 상태로 보인다
    toast(answered ? '응답받은 기도로 옮겼어요.' : '다시 기도 중으로 되돌렸어요.');
    await reload(root);
  } catch (e) {
    toast('처리하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    btn.disabled = false;
  }
}

async function remove(id, root, btn) {
  if (!window.confirm('이 기도 제목을 삭제할까요?')) return;
  btn.disabled = true;
  try {
    const res = await api.call('deletePrayer', { id: id });
    if (!res.ok) { toast(api.errorMessage(res.code)); return; }
    expanded.delete(id);
    toast('삭제했어요.');
    await reload(root);
  } catch (e) {
    toast('삭제하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    btn.disabled = false;
  }
}

export function resetView() {
  expanded.clear();
}
