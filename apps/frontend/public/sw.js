// 最小 Service Worker：只为了满足「可安装成 App」的条件（manifest + HTTPS + Service Worker）
// 跟提供离线时打开 App 至少看得到壳、不是白屏这两件事，不做完整离线优先的资料同步——
// 这个专案的资料（Booking/Wallet/Dispatch）时效性很高，永远该走网路拿最新的，不该被快取
// 骗过去，所以 API（/api/...）一律略过、直接打网路，只有静态资源走快取。
const CACHE_NAME = "car-team-shell-v1";
const APP_SHELL = ["/", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API 一律直接打网路，不快取——Dispatch/Wallet 这类资料快取了反而危险。
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 只处理同源的 GET，避免误快取到跨域请求或 POST/PUT 之类的动作。
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })
  );
});
