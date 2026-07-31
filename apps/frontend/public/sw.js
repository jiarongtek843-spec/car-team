// 最小 Service Worker：只为了满足「可安装成 App」的条件（manifest + HTTPS + Service Worker）
// 跟提供离线时打开 App 至少看得到壳、不是白屏这两件事，不做完整离线优先的资料同步——
// 这个专案的资料（Booking/Wallet/Dispatch）时效性很高，永远该走网路拿最新的，不该被快取
// 骗过去，所以 API（/api/...）一律略过、直接打网路，只有静态资源走快取。
const CACHE_NAME = "car-team-shell-v2";
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

  // 导航请求（也就是 index.html 本身）一定要先打网路——先前是「有快取就先回快取、背景才
  // 更新」，PWA 装到主屏幕后几乎不会整个关掉重开，导致每次打开看到的永远是「上一次」部署
  // 的版本，新功能要重开两次才会出现，使用者会以为部署没生效。改成先打网路拿最新的
  // index.html（它 reference 的 JS/CSS 檔名每次 build 都带 content hash，一定是最新的），
  // 只有离线连不上网路时才退回快取当保底、不会白屏。
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/")))
    );
    return;
  }

  // 其他静态资源（JS/CSS/圖片）維持 cache-first + 背景更新——這些檔名都帶 content hash，
  // 一旦快取到的版本本來就不會變，用快取換取速度沒有「看到舊版」的風險。
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

// Web Push（出单等事件要在 Driver 没开着网页时也能收到）：后端 push.service.ts 送出的
// payload 就是纯 JSON { title, body, url }，这里原样拿来当系统通知显示——是唯一能在网页
// 完全没开、甚至浏览器整个关掉的情况下还跳出通知的机制（跟一般网页背景计时器不一样，
// Push 是浏览器厂商在系统层级帮忙代收代转）。
self.addEventListener("push", (event) => {
  let payload = { title: "车队管理系统", body: "有新的通知" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // 收到非 JSON 内容（理论上不会发生，因为送的一端固定是 JSON.stringify），退回预设文案。
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url ?? "/" }
    })
  );
});

// 点通知：已经有分页开着就切过去（同时导航到目标网址），完全没开就开一个新的——这是
// Web Notification API 标准的「聚焦既有分页优先」写法，避免每点一次通知就多开一个分页。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
