// web/js/ui.js — 화면 공통 유틸 (DOM 선택, 토스트, 바텀시트, 이스케이프).

export function el(sel, root) {
  return (root || document).querySelector(sel);
}

export function els(sel, root) {
  return Array.from((root || document).querySelectorAll(sel));
}

/**
 * HTML 이스케이프.
 * 사용자가 입력한 문자열(와닿은말씀·결단·기도제목·이름)을 innerHTML로 넣을 때
 * 반드시 통과시킨다. 시트에 저장된 값이라도 다른 사용자가 쓴 것일 수 있다.
 */
export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 줄바꿈을 <br>로. escapeHtml을 먼저 통과한 문자열에만 쓴다. */
export function nl2br(escaped) {
  return String(escaped).split('\n').join('<br>');
}

let toastTimer = null;

export function toast(message) {
  let node = el('#toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.className = 'toast';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2600);
}

/** 바텀시트 열기. bodyHtml은 이미 이스케이프된 안전한 HTML이어야 한다. */
export function openSheet(title, subtitle, bodyHtml) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.id = 'sheet-overlay';
  overlay.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-header">' +
        '<div>' +
          '<div class="sheet-title">' + escapeHtml(title) + '</div>' +
          (subtitle ? '<div class="sheet-sub">' + escapeHtml(subtitle) + '</div>' : '') +
        '</div>' +
        '<button class="sheet-close" aria-label="닫기">✕</button>' +
      '</div>' +
      '<div class="sheet-body">' + bodyHtml + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay || e.target.classList.contains('sheet-close')) closeSheet();
  });
  document.addEventListener('keydown', onEsc);
  return overlay;
}

function onEsc(e) {
  if (e.key === 'Escape') closeSheet();
}

export function closeSheet() {
  const o = el('#sheet-overlay');
  if (o) o.remove();
  document.removeEventListener('keydown', onEsc);
}

/** 'YYYY-MM-DD' → '7월 12일' */
export function shortDate(dateStr) {
  const p = String(dateStr).split('-');
  if (p.length < 3) return String(dateStr);
  return Number(p[1]) + '월 ' + Number(p[2]) + '일';
}

/** 'YYYY-MM' → '2026년 7월' */
export function ymLabel(ym) {
  const p = String(ym).split('-');
  return Number(p[0]) + '년 ' + Number(p[1]) + '월';
}
