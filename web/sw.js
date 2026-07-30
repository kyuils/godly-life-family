// web/sw.js — 서비스워커. 계약 §6.2
//
// 규칙:
//   1) 정적 자산과 참고자료(web/data/*.json)만 cache-first로 캐시한다.
//   2) GAS 호출(POST)은 절대 캐시하지 않는다 — 사용자 데이터가 기기에 남으면 안 된다.
//      (가정에서 폰을 공유하는 것이 이 앱의 기본 시나리오다 — 계약 §6.1)
//   3) 캐시명에 BUILD_TAG를 넣고 skipWaiting + clients.claim으로 즉시 교체한다.
//      그렇지 않으면 홈 화면에 추가한 사용자에게 구버전이 며칠씩 남는다.
//
// ★ 배포할 때마다 BUILD_TAG를 올린다 (docs/ops/03-deploy-gas.md, 계약 §8.3).

const BUILD_TAG = 'v1.0.0';
const CACHE = 'godly-life-family-' + BUILD_TAG;

const PRECACHE = [
  './',
  'index.html',
  'css/app.css',
  'js/mccheyne-plan.js',
  'manifest.webmanifest',
  'data/index.json',
];

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

  // GET이 아니면(=GAS로 보내는 POST 전부) 손대지 않는다.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 다른 출처(구글 로그인 스크립트, GAS 웹앱)는 캐시하지 않는다.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // 정적 자산과 data/*.json만 저장한다.
        const cacheable = res && res.ok && res.type === 'basic';
        if (cacheable) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
