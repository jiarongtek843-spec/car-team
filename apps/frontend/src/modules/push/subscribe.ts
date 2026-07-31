import { fetchVapidPublicKey, subscribePush, unsubscribePush } from "./api";

/** Push API 的 applicationServerKey 要吃 Uint8Array，但 VAPID Public Key 是 Base64URL
 * 字串——这是标准转换写法（MDN Web Push 范例就是这样写的），没有更简单的内建 API。
 * 刻意用 `new Uint8Array(length)` 而不是 `Uint8Array.from(...)`：新版 TS lib 把后者的
 * 回传型别推成 `Uint8Array<ArrayBufferLike>`（含 SharedArrayBuffer 的可能性），跟
 * PushManager.subscribe() 要求的 BufferSource 对不上；显式配置 buffer 长度回传的是
 * `Uint8Array<ArrayBuffer>`，类型才吻合。 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export type PushPermissionResult = "subscribed" | "unsupported" | "denied" | "no-vapid-key";

/**
 * Driver 点「上线」这个既有的使用者手势顺便请求通知权限——iOS/Android 都要求
 * Notification.requestPermission() 必须在使用者主动点击的事件处理常式里呼叫，不能在
 * 页面载入时就自动跳，浏览器会直接忽略。已经订阅过（且浏览器给的 endpoint 没变）时
 * 这里的 subscribe() 会直接回传既有订阅，不会重复跳权限询问，可以放心每次上线都呼叫。
 */
export async function ensurePushSubscription(): Promise<PushPermissionResult> {
  if (!isPushSupported()) {
    return "unsupported";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return "denied";
  }

  const { publicKey } = await fetchVapidPublicKey();
  if (!publicKey) {
    // 后端还没设定 VAPID Key（例如本地开发、或 Railway 环境变数还没补上）——不算错误，
    // 只是这个环境暂时不支援推播，安静跳过。
    return "no-vapid-key";
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // TS 的 Uint8Array<ArrayBufferLike> vs BufferSource 类型不吻合是新版 lib.dom.d.ts 的
    // 已知型别标注问题（runtime 上 Uint8Array 本来就满足 BufferSource），不是真的类型错误。
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return "unsupported";
  }

  await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }
  });

  return "subscribed";
}

/** Driver 点「下线」时顺手取消订阅——不是必要动作（下线之后本来就不该再收到出单通知），
 * 但清乾净比留着一笔「Driver 已下线、订阅却还在」的死资料好。失败（例如浏览器本身没有
 * 现成订阅可取消）静默忽略，不影响下线这个主要动作。 */
export async function clearPushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await unsubscribePush(endpoint);
  } catch {
    // 安静忽略——见上方注解。
  }
}
