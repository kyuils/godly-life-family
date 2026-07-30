// web/js/view-class.js — 우리반 탭 (교사/관리자 전용).
//
// 서버가 이미 권한을 강제하지만(계약 §4.2), 화면에서도 탭 자체를 숨긴다.
// 교사는 기도제목을 읽을 수만 있고 응답 체크·삭제는 할 수 없다(본인만 — 사용자 결정).

import * as api from './api.js';
import { state } from './state.js';
import { todayStr } from './auth.js';
import * as S from './stats.js';
import { el, escapeHtml, nl2br, openSheet, toast, shortDate } from './ui.js';

let kindTab = 'student';
let subTab = 'records';

export async function render(root) {
  if (state.classRecords === null) {
    root.innerHTML = '<div class="loading">불러오는 중...</div>';
    const [rec, pray, mem] = await Promise.all([
      api.call('getAllRecords', { days: 60 }),
      api.call('getAllPrayers', { days: 180 }),
      api.call('getMembers', {}),
    ]);
    if (!rec.ok || !pray.ok || !mem.ok) {
      const bad = [rec, pray, mem].find(function (r) { return !r.ok; });
      root.innerHTML = '<div class="empty-note">' + escapeHtml(api.errorMessage(bad.code)) + '</div>';
      return;
    }
    state.classRecords = rec.rows;
    state.classWindowDays = rec.windowDays || 60;
    state.classPrayers = pray.rows;
    state.classMembers = mem.members;
  }

  const kindLabel = kindTab === 'student' ? '학생' : '학부모';
  const members = state.classMembers.filter(function (m) { return m.kind === kindTab; });

  root.innerHTML =
    '<div class="seg">' +
      segBtn('student', '학생', kindTab) + segBtn('parent', '학부모', kindTab) +
    '</div>' +
    '<div class="seg seg-sub">' +
      segBtn2('records', '경건생활', subTab) + segBtn2('prayers', '기도제목', subTab) +
    '</div>' +
    (subTab === 'records' ? recordsHtml(members, kindLabel) : prayersHtml(kindLabel));

  root.querySelectorAll('[data-kind]').forEach(function (b) {
    b.onclick = function () { kindTab = b.dataset.kind; render(root); };
  });
  root.querySelectorAll('[data-sub]').forEach(function (b) {
    b.onclick = function () { subTab = b.dataset.sub; render(root); };
  });
  root.querySelectorAll('[data-member]').forEach(function (b) {
    b.onclick = function () { openMember(b.dataset.member); };
  });
}

function segBtn(v, label, active) {
  return '<button class="seg-btn' + (v === active ? ' on' : '') + '" data-kind="' + v + '">' + label + '</button>';
}
function segBtn2(v, label, active) {
  return '<button class="seg-btn' + (v === active ? ' on' : '') + '" data-sub="' + v + '">' + label + '</button>';
}

function rowsOf(email) {
  return state.classRecords.filter(function (r) { return r.email === email; });
}

function recordsHtml(members, kindLabel) {
  if (!members.length) return '<div class="empty-note">등록된 ' + kindLabel + '이 없어요.</div>';
  const today = todayStr();
  const last7 = [];
  for (let i = 6; i >= 0; i--) last7.push(S.addDays(today, -i));

  return members.map(function (m) {
    const rows = rowsOf(m.email);
    const done = S.doneDateSet(rows);
    const streak = S.computeStreak(rows, today);
    const monthly = S.monthlyRate(rows, today);
    // streak은 요청한 창(기본 60일) 안에서만 계산된다 — 창을 채우면 '+'를 붙여
    // 본인 화면의 값과 다를 수 있음을 드러낸다 (계약 §4.2).
    const capped = streak >= state.classWindowDays;
    return (
      '<button class="team-card" data-member="' + escapeHtml(m.email) + '">' +
        '<div class="team-top">' +
          '<span class="team-name">' + escapeHtml(m.name) + '</span>' +
          '<span class="team-stat"><b>' + streak + (capped ? '+' : '') + '</b>일 연속 · 이번달 ' + monthly.pct + '%</span>' +
        '</div>' +
        '<div class="team-week">' +
          last7.map(function (d) {
            return '<i class="day-mark ' + (done.has(d) ? 'done' : 'miss') + '" title="' + d + '"></i>';
          }).join('') +
        '</div>' +
      '</button>'
    );
  }).join('');
}

function prayersHtml(kindLabel) {
  const list = state.classPrayers.filter(function (p) {
    return p.kind === (kindTab === 'student' ? '학생' : '학부모');
  });
  if (!list.length) return '<div class="empty-note">' + kindLabel + '의 기도제목이 없어요.</div>';

  const open = list.filter(function (p) { return p.status === 'open'; });
  const answered = list.filter(function (p) { return p.status === 'answered'; });

  function card(p) {
    return (
      '<div class="prayer-card' + (p.status === 'open' ? ' open' : ' answered') + '">' +
        '<div class="prayer-top">' +
          '<span class="team-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="prayer-date">' + escapeHtml(shortDate(p.createdDate)) + '</span>' +
        '</div>' +
        '<div class="prayer-text">' + nl2br(escapeHtml(p.text)) + '</div>' +
        (p.status === 'answered'
          ? '<div class="prayer-answered-tag">' + escapeHtml(shortDate(p.answeredDate)) + ' 응답됨</div>' : '') +
      '</div>'
    );
  }

  return (
    '<div class="section-head"><span>기도 중 (' + open.length + ')</span></div>' +
    (open.length ? open.map(card).join('') : '<div class="empty-note">없음</div>') +
    '<div class="section-head"><span>응답됨 (' + answered.length + ')</span></div>' +
    (answered.length ? answered.map(card).join('') : '<div class="empty-note">없음</div>') +
    '<div class="form-hint">응답 여부는 본인만 표시할 수 있어요.</div>'
  );
}

function openMember(email) {
  const m = state.classMembers.find(function (x) { return x.email === email; });
  if (!m) return;
  const rows = rowsOf(email).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  const body = rows.length
    ? rows.slice(0, 30).map(function (r) {
        return (
          '<div class="record-card">' +
            '<div class="record-date">' + escapeHtml(shortDate(r.date)) + '</div>' +
            '<div class="record-badges">' +
              '<span class="rbadge ' + (r.wordRead ? 'on read' : '') + '" title="말씀읽음">' + (r.wordRead ? '✓' : '·') + '</span>' +
              '<span class="rbadge ' + (r.intercession ? 'on prayer' : '') + '" title="중보기도">' + (r.intercession ? '✓' : '·') + '</span>' +
            '</div>' +
            (r.verse ? '<div class="detail-field"><div class="df-value">' + nl2br(escapeHtml(r.verse)) + '</div></div>' : '') +
            (r.resolution ? '<div class="detail-field"><div class="df-value">' + nl2br(escapeHtml(r.resolution)) + '</div></div>' : '') +
          '</div>'
        );
      }).join('')
    : '<div class="empty-note">최근 기록이 없어요.</div>';
  // email 병기 — 동명이인·사칭 구분 (시니어 검토 반영)
  openSheet(m.name, m.email, body);
}

export async function refresh(root) {
  state.classRecords = null;
  await render(root);
}

export function resetView() {
  kindTab = 'student';
  subTab = 'records';
}
