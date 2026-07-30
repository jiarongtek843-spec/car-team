import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as gpsService from "./gps.service.js";
import { ConflictError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

async function fastForwardToOnBoard(legId: number, driverId: number) {
  await prisma.leg.update({ where: { id: legId }, data: { driverId, status: "PASSENGER_ON_BOARD" } });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.driverLocation.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("GPS live tracking (Module 5 scenarios)", () => {
  it("goOnline/goOffline toggle isOnline and onlineSince", async () => {
    const driver = await createTestDriver("Presence Toggle Driver");
    driverIds.push(driver.id);

    const online = await gpsService.goOnline(driver.id, systemActor);
    expect(online.isOnline).toBe(true);
    expect(online.onlineSince).not.toBeNull();

    const offline = await gpsService.goOffline(driver.id, systemActor);
    expect(offline.isOnline).toBe(false);
    expect(offline.onlineSince).toBeNull();
  });

  it("Mobile UAT Bug Fix：goOnline 之后立刻查 getDriverPresence（不用等任何 GPS ping）就是 ONLINE，不是 OFFLINE/undefined", async () => {
    // 对应 driverPresence.controller.ts 的 goOnline/goOffline：现在直接在同一个 request 里
    // 呼叫 gpsService.goOnline 再呼叫 gpsService.getDriverPresence 组成回应，这里锁定这个
    // 组合本身产生的结果是正确的——真实设备上曾经出现「点了上线、Toast 显示成功，但 Header/
    // 首页读到的 presence 还是 Offline」，根因之一就是没有验证过这个组合值是否真的立刻是 ONLINE。
    const driver = await createTestDriver("Immediate Online Presence Driver");
    driverIds.push(driver.id);

    await gpsService.goOnline(driver.id, systemActor);
    const presence = await gpsService.getDriverPresence(driver.id);
    expect(presence.status).toBe("ONLINE");

    await gpsService.goOffline(driver.id, systemActor);
    const presenceAfterOffline = await gpsService.getDriverPresence(driver.id);
    expect(presenceAfterOffline.status).toBe("OFFLINE");
  });

  it("Mobile UAT Bug Fix：重新上线时，DB 里留着上一次上线时的旧定位也不会被误判成 Offline（Railway 实测根因）", async () => {
    // 完整重现 Railway Staging 抓到的真实场景：Driver 之前上线过、收到过一次 GPS ping
    // （DriverLocation 因此有资料），然后下线（DriverLocation 不会被清掉，继续留着这笔
    // 旧资料）。现在重新点上线：旧版逻辑会用那笔旧定位的时间当新鲜度基准，判定成
    // 「太久没更新」→ OFFLINE，还会被 selfHealStaleOnlineDrivers 在同一个 request 里
    // 把刚设成 true 的 isOnline 打回 false，导致 goOnline 自己的 response 都已经是
    // Offline，Toast 显示成功但画面永远显示 Offline。
    const driver = await createTestDriver("Stale Location Reonline Driver");
    driverIds.push(driver.id);

    await gpsService.goOnline(driver.id, systemActor);
    await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 });
    await gpsService.goOffline(driver.id, systemActor);

    // 模拟这笔旧定位是很久以前留下来的（不是刚刚那次 ping 的真实时间）。
    await prisma.driverLocation.update({
      where: { driverId: driver.id },
      data: { receivedAt: new Date(Date.now() - 28 * 60 * 60 * 1000) }
    });

    await gpsService.goOnline(driver.id, systemActor);
    const presence = await gpsService.getDriverPresence(driver.id);
    expect(presence.status).toBe("ONLINE");

    const reloadedDriver = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(reloadedDriver.isOnline).toBe(true);
  });

  it("rejects a GPS ping when the driver has not gone online", async () => {
    const driver = await createTestDriver("Offline Ping Driver");
    driverIds.push(driver.id);

    await expect(
      gpsService.recordPing(driver.id, { latitude: 3.139, longitude: 101.6869 })
    ).rejects.toThrow(ConflictError);
  });

  it("recordPing upserts a single latest location row instead of accumulating history", async () => {
    const driver = await createTestDriver("Ping Upsert Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);

    await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 });
    await gpsService.recordPing(driver.id, { latitude: 3.2, longitude: 101.7 });

    const count = await prisma.driverLocation.count({ where: { driverId: driver.id } });
    expect(count).toBe(1);

    const location = await prisma.driverLocation.findUniqueOrThrow({ where: { driverId: driver.id } });
    expect(location.latitude).toBe(3.2);
    expect(location.longitude).toBe(101.7);
  });

  it("getDriverPresence reports the active leg's status instead of plain ONLINE when GPS is fresh", async () => {
    const driver = await createTestDriver("Active Leg Presence Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking({ girlName: "GpsActiveLeg", totalAmountCents: 0 });
    bookingIds.push(booking.id);
    const leg = await prisma.leg.create({
      data: { bookingId: booking.id, sequence: 1, driverId: driver.id, status: "ASSIGNED" }
    });

    await gpsService.goOnline(driver.id, systemActor);
    await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 });

    const presence = await gpsService.getDriverPresence(driver.id);
    expect(presence.status).toBe("ASSIGNED");
    expect(presence.activeLeg?.id).toBe(leg.id);
    expect(presence.location).not.toBeNull();
  });

  it("listDriverPresence self-heals a driver whose GPS has been stale past the auto-offline threshold", async () => {
    const driver = await createTestDriver("Stale Presence Driver");
    driverIds.push(driver.id);

    await gpsService.goOnline(driver.id, systemActor);
    await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 });

    const staleTime = new Date(Date.now() - (gpsService.AUTO_OFFLINE_THRESHOLD_SECONDS + 30) * 1000);
    // onlineSince 也要跟着往前推：Mobile UAT Bug Fix 之后，只有「不早于 onlineSince」的
    // 定位才会被拿来当新鲜度基准（不然会跟上一次上线留下的旧定位分不出来）。这里要模拟的是
    // 「这次持续在线期间最后一个 ping 之后就没再更新」，不是「上一次上线留下的旧定位」，
    // 所以 onlineSince 要跟着一起往前推，不能只改 location 的时间。
    await prisma.driver.update({ where: { id: driver.id }, data: { onlineSince: staleTime } });
    await prisma.driverLocation.update({ where: { driverId: driver.id }, data: { receivedAt: staleTime } });

    const list = await gpsService.listDriverPresence(false);
    const entry = list.find((p) => p.driver.id === driver.id);
    expect(entry?.status).toBe("OFFLINE");

    const reloaded = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(reloaded.isOnline).toBe(false);
  });

  it("GPS failures never block completing a leg -- Booking works even if the driver never went online", async () => {
    const driver = await createTestDriver("No GPS Ever Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "GpsIndependence",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);

    // Driver 从来没有 Go Online、也没有上传过任何一次 GPS。
    const presenceBefore = await gpsService.getDriverPresence(driver.id);
    expect(presenceBefore.status).toBe("OFFLINE");
    expect(presenceBefore.location).toBeNull();

    const completed = await driverJobsService.completeLeg(driver.id, leg.id, systemActor);
    expect(completed.status).toBe("COMPLETED");
  });

  it("Mobile UAT Round 2 Bug Fix：完成一趟行程之后重新上线，Presence 显示 ONLINE 而不是 COMPLETED", async () => {
    // Driver App 右上角状态徽章之前误显示 Completed：找「这个 Driver 手上的 Leg」时用错
    // 了包含 COMPLETED 的 ACTIVE_LEG_STATUSES（那是给 Booking Status 推导用的），导致
    // 刚完成一趟行程、还没接到下一趟的 Driver，presence 会被这笔已经结束的 Leg 盖过去。
    const driver = await createTestDriver("Completed Then Online Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "CompletedThenOnline",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    await gpsService.goOnline(driver.id, systemActor);
    const presence = await gpsService.getDriverPresence(driver.id);
    expect(presence.status).toBe("ONLINE");

    const list = await gpsService.listDriverPresence(false);
    const entry = list.find((p) => p.driver.id === driver.id);
    expect(entry?.status).toBe("ONLINE");
  });
});

describe("GPS Foundation (accuracy + DriverPresence-gated location reporting)", () => {
  it("stores and returns the optional accuracy field", async () => {
    const driver = await createTestDriver("Accuracy Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);

    const location = await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6, accuracy: 12.5 });
    expect(location.accuracy).toBe(12.5);

    const reloaded = await prisma.driverLocation.findUniqueOrThrow({ where: { driverId: driver.id } });
    expect(reloaded.accuracy).toBe(12.5);
  });

  it("accepts a ping with no accuracy (still optional)", async () => {
    const driver = await createTestDriver("No Accuracy Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);

    const location = await gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 });
    expect(location.accuracy).toBeNull();
  });

  it("rejects a negative accuracy value", async () => {
    const driver = await createTestDriver("Negative Accuracy Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);

    await expect(
      gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6, accuracy: -1 })
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a ping while DriverPresence is ACCEPTED_JOB (not just plain AVAILABLE)", async () => {
    const driver = await createTestDriver("Accepted Job Presence Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);
    await prisma.driverPresence.update({ where: { driverId: driver.id }, data: { status: "ACCEPTED_JOB" } });

    await expect(gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 })).resolves.toBeTruthy();
  });

  it("rejects a ping while DriverPresence is BREAK, even though the legacy isOnline flag is still true", async () => {
    const driver = await createTestDriver("Break Presence Driver");
    driverIds.push(driver.id);
    await gpsService.goOnline(driver.id, systemActor);
    await prisma.driverPresence.update({ where: { driverId: driver.id }, data: { status: "BREAK" } });

    await expect(
      gpsService.recordPing(driver.id, { latitude: 3.1, longitude: 101.6 })
    ).rejects.toThrow(ConflictError);

    const reloadedDriver = await prisma.driver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(reloadedDriver.isOnline).toBe(true);
  });

  it("getDriverLocations (Admin Get Driver Locations API) only returns latest location for drivers currently reporting", async () => {
    const reporting = await createTestDriver("Reporting Locations Driver");
    const offline = await createTestDriver("Offline Locations Driver");
    driverIds.push(reporting.id, offline.id);

    await gpsService.goOnline(reporting.id, systemActor);
    await gpsService.recordPing(reporting.id, { latitude: 3.15, longitude: 101.71, accuracy: 8 });

    await gpsService.goOnline(offline.id, systemActor);
    await gpsService.recordPing(offline.id, { latitude: 3.16, longitude: 101.72 });
    await gpsService.goOffline(offline.id, systemActor);

    const locations = await gpsService.getDriverLocations();
    const reportingEntry = locations.find((l) => l.driverId === reporting.id);
    const offlineEntry = locations.find((l) => l.driverId === offline.id);

    expect(reportingEntry).toMatchObject({
      driverId: reporting.id,
      driverName: "Reporting Locations Driver",
      latitude: 3.15,
      longitude: 101.71,
      accuracy: 8
    });
    expect(reportingEntry?.updatedAt).toBeInstanceOf(Date);
    expect(offlineEntry).toBeUndefined();
  });
});
