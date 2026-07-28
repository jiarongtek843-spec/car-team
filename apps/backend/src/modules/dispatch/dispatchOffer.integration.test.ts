import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as dispatchOfferService from "./dispatchOffer.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
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
  // 新增的 Wallet 入帐回归测试会把 Leg 一路跑到 COMPLETED，连带产生
  // WalletTransaction/RevenueSharingSnapshot/BookingCharge，都要在删 Leg/Booking 之前
  // 先清掉，不然会撞 FK constraint（沿用 revenueSharing.wallet.integration.test.ts 的清理顺序）。
  await prisma.walletTransaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
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

  /**
   * UAT Bug 回归（Driver Income Not Credited to Wallet）：Dispatcher 用户实测报告「透过
   * Dispatch Offer 接单 → 完成行程，Driver Wallet 没有入帐」。实际追查下来后端逻辑本身是
   * 对的（acceptOffer 正确写入 Leg.driverId，completeLeg 照样能查到、照样触发
   * payoutForCompletedLeg）——问题出在前端 useCompleteLegMutation 没有 invalidate
   * ["wallet"] query，画面看起来像没入帐，其实后端已经记了帐。这里补的是后端这一段
   * 完整流程本身的回归测试，钉住「Dispatch Offer 接单」这条路径不会重蹈覆辙。
   */
  describe("Wallet 入帐回归（Dispatch Offer 接单 → Complete Job）", () => {
    it("Dispatch Offer 接单 → 完整跑完 Driver Job 状态机 → Complete 之后 Wallet 只入帐一次，driver/leg/booking 都对得上", async () => {
      const driver = await createOnlineIdleDriver("Wallet Regression Offer Driver");
      driverIds.push(driver.id);

      const booking = await bookingsService.createBooking(
        { girlName: "WalletRegressionOffer", totalAmountCents: 15000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
        systemActor
      );
      bookingIds.push(booking.id);
      const [leg] = booking.legs;

      const offers = await dispatchOfferService.sendOffer(leg.id, systemActor);
      const offer = offers.find((o) => o.driverId === driver.id)!;
      const assignedLeg = await dispatchOfferService.acceptOffer(driver.id, offer.id);

      // acceptOffer 只做 Leg 指派，这个当下不该有任何 Wallet Transaction。
      expect(assignedLeg.status).toBe("ASSIGNED");
      expect(assignedLeg.driverId).toBe(driver.id);
      const walletAfterAssign = await prisma.walletTransaction.findMany({ where: { legId: leg.id } });
      expect(walletAfterAssign).toHaveLength(0);

      await driverJobsService.acceptLeg(driver.id, leg.id);
      await driverJobsService.markDriverArriving(driver.id, leg.id);
      await driverJobsService.markPassengerOnBoard(driver.id, leg.id);
      const completedLeg = await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

      expect(completedLeg.status).toBe("COMPLETED");
      // completeLeg 直接回传的序列化结果就该带出这笔收入——跟 driverJobs.controller.ts
      // 回给前端的资料是同一份，Driver Portal 显示的 driverEarningCents 就是这个栏位。
      expect(completedLeg.driverEarningCents).not.toBeNull();
      expect(completedLeg.driverEarningCents).toBeGreaterThan(0);
      expect(completedLeg.walletStatus).toBe("PENDING");

      const walletAfterComplete = await prisma.walletTransaction.findMany({ where: { legId: leg.id } });
      expect(walletAfterComplete).toHaveLength(1);
      const [tx] = walletAfterComplete;
      expect(tx.driverId).toBe(driver.id);
      expect(tx.legId).toBe(leg.id);
      expect(tx.bookingId).toBe(booking.id);
      expect(tx.transactionType).toBe("REVENUE_SHARE_PAYOUT");
      expect(tx.amountCents).toBe(completedLeg.driverEarningCents);

      // 重复 Complete：Leg 状态机（applyLegTransition 的条件式 UPDATE）会直接挡下第二次
      // 转换，从未到达 Payout 逻辑——不会有第二笔 Wallet Transaction。
      await expect(driverJobsService.completeLeg(driver.id, leg.id, systemActor)).rejects.toThrow(ConflictError);
      const walletAfterDuplicateAttempt = await prisma.walletTransaction.findMany({ where: { legId: leg.id } });
      expect(walletAfterDuplicateAttempt).toHaveLength(1);
    });

    it("手动 Quick Assign（非 Dispatch Offer）→ Complete Job → Wallet 一样只入帐一次，两条指派路径行为一致", async () => {
      const driver = await createOnlineIdleDriver("Wallet Regression Manual Driver");
      driverIds.push(driver.id);

      const booking = await bookingsService.createBooking(
        { girlName: "WalletRegressionManual", totalAmountCents: 20000, legs: [{ pickupLocation: "A", dropoffLocation: "B" }] },
        systemActor
      );
      bookingIds.push(booking.id);
      const [leg] = booking.legs;

      await prisma.leg.update({ where: { id: leg.id }, data: { driverId: driver.id, status: "ASSIGNED", assignedAt: new Date() } });

      await driverJobsService.acceptLeg(driver.id, leg.id);
      await driverJobsService.markDriverArriving(driver.id, leg.id);
      await driverJobsService.markPassengerOnBoard(driver.id, leg.id);
      const completedLeg = await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

      expect(completedLeg.driverEarningCents).toBeGreaterThan(0);
      const walletTxs = await prisma.walletTransaction.findMany({ where: { legId: leg.id } });
      expect(walletTxs).toHaveLength(1);
      expect(walletTxs[0]?.driverId).toBe(driver.id);
      expect(walletTxs[0]?.bookingId).toBe(booking.id);
    });
  });
});
