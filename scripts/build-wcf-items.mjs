#!/usr/bin/env node
// scripts/build-wcf-items.mjs — 신도게요서에 «항» 구조를 덧붙인다.
//
// ★ additive: 기존 `paras`를 지우지 않고 `items`를 **추가**한다.
//   `web/data/*`는 서비스워커가 cache-first로 잡아 두므로(계약 §6.2),
//   배포 직후 잠시 «구 JSON + 신 JS» 조합이 생긴다. paras를 남겨 두면
//   그 조합에서도 화면이 죽지 않고, 되돌리기도 파일 하나로 끝난다.
//
// 멱등: 여러 번 실행해도 결과가 같다.
// 실행: node scripts/build-wcf-items.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSections, WCF_ITEM_COUNTS } from './lib-sections.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'web', 'data', 'wcf.json');

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!Array.isArray(doc.sections)) {
  console.error('sections 배열이 없습니다: ' + FILE);
  process.exit(1);
}

const problems = [];
let postscript = null;

doc.sections.forEach(function (sec) {
  const r = splitSections(sec.paras || []);
  sec.items = r.items;
  if (r.postscript.length) postscript = r.postscript;

  const expected = WCF_ITEM_COUNTS[sec.no - 1];
  if (typeof expected !== 'number') {
    problems.push(sec.no + '장: 기준 항 수가 정의되지 않음');
  } else if (r.items.length !== expected) {
    problems.push(sec.no + '장: 기준 ' + expected + '항인데 ' + r.items.length + '항으로 나뉨');
  }
  r.items.forEach(function (it) {
    if (!it.paras.length) problems.push(sec.no + '장 ' + it.no + '항: 본문이 비어 있음');
  });
});

if (postscript) doc.postscript = postscript;

if (problems.length) {
  console.error('=== 중단: 항 분리 결과가 기준과 다릅니다 ===');
  problems.forEach(function (p) { console.error('  - ' + p); });
  console.error('데이터를 억지로 맞추지 않습니다. 규칙이나 기준을 먼저 확인하세요.');
  process.exit(1);
}

fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n', 'utf8');

const total = doc.sections.reduce(function (n, s) { return n + s.items.length; }, 0);
console.log('OK — ' + doc.sections.length + '장 / 총 ' + total + '항' +
  (postscript ? ' / 후기 ' + postscript.length + '문단' : ''));
