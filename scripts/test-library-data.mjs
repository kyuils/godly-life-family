#!/usr/bin/env node
// scripts/test-library-data.mjs
//
// 참고자료 JSON 검증. 계약 docs/specs/2026-07-30-api-contract.md §5.3/§5.4 기준.
// 수집 스크립트(fetch-library.mjs)와 독립적으로 작성한다 — 같은 코드가 만들고 검사하면
// 파서 버그를 잡지 못하기 때문이다.
//
// 실패 시 exit 1. 통과 시 exit 0 + "ALL TESTS PASSED".

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WCF_ITEM_COUNTS } from './lib-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'web', 'data');

let pass = 0;
const failures = [];

function check(label, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    ok = r === true || r === undefined;
    if (typeof r === 'string') { ok = false; detail = r; }
  } catch (e) {
    ok = false;
    detail = String(e && e.message ? e.message : e);
  }
  if (ok) { pass++; console.log('  [PASS] ' + label); }
  else { failures.push(label + (detail ? ' — ' + detail : '')); console.log('  [FAIL] ' + label + (detail ? ' — ' + detail : '')); }
}

// 계약 §5.4 — 하한(>=)이 아니라 정확 일치. 하한은 수집 누락을 잡아내지 못한다.
//
// 근거 등급을 구분한다:
//   [확정] 외부 정본 수치 — 수집 결과와 독립적이므로 누락을 실제로 잡아낸다.
//   [추정] 수집 시점 실측 — 자기참조라 "이번 수집과 같은가"만 본다.
//          그래도 값이 있으면 다음 수집에서 문서 구조가 바뀐 것은 감지한다.
const EXACT_COUNT = {
  wsc: 107,        // [확정] 웨스트민스터 소요리문답의 정본 문항 수
  wlc: 196,        // [확정] 웨스트민스터 대요리문답의 정본 문항 수
  wcf: 33,         // [확정] 웨스트민스터 신앙고백서 33장
  heidelberg: 129, // [확정] 하이델베르크 요리문답 129문답
  worship: 17,     // [추정] 2026-07-30 gapck 수집 실측. 정본 장 수를 확인하지 못했다
  creed: 3,        // [추정] 같은 근거 (서언/신조/승인식으로 나뉘어 있음)
};

const HTML_RESIDUE = ['<p>', '<br', '&nbsp;', '&amp;', '&lt;', '&gt;', '&quot;', '</'];

console.log('=== 참고자료 JSON 검증 (계약 §5.3/§5.4) ===\n');

const indexPath = path.join(DATA_DIR, 'index.json');
check('index.json 존재', () => existsSync(indexPath) || 'not found: ' + indexPath);
if (!existsSync(indexPath)) {
  console.log('\nindex.json이 없어 이후 검증을 진행할 수 없습니다.');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
check('index.json이 배열이고 1개 이상', () => (Array.isArray(index) && index.length > 0) || 'shape mismatch');

for (const entry of index) {
  const id = entry.id;
  console.log('\n--- ' + id + ' (' + entry.title + ') ---');

  for (const k of ['id', 'title', 'shortTitle', 'type', 'count', 'file', 'bytes']) {
    check(id + ': index 항목에 ' + k, () => entry[k] !== undefined && entry[k] !== '' || 'missing ' + k);
  }

  const file = path.join(DATA_DIR, entry.file);
  check(id + ': 파일 존재', () => existsSync(file) || 'not found: ' + entry.file);
  if (!existsSync(file)) continue;

  let doc;
  check(id + ': JSON.parse 성공', () => { doc = JSON.parse(readFileSync(file, 'utf8')); return true; });
  if (!doc) continue;

  check(id + ': index.count와 실제 항목 수 일치', () => {
    const items = doc.type === 'catechism' ? doc.items : doc.sections;
    return (Array.isArray(items) && items.length === entry.count) ||
      'index=' + entry.count + ' actual=' + (Array.isArray(items) ? items.length : 'n/a');
  });

  check(id + ': index.type과 문서 type 일치', () => doc.type === entry.type || doc.type + ' != ' + entry.type);

  // source — license 포함 필수 (계약 §5.4/§5.5)
  const src = doc.source || {};
  for (const k of ['name', 'url', 'fetchedAt', 'license']) {
    check(id + ': source.' + k + ' 비어있지 않음', () =>
      (typeof src[k] === 'string' && src[k].trim().length > 0) || 'empty source.' + k);
  }
  check(id + ': source.licenseConfidence가 확정/추정/제한적 중 하나', () =>
    ['확정', '추정', '제한적'].includes(src.licenseConfidence) || 'got: ' + src.licenseConfidence);
  check(id + ': source.fetchedAt이 YYYY-MM-DD', () =>
    /^\d{4}-\d{2}-\d{2}$/.test(src.fetchedAt || '') || 'got: ' + src.fetchedAt);

  const items = doc.type === 'catechism' ? doc.items : doc.sections;
  check(id + ': items/sections가 비어있지 않은 배열', () =>
    (Array.isArray(items) && items.length > 0) || 'empty');
  if (!Array.isArray(items) || !items.length) continue;

  // 정확 건수
  if (EXACT_COUNT[id] !== undefined) {
    check(id + ': 항목 수 정확히 ' + EXACT_COUNT[id], () =>
      items.length === EXACT_COUNT[id] || 'expected ' + EXACT_COUNT[id] + ', got ' + items.length);
  }

  // 번호 1..n 연속
  check(id + ': no가 1부터 연속', () => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].no !== i + 1) return 'index ' + i + ' has no=' + items[i].no + ' (expected ' + (i + 1) + ')';
    }
    return true;
  });

  // 타입별 필수 필드 + 빈 본문 없음
  if (doc.type === 'catechism') {
    check(id + ': 모든 문답에 q/a가 비어있지 않음', () => {
      for (const it of items) {
        if (!it.q || !String(it.q).trim()) return 'no=' + it.no + ' 질문 비어있음';
        if (!it.a || !String(it.a).trim()) return 'no=' + it.no + ' 답 비어있음';
      }
      return true;
    });
    check(id + ': refs가 배열', () => {
      for (const it of items) if (!Array.isArray(it.refs)) return 'no=' + it.no + ' refs가 배열 아님';
      return true;
    });
    // refs 각 항목은 "롬 11:36" 같은 한 줄짜리 인용이어야 한다. 줄바꿈이 남아 있으면
    // 여러 인용이 한 덩어리로 붙은 파싱 결함이다(2026-07-30 하이델베르크에서 실제 발생).
    check(id + ': refs 항목에 줄바꿈이 없음', () => {
      for (const it of items) {
        for (const r of it.refs) {
          if (/[\r\n]/.test(r)) return 'no=' + it.no + ' refs에 줄바꿈: ' + JSON.stringify(r);
        }
      }
      return true;
    });
    check(id + ': refs 항목이 앞뒤 공백 없이 정규화됨', () => {
      for (const it of items) {
        for (const r of it.refs) {
          if (r !== r.trim() || /\s{2,}/.test(r)) return 'no=' + it.no + ' 정규화 안 됨: ' + JSON.stringify(r);
        }
      }
      return true;
    });
  } else {
    check(id + ': 모든 장에 title과 1개 이상의 para', () => {
      for (const it of items) {
        if (!it.title || !String(it.title).trim()) return 'no=' + it.no + ' title 비어있음';
        if (!Array.isArray(it.paras) || it.paras.length === 0) return 'no=' + it.no + ' paras 비어있음';
        for (const p of it.paras) if (!String(p).trim()) return 'no=' + it.no + ' 빈 문단 포함';
      }
      return true;
    });
  }

  // HTML 잔여물 + 제어문자
  const blob = JSON.stringify(doc);
  check(id + ': HTML 태그/엔티티 잔여물 없음', () => {
    const found = HTML_RESIDUE.filter((t) => blob.includes(t));
    return found.length === 0 || '발견: ' + found.join(', ');
  });
  check(id + ': 널바이트/제어문자 없음', () => {
    // 정규식에 제어문자를 리터럴로 두면 편집기·도구가 조용히 지울 수 있으므로
    // 문자코드로 직접 검사한다. 탭(9)·개행(10)·복귀(13)는 정상 문자로 허용한다.
    for (let i = 0; i < blob.length; i++) {
      const c = blob.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        return '제어문자 U+' + c.toString(16).padStart(4, '0') + ' at ' + i;
      }
    }
    return true;
  });
  check(id + ': 한글이 포함됨 (인코딩 사고 감지)', () => /[가-힣]/.test(blob) || '한글 없음');
}

// ---------------------------------------------------------------------------
// 신도게요서 «항(項)» 구조 (2026-07-31 요청)
// ---------------------------------------------------------------------------
//
// 수집 원문은 «장»까지만 나뉘어 있어 문단이 평평하게 들어온다. 이를 항으로
// 묶는 규칙(scripts/lib-sections.mjs)이 조용히 어긋나면 «몇 장 몇 항»이 전부
// 밀린다. 개수만 세면 각주가 이웃 항으로 넘어간 오류를 못 잡으므로,
// 본문 지문(해시)까지 고정한다. 원문을 코드에 옮겨 적지 않으려고 해시를 쓴다.
{
  const wcf = JSON.parse(readFileSync(path.join(DATA_DIR, 'wcf.json'), 'utf8'));
  const digest = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
  const itemOf = (ch, no) => {
    const sec = wcf.sections.find((s) => s.no === ch);
    return sec && sec.items ? sec.items.find((i) => i.no === no) : null;
  };

  check('wcf: 모든 장에 items가 있다', () =>
    wcf.sections.every((s) => Array.isArray(s.items) && s.items.length > 0) ||
    'items 없는 장: ' + wcf.sections.filter((s) => !(s.items || []).length).map((s) => s.no).join(', '));

  check('wcf: 장별 항 수가 기준과 일치한다 (OPC 판 — 31장은 4항)', () => {
    const wrong = wcf.sections
      .filter((s) => (s.items || []).length !== WCF_ITEM_COUNTS[s.no - 1])
      .map((s) => s.no + '장(기준 ' + WCF_ITEM_COUNTS[s.no - 1] + ' → ' + (s.items || []).length + ')');
    return wrong.length === 0 || wrong.join(', ');
  });

  check('wcf: 총 171항', () => {
    const n = wcf.sections.reduce((a, s) => a + (s.items || []).length, 0);
    return n === 171 || '총 ' + n + '항';
  });

  check('wcf: 항 번호가 1..N 연속이다', () => {
    const bad = wcf.sections.filter((s) =>
      (s.items || []).some((it, i) => it.no !== i + 1));
    return bad.length === 0 || '번호가 어긋난 장: ' + bad.map((s) => s.no).join(', ');
  });

  check('wcf: 본문이 빈 항이 없다', () => {
    const bad = [];
    wcf.sections.forEach((s) => (s.items || []).forEach((it) => {
      if (!Array.isArray(it.paras) || it.paras.length === 0) bad.push(s.no + '-' + it.no);
    }));
    return bad.length === 0 || '빈 항: ' + bad.join(', ');
  });

  check('wcf: 각주가 없는 항이 없다 (후기는 항에서 제외되어야 한다)', () => {
    const bad = [];
    wcf.sections.forEach((s) => (s.items || []).forEach((it) => {
      if (!Array.isArray(it.refs) || it.refs.length === 0) bad.push(s.no + '장 ' + it.no + '항');
    }));
    return bad.length === 0 || '각주 없는 항: ' + bad.join(', ');
  });

  check('wcf: 역문 후기가 항이 아니라 postscript로 분리되어 있다', () =>
    (Array.isArray(wcf.postscript) && wcf.postscript.length === 1) ||
    'postscript: ' + JSON.stringify(wcf.postscript || null));

  check('★ wcf: 전체 지문 — 항의 «내용»이 바뀌지 않았다', () => {
    // ★ 개수 검사만으로는 부족하다. 각주 연속행 «(눅 16:29 …)»을 각주로 보지
    //   않으면 그 줄이 다음 항 본문 맨 앞에 붙는데, **항의 개수는 그대로다.**
    //   (실제로 규칙을 약화시켜 확인했다 — 1장은 여전히 10항이 나온다.)
    //   그래서 대표 항 몇 개가 아니라 **전 171항의 본문·각주 전체**를 지문으로
    //   묶어 고정한다. 어느 항이 한 줄이라도 달라지면 값이 바뀐다.
    const blob = wcf.sections
      .map((s) => (s.items || [])
        .map((i) => i.no + '|' + i.paras.join('\n') + '|' + i.refs.join('\n'))
        .join('\n'))
      .join('\n');
    const expected = '25bb06b7a5577ee7';
    const actual = digest(blob);
    return actual === expected ||
      '기대 ' + expected + ' / 실제 ' + actual +
      ' — 항 분리 규칙이나 원문이 바뀌었습니다. 의도한 변경이면 이 값을 갱신하세요.';
  });

  check('wcf: 기존 paras가 보존되어 있다 (additive — 되돌리기 안전)', () =>
    wcf.sections.every((s) => Array.isArray(s.paras) && s.paras.length > 0) ||
    'paras가 사라진 장이 있다');
}

// index에 없는 데이터 파일이 굴러다니지 않는지
check('web/data에 index 미등재 json 없음', () => {
  const listed = new Set(index.map((e) => e.file).concat(['index.json']));
  const extra = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json') && !listed.has(f));
  return extra.length === 0 || '미등재: ' + extra.join(', ');
});

console.log('\n=== 결과 ===');
console.log('PASS: ' + pass + ', FAIL: ' + failures.length);
if (failures.length) {
  console.log('\nFAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL TESTS PASSED');
