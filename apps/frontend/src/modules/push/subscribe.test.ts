import { describe, expect, it, vi, afterEach } from "vitest";
import { ensurePushSubscription, isPushSupported } from "./subscribe";
import * as pushApi from "./api";

describe("isPushSupported", () => {
  it("returns false when the browser lacks PushManager/serviceWorker (e.g. jsdom test env)", () => {
    // jsdom 本来就没有实作这几个 API，这里就是在确认我们没有误判成「支援」。
    expect(isPushSupported()).toBe(false);
  });
});

describe("ensurePushSubscription", () => {
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification = originalNotification;
    }
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    }
  });

  it("returns 'unsupported' when the environment has no PushManager", async () => {
    const result = await ensurePushSubscription();
    expect(result).toBe("unsupported");
  });

  it("returns 'denied' when the user rejects the notification permission prompt", async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue("denied")
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({}) }
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });

    const result = await ensurePushSubscription();
    expect(result).toBe("denied");
  });

  it("returns 'no-vapid-key' when the backend hasn't configured VAPID keys yet", async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue("granted")
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({}) }
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    vi.spyOn(pushApi, "fetchVapidPublicKey").mockResolvedValue({ publicKey: null });

    const result = await ensurePushSubscription();
    expect(result).toBe("no-vapid-key");
  });

  it("returns 'save-failed' (not an unhandled rejection) when the browser subscribes fine but POSTing it to the backend fails", async () => {
    // Railway 上实测到的真实场景：Notification 权限确实按了允许，浏览器端的
    // pushManager.subscribe() 也真的成功，但把这笔订阅存到后端的网路请求失败——原本这里
    // 完全没有 try/catch，会变成一个安静的 Unhandled Promise Rejection，DriverPresenceToggle
    // 也没接 .catch()，使用者完全看不到任何错误，后端 push_subscriptions 表里则永远不会
    // 有这笔资料，之后所有推播都会静默找不到订阅、什么都不送。
    (globalThis as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn().mockResolvedValue("granted")
    };
    const fakeSubscription = {
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } })
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { subscribe: vi.fn().mockResolvedValue(fakeSubscription) }
        })
      }
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    vi.spyOn(pushApi, "fetchVapidPublicKey").mockResolvedValue({ publicKey: "fake-public-key" });
    vi.spyOn(pushApi, "subscribePush").mockRejectedValue(new Error("network error"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ensurePushSubscription();
    expect(result).toBe("save-failed");
  });
});
