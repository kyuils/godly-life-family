// web/js/view-calendar.js — 달력 탭 (요구사항 2).
// 본인의 날주 기록을 한 달 달력으로 한눈에. 날짜를 누르면 그날 기록 상세.

import * as api from './api.js';
import { state } from './state.js';
import { todayStr } from './auth.js';
import * as S from './stats.js';
import { el, escapeHtml, nl2br, openSheet, toast, ymLabel } from './ui.js';
import { formatKo } from './view-today.js';

let viewYm = null;

const DOW = ['월', '화', '수', '목', '금', '토', '일'];

function currentYm() {
  return viewYm || S.ymOf(todayStr());
}

/** 이동 가능한 가장 이른 달 — 가입월. 없으면 가장 오래된 기록의 달 (계약 §7). */
function lowerBoundYm() {
  const joined = state.session && state.session.joinedAt;
  if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined)) return S.ymOf(joined);
  if (state.records.length) return S.ymOf(state.records[0].date);
  return S.ymOf(todayStr());
}

function statsHeader() {
  const today = todayStr();
  const streak = S.computeStreak(state.records, today);
  const weekly = S.weeklyRate(state.records, today);
  const monthly = S.monthlyRate(state.records, today);
  const inter = S.intercessionCount(state.records, today, 7);
  // 6개월 상한에 걸렸으면 '+'를 붙여 실제로는 더 길 수 있음을 드러낸다 (계약 §3.1).
  const streakLabel = streak + (state.streakCapped ? '+' : '');

  return (
    '<div class="streak-card">' +
      '<div class="streak-flame">🔥</div>' +
      '<div><div class="streak-num">' + streakLabel + '일</div>' +
      '<div class="streak-label">연속 기록</div></div>' +
    '</div>' +
    '<div class="rate-grid">' +
      rateCard('이번 주', weekly) +
      rateCard('이번 달', monthly) +
    '</div>' +
    '<div class="prayer-counter"><span class="pc-num">' + inter + '</span>' +
    '<span class="pc-label">최근 7일 중 ' + inter + '일 중보기도했어요</span></div>'
  );
}

function rateCard(title, r) {
  return (
    '<div class="rate-card">' +
      '<div class="rate-title">' + title + '</div>' +
      '<div class="rate-pct">' + r.pct + '%</div>' +
      '<div class="rate-track"><div class="rate-fill" style="width:' + r.pct + '%"></div></div>' +
      '<div class="rate-meta">' + r.done + ' / ' + r.total + '일</div>' +
    '</div>'
  );
}

export function render(root) {
  const ym = currentYm();
  const today = todayStr();
  const cells = S.monthGrid(state.records, ym, today);
  const canPrev = ym > lowerBoundYm();
  const canNext = ym < S.ymOf(today);

  root.innerHTML =
    statsHeader() +
    '<div class="section-head">' +
      '<button class="icon-btn" id="cal-prev" ' + (canPrev ? '' : 'disabled') + ' aria-label="이전 달">‹</button>' +
      '<span>' + ymLabel(ym) + '</span>' +
      '<button class="icon-btn" id="cal-next" ' + (canNext ? '' : 'disabled') + ' aria-label="다음 달">›</button>' +
    '</div>' +
    '<div class="cal-grid">' +
      DOW.map(function (d) { return '<div class="day-dow">' + d + '</div>'; }).join('') +
      cells.map(cellHtml).join('') +
    '</div>' +
    '<div class="cal-legend">' +
      '<span><i class="day-mark done"></i> 기록함</span>' +
      '<span><i class="day-mark miss"></i> 기록 없음</span>' +
      '<span><i class="day-mark future"></i> 아직 안 온 날</span>' +
    '</div>';

  el('#cal-prev').onclick = function () {
    if (!canPrev) return;
    viewYm = S.ymOf(S.addDays(ym + '-01', -1));
    ensureMonthLoaded(viewYm, root);
  };
  el('#cal-next').onclick = function () {
    if (!canNext) return;
    viewYm = S.ymOf(S.addDays(ym + '-01', 32));
    ensureMonthLoaded(viewYm, root);
  };
  root.querySelectorAll('.day-cell[data-date]').forEach(function (b) {
    b.onclick = function () { openDay(b.dataset.date); };
  });
}

function cellHtml(c) {
  if (c.state === 'pad') return '<div class="day-cell pad"></div>';
  return (
    '<button class="day-cell" data-date="' + c.date + '">' +
      '<span class="day-num">' + c.day + '</span>' +
      '<i class="day-mark ' + c.state + '"></i>' +
    '</button>'
  );
}

/**
 * 화면에 띄울 달이 아직 로드되지 않았으면 서버에서 가져온다.
 * months는 최대 6개이므로, 넘치면 가장 오래된 달을 버린다(현재 보는 달은 항상 유지).
 */
async function ensureMonthLoaded(ym, root) {
  if (state.months.indexOf(ym) >= 0) { render(root); return; }
  let months = state.months.concat([ym]);
  if (months.length > 6) {
    months = months.sort().slice(-6);
    if (months.indexOf(ym) < 0) months = months.slice(1).concat([ym]);
  }
  const res = await api.call('getMyRecords', { months: months });
  if (!res.ok) { toast(api.errorMessage(res.code)); return; }
  state.months = months;
  state.records = res.rows;
  render(root);
}

function openDay(date) {
  const rec = state.records.find(function (r) { return r.date === date; });
  const plan = window.MccheynePlan ? window.MccheynePlan.getReadings(date) : null;

  let body = '';
  if (plan) {
    body += '<div class="detail-field"><div class="df-label">그날의 본문</div>' +
      '<div class="df-value">' + escapeHtml(plan.family.concat(plan.secret).join(' · ')) + '</div></div>';
  }
  if (!rec) {
    body += '<div class="empty-note">이 날은 기록이 없어요.</div>';
  } else {
    body += '<div class="record-badges">' +
      badge('말씀읽음', rec.wordRead, 'read') +
      badge('중보기도', rec.intercession, 'prayer') +
      '</div>';
    body += field('와닿은 말씀', rec.verse);
    body += field('오늘의 결단', rec.resolution);
  }
  // 오늘·어제만 수정 가능 (계약 §4.2) — 그 외 날짜에는 버튼을 두지 않는다.
  const editable = date === todayStr() || date === S.addDays(todayStr(), -1);
  if (editable) {
    body += '<div class="empty-note">이 날짜는 «오늘» 탭에서 수정할 수 있어요.</div>';
  }
  openSheet(formatKo(date), null, body);
}

// rbadge는 26px 정사각형이라 글자를 넣지 않는다. 의미는 title로 전달한다.
function badge(label, on, color) {
  return '<span class="rbadge ' + (on ? 'on ' + color : '') + '" title="' + escapeHtml(label) + '">' +
    (on ? '✓' : '·') + '</span>';
}

function field(label, value) {
  const v = String(value || '').trim();
  return '<div class="detail-field"><div class="df-label">' + escapeHtml(label) + '</div>' +
    '<div class="df-value' + (v ? '' : ' muted') + '">' + (v ? nl2br(escapeHtml(v)) : '비어 있음') + '</div></div>';
}

export function resetView() {
  viewYm = null;
}
