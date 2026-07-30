#!/usr/bin/env node
// scripts/mock-server.mjs — 로컬 미리보기 서버.
//
// web/ 을 정적 서빙하고, /api 로 오는 POST는 gas-harness의 모의 백엔드로 넘긴다.
// 즉 실제 GAS 코드(gas/*.gs)가 그대로 돌아가므로 화면과 백엔드를 함께 확인할 수 있다.
//
// 실행:  node scripts/mock-server.mjs 8788
// 사용:  web/js/config.js 를 임시로
//          GAS_URL: '/api', MOCK: 'student1@example.com'
//        으로 바꾼 뒤 http://localhost:8788 접속.
//        교사 화면은 MOCK: 'teacher@example.com'.
//        ★ 커밋 전 반드시 placeholder로 복원한다 (scripts/check-web.mjs가 검사).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './gas-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..', 'web');
const PORT = Number(process.argv[2] || 8788);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// 시연용 시드 — 오늘 기준으로 최근 기록이 보이도록 만든다.
function seed() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  function addDays(d, n) {
    const p = d.split('-').map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  const records = {};
  for (let i = 1; i <= 12; i++) {
    const date = addDays(today, -i);
    if (i === 4 || i === 9) continue; // 빈 날을 섞어 연속기록이 끊기는 모습을 본다
    const key = 'RECORDS_' + date.slice(0, 7);
    if (!records[key]) records[key] = [];
    records[key].push({
      '날짜': date, email: 'student1@example.com', '이름': '김믿음', '구분': '학생',
      '말씀읽음': 'TRUE', '와닿은말씀': '“내가 산을 향하여 눈을 들리라” (시 121:1)',
      '결단': '오늘 하루 조급해지지 않고 먼저 기도하겠습니다.',
      '중보기도': i % 2 === 0 ? 'TRUE' : 'FALSE',
      '기록시각': date + 'T09:00:00.000Z', '수정시각': date + 'T09:00:00.000Z',
    });
  }
  return {
    students: [
      { email: 'student1@example.com', '이름': '김믿음', '학년반': '중2-1', active: 'TRUE', '가입시각': addDays(today, -120), '가입경로': 'self' },
      { email: 'student2@example.com', '이름': '이소망', '학년반': '중3-2', active: 'TRUE', '가입시각': addDays(today, -60), '가입경로': 'self' },
    ],
    parents: [
      { email: 'parent1@example.com', '이름': '박은혜', '자녀이름': '김믿음', active: 'TRUE', '가입시각': addDays(today, -90), '가입경로': 'self' },
    ],
    teachers: [
      { email: 'teacher@example.com', '이름': '황교사', '역할': 'admin', active: 'TRUE', '가입시각': addDays(today, -200) },
    ],
    prayers: [
      { '기도ID': 'Pseed000000000001', '등록일': addDays(today, -20), email: 'student1@example.com', '이름': '김믿음', '구분': '학생',
        '기도제목': '기말고사를 잘 준비할 수 있도록 기도해 주세요.', '상태': '응답됨', '응답일': addDays(today, -5), '수정시각': '', '삭제여부': '' },
      { '기도ID': 'Pseed000000000002', '등록일': addDays(today, -3), email: 'student1@example.com', '이름': '김믿음', '구분': '학생',
        '기도제목': '친구와 다툰 일을 잘 풀 수 있도록 기도 부탁드려요.', '상태': '진행중', '응답일': '', '수정시각': '', '삭제여부': '' },
    ],
    records: records,
  };
}

const harness = createHarness(seed());

const server = http.createServer(function (req, res) {
  if (req.url.split('?')[0] === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      let out;
      try {
        out = harness.callAction(JSON.parse(body || '{}'));
      } catch (e) {
        out = { ok: false, code: 'server_error' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, rel);
  // 디렉터리 탈출 방지
  if (!file.startsWith(WEB)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('미리보기: http://localhost:' + PORT);
  console.log('  (web/js/config.js 의 GAS_URL을 \'/api\', MOCK을 \'student1@example.com\' 으로 임시 변경 필요)');
});
