import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as dispatchOfferService from "./dispatchOffer.service.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Phase 1 Dispatch Engine（简化版，见 dispatchOffer.service.ts 顶部注解）的核心流程测试：
 * Send Offer → 第一个 Accept 赢、其他自动关闭 → 逾时 Sweep。刻意不测 Eligibility/Ranking
 * 本身的规则细节——那些已经在 eligibility.test.ts / ranking.test.ts 独立测过，这里只测
 * dispatchOffer.service.ts 自己新增的编排逻辑。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

async function createOnlineIdleDriver(name: string) {
  const driver = await prisma.driver.create({ data: { name, isOnline: true, onlineSince: new Date() } });
  return driver;
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.dispatchOffer.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.driverLocation.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("dispatchOffer.service.ts (Phase 1 Dispatch Engine, simplified)", () => {
  it("sendOffer creates one PENDING offer per eligible driver, none for ineligible ones", async () => {
    const eligible = await createOnlineIdleDriver("Offer Eligible Driver");
    driverIds.push(eligible.id);
    const offline = await prisma.driver.create({ data: { name: "Offer Offline Driver" } });
    driverIds.push(offline.id);

    const booking = await bookingsService.createBooking(
      { girlName: "SendOfferBasic", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);

    expect(offers).toHaveLength(1);
    expect(offers[0]?.driverId).toBe(eligible.id);
    expect(offers[0]?.status).toBe("PENDING");
    expect(offers.some((o) => o.driverId === offline.id)).toBe(false);
  });

  it("sendOffer throws when the leg isn't in a waiting status", async () => {
    const driver = await createOnlineIdleDriver("Offer NonWaiting Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "SendOfferNonWaiting", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;
    await prisma.leg.update({ where: { id: leg.id }, data: { status: "ASSIGNED", driverId: driver.id } });

    await expect(dispatchOfferService.sendOffer(leg.id, systemActor)).rejects.toThrow(ConflictError);
  });

  it("sendOffer throws when there are no eligible drivers", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "SendOfferNoEligible", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await expect(dispatchOfferService.sendOffer(leg.id, systemActor)).rejects.toThrow(ConflictError);
  });

  it("sendOffer refuses to send a second batch while offers are still pending", async () => {
    const driver = await createOnlineIdleDriver("Offer Duplicate Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking(
      { girlName: "SendOfferDuplicate", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await dispatchOfferService.sendOffer(leg.id, systemActor);

    await expect(dispatchOfferService.sendOffer(leg.id, systemActor)).rejects.toThrow(ConflictError);
  });

  it("acceptOffer assigns the leg to the winning driver and closes sibling offers", async () => {
    const winner = await createOnlineIdleDriver("Offer Winner Driver");
    driverIds.push(winner.id);
    const loser = await createOnlineIdleDriver("Offer Loser Driver");
    driverIds.push(loser.id);

    const booking = await bookingsService.createBooking(
      { girlName: "AcceptOfferWinner", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const winningOffer = offers.find((o) => o.driverId === winner.id)!;
    const losingOffer = offers.find((o) => o.driverId === loser.id)!;

    const updatedLeg = await dispatchOfferService.acceptOffer(winner.id, winningOffer.id);

    expect(updatedLeg.status).toBe("ASSIGNED");
    expect(updatedLeg.driverId).toBe(winner.id);

    const refreshedLosing = await prisma.dispatchOffer.findUniqueOrThrow({ where: { id: losingOffer.id } });
    expect(refreshedLosing.status).toBe("EXPIRED");

    const refreshedWinning = await prisma.dispatchOffer.findUniqueOrThrow({ where: { id: winningOffer.id } });
    expect(refreshedWinning.status).toBe("ACCEPTED");
  });

  it("acceptOffer is a race: only one of two simultaneous accepts wins", async () => {
    const driverA = await createOnlineIdleDriver("Offer Race Driver A");
    driverIds.push(driverA.id);
    const driverB = await createOnlineIdleDriver("Offer Race Driver B");
    driverIds.push(driverB.id);

    const booking = await bookingsService.createBooking(
      { girlName: "AcceptOfferRace", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const offerA = offers.find((o) => o.driverId === driverA.id)!;
    const offerB = offers.find((o) => o.driverId === driverB.id)!;

    const results = await Promise.allSettled([
      dispatchOfferService.acceptOffer(driverA.id, offerA.id),
      dispatchOfferService.acceptOffer(driverB.id, offerB.id)
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(finalLeg.status).toBe("ASSIGNED");
    expect([driverA.id, driverB.id]).toContain(finalLeg.driverId);
  });

  it("acceptOffer rejects an offer that isn't owned by the calling driver", async () => {
    const driver = await createOnlineIdleDriver("Offer NotOwned Driver");
    driverIds.push(driver.id);
    const stranger = await createOnlineIdleDriver("Offer Stranger Driver");
    driverIds.push(stranger.id);

    const booking = await bookingsService.createBooking(
      { girlName: "AcceptOfferNotOwned", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const offer = offers.find((o) => o.driverId === driver.id)!;

    await expect(dispatchOfferService.acceptOffer(stranger.id, offer.id)).rejects.toThrow(NotFoundError);
  });

  it("acceptOffer rejects an already-expired offer", async () => {
    const driver = await createOnlineIdleDriver("Offer Expired Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      { girlName: "AcceptOfferExpired", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const offer = offers.find((o) => o.driverId === driver.id)!;
    await prisma.dispatchOffer.update({ where: { id: offer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(dispatchOfferService.acceptOffer(driver.id, offer.id)).rejects.toThrow(ConflictError);
  });

  it("declineOffer marks the offer DECLINED without touching the leg", async () => {
    const driver = await createOnlineIdleDriver("Offer Decline Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      { girlName: "DeclineOfferBasic", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const offer = offers.find((o) => o.driverId === driver.id)!;

    await dispatchOfferService.declineOffer(driver.id, offer.id);

    const refreshedOffer = await prisma.dispatchOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(refreshedOffer.status).toBe("DECLINED");

    const refreshedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(refreshedLeg.status).toBe("PENDING");
  });

  it("declineOffer rejects declining an offer twice", async () => {
    const driver = await createOnlineIdleDriver("Offer DoubleDecline Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      { girlName: "DeclineOfferTwice", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
    const offer = offers.find((o) => o.driverId === driver.id)!;

    await dispatchOfferService.declineOffer(driver.id, offer.id);
    await expect(dispatchOfferService.declineOffer(driver.id, offer.id)).rejects.toThrow(ConflictError);
  });

  it("listMyPendingOffers only returns the given driver's PENDING, unexpired offers", async () => {
    const driverA = await createOnlineIdleDriver("Offer List Driver A");
    driverIds.push(driverA.id);
    const driverB = await createOnlineIdleDriver("Offer List Driver B");
    driverIds.push(driverB.id);

    const booking = await bookingsService.createBooking(
      { girlName: "ListMyPendingOffers", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await dispatchOfferService.sendOffer(leg.id, systemActor);

    const listA = await dispatchOfferService.listMyPendingOffers(driverA.id);
    const listB = await dispatchOfferService.listMyPendingOffers(driverB.id);

    expect(listA).toHaveLength(1);
    expect(listA[0]?.leg.id).toBe(leg.id);
    expect(listB).toHaveLength(1);
  });

  it("sweepExpiredOffers expires only PENDING offers past their expiresAt", async () => {
    const driverExpired = await createOnlineIdleDriver("Offer Sweep Expired Driver");
    driverIds.push(driverExpired.id);
    const driverFresh = await createOnlineIdleDriver("Offer Sweep Fresh Driver");
    driverIds.push(driverFresh.id);

    const bookingExpired = await bookingsService.createBooking(
      { girlName: "SweepExpiredBooking", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(bookingExpired.id);
    const bookingFresh = await bookingsService.createBooking(
      { girlName: "SweepFreshBooking", totalAmountCents: 0, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
      systemActor
    );
    bookingIds.push(bookingFresh.id);

    const expiredOffers = await dispatchOfferService.sendOffer(bookingExpired.legs[0].id, systemActor);
    const freshOffers = await dispatchOfferService.sendOffer(bookingFresh.legs[0].id, systemActor);
    await prisma.dispatchOffer.update({
      where: { id: expiredOffers[0]!.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const sweptCount = await dispatchOfferService.sweepExpiredOffers();
    expect(sweptCount).toBeGreaterThanOrEqual(1);

    const refreshedExpired = await prisma.dispatchOffer.findUniqueOrThrow({ where: { id: expiredOffers[0]!.id } });
    expect(refreshedExpired.status).toBe("EXPIRED");

    const refreshedFresh = await prisma.dispatchOffer.findUniqueOrThrow({ where: { id: freshOffers[0]!.id } });
    expect(refreshedFresh.status).toBe("PENDING");

    // Leg 本身完全不受 Sweep 影响，还是留在 Waiting Bookings 名单里，等 Dispatcher 手动处理。
    const legAfterSweep = await prisma.leg.findUniqueOrThrow({ where: { id: bookingExpired.legs[0].id } });
    expect(legAfterSweep.status).toBe("PENDING");
  });
});
