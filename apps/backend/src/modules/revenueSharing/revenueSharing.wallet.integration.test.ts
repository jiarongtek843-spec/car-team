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
    data: { allowManagerFinalizeRevenueSharing: originalSettings.allowManagerFinalizeRevenueSharing }
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

  it("Financial V2 的 Booking，Leg 完成时完全不建立 LEG_EARNING", async () => {
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

    const anyTransaction = await prisma.walletTransaction.findFirst({ where: { legId: leg.id } });
    expect(anyTransaction).toBeNull();
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
