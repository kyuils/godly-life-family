// web/js/view-library.js — 자료 탭 (요구사항 4).
//
// 참고자료는 web/data/*.json 정적 파일이다(서버 왕복 없음).
// 목록(index.json)만 먼저 읽고 본문은 문서를 열 때 지연 로드한다 (계약 §5.3).
// 화면 하단에 출처·저작권·이용조건을 항상 노출한다 (계약 §5.5.1).

import { state, bumpGeneration, stale } from './state.js';
import { el, escapeHtml, nl2br, toast } from './ui.js';

let openDocId = null;
let query = '';

export async function render(root) {
  const gen = bumpGeneration();
  if (!state.library) {
    root.innerHTML = '<div class="loading">자료를 불러오는 중...</div>';
    try {
      const res = await fetch('data/index.json');
      const data = await res.json();
      // 참고자료는 공개 정적 자료다 — 받아 뒀다가 다음에 재사용한다(버리지 않는다).
      state.library = data;
      if (stale(gen)) return;          // 그 사이 다른 탭으로 이동했다 — 화면만 막는다
    } catch (e) {
      if (stale(gen)) return;
      root.innerHTML = '<div class="empty-note">자료를 불러오지 못했습니다.</div>';
      return;
    }
  }
  if (!openDocId) { renderList(root); return; }
  await renderDoc(root, openDocId);
}

function renderList(root) {
  root.innerHTML =
    '<div class="section-head"><span>참고자료</span></div>' +
    state.library.map(function (d) {
      return (
        '<button class="lib-item" data-doc="' + escapeHtml(d.id) + '">' +
          '<div class="lib-title">' + escapeHtml(d.title) + '</div>' +
          '<div class="lib-meta">' + countLabel(d) + '</div>' +
          '<span class="prayer-chevron">›</span>' +
        '</button>'
      );
    }).join('');
  root.querySelectorAll('[data-doc]').forEach(function (b) {
    b.onclick = function () { openDocId = b.dataset.doc; query = ''; render(root); };
  });
}

function countLabel(d) {
  return d.type === 'catechism' ? d.count + '문답' : d.count + '장';
}

async function renderDoc(root, id) {
  const gen = bumpGeneration();
  let doc = state.libraryDocs[id];
  if (!doc) {
    root.innerHTML = '<div class="loading">불러오는 중...</div>';
    const meta = state.library.find(function (x) { return x.id === id; });
    try {
      const res = await fetch('data/' + meta.file);
      const parsed = await res.json();
      doc = parsed;
      state.libraryDocs[id] = doc;     // 받아 둔 본문은 캐시해 다음 열람을 빠르게
      if (stale(gen)) return;          // 로딩 중에 탭이 바뀌었다 — 화면만 막는다
    } catch (e) {
      if (stale(gen)) return;
      toast('본문을 불러오지 못했습니다.');
      openDocId = null;
      renderList(root);
      return;
    }
  }
  if (stale(gen)) return;

  const items = doc.type === 'catechism' ? doc.items : doc.sections;
  const filtered = query ? items.filter(function (it) { return matches(it, query); }) : items;

  root.innerHTML =
    '<div class="section-head">' +
      '<button class="icon-btn" id="lib-back" aria-label="목록으로">‹</button>' +
      '<span>' + escapeHtml(doc.shortTitle || doc.title) + '</span>' +
      '<span></span>' +
    '</div>' +
    '<input class="form-input" id="lib-q" type="search" placeholder="이 문서에서 검색" value="' + escapeHtml(query) + '">' +
    (query ? '<div class="form-hint">' + filtered.length + '건 찾음</div>' : '') +
    '<div class="lib-body">' +
      (filtered.length
        ? filtered.map(doc.type === 'catechism' ? qaHtml : chapterHtml).join('')
        : '<div class="empty-note">검색 결과가 없습니다.</div>') +
    '</div>' +
    sourceHtml(doc);

  el('#lib-back').onclick = function () {
    clearTimeout(searchTimer);   // 대기 중인 검색이 뒤늦게 화면을 덮어쓰지 않도록
    openDocId = null; query = ''; render(root);
  };
  const q = el('#lib-q');
  q.oninput = function () {
    // 대요리문답은 196문답(162KB)이라 키 입력마다 재렌더하면 저사양 폰에서 버벅인다.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { applySearch(root, id, q); }, 180);
  };
}

let searchTimer = null;

function applySearch(root, id, q) {
  query = q.value.trim();
  const pos = q.selectionStart;
  renderDoc(root, id).then(function () {
    const nq = el('#lib-q');
    if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  });
}

function matches(it, q) {
  const hay = it.q !== undefined
    ? (it.q + ' ' + it.a)
    : (it.title + ' ' + (it.paras || []).join(' '));
  return hay.indexOf(q) >= 0;
}

function qaHtml(it) {
  return (
    '<div class="qa">' +
      '<div class="qa-q"><span class="qa-no">' + it.no + '</span>' + escapeHtml(it.q) + '</div>' +
      '<div class="qa-a">' + nl2br(escapeHtml(it.a)) + '</div>' +
      (it.refs && it.refs.length
        ? '<div class="qa-refs">' + escapeHtml(it.refs.join(', ')) + '</div>' : '') +
    '</div>'
  );
}

function chapterHtml(it) {
  return (
    '<div class="qa">' +
      '<div class="qa-q">' + escapeHtml(it.title) + '</div>' +
      (it.paras || []).map(function (p) {
        return '<div class="qa-a">' + nl2br(escapeHtml(p)) + '</div>';
      }).join('') +
    '</div>'
  );
}

/**
 * 출처·저작권 표기 (계약 §5.5.1).
 * 이용 조건이 '제한적'인 문서는 그 사실을 화면에서 숨기지 않는다 —
 * 사용자(교사)가 자기 자료의 성격을 알고 있어야 하기 때문이다.
 */
function sourceHtml(doc) {
  const s = doc.source || {};
  const limited = s.licenseConfidence === '제한적';
  return (
    '<div class="lib-source">' +
      '<div><b>출처</b> ' + escapeHtml(s.name || '') + '</div>' +
      '<div><b>저작권</b> ' + escapeHtml(s.license || '') + '</div>' +
      '<div><b>수집일</b> ' + escapeHtml(s.fetchedAt || '') + '</div>' +
      (limited ? '<div class="lib-source-warn">※ 이용 조건이 명확히 확인되지 않은 자료입니다. 교회 내부 교육 목적으로만 사용해 주세요.</div>' : '') +
      (s.note ? '<div class="lib-source-note">' + escapeHtml(s.note) + '</div>' : '') +
    '</div>'
  );
}

/**
 * 대기 중인 지연 검색을 취소한다.
 *
 * ★ 검색어를 치고 180ms 안에 다른 탭으로 넘어가면, 뒤늦게 실행된 applySearch가
 * `#view`를 문서 본문으로 덮어써 **방금 연 탭 위에 자료 본문이 겹쳐 보인다.**
 * 탭을 전환할 때마다 app.js가 이 함수를 부른다 (2026-07-30 2차 검토 지적).
 */
export function cancelPending() {
  clearTimeout(searchTimer);
  searchTimer = null;
}

export function resetView() {
  cancelPending();
  openDocId = null;
  query = '';
}
