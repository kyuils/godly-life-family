// web/sw.js — 서비스워커. 계약 §6.2
//
// 캐시 전략은 자산 성격에 따라 둘로 나눈다.
//
//   1) 참고자료(data/*.json)와 아이콘 → cache-first
//      내용이 사실상 바뀌지 않고 크기가 크다(총 470KB).
//      ※ 앱을 새로 켜면 로그인이 필요하므로 '완전 오프라인 기동'은 불가능하다.
//         이 캐시가 보장하는 것은 '쓰는 중에 회선이 끊겨도 계속 볼 수 있다'까지다(계약 §5.1).
//
//   2) 앱 자체(HTML/CSS/JS) → **network-first** (오프라인일 때만 캐시)
//      cache-first로 두면 코드를 고쳐 배포해도 **BUILD_TAG를 올리는 것을 잊는 순간
//      사용자에게 구버전이 영원히 남는다.** 실제로 개발 중에 이 사고가 났고,
//      비개발자 운영자에게는 "고쳤는데 안 바뀌어요"로 나타나며 진단 수단이 없다.
//      앱 파일은 전부 합쳐 100KB 미만이라 매번 받아도 부담이 없다.
//
// 그리고 어떤 경우에도:
//   - GET이 아닌 요청(= GAS로 보내는 POST)은 손대지 않는다. 사용자 데이터가 기기에
//     남으면 안 된다 (가정에서 폰을 공유하는 것이 기본 시나리오 — 계약 §6.1).
//   - 다른 출처(구글 로그인, GAS 웹앱)는 캐시하지 않는다.

const BUILD_TAG = 'v1.2.0';
const CACHE = 'godly-life-family-' + BUILD_TAG;

// 오프라인 최초 진입을 위한 최소 세트.
const PRECACHE = [
  './',
  'index.html',
  'css/app.css',
  'js/mccheyne-plan.js',
  'manifest.webmanifest',
  'data/index.json',
];

// cache-first 대상 — 변하지 않는 큰 자산.
function isImmutableAsset(pathname) {
  return pathname.indexOf('/data/') >= 0 || pathname.indexOf('/icons/') >= 0;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .catch(function () { /* 일부 실패해도 설치는 진행한다 */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;

  // GET이 아니면(= GAS로 보내는 POST 전부) 손대지 않는다.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 다른 출처(구글 로그인 스크립트, GAS 웹앱)는 캐시하지 않는다.
  if (url.origin !== self.location.origin) return;

  if (isImmutableAsset(url.pathname)) {
    // cache-first
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            // network-first 쪽과 같은 이유로 waitUntil로 수명을 잡고, 실패는 삼킨다.
            // (catch가 없으면 unhandled rejection이 된다 — 5차 검토 N6)
            const write = caches.open(CACHE).then(function (c) { return c.put(req, copy); });
            try { e.waitUntil(write.catch(function () {})); } catch (err) { /* 무시 */ }
          }
          return res;
        });
      })
    );
    return;
  }

  // network-first(3초 타임아웃) — 온라인이면 최신 코드, 느리거나 끊기면 캐시로 버틴다.
  //
  // 타임아웃이 필요한 이유: 오프라인이면 fetch가 곧바로 실패하지만, **불안정한 모바일
  // 회선에서는 실패하지 않고 계속 매달린다.** 그러면 앱 시작이 무한정 늦어진다.
  // 3초 안에 응답이 없으면 캐시본으로 먼저 띄우고, 네트워크 응답은 도착하는 대로
  // 캐시에 넣어 다음 실행에 반영한다.
  e.respondWith(networkFirst(e, req));
});

function networkFirst(e, req) {
  // 캐시 쓰기가 끝나는 시점을 따로 잡아 둔다. `network`만 waitUntil에 걸면
  // 응답 도착 시점에 이미 이행되어 **캐시 쓰기 완료를 기다리지 않는다**
  // (2026-07-30 4차 검토 지적).
  let cacheWrite = Promise.resolve();
  const network = fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      cacheWrite = caches.open(CACHE).then(function (c) { return c.put(req, copy); });
    }
    return res;
  });

  const timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, 3000);
  });

  // 타임아웃이 이겨서 respondWith가 먼저 끝나도, 늦게 도착한 응답을 캐시에 넣는 작업이
  // SW 종료로 유실되지 않도록 이벤트 수명을 연장한다.
  try {
    e.waitUntil(
      network.catch(function () {}).then(function () { return cacheWrite.catch(function () {}); })
    );
  } catch (err) { /* 무시 */ }

  return Promise.race([network.catch(function () { return null; }), timeout])
    .then(function (res) {
      if (res) return res;
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // 캐시에도 없다면 네트워크 응답을 끝까지 기다려 본다.
        return network.catch(function () { return offlineFallback(req); });
      });
    });
}

/**
 * 오프라인 폴백.
 *
 * ★ 페이지 이동(navigate) 요청에만 index.html을 돌려준다.
 * JS 모듈 요청에 HTML을 돌려주면 strict MIME 검사에 걸려
 * "Failed to load module script"로 죽고 **빈 화면만 남는다**
 * (2026-07-30 2차 검토 [중대] 지적).
 */
function offlineFallback(req) {
  if (req.mode === 'navigate') return caches.match('index.html');
  return new Response('', { status: 504, statusText: 'offline' });
}
