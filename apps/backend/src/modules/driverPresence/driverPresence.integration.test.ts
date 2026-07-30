import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import { createActivity } from "../activityLog/activityLog.service.js";
import * as driverPresenceService from "./driverPresence.service.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as legsService from "../bookings/legs.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as gpsService from "../gps/gps.service.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Driver Presence：Dispatch/DriverJobs 的 Offer 相关事件（OFFER_SENT/OFFER_ACCEPTED/
 * OFFER_DECLINED/OFFER_EXPIRED）刻意不透过真的 sendOffer()/acceptOffer() 走——那些会用到
 * Eligibility Engine（读全域「目前在线的 Driver」），跟同时在跑的
 * dispatchOffer.integration.test.ts 共用同一个开发库会互相干扰（先前 Booking Timeline 那次
 * 就撞过一次）。这里直接呼叫 createActivity() 模拟这些事件，精准测 driverPresence.service.ts
 * 的订阅逻辑本身对不对；assignDriver/cancelLeg/driverJobs/GPS 这些不牵涉 Eligibility Engine
 * 的路径，则走真正的 service 函式，确保「呼叫真的 createActivity()」这件事本身也有被验证到。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

let driverIds: number[] = [];
let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.activityLog.deleteMany({ where: { OR: [{ subjectDriverId: { in: driverIds } }, { actorDriverId: { in: driverIds } }] } });
  await prisma.driverPresence.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  driverIds = [];
  bookingIds = [];
});

async function createTestDriver(name: string) {
  const driver = await prisma.driver.create({ data: { name } });
  driverIds.push(driver.id);
  return driver;
}

async function createTestLeg(girlName: string) {
  const booking = await bookingsService.createBooking(
    { girlName, totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
    systemActor
  );
  bookingIds.push(booking.id);
  return { booking, legId: booking.legs[0].id };
}

describe("driverPresence.service.ts：Dispatch Offer 事件（直接模拟 Activity，绕过 Eligibility Engine）", () => {
  it("OFFER_SENT：司机变成 PENDING_OFFER，带上 currentBookingId/currentLegId", async () => {
    const driver = await createTestDriver("Presence Offer Driver");
    const { booking, legId } = await createTestLeg("PresenceOfferSent");

    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer sent",
      subjectDriverId: driver.id
    });

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("PENDING_OFFER");
    expect(presence?.currentBooking?.id).toBe(booking.id);
    expect(presence?.currentLeg?.id).toBe(legId);
    expect(presence?.lastSeenAt).not.toBeNull();
  });

  it("OFFER_ACCEPTED：赢家变 ACCEPTED_JOB，同一个 Leg 上其他 PENDING_OFFER 的陪标者 reset 回 AVAILABLE", async () => {
    const winner = await createTestDriver("Presence Winner");
    const loser = await createTestDriver("Presence Loser");
    const { legId } = await createTestLeg("PresenceOfferAccepted");

    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer sent",
      subjectDriverId: winner.id
    });
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer sent",
      subjectDriverId: loser.id
    });
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_ACCEPTED",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer accepted",
      subjectDriverId: winner.id
    });

    const winnerPresence = await driverPresenceService.getPresenceForDriver(winner.id);
    const loserPresence = await driverPresenceService.getPresenceForDriver(loser.id);

    expect(winnerPresence?.status).toBe("ACCEPTED_JOB");
    expect(winnerPresence?.currentLeg?.id).toBe(legId);
    expect(loserPresence?.status).toBe("AVAILABLE");
    expect(loserPresence?.currentLeg).toBeNull();
  });

  it("OFFER_DECLINED：只在司机目前跟踪的 Leg 就是这个事件的 Leg 时才 reset 回 AVAILABLE", async () => {
    const driver = await createTestDriver("Presence Decline Driver");
    const { legId } = await createTestLeg("PresenceOfferDeclined");

    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer sent",
      subjectDriverId: driver.id
    });
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_DECLINED",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer declined",
      subjectDriverId: driver.id
    });

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
    expect(presence?.currentBooking).toBeNull();
  });

  it("OFFER_EXPIRED：逾时未回应一样 reset 回 AVAILABLE", async () => {
    const driver = await createTestDriver("Presence Expired Driver");
    const { legId } = await createTestLeg("PresenceOfferExpired");

    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer sent",
      subjectDriverId: driver.id
    });
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_EXPIRED",
      entityType: "Leg",
      entityId: legId,
      summary: "Offer expired",
      subjectDriverId: driver.id
    });

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
  });

  it("过期事件不会误盖掉司机已经在跑的新工作（陈旧事件的自我保护）", async () => {
    const driver = await createTestDriver("Presence Stale Event Driver");
    const { legId: oldLegId } = await createTestLeg("PresenceStaleOld");
    const { legId: newLegId } = await createTestLeg("PresenceStaleNew");

    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: oldLegId,
      summary: "Offer sent (old)",
      subjectDriverId: driver.id
    });
    // 司机改去跟另一个 Leg 的 Offer（模拟先前那笔逾时之前，司机已经先接了别的）。
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_SENT",
      entityType: "Leg",
      entityId: newLegId,
      summary: "Offer sent (new)",
      subjectDriverId: driver.id
    });
    // 旧的那笔才姗姗来迟地被判定逾时——不该把司机目前正在跟踪的新 Leg 清掉。
    await createActivity({
      module: "DISPATCH",
      activityType: "OFFER_EXPIRED",
      entityType: "Leg",
      entityId: oldLegId,
      summary: "Offer expired (old, stale)",
      subjectDriverId: driver.id
    });

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("PENDING_OFFER");
    expect(presence?.currentLeg?.id).toBe(newLegId);
  });
});

describe("driverPresence.service.ts：Manual Assign / Cancel（真的走 legs.service.ts）", () => {
  it("assignDriver：司机变成 ACCEPTED_JOB", async () => {
    const driver = await createTestDriver("Presence Assign Driver");
    const { booking, legId } = await createTestLeg("PresenceAssign");

    await legsService.assignDriver(booking.id, legId, driver.id);

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ACCEPTED_JOB");
    expect(presence?.currentBooking?.id).toBe(booking.id);
    expect(presence?.currentLeg?.id).toBe(legId);
  });

  it("cancelLeg：已指派司机的 Leg 被取消，司机 reset 回 AVAILABLE", async () => {
    const driver = await createTestDriver("Presence Cancel Driver");
    const { booking, legId } = await createTestLeg("PresenceCancel");

    await legsService.assignDriver(booking.id, legId, driver.id);
    await legsService.cancelLeg(booking.id, legId);

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
    expect(presence?.currentLeg).toBeNull();
  });
});

describe("driverPresence.service.ts：Driver Job 状态机全流程（真的走 driverJobs.service.ts）", () => {
  it("Accept -> Driver Arriving -> Passenger On Board -> Completed 完整跑一遍，Presence 跟着正确转换", async () => {
    const driver = await createTestDriver("Presence Job Lifecycle Driver");
    const { booking, legId } = await createTestLeg("PresenceJobLifecycle");

    await legsService.assignDriver(booking.id, legId, driver.id);
    let presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ACCEPTED_JOB");

    await driverJobsService.acceptLeg(driver.id, legId);
    presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ACCEPTED_JOB");

    await driverJobsService.markDriverArriving(driver.id, legId);
    presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ON_TRIP");

    await driverJobsService.markPassengerOnBoard(driver.id, legId);
    presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ON_TRIP");

    await driverJobsService.completeLeg(driver.id, legId, systemActor);
    presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
    expect(presence?.currentBooking).toBeNull();
    expect(presence?.currentLeg).toBeNull();
    expect(presence?.lastSeenAt).not.toBeNull();
  });

  it("rejectLeg：司机拒绝已指派的工作，reset 回 AVAILABLE", async () => {
    const driver = await createTestDriver("Presence Reject Driver");
    const { booking, legId } = await createTestLeg("PresenceReject");

    await legsService.assignDriver(booking.id, legId, driver.id);
    await driverJobsService.rejectLeg(driver.id, legId, "太远了");

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
  });
});

describe("driverPresence.service.ts：GPS Go Online/Offline（真的走 gps.service.ts）", () => {
  it("goOnline：OFFLINE 的司机变成 AVAILABLE", async () => {
    const driver = await createTestDriver("Presence GPS Driver");

    await gpsService.goOnline(driver.id, systemActor);

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("AVAILABLE");
  });

  it("goOnline 不会盖掉正在跑的工作（例如司机 App 断线重连触发重新上线）", async () => {
    const driver = await createTestDriver("Presence GPS Reconnect Driver");
    const { booking, legId } = await createTestLeg("PresenceGpsReconnect");

    await gpsService.goOnline(driver.id, systemActor);
    await legsService.assignDriver(booking.id, legId, driver.id);
    await driverJobsService.acceptLeg(driver.id, legId);
    await driverJobsService.markDriverArriving(driver.id, legId);

    await gpsService.goOnline(driver.id, systemActor);

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("ON_TRIP");
    expect(presence?.currentLeg?.id).toBe(legId);
  });

  it("goOffline：清空 current*，状态变 OFFLINE", async () => {
    const driver = await createTestDriver("Presence GPS Offline Driver");

    await gpsService.goOnline(driver.id, systemActor);
    await gpsService.goOffline(driver.id, systemActor);

    const presence = await driverPresenceService.getPresenceForDriver(driver.id);
    expect(presence?.status).toBe("OFFLINE");
    expect(presence?.currentBooking).toBeNull();
  });
});

describe("driverPresence.service.ts：listPresence()", () => {
  it("回传 ACTIVE 司机的现在状态，包含没有 DriverPresence 纪录的司机（fallback）", async () => {
    const withPresence = await createTestDriver("Presence List Driver A");
    const withoutPresence = await createTestDriver("Presence List Driver B");
    await gpsService.goOnline(withPresence.id, systemActor);
    // withoutPresence 刻意不呼叫任何会建立 DriverPresence 的动作，模拟 fallback 情境。

    const list = await driverPresenceService.listPresence();
    const a = list.find((p) => p.driverId === withPresence.id);
    const b = list.find((p) => p.driverId === withoutPresence.id);

    expect(a?.status).toBe("AVAILABLE");
    expect(b?.status).toBe("OFFLINE");
  });
});
