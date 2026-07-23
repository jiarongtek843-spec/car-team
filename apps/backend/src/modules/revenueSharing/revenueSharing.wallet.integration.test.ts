import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as companySettingsService from "../companySettings/companySettings.service.js";
import * as revenueSharingService from "./revenueSharing.service.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Module 12（Wallet Migration）：Revenue Sharing Finalize 现在会在同一个 Transaction 里
 * 自动把 driverPoolCents 发放成 Wallet Transaction——不再有独立的 Issue Wallet 手动步骤。
 * 也涵盖 Financial Version Cut-over 的实际行为（V1 继续用 LEG_EARNING，V2 完全不建立），
 * 以及「谁能执行 Finalize」透过 CompanySettings.allowManagerFinalizeRevenueSharing 配置
 * （不写死在 Permission 里）。
 */

let ownerActor: AuditActor;
let managerActor: AuditActor;
let originalSettings: Awaited<ReturnType<typeof companySettingsService.getCompanySettings>>;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  ownerActor = { id: admin.id, role: "OWNER" };

  const manager = await prisma.user.findUniqueOrThrow({ where: { username: "manager01" } });
  managerActor = { id: manager.id, role: "MANAGER" };
});

beforeEach(async () => {
  originalSettings = await companySettingsService.getCompanySettings();
});

afterEach(async () => {
  await prisma.companySettings.update({
    where: { id: originalSettings.id },
    data: {
      allowManagerFinalizeRevenueSharing: originalSettings.allowManagerFinalizeRevenueSharing,
      companyCommissionType: originalSettings.companyCommissionType,
      companyCommissionValue: originalSettings.companyCommissionValue,
      dispatcherCommissionType: originalSettings.dispatcherCommissionType,
      dispatcherCommissionValue: originalSettings.dispatcherCommissionValue
    }
  });
});

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

async function fastForwardToOnBoard(legId: number, driverId: number) {
  await prisma.leg.update({ where: { id: legId }, data: { driverId, status: "PASSENGER_ON_BOARD" } });
}

let bookingIds: number[] = [];
let driverIds: number[] = [];

afterEach(async () => {
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  bookingIds = [];
  driverIds = [];
});

describe("Financial Version Cut-over（completeLeg 依版本决定要不要建立 LEG_EARNING）", () => {
  it("默认新建立的 Booking 是 Financial V2", async () => {
    const booking = await bookingsService.createBooking({ girlName: "CutoverDefault", totalAmountCents: 0 }, ownerActor);
    bookingIds.push(booking.id);

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialVersion).toBe("V2");
  });

  it("Financial V1 的 Booking，Leg 完成时仍然照旧建立 LEG_EARNING", async () => {
    const driver = await createTestDriver("Cutover V1 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "CutoverV1",
        financialVersion: "V1",
        totalAmountCents: 6000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);

    const legEarning = await prisma.walletTransaction.findFirst({
      where: { legId: leg.id, transactionType: "LEG_EARNING" }
    });
    expect(legEarning).not.toBeNull();
    expect(legEarning?.amountCents).toBe(2400);
  });

  it("Financial V2 的 Booking，Leg 完成时不建立 LEG_EARNING，改自动产生 REVENUE_SHARE_PAYOUT（driver-earnings-after-leg-completion 修复）", async () => {
    const driver = await createTestDriver("Cutover V2 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "CutoverV2",
        totalAmountCents: 6000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    expect(booking.financialVersion).toBe("V2");

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    const completed = await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);
    expect(completed.status).toBe("COMPLETED");

    const legEarning = await prisma.walletTransaction.findFirst({
      where: { legId: leg.id, transactionType: "LEG_EARNING" }
    });
    expect(legEarning).toBeNull();

    const payout = await prisma.walletTransaction.findFirst({
      where: { legId: leg.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(payout).not.toBeNull();
    expect(payout?.driverId).toBe(driver.id);
    expect(payout?.amountCents).toBeGreaterThan(0);

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("FINALIZED");
  });
});

/**
 * driver-earnings-after-leg-completion 修复（2026-07 Railway Staging 验证发现）：
 * Financial V2 的 Booking 原本要靠 Owner/Manager 手动呼叫 Finalize 才会发放 Wallet，
 * 但前端从来没有做过这个手动按钮，导致所有 V2 Booking 的司机收入永远不会产生。
 * 这里覆盖 completeLeg 的新自动触发路径：每条 Leg 完成时立刻拿到自己那一份，
 * 不需要等整张 Booking 全部完成。
 */
describe("Leg 完成自动触发 Revenue Sharing Payout（V2，取代手动 Finalize）", () => {
  it("单一 Leg：没有手动填司机收入，完成后自动均分成 100%，driverPoolCents 全额入袋", async () => {
    const driver = await createTestDriver("Auto Payout Single Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutSingle",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);

    const snapshot = await prisma.revenueSharingSnapshot.findUniqueOrThrow({ where: { bookingId: booking.id } });
    expect(snapshot.triggeredBy).toBe("LEG_COMPLETED");
    expect(snapshot.driverPoolCents).toBeGreaterThan(0);

    const payout = await prisma.walletTransaction.findFirstOrThrow({
      where: { legId: leg.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(payout.driverId).toBe(driver.id);
    expect(payout.amountCents).toBe(snapshot.driverPoolCents);

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("FINALIZED");
  });

  it("两个 Leg 只完成一个：只产生那一个 Driver 的收入，不需要等整张 Booking 完成", async () => {
    const driverA = await createTestDriver("Auto Payout Partial A");
    const driverB = await createTestDriver("Auto Payout Partial B");
    driverIds.push(driverA.id, driverB.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutPartial",
        totalAmountCents: 10000,
        legs: [
          { pickupLocation: "A", dropoffLocation: "B", driverId: driverA.id },
          { pickupLocation: "B", dropoffLocation: "C", driverId: driverB.id }
        ]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [legA, legB] = booking.legs;

    await fastForwardToOnBoard(legA.id, driverA.id);
    await driverJobsService.completeLeg(driverA.id, legA.id, ownerActor);

    const payoutA = await prisma.walletTransaction.findFirst({
      where: { legId: legA.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(payoutA).not.toBeNull();
    expect(payoutA?.driverId).toBe(driverA.id);

    const payoutB = await prisma.walletTransaction.findFirst({
      where: { legId: legB.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(payoutB).toBeNull();

    // Leg B 还没完成，营运 status 也不该是 COMPLETED——不需要等整张 Booking 结束。
    const reloadedLegB = await prisma.leg.findUniqueOrThrow({ where: { id: legB.id } });
    expect(reloadedLegB.status).not.toBe("COMPLETED");
  });

  it("两个 Leg 分别完成后，各自产生收入，总和精确等于 driverPoolCents", async () => {
    const driverA = await createTestDriver("Auto Payout Both A");
    const driverB = await createTestDriver("Auto Payout Both B");
    driverIds.push(driverA.id, driverB.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutBoth",
        totalAmountCents: 10000,
        legs: [
          { pickupLocation: "A", dropoffLocation: "B", driverId: driverA.id },
          { pickupLocation: "B", dropoffLocation: "C", driverId: driverB.id }
        ]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [legA, legB] = booking.legs;

    await fastForwardToOnBoard(legA.id, driverA.id);
    await driverJobsService.completeLeg(driverA.id, legA.id, ownerActor);

    await fastForwardToOnBoard(legB.id, driverB.id);
    await driverJobsService.completeLeg(driverB.id, legB.id, ownerActor);

    const snapshot = await prisma.revenueSharingSnapshot.findUniqueOrThrow({ where: { bookingId: booking.id } });
    const payouts = await prisma.walletTransaction.findMany({
      where: { bookingId: booking.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(payouts).toHaveLength(2);
    const sum = payouts.reduce((s, t) => s + t.amountCents, 0);
    expect(sum).toBe(snapshot.driverPoolCents);

    // 只有一次 Snapshot——第二条 Leg 完成时重用了第一条 Leg 完成当下建立的那一笔。
    const snapshotCount = await prisma.revenueSharingSnapshot.count({ where: { bookingId: booking.id } });
    expect(snapshotCount).toBe(1);
  });

  it("重复 Complete 不重复发钱（Leg 状态机挡下第二次转换，从未到达 Payout 逻辑）", async () => {
    const driver = await createTestDriver("Auto Payout Duplicate Complete");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutDuplicateComplete",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);

    await expect(driverJobsService.completeLeg(driver.id, leg.id, ownerActor)).rejects.toThrow();

    const count = await prisma.walletTransaction.count({
      where: { legId: leg.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(count).toBe(1);
  });

  it("有人手动填过司机收入时，仍然照旧按 earningAllocationCents 比例分配（不影响既有情境）", async () => {
    const driverA = await createTestDriver("Auto Payout Weighted A");
    const driverB = await createTestDriver("Auto Payout Weighted B");
    driverIds.push(driverA.id, driverB.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutWeighted",
        totalAmountCents: 10000,
        legs: [
          { pickupLocation: "A", dropoffLocation: "B", driverId: driverA.id, earningAllocationCents: 6000 },
          { pickupLocation: "B", dropoffLocation: "C", driverId: driverB.id, earningAllocationCents: 2000 }
        ]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [legA, legB] = booking.legs;

    await fastForwardToOnBoard(legA.id, driverA.id);
    await driverJobsService.completeLeg(driverA.id, legA.id, ownerActor);

    await fastForwardToOnBoard(legB.id, driverB.id);
    await driverJobsService.completeLeg(driverB.id, legB.id, ownerActor);

    const snapshot = await prisma.revenueSharingSnapshot.findUniqueOrThrow({ where: { bookingId: booking.id } });
    const payoutA = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: legA.id } });
    const payoutB = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: legB.id } });

    // 6000:2000 = 3:1，跟原本手动 Finalize 的既有测试断言完全一致。
    expect(payoutA.amountCents).toBe(Math.round(snapshot.driverPoolCents * 0.75));
    expect(payoutB.amountCents).toBe(snapshot.driverPoolCents - payoutA.amountCents);
  });

  it("Financial V1 的 Booking 仍然只走 LEG_EARNING，不会建立 Revenue Sharing Snapshot", async () => {
    const driver = await createTestDriver("Auto Payout V1 Untouched");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutV1Untouched",
        financialVersion: "V1",
        totalAmountCents: 6000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);

    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();

    const legEarning = await prisma.walletTransaction.findFirst({
      where: { legId: leg.id, transactionType: "LEG_EARNING" }
    });
    expect(legEarning).not.toBeNull();
  });

  it("Booking 还没有任何 Charge（车资未设定）时，拒绝完成 Leg 并清楚报错，不静默产生 RM0 收入", async () => {
    const driver = await createTestDriver("Auto Payout No Charge");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutNoCharge",
        totalAmountCents: 0,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    await expect(driverJobsService.completeLeg(driver.id, leg.id, ownerActor)).rejects.toThrow(ValidationError);

    // Transaction 整个回滚——Leg 不会被误标记成 COMPLETED。
    const reloadedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(reloadedLeg.status).toBe("PASSENGER_ON_BOARD");
  });

  it("Company Commission + Dispatcher Commission 设定超过 100% 时，拒绝完成 Leg 并清楚报错（不静默失败）", async () => {
    // updateCompanySettings 本身的 assertRevenueRuleSane 已经会挡下这个组合，这里故意
    // 绕过 Service 直接写 DB，模拟资料本身已经处于不合理状态（例如旧资料、手动改库）时，
    // calculateRevenueSharing 在真正要发钱的当下仍然是最后一道防线，不会静默算出负数。
    await prisma.companySettings.update({
      where: { id: originalSettings.id },
      data: {
        companyCommissionType: "PERCENTAGE",
        companyCommissionValue: 60,
        dispatcherCommissionType: "PERCENTAGE",
        dispatcherCommissionValue: 50
      }
    });

    const driver = await createTestDriver("Auto Payout Bad Commission");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutBadCommission",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    await expect(driverJobsService.completeLeg(driver.id, leg.id, ownerActor)).rejects.toThrow(ValidationError);

    const reloadedLeg = await prisma.leg.findUniqueOrThrow({ where: { id: leg.id } });
    expect(reloadedLeg.status).toBe("PASSENGER_ON_BOARD");
    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();
  });

  it("Settlement Preview 能读到自动触发产生的 REVENUE_SHARE_PAYOUT（不是只认得旧的 LEG_EARNING）", async () => {
    const driver = await createTestDriver("Auto Payout Settlement Visible");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "AutoPayoutSettlementVisible",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, ownerActor);

    const payout = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: leg.id } });

    const { previewSettlement } = await import("../settlement/settlement.service.js");
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const preview = await previewSettlement(driver.id, todayStr, todayStr);

    expect(preview.transactions.some((t) => t.id === payout.id)).toBe(true);
    // REVENUE_SHARE_PAYOUT 归类成「已完成行程收入」，不是普通 Adjustment。
    expect(preview.completedLegEarningsCents).toBeGreaterThanOrEqual(payout.amountCents);
  });
});

describe("finalizeRevenueSharing 自动发放 Wallet（不再需要单独的 Issue Wallet 步骤）", () => {
  it("单一 Leg：Finalize 完成的同时，driverPoolCents 全额发放给唯一的 Driver，reference 齐全", async () => {
    const driver = await createTestDriver("Finalize Wallet Single Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "FinalizeWalletSingle",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8500 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    expect(result.walletTransactions).toHaveLength(1);
    const [transaction] = result.walletTransactions;
    expect(transaction.driverId).toBe(driver.id);
    expect(transaction.amountCents).toBe(result.driverPoolCents);
    expect(transaction.transactionType).toBe("REVENUE_SHARE_PAYOUT");
    expect(transaction.source).toBe("BOOKING_REVENUE");
    expect(transaction.revenueSnapshotId).toBe(result.id);
    expect(transaction.bookingId).toBe(booking.id);
    expect(transaction.legId).toBe(booking.legs[0].id);

    // Snapshot 本身也确实建立了，financialStatus 也收敛成 FINALIZED——Finalize 该做的事一件都没少。
    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("FINALIZED");
  });

  it("多 Leg 多 Driver：按 earningAllocationCents 比例分配，总和精确等于 driverPoolCents", async () => {
    const driverA = await createTestDriver("Finalize Wallet Driver A");
    const driverB = await createTestDriver("Finalize Wallet Driver B");
    driverIds.push(driverA.id, driverB.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "FinalizeWalletMulti",
        totalAmountCents: 10000,
        legs: [
          { pickupLocation: "A", dropoffLocation: "B", driverId: driverA.id, earningAllocationCents: 6000 },
          { pickupLocation: "B", dropoffLocation: "A", driverId: driverB.id, earningAllocationCents: 2000 }
        ]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    expect(result.walletTransactions).toHaveLength(2);
    const sum = result.walletTransactions.reduce((s, t) => s + t.amountCents, 0);
    expect(sum).toBe(result.driverPoolCents);

    const forA = result.walletTransactions.find((t) => t.driverId === driverA.id)!;
    const forB = result.walletTransactions.find((t) => t.driverId === driverB.id)!;
    // 6000:2000 = 3:1
    expect(forA.amountCents).toBe(Math.round(result.driverPoolCents * 0.75));
    expect(forB.amountCents).toBe(result.driverPoolCents - forA.amountCents);
  });

  it("Financial V1 的 Booking，Finalize 建立 Snapshot 但不发放任何 Wallet（V1 继续用 LEG_EARNING）", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "FinalizeWalletV1", financialVersion: "V1", totalAmountCents: 10000 },
      ownerActor
    );
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    expect(result.walletTransactions).toHaveLength(0);
    expect(result.driverPoolCents).toBeGreaterThan(0);
  });

  it("没有任何 Leg/Driver 时，Snapshot 依然产生，但不建立任何 Wallet Transaction", async () => {
    const booking = await bookingsService.createBooking({ girlName: "FinalizeWalletNoDriver", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    expect(result.walletTransactions).toHaveLength(0);
  });

  it("已取消的 Leg 不参与分配", async () => {
    const driverActive = await createTestDriver("Active Leg Driver");
    const driverCancelled = await createTestDriver("Cancelled Leg Driver");
    driverIds.push(driverActive.id, driverCancelled.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "FinalizeWalletCancelledLeg",
        totalAmountCents: 10000,
        legs: [
          { pickupLocation: "A", dropoffLocation: "B", driverId: driverActive.id, earningAllocationCents: 4000 },
          { pickupLocation: "B", dropoffLocation: "A", driverId: driverCancelled.id, earningAllocationCents: 4000 }
        ]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    await prisma.leg.update({ where: { id: booking.legs[1].id }, data: { status: "CANCELLED" } });

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    expect(result.walletTransactions).toHaveLength(1);
    expect(result.walletTransactions[0].driverId).toBe(driverActive.id);
    expect(result.walletTransactions[0].amountCents).toBe(result.driverPoolCents);
  });

  it("重复 Finalize 会被拒绝，也不会建立第二批 Wallet Transaction（Duplicate Protection）", async () => {
    const driver = await createTestDriver("Finalize Wallet Duplicate Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "FinalizeWalletDuplicate",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor)).rejects.toThrow();

    const count = await prisma.walletTransaction.count({
      where: { driverId: driver.id, transactionType: "REVENUE_SHARE_PAYOUT" }
    });
    expect(count).toBe(1);
  });

  it("Duplicate Protection：DB 的 @@unique([legId, transactionType]) 挡下对同一个 Leg 的第二笔 REVENUE_SHARE_PAYOUT", async () => {
    const driver = await createTestDriver("Duplicate Protection Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "DuplicateProtection",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    await expect(
      prisma.walletTransaction.create({
        data: {
          driverId: driver.id,
          bookingId: booking.id,
          legId: leg.id,
          revenueSnapshotId: result.id,
          transactionType: "REVENUE_SHARE_PAYOUT",
          source: "BOOKING_REVENUE",
          amountCents: 1,
          status: "PENDING",
          effectiveDate: new Date(),
          createdBy: ownerActor.id
        }
      })
    ).rejects.toThrow();
  });
});

describe("谁能执行 Finalize（CompanySettings.allowManagerFinalizeRevenueSharing，不写死在 Permission 里）", () => {
  it("默认（allowManagerFinalizeRevenueSharing=false）MANAGER 不能 Finalize，即使 RBAC 层拥有 revenueSharing:finalize", async () => {
    await companySettingsService.updateCompanySettings({ allowManagerFinalizeRevenueSharing: false });

    const booking = await bookingsService.createBooking({ girlName: "FinalizePermissionDefault", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, managerActor)).rejects.toThrow(ForbiddenError);

    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();
  });

  it("开启 allowManagerFinalizeRevenueSharing=true 后，MANAGER 可以 Finalize", async () => {
    await companySettingsService.updateCompanySettings({ allowManagerFinalizeRevenueSharing: true });

    const booking = await bookingsService.createBooking({ girlName: "FinalizePermissionEnabled", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, managerActor);
    expect(result.id).toBeDefined();
  });

  it("OWNER 永远可以 Finalize，不受 allowManagerFinalizeRevenueSharing 影响", async () => {
    await companySettingsService.updateCompanySettings({ allowManagerFinalizeRevenueSharing: false });

    const booking = await bookingsService.createBooking({ girlName: "FinalizePermissionOwner", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);
    expect(result.id).toBeDefined();
  });
});

describe("getWalletForBooking / getDriverRevenueShareWallet / listWalletHistory", () => {
  it("Wallet Detail 在 Finalize 之后立刻 issued=true 且带出交易明细（不需要额外步骤）", async () => {
    const driver = await createTestDriver("Wallet Detail Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "WalletDetailTest",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    const detail = await revenueSharingService.getWalletForBooking(booking.id);
    expect(detail.issued).toBe(true);
    expect(detail.transactions).toHaveLength(1);
    expect(detail.transactions[0].driver.id).toBe(driver.id);
  });

  it("Wallet Detail 对还没 Finalize 的 Booking 回 404", async () => {
    const booking = await bookingsService.createBooking({ girlName: "WalletDetailNotFinalized", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.getWalletForBooking(booking.id)).rejects.toThrow(NotFoundError);
  });

  it("Driver Wallet 汇总某个 Driver 收到的所有 Revenue Sharing 分润", async () => {
    const driver = await createTestDriver("Driver Wallet Aggregate Driver");
    driverIds.push(driver.id);

    const bookingA = await bookingsService.createBooking(
      {
        girlName: "DriverWalletA",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    const bookingB = await bookingsService.createBooking(
      {
        girlName: "DriverWalletB",
        totalAmountCents: 5000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 4000 }]
      },
      ownerActor
    );
    bookingIds.push(bookingA.id, bookingB.id);

    const resultA = await revenueSharingService.finalizeRevenueSharing(bookingA.id, ownerActor);
    const resultB = await revenueSharingService.finalizeRevenueSharing(bookingB.id, ownerActor);

    const wallet = await revenueSharingService.getDriverRevenueShareWallet(driver.id);
    expect(wallet.transactions).toHaveLength(2);
    expect(wallet.totalCents).toBe(resultA.driverPoolCents + resultB.driverPoolCents);
  });

  it("Driver Wallet 对不存在的 Driver 回 404", async () => {
    await expect(revenueSharingService.getDriverRevenueShareWallet(999999999)).rejects.toThrow(NotFoundError);
  });

  it("Wallet History 分页列出所有已发放的 REVENUE_SHARE_PAYOUT，并且能找到刚 Finalize 产生的这笔", async () => {
    const driver = await createTestDriver("Wallet History Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "WalletHistoryTest",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    const result = await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    const history = await revenueSharingService.listWalletHistory({ page: 1, pageSize: 50 });
    const found = history.data.find((t) => t.id === result.walletTransactions[0].id);
    expect(found).toBeDefined();
    expect(found?.booking?.id).toBe(booking.id);
    expect(history.total).toBeGreaterThanOrEqual(1);
  });

  it("Driver 自己的 Wallet Transactions 列表（既有的 driverWallet 端点）会自然带出 REVENUE_SHARE_PAYOUT", async () => {
    const driver = await createTestDriver("Driver Self View Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking(
      {
        girlName: "DriverSelfView",
        totalAmountCents: 10000,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", driverId: driver.id, earningAllocationCents: 8000 }]
      },
      ownerActor
    );
    bookingIds.push(booking.id);

    await revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor);

    const { listTransactions, getDriverWalletSummary } = await import("../wallet/wallet.service.js");
    const list = await listTransactions({ driverId: driver.id, page: 1, pageSize: 50 });
    expect(list.data.some((t) => t.transactionType === "REVENUE_SHARE_PAYOUT")).toBe(true);

    const summary = await getDriverWalletSummary(driver.id);
    expect(summary.unsettledCents).toBeGreaterThan(0);
  });
});

describe("Validation：Booking Total 一致性 / Revenue Allocation 超额（仍然阻止 Finalize，连带阻止 Wallet 发放）", () => {
  it("Booking Total 与 Charge 实际加总不一致时拒绝 Finalize，不建立 Snapshot 也不发放 Wallet", async () => {
    const booking = await bookingsService.createBooking({ girlName: "FinalizeInconsistent", totalAmountCents: 10000 }, ownerActor);
    bookingIds.push(booking.id);

    await prisma.booking.update({ where: { id: booking.id }, data: { totalAmountCents: 99999 } });

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, ownerActor)).rejects.toThrow(ValidationError);

    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();
  });
});
