import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as gpsService from "../gps/gps.service.js";
import * as matchingService from "./matching.service.js";
import { NotFoundError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

/** goOnline 之后 Driver Presence 会自动变成 AVAILABLE（GPS Foundation 的订阅规则）。 */
async function makeAvailable(driverId: number, actor: AuditActor, location?: { latitude: number; longitude: number }) {
  await gpsService.goOnline(driverId, actor);
  if (location) {
    await gpsService.recordPing(driverId, location);
  }
}

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.driverLocation.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Driver Matching Engine (GET /api/admin/dispatch/matching/:bookingId)", () => {
  it("throws NotFoundError for a booking that does not exist", async () => {
    await expect(matchingService.matchDriversForBooking(999999999)).rejects.toThrow(NotFoundError);
  });

  it("orders AVAILABLE drivers nearest-first when pickup and driver coordinates are both present", async () => {
    const near = await createTestDriver("Near Driver");
    const far = await createTestDriver("Far Driver");
    driverIds.push(near.id, far.id);

    // Kuala Lumpur-ish pickup point.
    const booking = await bookingsService.createBooking({
      girlName: "MatchingDistanceTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A", pickupLatitude: 3.139, pickupLongitude: 101.6869 }]
    });
    bookingIds.push(booking.id);

    await makeAvailable(near.id, systemActor, { latitude: 3.14, longitude: 101.687 });
    await makeAvailable(far.id, systemActor, { latitude: 1.4927, longitude: 103.7414 }); // Johor Bahru, far away

    const result = await matchingService.matchDriversForBooking(booking.id);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].driverName).toBe("Near Driver");
    expect(result.candidates[0].distanceKm).not.toBeNull();
    expect(result.candidates[1].driverName).toBe("Far Driver");
    expect(result.candidates[0].distanceKm!).toBeLessThan(result.candidates[1].distanceKm!);
    expect(result.candidates[0].rank).toBe(1);
    expect(result.candidates[1].rank).toBe(2);
  });

  it("excludes OFFLINE drivers", async () => {
    const offline = await createTestDriver("Offline Driver");
    driverIds.push(offline.id);
    // Never goes online -- presence defaults to OFFLINE.

    const booking = await bookingsService.createBooking({
      girlName: "MatchingOfflineTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A" }]
    });
    bookingIds.push(booking.id);

    const result = await matchingService.matchDriversForBooking(booking.id);
    expect(result.candidates.map((c) => c.driverId)).not.toContain(offline.id);
  });

  it("excludes Busy drivers (PENDING_OFFER/ACCEPTED_JOB/ON_TRIP)", async () => {
    const busy = await createTestDriver("Busy Driver");
    driverIds.push(busy.id);
    await makeAvailable(busy.id, systemActor);
    await prisma.driverPresence.update({ where: { driverId: busy.id }, data: { status: "ON_TRIP" } });

    const booking = await bookingsService.createBooking({
      girlName: "MatchingBusyTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A" }]
    });
    bookingIds.push(booking.id);

    const result = await matchingService.matchDriversForBooking(booking.id);
    expect(result.candidates.map((c) => c.driverId)).not.toContain(busy.id);
  });

  it("excludes drivers on BREAK", async () => {
    const onBreak = await createTestDriver("Break Driver");
    driverIds.push(onBreak.id);
    await makeAvailable(onBreak.id, systemActor);
    await prisma.driverPresence.update({ where: { driverId: onBreak.id }, data: { status: "BREAK" } });

    const booking = await bookingsService.createBooking({
      girlName: "MatchingBreakTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A" }]
    });
    bookingIds.push(booking.id);

    const result = await matchingService.matchDriversForBooking(booking.id);
    expect(result.candidates.map((c) => c.driverId)).not.toContain(onBreak.id);
  });

  it("still returns eligible drivers with distanceKm: null when the leg has no pickup coordinates", async () => {
    const driver = await createTestDriver("No Pickup Coords Driver");
    driverIds.push(driver.id);
    await makeAvailable(driver.id, systemActor, { latitude: 3.14, longitude: 101.687 });

    const booking = await bookingsService.createBooking({
      girlName: "MatchingNoPickupCoordsTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A" }] // no pickupLatitude/pickupLongitude
    });
    bookingIds.push(booking.id);

    const result = await matchingService.matchDriversForBooking(booking.id);
    expect(result.pickupLatitude).toBeNull();
    const entry = result.candidates.find((c) => c.driverId === driver.id);
    expect(entry).toBeTruthy();
    expect(entry?.distanceKm).toBeNull();
  });

  it("returns Driver Name / Status / Current Booking / Last GPS Update for each candidate", async () => {
    const driver = await createTestDriver("Full Payload Driver");
    driverIds.push(driver.id);
    await makeAvailable(driver.id, systemActor, { latitude: 3.14, longitude: 101.687 });

    const booking = await bookingsService.createBooking({
      girlName: "MatchingPayloadTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A", pickupLatitude: 3.139, pickupLongitude: 101.6869 }]
    });
    bookingIds.push(booking.id);

    const result = await matchingService.matchDriversForBooking(booking.id);
    const entry = result.candidates.find((c) => c.driverId === driver.id);

    expect(entry).toMatchObject({
      driverName: "Full Payload Driver",
      status: "AVAILABLE",
      currentBooking: null
    });
    expect(entry?.lastGpsUpdateAt).toBeInstanceOf(Date);
    expect(typeof entry?.distanceKm).toBe("number");
  });

  it("does not auto-assign anyone -- the leg stays PENDING with no driver", async () => {
    const driver = await createTestDriver("No Auto Assign Driver");
    driverIds.push(driver.id);
    await makeAvailable(driver.id, systemActor, { latitude: 3.14, longitude: 101.687 });

    const booking = await bookingsService.createBooking({
      girlName: "MatchingNoAutoAssignTest",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "Pickup A", pickupLatitude: 3.139, pickupLongitude: 101.6869 }]
    });
    bookingIds.push(booking.id);

    await matchingService.matchDriversForBooking(booking.id);

    const reloadedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: booking.legs[0].id } });
    expect(reloadedLeg.status).toBe("PENDING");
    expect(reloadedLeg.driverId).toBeNull();
  });
});
