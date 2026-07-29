import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createActivity } from "../activityLog/activityLog.service.js";
import * as notificationService from "./notification.service.js";
import * as bookingsService from "../bookings/bookings.service.js";
import { NotFoundError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Notification Center：Notification 只能透过两条路径产生——
 *   1. handleActivity()（activityLog.service.ts 的 Subscriber，随 createActivity() 自动触发）
 *   2. createManualNotification()（给 POST /api/notifications 这个人工发公告的入口用）
 * 这个档案两条路径都测，另外补 CRUD（List/Get/MarkRead/MarkUnread/Delete）跟司机自己
 * 存取权限的隔离。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

let notificationIds: number[] = [];
let activityLogIds: number[] = [];
let driverIds: number[] = [];
let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  await prisma.activityLog.deleteMany({ where: { id: { in: activityLogIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  notificationIds = [];
  activityLogIds = [];
  driverIds = [];
  bookingIds = [];
});

async function createTestDriver(name: string) {
  const driver = await prisma.driver.create({ data: { name } });
  driverIds.push(driver.id);
  return driver;
}

async function trackNotificationsFor(activityId: number) {
  const rows = await prisma.notification.findMany({ where: { sourceActivityId: activityId } });
  notificationIds.push(...rows.map((r) => r.id));
  return rows;
}

describe("notification.service.ts：自动路径（Activity Log Subscriber）", () => {
  it("有 subjectDriverId 的事件：会产生一笔 DRIVER 通知给那个司机 + 一笔 ADMIN 广播", async () => {
    const driver = await createTestDriver("Notify Driver A");

    const activity = await createActivity({
      module: "WALLET",
      activityType: "WALLET_CREDITED",
      entityType: "WalletTransaction",
      entityId: 999001,
      summary: "系统自动发放 Leg 收入",
      subjectDriverId: driver.id
    });
    activityLogIds.push(activity.id);

    const notifications = await trackNotificationsFor(activity.id);
    const audiences = notifications.map((n) => n.audience).sort();

    expect(audiences).toEqual(["ADMIN", "DRIVER"]);
    const driverNotification = notifications.find((n) => n.audience === "DRIVER");
    expect(driverNotification?.driverId).toBe(driver.id);
    expect(driverNotification?.type).toBe("WALLET_CREDITED");
    expect(driverNotification?.message).toBe("系统自动发放 Leg 收入");
    expect(driverNotification?.isRead).toBe(false);
    expect(driverNotification?.sourceActivityId).toBe(activity.id);
  });

  it("module=DISPATCH 的事件：额外多一笔 DISPATCHER 广播", async () => {
    const driver = await createTestDriver("Notify Driver Dispatch");

    const activity = await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: 999002,
      summary: "Offer 已送出",
      subjectDriverId: driver.id
    });
    activityLogIds.push(activity.id);

    const notifications = await trackNotificationsFor(activity.id);
    const audiences = notifications.map((n) => n.audience).sort();

    expect(audiences).toEqual(["ADMIN", "DISPATCHER", "DRIVER"]);
  });

  it("没有 subjectDriverId、非 DISPATCH module 的事件：只有一笔 ADMIN 广播", async () => {
    const activity = await createActivity({
      module: "SETTLEMENT",
      activityType: "SETTLEMENT_CONFIRMED",
      entityType: "Settlement",
      entityId: 999003,
      summary: "Settlement 已确认"
    });
    activityLogIds.push(activity.id);

    const notifications = await trackNotificationsFor(activity.id);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].audience).toBe("ADMIN");
    expect(notifications[0].driverId).toBeNull();
  });

  it("entityType=Booking 的事件：relatedBookingId 自动带上 entityId", async () => {
    const booking = await bookingsService.createBooking({ girlName: "NotifyBookingLink", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    const activity = await createActivity({
      module: "BOOKING",
      activityType: "BOOKING_CREATED",
      entityType: "Booking",
      entityId: booking.id,
      summary: "Booking 已建立"
    });
    activityLogIds.push(activity.id);

    const notifications = await trackNotificationsFor(activity.id);

    expect(notifications[0].relatedBookingId).toBe(booking.id);
  });

  it("registerNotificationRule() 可以为特定 (module, activityType) 客制化内容，覆盖预设规则", async () => {
    const driver = await createTestDriver("Notify Driver Custom Rule");

    notificationService.registerNotificationRule({
      module: "TEST_CUSTOM_RULE_MODULE",
      activityType: "CUSTOM_EVENT",
      build: (activity) => [
        {
          audience: "DRIVER",
          driverId: activity.subjectDriverId,
          type: "CUSTOM_EVENT",
          title: "客制化标题",
          message: "客制化内容",
          relatedUrl: "/custom/path"
        }
      ]
    });

    const activity = await createActivity({
      module: "TEST_CUSTOM_RULE_MODULE",
      activityType: "CUSTOM_EVENT",
      entityType: "Leg",
      entityId: 999005,
      summary: "这段不该被拿去当 message（规则已客制化）",
      subjectDriverId: driver.id
    });
    activityLogIds.push(activity.id);

    const notifications = await trackNotificationsFor(activity.id);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("客制化标题");
    expect(notifications[0].message).toBe("客制化内容");
    expect(notifications[0].relatedUrl).toBe("/custom/path");
  });

  it("createActivity() 在同一个 $transaction 里失败时，Notification 也会跟着一起 rollback（原子性）", async () => {
    const driver = await createTestDriver("Notify Driver Rollback");
    let capturedActivityId: number | undefined;

    await expect(
      prisma.$transaction(async (tx) => {
        const activity = await createActivity(
          {
            module: "WALLET",
            activityType: "WALLET_CREDITED",
            entityType: "WalletTransaction",
            entityId: 999006,
            summary: "会被 rollback 的事件",
            subjectDriverId: driver.id
          },
          tx
        );
        capturedActivityId = activity.id;
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");

    expect(capturedActivityId).toBeDefined();
    const persistedActivity = await prisma.activityLog.findUnique({ where: { id: capturedActivityId! } });
    const persistedNotifications = await prisma.notification.findMany({
      where: { sourceActivityId: capturedActivityId! }
    });

    expect(persistedActivity).toBeNull();
    expect(persistedNotifications).toHaveLength(0);
  });
});

describe("notification.service.ts：手动路径（createManualNotification，给 CRUD Create API 用）", () => {
  it("audience=DRIVER 没给 driverId 会被拒绝", async () => {
    await expect(
      notificationService.createManualNotification({
        audience: "DRIVER",
        type: "ANNOUNCEMENT",
        title: "公告",
        message: "测试"
      })
    ).rejects.toThrow(ValidationError);
  });

  it("audience 不是 DRIVER 却给了 driverId 会被拒绝", async () => {
    const driver = await createTestDriver("Manual Notify Driver");

    await expect(
      notificationService.createManualNotification({
        audience: "ADMIN",
        driverId: driver.id,
        type: "ANNOUNCEMENT",
        title: "公告",
        message: "测试"
      })
    ).rejects.toThrow(ValidationError);
  });

  it("正常建立：sourceActivityId 是 null（不对应任何 Activity Log 事件）", async () => {
    const notification = await notificationService.createManualNotification({
      audience: "ADMIN",
      type: "ANNOUNCEMENT",
      title: "系统维护通知",
      message: "明天凌晨 2 点系统维护"
    });
    notificationIds.push(notification.id);

    expect(notification.sourceActivityId).toBeNull();
    expect(notification.audience).toBe("ADMIN");
  });
});

describe("notification.service.ts：CRUD", () => {
  it("listNotifications 支持 audience/isRead 过滤 + 分页", async () => {
    const driver = await createTestDriver("List Notify Driver");
    const a = await notificationService.createManualNotification({
      audience: "DRIVER",
      driverId: driver.id,
      type: "T1",
      title: "标题1",
      message: "内容1"
    });
    const b = await notificationService.createManualNotification({
      audience: "DRIVER",
      driverId: driver.id,
      type: "T2",
      title: "标题2",
      message: "内容2"
    });
    notificationIds.push(a.id, b.id);
    await notificationService.markAsRead(a.id);

    const unreadOnly = await notificationService.listNotifications({
      audience: "DRIVER",
      driverId: driver.id,
      isRead: false,
      page: 1,
      pageSize: 20
    });
    expect(unreadOnly.data.map((n) => n.id)).toEqual([b.id]);

    const paged = await notificationService.listNotifications({
      audience: "DRIVER",
      driverId: driver.id,
      page: 1,
      pageSize: 1
    });
    expect(paged.data).toHaveLength(1);
    expect(paged.total).toBe(2);
  });

  it("markAsRead/markAsUnread 会正确设定 isRead + readAt", async () => {
    const notification = await notificationService.createManualNotification({
      audience: "ADMIN",
      type: "T3",
      title: "标题3",
      message: "内容3"
    });
    notificationIds.push(notification.id);

    const read = await notificationService.markAsRead(notification.id);
    expect(read.isRead).toBe(true);
    expect(read.readAt).not.toBeNull();

    const unread = await notificationService.markAsUnread(notification.id);
    expect(unread.isRead).toBe(false);
    expect(unread.readAt).toBeNull();
  });

  it("getNotificationById 对不存在的 id 丢 NotFoundError", async () => {
    await expect(notificationService.getNotificationById(999999999)).rejects.toThrow(NotFoundError);
  });

  it("deleteNotification 会移除该笔纪录", async () => {
    const notification = await notificationService.createManualNotification({
      audience: "ADMIN",
      type: "T4",
      title: "标题4",
      message: "内容4"
    });

    await notificationService.deleteNotification(notification.id);

    await expect(notificationService.getNotificationById(notification.id)).rejects.toThrow(NotFoundError);
  });

  it("getOwnDriverNotification：司机只能存取自己的 DRIVER 通知，别人的/非 DRIVER 的一律 404", async () => {
    const driverA = await createTestDriver("Own Notify Driver A");
    const driverB = await createTestDriver("Own Notify Driver B");

    const ownNotification = await notificationService.createManualNotification({
      audience: "DRIVER",
      driverId: driverA.id,
      type: "T5",
      title: "标题5",
      message: "内容5"
    });
    const adminNotification = await notificationService.createManualNotification({
      audience: "ADMIN",
      type: "T6",
      title: "标题6",
      message: "内容6"
    });
    notificationIds.push(ownNotification.id, adminNotification.id);

    const fetched = await notificationService.getOwnDriverNotification(ownNotification.id, driverA.id);
    expect(fetched.id).toBe(ownNotification.id);

    await expect(notificationService.getOwnDriverNotification(ownNotification.id, driverB.id)).rejects.toThrow(
      NotFoundError
    );
    await expect(notificationService.getOwnDriverNotification(adminNotification.id, driverA.id)).rejects.toThrow(
      NotFoundError
    );
  });
});
