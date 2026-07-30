// web/sw.js — 서비스워커. 계약 §6.2
//
// 캐시 전략은 자산 성격에 따라 둘로 나눈다.
//
//   1) 참고자료(data/*.json)와 아이콘 → cache-first
//      내용이 사실상 바뀌지 않고 크기가 크다(총 470KB). 오프라인 열람의 근거다.
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

const BUILD_TAG = 'v1.0.1';
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
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // network-first — 온라인이면 항상 최신 코드, 오프라인이면 캐시로 버틴다.
  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
  );
});
