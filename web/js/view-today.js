// web/js/view-today.js — 오늘 탭 (요구사항 1).
// 맥체인 본문 4개 + 말씀읽음 / 와닿은말씀 / 결단 / 중보기도

import * as api from './api.js';
import { state } from './state.js';
import { todayStr } from './auth.js';
import { addDays } from './stats.js';
import { el, toast, escapeHtml } from './ui.js';

let editDate = null; // null이면 오늘

function targetDate() {
  return editDate || todayStr();
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
    if (!res.ok) {
      toast(api.errorMessage(res.code));
      return;
    }
    const fresh = await api.call('getMyRecords', { months: state.months }, { noCache: true });
    if (fresh.ok) state.records = fresh.rows;
    toast('저장했습니다.');
    render(root);
  } catch (e) {
    // 오프라인·네트워크 실패: 큐잉하지 않고 즉시 알린다. 입력 내용은 화면에 남는다 (계약 §6.3).
    toast('저장하지 못했습니다. 인터넷 연결을 확인해 주세요.');
  } finally {
    btn.disabled = false;
    btn.textContent = '저장하기';
  }
}

export function formatKo(dateStr) {
  const p = String(dateStr).split('-');
  return Number(p[0]) + '년 ' + Number(p[1]) + '월 ' + Number(p[2]) + '일';
}

export function resetEditDate() {
  editDate = null;
}
