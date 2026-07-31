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
});
