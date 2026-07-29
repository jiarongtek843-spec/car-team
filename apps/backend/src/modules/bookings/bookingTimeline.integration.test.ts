import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "./bookings.service.js";
import * as legsService from "./legs.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import { getBookingTimeline } from "./bookingTimeline.service.js";
import { NotFoundError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Booking Timeline（standalone feature，2026-07）：只读既有栏位组出时间轴，不碰
 * Dispatch/DriverJobs 既有写入逻辑，这里只验证「读出来的东西对不对」。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name, status: "ACTIVE" } });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.dispatchOffer.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Booking Timeline：事件推导", () => {
  it("Booking 不存在时丢 NotFoundError", async () => {
    await expect(getBookingTimeline(999999999)).rejects.toThrow(NotFoundError);
  });

  it("刚建立、没有任何 Leg 进度的 Booking：只有 Booking Created 一笔事件", async () => {
    const booking = await bookingsService.createBooking({ girlName: "TimelineFresh", totalAmountCents: 6000 }, systemActor);
    bookingIds.push(booking.id);

    const timeline = await getBookingTimeline(booking.id);

    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0].type).toBe("BOOKING_CREATED");
  });

  it("Manual Quick Assign 路径：Driver Accepted 有 driver 资讯，且没有 Offer Sent 事件", async () => {
    const driver = await createTestDriver("Manual Assign Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "TimelineManual", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const legId = booking.legs[0].id;

    await legsService.assignDriver(booking.id, legId, driver.id);
    await driverJobsService.acceptLeg(driver.id, legId);
    await driverJobsService.markDriverArriving(driver.id, legId);
    await driverJobsService.markPassengerOnBoard(driver.id, legId);
    await driverJobsService.completeLeg(driver.id, legId, systemActor);

    const timeline = await getBookingTimeline(booking.id);
    const types = timeline.events.map((e) => e.type);

    expect(types).toEqual(["BOOKING_CREATED", "DRIVER_ACCEPTED", "DRIVER_ARRIVED", "PASSENGER_ON_BOARD", "COMPLETED"]);
    expect(timeline.events.find((e) => e.type === "DRIVER_ACCEPTED")?.driver).toEqual({ id: driver.id, name: driver.name });
    expect(timeline.events.find((e) => e.type === "COMPLETED")?.driver).toEqual({ id: driver.id, name: driver.name });
  });

  it("Dispatch Offer 路径：Offer Sent 只出现一次（去重同一批），且在 Driver Accepted 之前", async () => {
    // 刻意不走 dispatchOfferService.sendOffer()——那会读全域「目前在线的 Driver」名单
    // （Eligibility Engine），跟同时在跑的 dispatchOffer.integration.test.ts 共用同一个
    // 开发库会互相干扰（各自建的在线 Driver 会被对方的 sendOffer 看到）。这里要测的只是
    // Timeline 怎么把「同一批 DispatchOffer」去重成一个事件，不是 Eligibility 本身
    // （eligibility.test.ts 已经测过），所以直接建 DispatchOffer row 更精准也更稳定。
    const driverA = await createTestDriver("Offer Driver A");
    const driverB = await createTestDriver("Offer Driver B");
    driverIds.push(driverA.id, driverB.id);
    const booking = await bookingsService.createBooking(
      { girlName: "TimelineOffer", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const legId = booking.legs[0].id;

    const offeredAt = new Date();
    const expiresAt = new Date(offeredAt.getTime() + 60_000);
    await prisma.dispatchOffer.createMany({
      data: [
        { legId, driverId: driverA.id, offeredAt, expiresAt },
        { legId, driverId: driverB.id, offeredAt, expiresAt }
      ]
    });

    await legsService.assignDriver(booking.id, legId, driverA.id);
    await driverJobsService.acceptLeg(driverA.id, legId);

    const timeline = await getBookingTimeline(booking.id);
    const offerSentEvents = timeline.events.filter((e) => e.type === "OFFER_SENT");
    const acceptedIndex = timeline.events.findIndex((e) => e.type === "DRIVER_ACCEPTED");
    const offerIndex = timeline.events.findIndex((e) => e.type === "OFFER_SENT");

    expect(offerSentEvents).toHaveLength(1);
    expect(offerSentEvents[0].driver).toBeNull();
    expect(offerIndex).toBeLessThan(acceptedIndex);
    expect(timeline.events[acceptedIndex].driver).toEqual({ id: driverA.id, name: driverA.name });
  });

  it("多个 Leg（去程/回程）各自的事件都带上 legId/legSequence，并整体按时间排序", async () => {
    const driver = await createTestDriver("Multi Leg Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      {
        girlName: "TimelineMultiLeg",
        totalAmountCents: 12000,
        legs: [
          { legType: "OUTBOUND", pickupLocation: "A", dropoffLocation: "B" },
          { legType: "RETURN", pickupLocation: "B", dropoffLocation: "A" }
        ]
      },
      systemActor
    );
    bookingIds.push(booking.id);
    const outboundLegId = booking.legs[0].id;

    await legsService.assignDriver(booking.id, outboundLegId, driver.id);
    await driverJobsService.acceptLeg(driver.id, outboundLegId);

    const timeline = await getBookingTimeline(booking.id);
    const acceptedEvent = timeline.events.find((e) => e.type === "DRIVER_ACCEPTED");

    expect(acceptedEvent?.legId).toBe(outboundLegId);
    expect(acceptedEvent?.legSequence).toBe(1);
    expect(acceptedEvent?.legType).toBe("OUTBOUND");

    const timestamps = timeline.events.map((e) => new Date(e.timestamp).getTime());
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });

  it("是唯读操作：读取 Timeline 前后 Leg/Booking 资料完全不变", async () => {
    const driver = await createTestDriver("ReadOnly Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "TimelineReadOnly", totalAmountCents: 6000, legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }] },
      systemActor
    );
    bookingIds.push(booking.id);

    const before = await prisma.leg.findUniqueOrThrow({ where: { id: booking.legs[0].id } });
    await getBookingTimeline(booking.id);
    const after = await prisma.leg.findUniqueOrThrow({ where: { id: booking.legs[0].id } });

    expect(after).toEqual(before);
  });
});
