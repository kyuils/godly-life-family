#!/usr/bin/env node
// scripts/build-creeds.mjs — 보편 신조(사도신경·니케아 신경) 자료 파일 생성.
//
// 이 두 문서는 gapck.org 총회헌법 자료실에 «별도 문서»로 존재하지 않는다
// (2026-07-31 전 카테고리 조사로 확인: 정치·권징조례·예배모범·신도게요서·
//  대소요리문답·12신조·신학정체성 선언문이 전부다). 그래서 따로 수록한다.
//
// 출처
//  - 사도신경: 대한예수교장로회 총회가 **총회 결의(89·95·96회)에 따라 전국
//    교회에 사용을 공표한 본문**. 총회 교육국 게시물 이미지에서 옮겼다.
//    (총회장·교육부장·신학부장 명의로 "총회 성도는 다음 본문을 사용하셔야
//     합니다"라고 공표된 예배용 공인문이다.)
//  - 니케아 신경: 담임교사가 직접 제공한 본문(니케아-콘스탄티노폴리스 신경,
//    381년). 이 저장소가 임의로 수집한 것이 아니다.
//
// 실행: node scripts/build-creeds.mjs   (멱등)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'web', 'data');
const TODAY = '2026-07-31';

// ---------------------------------------------------------------------------
// 사도신경 — 예장합동 총회 공표 본문
// ---------------------------------------------------------------------------
const apostles = {
  id: 'apostles',
  title: '사도신경',
  shortTitle: '사도신경',
  type: 'chapters',
  source: {
    name: '대한예수교장로회총회 공표 본문 (총회 결의 89·95·96회, 총회 교육국)',
    url: 'https://www.dongsan1970.org/main/sub.html?boardID=www22&num=45&Mode=view',
    fetchedAt: TODAY,
    license:
      '대한예수교장로회총회가 "총회 성도는 다음의 사도신경 본문을 사용하셔야 합니다"라며 ' +
      '전국 교회에 사용을 공표한 예배용 본문 (총회장 백남선 목사, 교육부장 김연도 목사, ' +
      '신학부장 김유문 목사 명의). 2026-07-31 게시 이미지에서 직접 확인.',
    licenseConfidence: '확정',
    note:
      '고대 교회의 신경이며, 이 한국어 본문은 우리 교단 총회가 전 교회에 사용하도록 ' +
      '공표한 공인 예배문이다. 교단 소속 교회의 교육 용도가 곧 공표된 목적이다.',
  },
  sections: [
    {
      no: 1,
      title: '사도신경',
      paras: [
        '전능하사 천지를 만드신 하나님 아버지를 내가 믿사오며',
        '그 외아들 우리 주 예수 그리스도를 믿사오니',
        '이는 성령으로 잉태하사 동정녀 마리아에게 나시고',
        '본디오 빌라도에게 고난을 받으사 십자가에 못 박혀 죽으시고',
        '장사한 지 사흘 만에 죽은 자 가운데서 다시 살아나시며',
        '하늘에 오르사 전능하신 하나님 우편에 앉아 계시다가',
        '저리로서 산 자와 죽은 자를 심판하러 오시리라',
        '성령을 믿사오며',
        '거룩한 공회와 성도가 서로 교통하는 것과',
        '죄를 사하여 주시는 것과',
        '몸이 다시 사는 것과',
        '영원히 사는 것을 믿사옵나이다. 아멘',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 니케아 신경 — 담임교사 제공 본문
// ---------------------------------------------------------------------------
const nicene = {
  id: 'nicene',
  title: '니케아 신경',
  shortTitle: '니케아 신경',
  type: 'chapters',
  source: {
    name: '담임교사 제공 본문 — 니케아-콘스탄티노폴리스 신경(381년)',
    url: '',
    fetchedAt: TODAY,
    license: '담임교사가 이 앱에 수록하도록 직접 제공한 본문 (2026-07-31).',
    // ★ '제한적'인 이유: 사용을 지시한 주체는 분명하지만(담임교사),
    //   이 한국어 본문의 «원 번역 출처»는 확인하지 못했다. 이용 조건과
    //   출처 추적성은 다른 문제이고, 모르는 쪽에 맞춰 낮춰 적는다.
    //   화면에는 이 등급에 맞는 안내가 함께 표시된다.
    licenseConfidence: '제한적',
    note:
      '381년 콘스탄티노폴리스 공의회에서 확정된 보편 신조. 예장합동 총회 헌법에는 ' +
      '별도 문서로 수록되어 있지 않아, 담임교사가 제공한 본문을 그대로 싣는다. ' +
      '원 번역자·출판 주체는 확인되지 않았다(웹에서 수집한 것이 아니므로 url이 없다).',
  },
  sections: [
    {
      no: 1,
      title: '성부 하나님에 대한 고백',
      paras: [
        '우리는 한 분이시요 전능하신 하나님 아버지, 하늘과 땅과 보이는 것과 보이지 않는 모든 것의 창조주를 믿습니다.',
      ],
    },
    {
      no: 2,
      title: '성자 하나님에 대한 고백',
      paras: [
        '우리는 또한 한 분이신 주 예수 그리스도를 믿으니, 모든 세계가 있기 전에 성부에게서 나신 하나님의 독생자이십니다.',
        '그분은 하나님에게서 나신 하나님이시요, 빛에서 나신 빛이시요, 참 하나님에게서 나신 참 하나님이시며, 창조되지 않고 나시어, 성부와 본질이 동일하시며, 만물이 다 그분으로 말미암아 지은 바 되었습니다.',
        '그분은 우리 인간들과 우리의 구원을 위하여 하늘로부터 내려오사, 성령과 동정녀 마리아에게서 육신을 입어 사람이 되셨습니다.',
        '그분은 본디오 빌라도 치하에서 우리를 위하여 십자가에 못 박히사 고난을 받으시고 장사되셨으나, 성경대로 사흗날에 다시 살아나셨습니다.',
        '그분은 하늘에 오르사 성부 오른편에 앉아 계시며, 산 자와 죽은 자를 심판하러 영광 중에 다시 오실 것이니, 그분의 나라는 끝이 없을 것입니다.',
      ],
    },
    {
      no: 3,
      title: '성령 하나님에 대한 고백',
      paras: [
        '우리는 주님이시며 생명을 주시는 성령을 믿으니, 성령은 성부(와 성자)로부터 나오시며, 성부와 성자와 더불어 예배와 영광을 받으시고, 예언자들을 통하여 말씀하셨습니다.',
      ],
    },
    {
      no: 4,
      title: '교회의 보편성과 종말에 대한 고백',
      paras: [
        '우리는 하나이고 거룩하며 보편적이고 사도적인 교회를 믿습니다.',
        '우리는 죄 사함을 얻게 하는 하나의 세례를 고백하며, 죽은 자들의 부활과 장차 올 세상의 영원한 생명을 바라봅니다. 아멘.',
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

function write(doc) {
  const file = path.join(OUT, doc.id + '.json');
  fs.writeFileSync(file, JSON.stringify(doc, null, 1) + '\n', 'utf8');
  return { file: doc.id + '.json', bytes: fs.statSync(file).size, count: doc.sections.length };
}

const results = [apostles, nicene].map(write);

// index.json 갱신 — 보편 신조 그룹으로, 대륙 개혁교회 문서 앞에 둔다.
const indexPath = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

[[apostles, results[0]], [nicene, results[1]]].forEach(function ([doc, r]) {
  const entry = {
    id: doc.id,
    title: doc.title,
    shortTitle: doc.shortTitle,
    type: doc.type,
    count: r.count,
    file: r.file,
    bytes: r.bytes,
    group: 'ecumenical',
  };
  const at = index.findIndex(function (e) { return e.id === doc.id; });
  if (at >= 0) index[at] = entry; else index.push(entry);
});

const ORDER = ['wcf', 'wlc', 'wsc', 'worship', 'creed', 'apostles', 'nicene', 'heidelberg'];
index.sort(function (a, b) { return ORDER.indexOf(a.id) - ORDER.indexOf(b.id); });
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n', 'utf8');

console.log('OK — ' + results.map(function (r) { return r.file + '(' + r.bytes + 'B)'; }).join(', '));
console.log('index.json: ' + index.map(function (e) { return e.id; }).join(', '));
