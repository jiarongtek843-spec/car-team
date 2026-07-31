import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as pushService from "./push.service.js";
import { ValidationError } from "../../common/errors.js";

let driverIds: number[] = [];

afterEach(async () => {
  await prisma.pushSubscription.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  driverIds = [];
});

async function createTestDriver(name: string) {
  const driver = await prisma.driver.create({ data: { name } });
  driverIds.push(driver.id);
  return driver;
}

describe("push.service.ts", () => {
  it("saveSubscription creates a new row keyed by endpoint", async () => {
    const driver = await createTestDriver("Push Subscribe Driver");

    const sub = await pushService.saveSubscription({
      driverId: driver.id,
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
      userAgent: "vitest"
    });

    expect(sub.driverId).toBe(driver.id);
    expect(sub.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");

    const rows = await prisma.pushSubscription.findMany({ where: { driverId: driver.id } });
    expect(rows).toHaveLength(1);
  });

  it("saveSubscription upserts by endpoint instead of creating duplicates for the same device", async () => {
    const driver = await createTestDriver("Push Upsert Driver");
    const endpoint = "https://fcm.googleapis.com/fcm/send/dup123";

    await pushService.saveSubscription({
      driverId: driver.id,
      endpoint,
      keys: { p256dh: "old-p256dh", auth: "old-auth" }
    });
    await pushService.saveSubscription({
      driverId: driver.id,
      endpoint,
      keys: { p256dh: "new-p256dh", auth: "new-auth" }
    });

    const rows = await prisma.pushSubscription.findMany({ where: { driverId: driver.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("new-p256dh");
  });

  it("saveSubscription rejects missing keys", async () => {
    const driver = await createTestDriver("Push Invalid Driver");
    await expect(
      pushService.saveSubscription({
        driverId: driver.id,
        endpoint: "https://fcm.googleapis.com/fcm/send/invalid",
        keys: { p256dh: "", auth: "auth-value" }
      })
    ).rejects.toThrow(ValidationError);
  });

  it("removeSubscription only deletes the subscription owned by the calling driver", async () => {
    const owner = await createTestDriver("Push Owner Driver");
    const stranger = await createTestDriver("Push Stranger Driver");
    const endpoint = "https://fcm.googleapis.com/fcm/send/owned123";

    await pushService.saveSubscription({
      driverId: owner.id,
      endpoint,
      keys: { p256dh: "p256dh-value", auth: "auth-value" }
    });

    // 陌生人带同一个 endpoint 来删，不该删得掉。
    await pushService.removeSubscription(stranger.id, endpoint);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).not.toBeNull();

    // 真正的 owner 才能删得掉。
    await pushService.removeSubscription(owner.id, endpoint);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).toBeNull();
  });

  it("removeSubscription silently no-ops for an endpoint that doesn't exist", async () => {
    const driver = await createTestDriver("Push NoOp Driver");
    await expect(pushService.removeSubscription(driver.id, "https://fcm.googleapis.com/fcm/send/never-existed")).resolves.not.toThrow();
  });

  it("sendPushToDriver silently no-ops when the driver has no subscriptions", async () => {
    const driver = await createTestDriver("Push NoSub Driver");
    await expect(pushService.sendPushToDriver(driver.id, { title: "Test", body: "Test" })).resolves.not.toThrow();
  });
});
