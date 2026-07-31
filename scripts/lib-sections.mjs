// scripts/lib-sections.mjs — 장(章) 안의 문단 배열을 항(項)으로 묶는 공용 모듈.
//
// 왜 필요한가: gapck.org에서 받은 신도게요서는 «장»까지만 나뉘어 있고 문단이
// 한 줄씩 평평하게 들어온다. 본문·각주·성경 66권 목록이 뒤섞여 있어서
// 사용자가 "몇 장 몇 항"으로 찾아볼 수 없다 (2026-07-31 요청).
//
// 규칙 (실제 데이터 33장 전체로 검증됨):
//   각주 문단 = «(숫자)»로 시작  OR  (직전 문단이 각주이고 «(»로 시작 — 각주 연속행)
//   항        = [연속된 본문 문단들] + [뒤따르는 연속된 각주 문단들]
//   즉 «각주 블록의 끝»이 항 경계다.
//
// 왜 «(숫자)로 시작하면 각주»만으로는 안 되는가:
//   1장에는 각주 연속행 «(눅 16:29, 요 20:29, 31).»이 있고, 2항 본문에는
//   성경 66권 목록이 24개 문단으로 쪼개져 들어 있다. 마커만 보면 1장이
//   10항이 아니라 30항 안팎으로 잘린다.
//
// 후기(postscript): 각주가 하나도 없는 «마지막» 블록은 항이 아니다.
//   실제로 전 33장에서 이런 블록은 33장 끝의 역문 후기 하나뿐이다.

const FN_HEAD = /^\(\s*\d+\s*\)/;

/**
 * @param {string[]} paras 한 장의 문단 배열
 * @return {{items: {no:number, paras:string[], refs:string[]}[], postscript: string[]}}
 */
export function splitSections(paras) {
  const blocks = [];
  let body = [];
  let refs = [];
  let prevIsFootnote = false;
  let inRefs = false;

  for (let i = 0; i < paras.length; i++) {
    const s = String(paras[i] || '').trim();
    if (!s) continue;
    const isFootnote = FN_HEAD.test(s) || (prevIsFootnote && s.charAt(0) === '(');

    if (isFootnote) {
      inRefs = true;
      refs.push(s);
    } else {
      // 각주 블록이 끝나고 새 본문이 시작되면 거기가 항 경계다.
      if (inRefs) {
        blocks.push({ paras: body, refs: refs });
        body = [];
        refs = [];
        inRefs = false;
      }
      body.push(s);
    }
    prevIsFootnote = isFootnote;
  }
  if (body.length || refs.length) blocks.push({ paras: body, refs: refs });

  // 각주 없는 «마지막» 블록은 항이 아니라 후기다.
  let postscript = [];
  if (blocks.length > 1) {
    const last = blocks[blocks.length - 1];
    if (last.refs.length === 0) {
      postscript = last.paras;
      blocks.pop();
    }
  }

  const items = blocks
    .filter(function (b) { return b.paras.length > 0; })
    .map(function (b, i) { return { no: i + 1, paras: b.paras, refs: b.refs }; });

  return { items: items, postscript: postscript };
}

/**
 * 웨스트민스터 신앙고백서 장별 항 수 — 검증 기준.
 *
 * 출처 `[확정]`: 이 데이터 자체가 **미국 정통장로교회(OPC) 판**을 옮긴 것이다.
 * 33장 말미의 역문 후기에 «內容을 美國正統長老敎會의 信徒揭要에 따라» 라고
 * 명시되어 있다. 원본 웨스트민스터의 31장은 5항이지만, 미국 장로교 개정판에서
 * 3항(국가 위정자의 회의 소집권)이 삭제되어 **31장은 4항**이다.
 * 이 값을 데이터에서 도출하면 검사가 자기 자신을 검증하는 꼴이 되므로,
 * 외부 기준으로 고정해 둔다.
 */
export const WCF_ITEM_COUNTS = [
  10, 3, 8, 2, 7, 6, 6, 8, 5, 4, 6, 1, 3, 3, 6, 7, 3,
  4, 7, 4, 8, 7, 4, 6, 6, 3, 5, 7, 8, 4, 4, 3, 3,
];
