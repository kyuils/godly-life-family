// web/js/view-calendar.js — 달력 탭 (요구사항 2).
// 본인의 날주 기록을 한 달 달력으로 한눈에. 날짜를 누르면 그날 기록 상세.

import * as api from './api.js';
import { state, bumpGeneration, stale } from './state.js';
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
  // 달력에서 과거 달로 이동해도 상단 지표는 흔들리지 않아야 한다 — 로그인 시 확보한
  // 창(statsRecords)을 기준으로 계산한다. state.records는 달력 그리드 전용이다.
  const base = state.statsRecords.length ? state.statsRecords : state.records;
  const streak = S.computeStreak(base, today);
  const weekly = S.weeklyRate(base, today);
  const monthly = S.monthlyRate(base, today);
  const inter = S.intercessionCount(base, today, 7);
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

  // 2차 방어: 어떤 이유로든 보고 있는 달이 로드되지 않은 상태라면, 빈 달력을 그려
  // "기록이 없다"고 오인하게 두지 말고 다시 불러온다.
  if (state.months.length && state.months.indexOf(ym) < 0) {
    root.innerHTML = '<div class="loading">불러오는 중...</div>';
    ensureMonthLoaded(ym, root);
    return;
  }
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

  // ★ 여기서 viewYm을 미리 바꾸지 않는다. ensureMonthLoaded가 로드에 성공했을 때만
  //   옮긴다 — 미리 바꿔 두면 로드가 중단됐을 때 되돌릴 원본이 사라진다.
  el('#cal-prev').onclick = function () {
    if (!canPrev) return;
    ensureMonthLoaded(S.ymOf(S.addDays(ym + '-01', -1)), root);
  };
  el('#cal-next').onclick = function () {
    if (!canNext) return;
    ensureMonthLoaded(S.ymOf(S.addDays(ym + '-01', 32)), root);
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
 *
 * ★ 중단(stale)할 때 반드시 `viewYm`을 원래 달로 되돌린다.
 * 되돌리지 않으면 `viewYm`은 새 달을 가리키는데 `state.records`는 갱신되지 않은 채로
 * 남아, 달력 탭으로 돌아왔을 때 그 달 전체가 «기록 없음»으로 그려진다.
 * 사용자에게는 **"내 기록이 통째로 사라졌다"** 로 보이고 되살릴 UI 경로도 없다
 * (2026-07-30 4차 검토 [중대] — 세대 카운터를 넣으면서 만든 결함).
 */
async function ensureMonthLoaded(ym, root) {
  const gen = bumpGeneration();

  // 이미 로드된 달이면 곧바로 옮긴다.
  if (state.months.indexOf(ym) >= 0) { viewYm = ym; render(root); return; }

  let months = state.months.concat([ym]);
  if (months.length > 6) {
    months = months.sort().slice(-6);
    if (months.indexOf(ym) < 0) months = months.slice(1).concat([ym]);
  }

  root.innerHTML = '<div class="loading">불러오는 중...</div>';
  const res = await api.call('getMyRecords', { months: months });

  // 중단되면 **화면을 옮기지 않는다.** viewYm은 여전히 로드된 달을 가리키므로
  // 돌아왔을 때 빈 달력이 그려지는 일이 없다.
  if (stale(gen)) return;

  if (!res.ok) {
    toast(api.errorMessage(res.code));
    render(root);          // 원래 달을 다시 그린다
    return;
  }
  state.months = months;
  state.records = res.rows;
  viewYm = ym;             // 성공했을 때만 옮긴다
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
