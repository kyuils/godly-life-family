// web/js/view-home.js — 로그인 직후 첫 화면 (2026-07-31 요청).
//
// "로그인 페이지 이후 첫 페이지에 큰 아이콘으로 날주, 날주진행, 기도요청,
//  신앙자료가 큰 페이지로 보이도록. 첫 페이지에서 골라서 들어가면 좋겠어."
//
// 홈은 **탭이 아니다.** 탭으로 넣으면 교사 화면이 6개가 되어, 직전에 고친
// «탭이 작아 누르기 어렵다» 문제가 그대로 되살아난다. 대신 로그인 후 첫
// 화면이 홈이고, 제목줄의 앱 이름을 누르면 언제든 홈으로 돌아온다.
//
// 각 칸의 data-tab 값은 반드시 app.js의 TABS에 있는 id여야 한다
// (scripts/check-web.mjs가 이 대응을 검사한다 — 오탈자로 눌러도 안 열리는
//  칸이 생기는 것을 막는다).

import { el, escapeHtml } from './ui.js';
import { state } from './state.js';

const CARDS = [
  { tab: 'today', icon: '📖', title: '날주 체크', desc: '오늘의 맥체인 본문과 결단' },
  { tab: 'calendar', icon: '🗓️', title: '날주 진행', desc: '한 달 기록을 한눈에' },
  { tab: 'prayer', icon: '🙏', title: '기도 요청', desc: '담임교사에게만 전해집니다' },
  { tab: 'library', icon: '📚', title: '신앙 자료', desc: '신앙고백서·요리문답' },
];

/** 홈에서 보여 줄 칸 목록 — check-web이 TABS와 대조하는 대상이다. */
export function homeCards() {
  return CARDS;
}

export function render(root, onPick) {
  const name = (state.session && state.session.name) || '';
  root.innerHTML =
    '<div class="home">' +
      (name ? '<div class="home-greet">' + escapeHtml(name) + '님, 오늘도 반갑습니다</div>' : '') +
      '<div class="home-grid">' +
        CARDS.map(function (c) {
          return (
            '<button class="home-card" data-tab="' + c.tab + '">' +
              '<span class="home-icon">' + c.icon + '</span>' +
              '<span class="home-title">' + escapeHtml(c.title) + '</span>' +
              '<span class="home-desc">' + escapeHtml(c.desc) + '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>' +
    '</div>';

  root.querySelectorAll('.home-card').forEach(function (b) {
    b.onclick = function () { onPick(b.dataset.tab); };
  });
}

export function resetView() { /* 홈은 보관할 상태가 없다 */ }
