import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as gpsService from "./gps.service.js";
import { ConflictError } from "../../common/errors.js";
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
});
