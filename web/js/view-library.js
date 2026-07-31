// web/js/view-library.js — 자료 탭 (요구사항 4).
//
// 참고자료는 web/data/*.json 정적 파일이다(서버 왕복 없음).
// 목록(index.json)만 먼저 읽고 본문은 문서를 열 때 지연 로드한다 (계약 §5.3).
// 화면 하단에 출처·저작권·이용조건을 항상 노출한다 (계약 §5.5.1).

import { state, bumpGeneration, stale } from './state.js';
import { el, escapeHtml, nl2br, toast, openSheet, closeSheet } from './ui.js';

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

/**
 * 분류 그룹 정의 (2026-07-31 요청 — 신조·고백을 성격별로 묶어 본다).
 *
 * 라벨에 «합동 교단 표준문서가 아님»을 적는 이유: 대륙 개혁교회 문서를
 * 우리 교단 표준문서로 오해하면 안 된다. 학생이 보는 화면이라 더 그렇다.
 */
const GROUPS = [
  { id: 'westminster', label: '웨스트민스터 표준문서', note: '대한예수교장로회(합동) 헌법 수록' },
  { id: 'gapck', label: '우리 교단 신조', note: '대한예수교장로회(합동) 헌법 수록' },
  { id: 'ecumenical', label: '보편 신조', note: '전 세계 교회가 함께 고백해 온 신조' },
  { id: 'continental', label: '대륙 개혁교회 문서', note: '합동 교단 표준문서는 아닙니다' },
  { id: 'etc', label: '그 밖의 자료', note: '' },
];

function groupsWithDocs() {
  return GROUPS
    .map(function (g) {
      const docs = state.library.filter(function (d) { return (d.group || 'etc') === g.id; });
      return { group: g, docs: docs };
    })
    .filter(function (x) { return x.docs.length > 0; });
}

function docCardHtml(d) {
  return (
    '<button class="lib-item" data-doc="' + escapeHtml(d.id) + '">' +
      '<div class="lib-title">' + escapeHtml(d.title) + '</div>' +
      '<div class="lib-meta">' + countLabel(d) + '</div>' +
      '<span class="prayer-chevron">›</span>' +
    '</button>'
  );
}

function renderList(root) {
  root.innerHTML =
    '<div class="section-head"><span>참고자료</span></div>' +
    groupsWithDocs().map(function (x) {
      return (
        '<div class="lib-group">' +
          '<div class="lib-group-head">' +
            '<span class="lib-group-label">' + escapeHtml(x.group.label) + '</span>' +
            (x.group.note ? '<span class="lib-group-note">' + escapeHtml(x.group.note) + '</span>' : '') +
          '</div>' +
          x.docs.map(docCardHtml).join('') +
        '</div>'
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
    // ★ .section-head를 쓰지 않는다. 그 class는 달력·우리반·기도 화면이 함께 쓰는
    //   «작은 회색 머리글»이라, 여기서 flex 배치를 주면 세 화면이 같이 바뀐다.
    //   자료 화면만 «‹ 제목 ☰» 세 칸 배치가 필요하므로 전용 class를 둔다.
    '<div class="lib-head">' +
      '<button class="icon-btn" id="lib-back" aria-label="목록으로">‹</button>' +
      '<span class="lib-head-title">' + escapeHtml(doc.shortTitle || doc.title) + '</span>' +
      '<button class="icon-btn" id="lib-menu" aria-label="다른 자료·목차">☰</button>' +
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
  el('#lib-menu').onclick = function () { openNavSheet(root, doc); };
  const q = el('#lib-q');
  q.oninput = function () {
    // 대요리문답은 196문답(162KB)이라 키 입력마다 재렌더하면 저사양 폰에서 버벅인다.
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { applySearch(root, id, q); }, 180);
  };
}

/**
 * ☰ — «다른 자료»와 «목차»를 한 장에 담은 시트.
 *
 * 왜 필요한가: 예전에는 자료를 보다가 다른 자료로 가려면 목록까지 되돌아
 * 나와야 했다(2026-07-31 요청: "다른 자료는 다시 되돌아 나와서 봐야 해서 불편해").
 *
 * ★ 배치가 좌우 2단이다 (2026-07-31 2차 요청 — 사용자가 원하는 형태를 사진으로 지정).
 *   처음에는 «휴대폰 폭에서 양쪽 다 좁아진다»는 이유로 위아래 1단이었다.
 *
 * ★ 두 단을 각각 <div>로 감싸는 것이 필수다. 지금처럼 제목·버튼이 평면으로
 *   나열된 상태에서 부모에 grid를 걸면 **그 전부가 좌·우로 번갈아 꽂힌다**
 *   (문서 버튼이 양쪽에 섞인다). 배치만 바꾸면 되는 일이 아니다.
 */
function openNavSheet(root, doc) {
  const others = groupsWithDocs().map(function (x) {
    return (
      '<div class="sheet-group">' + escapeHtml(x.group.label) + '</div>' +
      x.docs.map(function (d) {
        const on = d.id === doc.id ? ' on' : '';
        return '<button class="nav-doc' + on + '" data-goto-doc="' + escapeHtml(d.id) + '">' +
          escapeHtml(d.title) + '</button>';
      }).join('')
    );
  }).join('');

  const units = doc.type === 'catechism' ? (doc.items || []) : (doc.sections || []);
  const toc = units.map(function (u) {
    const label = doc.type === 'catechism'
      ? (u.no + '문')
      : escapeHtml(u.title || (u.no + '장'));
    const sub = doc.type === 'catechism'
      ? escapeHtml(String(u.q || '').slice(0, 28))
      : ((u.items && u.items.length) ? u.items.length + '항' : '');
    return '<button class="nav-toc" data-goto-unit="' + u.no + '">' +
      '<span class="nav-toc-no">' + label + '</span>' +
      (sub ? '<span class="nav-toc-sub">' + sub + '</span>' : '') +
      '</button>';
  }).join('');

  openSheet(doc.shortTitle || doc.title, '다른 자료로 바로 갈 수 있어요',
    '<div class="nav-sheet">' +
      '<div class="nav-col">' +
        '<div class="nav-sec-title">신조와 고백</div>' +
        '<div class="nav-col-body">' + others + '</div>' +
      '</div>' +
      '<div class="nav-col">' +
        '<div class="nav-sec-title">목차</div>' +
        '<div class="nav-col-body"><div class="nav-toc-list">' + toc + '</div></div>' +
      '</div>' +
    '</div>');

  document.querySelectorAll('[data-goto-doc]').forEach(function (b) {
    b.onclick = function () {
      const id = b.dataset.gotoDoc;
      closeSheet();
      if (id === openDocId) return;
      clearTimeout(searchTimer);
      openDocId = id; query = '';
      render(root);
    };
  });
  document.querySelectorAll('[data-goto-unit]').forEach(function (b) {
    b.onclick = function () {
      const no = b.dataset.gotoUnit;
      closeSheet();
      const target = el('#lib-u-' + no);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    };
  });
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
  if (it.q !== undefined) return (it.q + ' ' + it.a).indexOf(q) >= 0;
  // 항으로 나뉜 문서는 항 본문까지 봐야 한다 — 안 그러면 «몇 장 몇 항»의
  // 내용이 검색되지 않는다.
  const parts = [it.title || ''].concat(it.paras || []);
  (it.items || []).forEach(function (x) {
    parts.push((x.paras || []).join(' '));
  });
  return parts.join(' ').indexOf(q) >= 0;
}

function qaHtml(it) {
  return (
    '<div class="qa" id="lib-u-' + it.no + '">' +
      '<div class="qa-q"><span class="qa-no">' + it.no + '</span>' + escapeHtml(it.q) + '</div>' +
      '<div class="qa-a">' + nl2br(escapeHtml(it.a)) + '</div>' +
      (it.refs && it.refs.length
        ? '<div class="qa-refs">' + escapeHtml(it.refs.join(', ')) + '</div>' : '') +
    '</div>'
  );
}

/**
 * 장(章) 하나. 항(項)으로 나뉜 문서는 «몇 항»을 붙여 보여 준다 (2026-07-31 요청).
 *
 * `items`가 없는 문서(예배모범·12신조)는 예전처럼 문단만 이어서 보여 준다 —
 * 데이터가 additive라 두 형태가 함께 존재할 수 있다.
 */
function chapterHtml(it) {
  const hasItems = Array.isArray(it.items) && it.items.length > 0;
  return (
    '<div class="qa" id="lib-u-' + it.no + '">' +
      '<div class="qa-q">' + escapeHtml(it.title) + '</div>' +
      (hasItems
        ? it.items.map(function (x) {
            return (
              '<div class="lib-sec">' +
                '<div class="lib-sec-no">' + x.no + '항</div>' +
                (x.paras || []).map(function (p) {
                  return '<div class="qa-a">' + nl2br(escapeHtml(p)) + '</div>';
                }).join('') +
                (x.refs && x.refs.length
                  ? '<div class="qa-refs">' + escapeHtml(x.refs.join(' ')) + '</div>' : '') +
              '</div>'
            );
          }).join('')
        : (it.paras || []).map(function (p) {
            return '<div class="qa-a">' + nl2br(escapeHtml(p)) + '</div>';
          }).join('')) +
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
