#!/usr/bin/env node
// scripts/fetch-library.mjs
//
// 참고자료(개혁주의 신앙고백 문서) 수집 스크립트.
// - 출처 A: 대한예수교장로회(합동) 총회 전자자료실 JSON API (신도게요서·소요리문답·대요리문답·예배모범·신조)
// - 출처 B: 하이델베르크 요리문답(129문답) - heidelberg-catechism.com 한국어 공개 번역본
//
// Node 18+ 내장 fetch만 사용, 외부 의존성 없음. 재실행 가능(멱등) - 실행할 때마다
// 원격에서 새로 받아 web/data/*.json을 덮어쓴다.
//
// 실행: node scripts/fetch-library.mjs
//
// 스키마·계약 근거: docs/specs/2026-07-30-api-contract.md 5장

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'web', 'data');

const UA = 'Mozilla/5.0 (compatible; godly-life-app-fetch-library/1.0)';

function todayKST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// HTML -> 텍스트 공용 유틸
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  var out = s;
  out = out.split('&nbsp;').join(' ');
  out = out.split('&ldquo;').join('“');
  out = out.split('&rdquo;').join('”');
  out = out.split('&lsquo;').join('‘');
  out = out.split('&rsquo;').join('’');
  out = out.split('&mdash;').join('—');
  out = out.split('&ndash;').join('–');
  out = out.split('&hellip;').join('…');
  out = out.split('&amp;').join('&');
  out = out.split('&lt;').join('<');
  out = out.split('&gt;').join('>');
  out = out.split('&quot;').join('"');
  out = out.split('&#39;').join("'");
  return out;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '');
}

function collapseSpaces(s) {
  return s.replace(/[ \t]+/g, ' ');
}

var NEWLINE = String.fromCharCode(10);

/**
 * HTML 조각을 "줄" 배열로 분해한다. <br>, </p>, </div>, </li> 를 줄 경계로 취급하고
 * 남은 태그는 모두 제거한다. 각 줄은 트림 + 엔티티 디코드 + 공백 정규화까지 마친 상태로 반환.
 * 빈 줄은 제외한다. 경계 마커로는 항상 개행(\n) 하나만 사용한다.
 */
function htmlToLines(html) {
  var s = html.split('\r\n').join(NEWLINE);
  s = s.replace(/<br\s*\/?>/gi, NEWLINE);
  s = s.replace(/<\/p>/gi, NEWLINE).replace(/<p[^>]*>/gi, '');
  s = s.replace(/<\/div>/gi, NEWLINE).replace(/<div[^>]*>/gi, '');
  s = s.replace(/<\/li>/gi, NEWLINE).replace(/<li[^>]*>/gi, '');
  s = s.replace(/<\/?ol[^>]*>/gi, '').replace(/<\/?ul[^>]*>/gi, '');
  var rawLines = s.split(NEWLINE);
  var lines = [];
  for (var i = 0; i < rawLines.length; i++) {
    var noTags = stripTags(rawLines[i]);
    var decoded = decodeEntities(noTags);
    var line = collapseSpaces(decoded).trim();
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * "장절형" 문서(신도게요서·예배모범·신조)용: HTML 조각을 문단 배열로 변환한다.
 * <p>/<li> 경계를 문단 경계로 취급한다. <ol><li> 의 자동 번호 매김은 원문 HTML
 * 마크업이 문서마다 일관되지 않아(예: 신도게요서 1장은 <ol> 그룹이 항목 수와
 * 어긋나게 쪼개져 있음) 프로그램적으로 재구성하지 않는다 - 존재하지 않는 번호를
 * 지어내는 위험이 더 크다고 판단했다. 대신 원문에 번호가 이미 박혀 있는 문서
 * (예: 12신조 본문)는 그 번호가 그대로 텍스트에 보존된다.
 */
function htmlToParas(html) {
  return htmlToLines(html);
}

// ---------------------------------------------------------------------------
// 출처 A - gapck.org (대한예수교장로회 합동 총회 전자자료실)
// ---------------------------------------------------------------------------

var GAPCK_BASE = 'https://gapck.org/api/v1/eMARKDOWN_USER_LIST';
var GAPCK_PARENT_CD = 'EL-총회헌법';
var GAPCK_REFERER = 'https://gapck.org/library/general-assembly-constitution';
var GAPCK_PAGE_LIMIT = 250;
var GAPCK_SOURCE_NAME = '대한예수교장로회(합동) 총회 전자자료실';

// 2026-07-30 gapck.org를 브라우저로 렌더링해 하단 footer를 직접 확인한 결과 그대로.
// (Claude Browser로 https://gapck.org 렌더링 후 DOM에서 footer 텍스트를 읽음)
// 재사용·재배포를 허용한다는 문구는 사이트 어디에서도 발견하지 못했다 - 이 앱은
// GitHub Pages로 공개 배포되므로, 실제 배포 전에 총회 측에 재사용 허락을 구하는 것을
// 권장한다(법적 판단은 이 스크립트의 몫이 아니라 사람이 내려야 한다).
var GAPCK_LICENSE = 'Copyright ⓒ 대한예수교장로회총회. All Rights Reserved. (gapck.org 사이트 하단 footer, 2026-07-30 직접 확인)';
var GAPCK_LICENSE_CONFIDENCE = '확정';
var GAPCK_LICENSE_CAVEAT =
  '사이트 footer에 전체 저작권 표기만 있고, 재사용·재배포를 허락하는 별도 문구(공개/CC/자유이용)는' +
  ' 발견하지 못했다. 이 저장소는 GitHub Pages로 공개 배포되므로 실제 배포 전 총회 측 재사용 허락' +
  ' 확인을 권장한다.';

var GAPCK_DOCS = [
  { no: 3, id: 'wcf', title: '웨스트민스터 신앙고백서', shortTitle: '신도게요서', type: 'chapters', expectedCount: 33 },
  { no: 2, id: 'wsc', title: '웨스트민스터 소요리문답', shortTitle: '소요리문답', type: 'catechism', expectedCount: 107 },
  { no: 8, id: 'wlc', title: '웨스트민스터 대요리문답', shortTitle: '대요리문답', type: 'catechism', expectedCount: 196 },
  { no: 4, id: 'worship', title: '예배모범', shortTitle: '예배모범', type: 'chapters', expectedCount: null },
  { no: 6, id: 'creed', title: '12신조', shortTitle: '신조', type: 'chapters', expectedCount: null },
];

async function fetchGapckCategory(categoryNo) {
  var items = [];
  var skip = 0;
  var total = Infinity;
  var apiTotal = null;
  while (skip < total) {
    var url =
      GAPCK_BASE +
      '?parent_table_cds%5B%5D=' + encodeURIComponent(GAPCK_PARENT_CD) +
      '&parent_table_noes%5B%5D=' + categoryNo +
      '&skip=' + skip + '&limit=' + GAPCK_PAGE_LIMIT + '&sort=1';
    var res = await fetch(url, {
      headers: { Referer: GAPCK_REFERER, 'User-Agent': UA },
    });
    if (!res.ok) {
      throw new Error('gapck API ' + res.status + ' (category=' + categoryNo + ', skip=' + skip + ')');
    }
    var data = await res.json();
    if (data.code !== 200) {
      throw new Error('gapck API code=' + data.code + ' (category=' + categoryNo + ', skip=' + skip + ')');
    }
    items = items.concat(data.list);
    if (apiTotal === null) apiTotal = typeof data.count === 'number' ? data.count : null;
    total = typeof data.count === 'number' ? data.count : items.length;
    skip += GAPCK_PAGE_LIMIT;
    if (data.list.length === 0) break; // 안전장치: 무한루프 방지
    await sleep(150);
  }
  var rawTotal = items.length;
  var filtered = items.filter(function (it) {
    return it.del_yn !== 'Y';
  });
  return { items: filtered, rawTotal: rawTotal, apiTotal: apiTotal, deletedCount: rawTotal - filtered.length };
}

/**
 * refs 항목은 "롬 11:36" 같은 한 줄짜리 인용 문자열이어야 한다.
 * 원문 각주는 줄바꿈과 구분자가 뒤섞여 있어서(예: "살전 5:9-10\r\n 고전 6:19-20")
 * 구분자만으로 자르면 여러 인용이 한 덩어리로 붙는다. 줄바꿈도 항상 경계로 취급하고
 * 남은 공백류는 전부 단일 공백으로 정규화한다.
 */
function splitRefs(text, separator) {
  return String(text)
    .split(/[\r\n]+/)
    .join(separator)
    .split(separator)
    .map(function (s) {
      return s.replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim();
    })
    .filter(Boolean);
}

// 문답형(소요리·대요리): 제목 "12. 질문내용?" -> no/q 분리. 본문 끝의 성경 인용 괄호를 refs로 분리.
function parseCatechismEntry(raw) {
  var titleMatch = raw.markdown_title.match(/^(\d+)\.\s*([\s\S]+)$/);
  var no = titleMatch ? parseInt(titleMatch[1], 10) : null;
  var q = titleMatch ? titleMatch[2].trim() : raw.markdown_title.trim();

  var lines = htmlToLines(raw.markdown_cont);
  var text = lines.join(NEWLINE);

  var refsMatch = text.match(/\(([^()]+)\)\s*$/);
  var a = text;
  var refs = [];
  if (refsMatch) {
    var inner = refsMatch[1];
    var hasDigit = /\d/.test(inner);
    var plausibleCharset = /^[가-힣a-zA-Z0-9:;∼~\-.,\s]+$/.test(inner);
    if (hasDigit && plausibleCharset) {
      refs = splitRefs(inner, ',');
      a = text.slice(0, refsMatch.index);
    }
  }
  // 답 본문은 연속된 산문이므로 개행을 공백으로 합친다.
  a = collapseSpaces(a.split(NEWLINE).join(' ')).trim();

  return { no: no, q: q, a: a, refs: refs };
}

// 장절형(신도게요서·예배모범·신조): sections 배열. no는 응답 순서(1부터).
function parseChapterEntry(raw, index) {
  var title = raw.markdown_title.trim();
  var paras = htmlToParas(raw.markdown_cont);
  return { no: index + 1, title: title, paras: paras };
}

async function buildGapckDoc(cfg) {
  var fetched = await fetchGapckCategory(cfg.no);
  var raws = fetched.items;
  var doc = {
    id: cfg.id,
    title: cfg.title,
    shortTitle: cfg.shortTitle,
    type: cfg.type,
    source: {
      name: GAPCK_SOURCE_NAME,
      url: GAPCK_REFERER,
      fetchedAt: todayKST(),
      license: GAPCK_LICENSE,
      licenseConfidence: GAPCK_LICENSE_CONFIDENCE,
      note: '교단(예장합동) 총회 전자자료실 공개 자료. ' + GAPCK_LICENSE_CAVEAT,
    },
  };
  var count;
  if (cfg.type === 'catechism') {
    doc.items = raws.map(parseCatechismEntry);
    count = doc.items.length;
  } else {
    doc.sections = raws.map(parseChapterEntry);
    count = doc.sections.length;
  }

  var countProblems = [];
  if (fetched.apiTotal !== null && fetched.rawTotal !== fetched.apiTotal) {
    countProblems.push(
      cfg.id + ': API count=' + fetched.apiTotal + ' 인데 실제로 받은 행 수=' + fetched.rawTotal + ' (페이지네이션 누락 의심)'
    );
  }
  if (fetched.deletedCount > 0) {
    countProblems.push(cfg.id + ': del_yn=Y로 제외한 행 ' + fetched.deletedCount + '건');
  }
  if (cfg.expectedCount !== null && cfg.expectedCount !== undefined && count !== cfg.expectedCount) {
    countProblems.push(cfg.id + ': 기대 건수(' + cfg.expectedCount + ') != 실제 건수(' + count + ') - 정확 일치 아님, 조작하지 않고 그대로 보고');
  }

  return { doc: doc, count: count, countProblems: countProblems };
}

// ---------------------------------------------------------------------------
// 출처 B - 하이델베르크 요리문답 (heidelberg-catechism.com 한국어 번역)
// ---------------------------------------------------------------------------

var HC_BASE = 'https://www.heidelberg-catechism.com/ko/lords-days/';
var HC_LORDS_DAYS = 52; // 1~52주일, 총 129문답
var HC_SOURCE_NAME = 'Heidelberg-Catechism.com 한국어역 (후원: Canadian Reformed Theological Seminary)';
var HC_SOURCE_NOTE =
  '예장합동 공인 번역이 아님. Heidelberg-Catechism.com에 게시된 한국어 공개 번역본(제1~52주일, ' +
  'lords-days/1.html ~ 52.html)에서 수집. 번역자·번역연도는 사이트에 별도 명시되어 있지 않으며, ' +
  '페이지 하단에 "저작권 2010" 표기가 있음. 캐나다 개혁교단(Canadian Reformed) 계열 신학교 후원 사이트.';

// ---------------------------------------------------------------------------
// 라이선스 게이트 (2026-07-30 시니어 검토 반영)
//
// 이 저장소는 GitHub Pages로 "공개 배포"된다 - 즉 수집한 본문을 재배포하는 것이다.
// 하이델베르크 요리문답 원문(1563)은 저작권이 소멸했지만, 한글 "번역"은 번역자·
// 발행처의 별도 저작권 대상일 수 있다. 아래는 실제로 확인한 후보 출처와 그 결과다.
// 확인한 어느 후보에서도 "재사용/재배포 자유" 를 명시한 문구를 찾지 못했으므로,
// 이 조사 결과는 아래 "사용자 결정" 항목으로 이어진다.
//
// 확인한 후보:
//   1) heidelberg-catechism.com/ko (본 스크립트가 실제로 파싱하는 대상)
//      - 각 주일(Lord's Day) 페이지 하단: "저작권 2010"
//      - 사이트 전역 footer: "© 2026 모든 저작권은 보호되어 있습니다." (all rights reserved)
//      - 재사용 허락 문구 없음. 후원: Canadian Reformed Theological Seminary
//   2) CRCNA(Christian Reformed Church in North America) 공식 한글 번역 PDF (2012)
//      https://www.crcna.org/sites/default/files/Heidelberg%20Catechism%20Korean%20tr-2012.pdf
//      - PDF 내부에 permissions@faithaliveresources.org 링크 2건 발견
//        → 통상 "재사용 시 허가 요청" 관행을 시사(= 자유 이용 아님을 시사하는 정황)
//   3) 한국어 위키문헌(ko.wikisource.org) - 검색 결과 문서 없음(등재 안 됨)
//   4) koreancrc.com/hc - 별도 직접 검증하지 않음(1)과 동일 계열 번역일 가능성이 높아
//      우선순위 낮음
//
// ---------------------------------------------------------------------------
// 2026-07-30 사용자 결정
//
// 위 조사 결과(자유 이용 허락 문구 없음)를 사용자에게 그대로 보고했고, 사용자는
// 합동 총회 자료와 "동일하게 처리"(본문 포함 + 출처·저작권 명시)하기로 결정했다.
// 따라서 heidelberg.json을 생성한다.
//
// 플래그 이름을 CONFIRMED_FREE로 두지 않는 이유: 이용 조건은 여전히 "확인되지 않았다".
// 확인되었다고 적으면 다음 검토자가 틀린 근거로 판단하게 된다. licenseConfidence는
// '제한적'을 유지하고, 앱의 자료 화면은 이 값을 그대로 노출한다(계약 §5.5, §7).
// 총회/번역처의 요청이 있으면 이 플래그를 false로 되돌리고 재실행하면 파일이 빠진다.
var HC_INCLUDE = true;
var HC_LICENSE =
  '저작권 2010 (각 주일 페이지 하단) / "© 2026 모든 저작권은 보호되어 있습니다." (사이트 footer). ' +
  '재사용·재배포 허락 문구는 확인하지 못함 — 2026-07-30 직접 확인.';
var HC_LICENSE_CONFIDENCE = '제한적';

function parseHcTable(block) {
  var noMatch = block.match(/class="number">(\d+)\./);
  var qMatch = block.match(/<h2>([\s\S]*?)<\/h2>/);
  var aMatch = block.match(/답<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/);
  var fnMatch = block.match(/class="ld-footnotes">([\s\S]*?)<\/td>/);
  if (!noMatch || !qMatch || !aMatch) return null;

  var no = parseInt(noMatch[1], 10);
  var q = htmlToLines(qMatch[1]).join(' ');

  var aHtmlNoSup = aMatch[1].replace(/<sup>\d+<\/sup>/gi, '');
  var a = htmlToLines(aHtmlNoSup).join(NEWLINE);

  var refs = [];
  if (fnMatch) {
    var fnHtmlFlat = fnMatch[1].replace(/<sup>\d+<\/sup>/gi, '');
    var fnText = decodeEntities(stripTags(fnHtmlFlat));
    refs = splitRefs(fnText, ';');
  }

  return { no: no, q: q, a: a, refs: refs };
}

async function fetchHeidelberg() {
  var all = [];
  for (var ld = 1; ld <= HC_LORDS_DAYS; ld++) {
    var res = await fetch(HC_BASE + ld + '.html', { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      throw new Error('heidelberg-catechism.com ' + res.status + ' (lords-day=' + ld + ')');
    }
    var html = await res.text();
    var tableRe = /<table class="question-and-answer">([\s\S]*?)<\/table>/g;
    var m;
    while ((m = tableRe.exec(html))) {
      var item = parseHcTable(m[1]);
      if (item) all.push(item);
    }
    await sleep(150);
  }
  all.sort(function (a, b) { return a.no - b.no; });
  return all;
}

async function buildHeidelbergDoc() {
  console.log('  [heidelberg] 제1~52주일 페이지 수집 중... (데이터 완전성만 확인, 라이선스 미확인 - 아래 참고)');
  var items = await fetchHeidelberg();
  var nos = items.map(function (it) { return it.no; });
  var expected = [];
  for (var i = 1; i <= 129; i++) expected.push(i);
  var missing = expected.filter(function (n) { return nos.indexOf(n) === -1; });
  var dupes = nos.filter(function (n, i) { return nos.indexOf(n) !== i; });
  var dataComplete = items.length === 129 && missing.length === 0 && dupes.length === 0;

  console.log('    수집된 문답 수: ' + items.length + ' (기대: 129, 정확 일치: ' + (items.length === 129 ? '예' : '아니오') + ')');
  if (missing.length) console.log('    누락된 번호: ' + missing.join(', '));
  if (dupes.length) console.log('    중복된 번호: ' + dupes.join(', '));

  if (!dataComplete) {
    console.error('  [heidelberg] 데이터 완전성 검증 실패 - heidelberg.json을 생성하지 않습니다.');
    return { doc: null, count: items.length, dataComplete: false, included: false };
  }

  if (!HC_INCLUDE) {
    console.log('  [heidelberg] 데이터는 129문답 전부 정확히 수집됨. 그러나 HC_INCLUDE=false 이므로');
    console.log('    heidelberg.json을 생성하지 않습니다(스크립트 상단 "사용자 결정" 주석 참고).');
    return { doc: null, count: items.length, dataComplete: true, included: false };
  }

  var doc = {
    id: 'heidelberg',
    title: '하이델베르크 요리문답',
    shortTitle: '하이델베르크 요리문답',
    type: 'catechism',
    source: {
      name: HC_SOURCE_NAME,
      url: HC_BASE + '1.html',
      fetchedAt: todayKST(),
      license: HC_LICENSE,
      licenseConfidence: HC_LICENSE_CONFIDENCE,
      note: HC_SOURCE_NOTE,
    },
    items: items,
  };
  return { doc: doc, count: items.length, dataComplete: true, licenseConfirmed: true };
}

// ---------------------------------------------------------------------------
// 검증 유틸 (자체 점검 - 실패해도 파일은 쓰되 콘솔에 경고)
// ---------------------------------------------------------------------------

function checkSequential(items, label) {
  var nos = items.map(function (it) { return it.no; }).slice().sort(function (a, b) { return a - b; });
  var problems = [];
  for (var i = 0; i < nos.length; i++) {
    if (nos[i] !== i + 1) {
      problems.push(label + ': 번호가 1부터 연속이 아님 (기대 ' + (i + 1) + ', 실제 ' + nos[i] + ')');
      break;
    }
  }
  var dupes = nos.filter(function (n, i) { return nos.indexOf(n) !== i; });
  if (dupes.length) problems.push(label + ': 중복 번호 ' + Array.from(new Set(dupes)).join(', '));
  return problems;
}

function checkHtmlResidue(str, label) {
  if (/<p[ >]|<br|&nbsp;/i.test(str)) {
    return [label + ': HTML 태그/엔티티 잔여물 발견'];
  }
  return [];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  var results = [];
  var warnings = [];

  var exactCountReport = [];

  for (var gi = 0; gi < GAPCK_DOCS.length; gi++) {
    var cfg = GAPCK_DOCS[gi];
    console.log('[' + cfg.id + '] ' + cfg.title + ' (' + cfg.shortTitle + ') 수집 중...');
    var built = await buildGapckDoc(cfg);
    console.log('  -> ' + built.count + '건' + (cfg.expectedCount != null ? ' (기대 ' + cfg.expectedCount + '건)' : ''));

    var allText = JSON.stringify(built.doc);
    warnings = warnings.concat(checkHtmlResidue(allText, cfg.id));
    if (cfg.type === 'catechism') {
      warnings = warnings.concat(checkSequential(built.doc.items, cfg.id));
    }
    warnings = warnings.concat(built.countProblems);

    exactCountReport.push({
      id: cfg.id,
      expected: cfg.expectedCount,
      actual: built.count,
      match: cfg.expectedCount == null ? null : cfg.expectedCount === built.count,
    });

    results.push({ cfg: cfg, doc: built.doc, count: built.count });
    await sleep(150);
  }

  console.log('[heidelberg] 하이델베르크 요리문답 수집 중...');
  var hc = await buildHeidelbergDoc();
  exactCountReport.push({ id: 'heidelberg', expected: 129, actual: hc.count, match: hc.count === 129 });
  if (hc.doc) {
    console.log('  -> ' + hc.count + '건, heidelberg.json 생성');
    warnings = warnings.concat(checkHtmlResidue(JSON.stringify(hc.doc), 'heidelberg'));
    warnings = warnings.concat(checkSequential(hc.doc.items, 'heidelberg'));
    results.push({
      cfg: { id: 'heidelberg', title: '하이델베르크 요리문답', shortTitle: '하이델베르크 요리문답', type: 'catechism' },
      doc: hc.doc,
      count: hc.count,
    });
  } else {
    console.log('  -> heidelberg.json 생성 건너뜀 (' + (hc.dataComplete ? 'HC_INCLUDE=false' : '데이터 완전성 검증 실패') + ')');
  }

  // 파일 기록
  var indexEntries = [];
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    var fileName = r.cfg.id + '.json';
    var json = JSON.stringify(r.doc, null, 1);
    await writeFile(path.join(OUT_DIR, fileName), json, 'utf8');
    indexEntries.push({
      id: r.cfg.id,
      title: r.doc.title,
      shortTitle: r.doc.shortTitle,
      type: r.doc.type,
      count: r.count,
      file: fileName,
      bytes: Buffer.byteLength(json, 'utf8'),
    });
  }

  var indexJson = JSON.stringify(indexEntries, null, 1);
  await writeFile(path.join(OUT_DIR, 'index.json'), indexJson, 'utf8');

  console.log('');
  console.log('=== 수집 결과 ===');
  for (var ei = 0; ei < indexEntries.length; ei++) {
    var e = indexEntries[ei];
    console.log('  ' + e.id.padEnd(10) + ' ' + String(e.count).padStart(4) + '건  ' + e.file + '  (' + e.bytes + ' bytes)');
  }
  if (!hc.doc) {
    console.log('  heidelberg  (생성 안 됨 - ' + (hc.dataComplete ? '라이선스 미확인' : '데이터 완전성 검증 실패') + ')');
  }

  console.log('');
  console.log('=== 정확 건수 검증 (기대치 = 실제치) ===');
  for (var qi = 0; qi < exactCountReport.length; qi++) {
    var q = exactCountReport[qi];
    var matchLabel = q.match === null ? '(기대치 없음)' : q.match ? '일치' : '불일치!';
    console.log('  ' + q.id.padEnd(10) + ' 기대=' + String(q.expected).padStart(4) + '  실제=' + String(q.actual).padStart(4) + '  ' + matchLabel);
  }

  if (warnings.length) {
    console.log('');
    console.log('=== 경고 ===');
    for (var wi = 0; wi < warnings.length; wi++) console.log('  - ' + warnings[wi]);
  } else {
    console.log('');
    console.log('경고 없음.');
  }

  console.log('');
  console.log('index.json 기록 완료 (' + indexEntries.length + '개 문서).');
}

main().catch(function (err) {
  console.error('수집 실패:', err);
  process.exitCode = 1;
});
