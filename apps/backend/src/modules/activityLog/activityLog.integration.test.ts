import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createActivity } from "./activityLog.service.js";

/**
 * Activity Log 标准化基础设施：现在还没有任何 Consumer（Notification Center 尚未开工），
 * 这里只验证 createActivity() 本身写对了资料——之后 Wallet/GPS/Dispatch/Settlement 等
 * 模块接进来时，是套用同一份保证，不用重新验证一次基础行为。
 */

let activityLogIds: number[] = [];
let userIds: number[] = [];
let driverIds: number[] = [];

afterEach(async () => {
  await prisma.activityLog.deleteMany({ where: { id: { in: activityLogIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  activityLogIds = [];
  userIds = [];
  driverIds = [];
});

async function createTestDriver(name: string) {
  const driver = await prisma.driver.create({ data: { name } });
  driverIds.push(driver.id);
  return driver;
}

describe("activityLog.service.ts：createActivity()", () => {
  it("系统自动触发（省略 actor）：actorUserId/actorDriverId 都是 null", async () => {
    const activity = await createActivity({
      module: "WALLET",
      activityType: "WALLET_CREDITED",
      entityType: "WalletTransaction",
      entityId: 1,
      summary: "系统自动发放 Leg 收入"
    });
    activityLogIds.push(activity.id);

    expect(activity.actorUserId).toBeNull();
    expect(activity.actorDriverId).toBeNull();
    expect(activity.module).toBe("WALLET");
    expect(activity.activityType).toBe("WALLET_CREDITED");
    expect(activity.summary).toBe("系统自动发放 Leg 收入");
  });

  it("actor 是登入的 User（例如 Dispatcher/Admin）：actorUserId 有值，actorDriverId 是 null", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });

    const activity = await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: 10,
      summary: "Dispatcher 送出 Offer",
      actor: { userId: admin.id }
    });
    activityLogIds.push(activity.id);

    expect(activity.actorUserId).toBe(admin.id);
    expect(activity.actorDriverId).toBeNull();
  });

  it("actor 是司机本人：actorDriverId 有值", async () => {
    const driver = await createTestDriver("Activity Log Driver");

    const activity = await createActivity({
      module: "DRIVER_JOBS",
      activityType: "DRIVER_ACCEPTED_LEG",
      entityType: "Leg",
      entityId: 20,
      summary: `${driver.name} 接受了行程`,
      actor: { driverId: driver.id }
    });
    activityLogIds.push(activity.id);

    expect(activity.actorDriverId).toBe(driver.id);
    expect(activity.actorUserId).toBeNull();
  });

  it("subjectDriverId 可以跟 actor 不同（例如 Dispatcher 帮某个司机送 Offer）", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    const driver = await createTestDriver("Offer Subject Driver");

    const activity = await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: 30,
      summary: `Offer 已送给 ${driver.name}`,
      actor: { userId: admin.id },
      subjectDriverId: driver.id
    });
    activityLogIds.push(activity.id);

    expect(activity.actorUserId).toBe(admin.id);
    expect(activity.subjectDriverId).toBe(driver.id);
  });

  it("metadata 会被正确序列化成 JSON（含 Date 转 ISO string）", async () => {
    const now = new Date("2026-07-29T10:00:00.000Z");

    const activity = await createActivity({
      module: "WALLET",
      activityType: "WALLET_CREDITED",
      entityType: "WalletTransaction",
      entityId: 40,
      summary: "系统自动发放 Leg 收入",
      metadata: { amountCents: 1488, effectiveDate: now }
    });
    activityLogIds.push(activity.id);

    expect(activity.metadata).toEqual({ amountCents: 1488, effectiveDate: now.toISOString() });
  });

  it("没有 metadata 时该栏位是 null", async () => {
    const activity = await createActivity({
      module: "GPS",
      activityType: "DRIVER_WENT_OFFLINE",
      entityType: "Driver",
      entityId: 50,
      summary: "司机自动被判定离线"
    });
    activityLogIds.push(activity.id);

    expect(activity.metadata).toBeNull();
  });

  it("可以在同一个 Transaction 里跟其他写入一起 commit（reuse 既有 Prisma.TransactionClient 模式）", async () => {
    const driver = await createTestDriver("Transactional Driver");

    const activity = await prisma.$transaction(async (tx) => {
      return createActivity(
        {
          module: "DRIVER_JOBS",
          activityType: "DRIVER_ACCEPTED_LEG",
          entityType: "Leg",
          entityId: 60,
          summary: `${driver.name} 接受了行程`,
          actor: { driverId: driver.id }
        },
        tx
      );
    });
    activityLogIds.push(activity.id);

    const persisted = await prisma.activityLog.findUnique({ where: { id: activity.id } });
    expect(persisted).not.toBeNull();
  });
});
