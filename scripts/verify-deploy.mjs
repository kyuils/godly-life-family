#!/usr/bin/env node
// scripts/verify-deploy.mjs — 서버(GAS) 배포가 실제로 반영됐는지 **네트워크로** 확인한다.
//
// ★ 왜 필요한가 (2026-08-02 실제 사고)
//   「배포 관리 → ✏ 수정 → 새 버전」이 아니라 **「새 배포」를 누르면 주소가 바뀐다.**
//   그러면 앱은 옛 서버를 계속 부르는데,
//     - 배포 화면은 성공한 것처럼 보이고
//     - 새 주소도 정상 응답하고
//     - 옛 주소도 정상 응답한다
//   그래서 **겉으로는 아무 문제가 없다.** 실제로 이 사고가 났고, 며칠치 수정이
//   운영에 반영되지 않은 채 지나갔다.
//
//   `docs/ops/03-deploy-gas.md`에는 「복사한 주소와 대조하라」고 적혀 있었지만
//   대조 대상이 `AKfycb....` 플레이스홀더라 **처음부터 실행할 수 없는 단계**였다.
//   그 단계를 사람의 눈이 아니라 이 스크립트가 대신한다.
//
// ★ npm test에 넣지 않는 이유: 네트워크가 필요하다. 오프라인에서 실패하는 검사를
//   기본 하네스에 넣으면 곧 무시당한다. 배포 직후에만 손으로 돌린다.
//
// 사용법:  node scripts/verify-deploy.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function fail(msg, hint) {
  console.log('\n  [실패] ' + msg);
  if (hint) console.log('\n  ' + hint.split('\n').join('\n  '));
  console.log('');
  process.exit(1);
}

console.log('=== 서버 배포 확인 ===\n');

// 1) 앱이 부르는 주소
const cfg = read('web/js/config.js');
const m = /GAS_URL:\s*'(https:\/\/script\.google\.com\/macros\/s\/([^/']+)\/exec)'/.exec(cfg);
if (!m) fail('web/js/config.js에서 GAS_URL을 읽지 못했습니다.');
const url = m[1];
const deployId = m[2];

// 2) 저장소가 기대하는 서버 버전
const codeGs = read('gas/Code.gs');
const bt = /BUILD_TAG\s*=\s*'([^']+)'/.exec(codeGs);
if (!bt) fail('gas/Code.gs에서 BUILD_TAG를 읽지 못했습니다.');
const expected = bt[1];

console.log('  앱이 부르는 배포 : ' + deployId.slice(0, 16) + '…');
console.log('  기대하는 서버 버전: ' + expected + '   (gas/Code.gs 기준)\n');

// 3) 실제로 물어본다
let body;
try {
  const res = await fetch(url, { redirect: 'follow' });
  body = await res.text();
} catch (e) {
  fail('서버에 연결하지 못했습니다: ' + e.message,
    '인터넷 연결을 확인하고 다시 실행해 주세요.');
}

let json;
try {
  json = JSON.parse(body);
} catch (e) {
  // 구글 로그인 페이지가 오면 배포 설정이 틀린 것이다.
  const looksLikeLogin = /accounts\.google\.com|로그인|Sign in/i.test(body);
  fail('서버가 JSON이 아닌 것을 돌려줬습니다.',
    looksLikeLogin
      ? '구글 로그인 화면으로 보입니다 → 배포 설정을 «나(소유자)로 실행 / 모든 사용자 접근»으로\n고쳐야 합니다 (docs/ops/03-deploy-gas.md 5단계).'
      : '구글 쪽 일시적 오류일 수 있습니다. 한 번 더 실행해 보세요.\n받은 내용 앞부분: ' + body.slice(0, 120));
}

if (!json.ok) fail('서버가 ok:false를 돌려줬습니다: ' + JSON.stringify(json).slice(0, 200));

console.log('  실제 서버 응답   : build=' + json.build + ' (service=' + json.service + ')\n');

if (json.build !== expected) {
  fail('앱이 부르는 서버가 ' + json.build + ' 입니다. 기대값은 ' + expected + ' 입니다.',
    '가장 흔한 원인은 **「새 배포」를 만든 것**입니다.\n' +
    '「새 배포」는 주소를 새로 만들기 때문에, 앱은 옛 주소(=옛 코드)를 계속 부릅니다.\n\n' +
    '확인 순서:\n' +
    ' 1. Apps Script → 배포 → 배포 관리 → 목록에 배포가 **몇 개**인지 봅니다\n' +
    ' 2. 앱이 부르는 것은 ' + deployId.slice(0, 16) + '… 로 시작하는 배포입니다\n' +
    ' 3. **그 배포를** ✏ 수정 → 버전 «새 버전» → 배포 하세요\n' +
    '    (다른 배포를 고치면 앱에는 아무 변화가 없습니다)\n' +
    ' 4. 그래도 옛 버전이면 편집기의 gas/Code.gs 첫머리가\n' +
    "    const BUILD_TAG = '" + expected + "'; 인지 눈으로 확인하세요 —\n" +
    '    아니면 코드 붙여넣기부터 다시 해야 합니다.');
}

console.log('  ✅ 앱이 부르는 서버가 기대한 버전(' + expected + ')입니다.\n');
process.exit(0);
