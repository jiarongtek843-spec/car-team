import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as bookingChargeService from "../bookingCharges/bookingCharge.service.js";
import * as companySettingsService from "../companySettings/companySettings.service.js";
import * as revenueSharingService from "./revenueSharing.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

let systemActor: AuditActor;
let originalSettings: Awaited<ReturnType<typeof companySettingsService.getCompanySettings>>;
let personalTipChargeTypeId: number;
let platformFeeChargeTypeId: number;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };

  const tip = await prisma.chargeType.findUniqueOrThrow({ where: { key: "PERSONAL_TIP" } });
  personalTipChargeTypeId = tip.id;

  const platformFee = await prisma.chargeType.create({
    data: { key: "TEST_PLATFORM_FEE", label: "Test Platform Fee", participatesInRevenueSharing: false, isCompanyRevenue: true }
  });
  platformFeeChargeTypeId = platformFee.id;
});

afterAll(async () => {
  // 这笔是测试自己建的额外 ChargeType（用来覆盖「不参与分润但算 Company Revenue」这个分支），
  // 不属于 Module 9 的 4 个 Seed 资料，跑完要清掉，否则会污染 financialSchema.integration.test.ts
  // 那边「只 Seed 4 个」的断言。
  await prisma.chargeType.delete({ where: { id: platformFeeChargeTypeId } });
});

beforeEach(async () => {
  originalSettings = await companySettingsService.getCompanySettings();
});

afterEach(async () => {
  await prisma.companySettings.update({
    where: { id: originalSettings.id },
    data: {
      companyCommissionType: originalSettings.companyCommissionType,
      companyCommissionValue: originalSettings.companyCommissionValue,
      dispatcherCommissionType: originalSettings.dispatcherCommissionType,
      dispatcherCommissionValue: originalSettings.dispatcherCommissionValue
    }
  });
});

async function setRule(rule: {
  companyCommissionType: "PERCENTAGE" | "FIXED_AMOUNT";
  companyCommissionValue: number;
  dispatcherCommissionType: "PERCENTAGE" | "FIXED_AMOUNT";
  dispatcherCommissionValue: number;
}) {
  await prisma.companySettings.update({ where: { id: originalSettings.id }, data: rule });
}

async function createTestBooking(totalAmountCents = 10000) {
  return bookingsService.createBooking({ girlName: "RevenueSharingTest", totalAmountCents }, systemActor);
}

let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  bookingIds = [];
});

describe("previewRevenueSharing", () => {
  it("按 FARE 全额参与分润，套用 Company/Dispatcher Commission，正确算出 Driver Pool", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 15,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 5
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    const result = await revenueSharingService.previewRevenueSharing(booking.id);

    expect(result.participatingAmountCents).toBe(10000);
    expect(result.companyCommissionCents).toBe(1500);
    expect(result.dispatcherCommissionCents).toBe(500);
    expect(result.driverPoolCents).toBe(8000);
    expect(result.financialStatus).toBe("OPEN");
  });

  it("Preview 是纯计算，不会建立 Snapshot、也不会改动 Booking 财务状态", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    await revenueSharingService.previewRevenueSharing(booking.id);
    await revenueSharingService.previewRevenueSharing(booking.id);

    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("OPEN");
  });

  it("Booking 不存在时拒绝", async () => {
    await expect(revenueSharingService.previewRevenueSharing(999999999)).rejects.toThrow(NotFoundError);
  });

  it("Booking 没有任何 Charge 时拒绝", async () => {
    const booking = await bookingsService.createBooking({ girlName: "RevenueSharingNoChargeTest" }, systemActor);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.previewRevenueSharing(booking.id)).rejects.toThrow(ValidationError);
  });

  it("Personal Tip（不参与分润、isCompanyRevenue=false）全额算 Driver 收入，不套用 Commission", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 15,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 0
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);
    await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: personalTipChargeTypeId, amountCents: 2000 },
      systemActor
    );

    const result = await revenueSharingService.previewRevenueSharing(booking.id);

    expect(result.participatingAmountCents).toBe(10000);
    expect(result.companyCommissionCents).toBe(1500);
    expect(result.companyRevenueCents).toBe(1500);
    expect(result.driverPoolCents).toBe(2000 + (10000 - 1500));
  });

  it("不参与分润且 isCompanyRevenue=true 的 Charge 全额算 Company Revenue", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 0,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 0
    });

    const booking = await createTestBooking(0);
    bookingIds.push(booking.id);
    await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: platformFeeChargeTypeId, amountCents: 800 },
      systemActor
    );

    const result = await revenueSharingService.previewRevenueSharing(booking.id);

    expect(result.companyRevenueCents).toBe(800);
    expect(result.driverPoolCents).toBe(0);
  });

  it("Company + Dispatcher Commission 总额超过参与分润总额时拒绝", async () => {
    await setRule({
      companyCommissionType: "FIXED_AMOUNT",
      companyCommissionValue: 700,
      dispatcherCommissionType: "FIXED_AMOUNT",
      dispatcherCommissionValue: 500
    });

    const booking = await createTestBooking(1000);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.previewRevenueSharing(booking.id)).rejects.toThrow(ValidationError);
  });
});

describe("finalizeRevenueSharing", () => {
  it("成功建立 Snapshot，写入正确的三个金额栏位，并把 Booking.financialStatus 收敛成 FINALIZED", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 15,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 5
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    const snapshot = await revenueSharingService.finalizeRevenueSharing(booking.id, systemActor);

    expect(snapshot.companyRevenueCents).toBe(1500);
    expect(snapshot.dispatcherCommissionCents).toBe(500);
    expect(snapshot.driverPoolCents).toBe(8000);
    expect(snapshot.triggeredBy).toBe("BOOKING_FINALIZED");

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("FINALIZED");

    const auditLog = await prisma.auditLog.findFirst({
      where: { action: "REVENUE_SHARING_FINALIZED", entityId: snapshot.id },
      orderBy: { createdAt: "desc" }
    });
    expect(auditLog).not.toBeNull();
  });

  it("重复 Finalize 同一张 Booking 会被拒绝（409）", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    await revenueSharingService.finalizeRevenueSharing(booking.id, systemActor);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, systemActor)).rejects.toThrow(ConflictError);
  });

  it("Booking 已经是 VOIDED 时拒绝 Finalize", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);
    await bookingsService.cancelBooking(booking.id);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, systemActor)).rejects.toThrow(
      ValidationError
    );
  });

  it("Booking 没有任何 Charge 时拒绝 Finalize", async () => {
    const booking = await bookingsService.createBooking({ girlName: "RevenueSharingFinalizeNoCharge" }, systemActor);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, systemActor)).rejects.toThrow(
      ValidationError
    );
  });

  it("Booking Total 与 Charge 实际加总不一致时拒绝 Finalize（资料一致性检查）", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    // 故意用 raw update 弄脏快取栏位，模拟资料不一致的情境（正常流程不会发生）。
    await prisma.booking.update({ where: { id: booking.id }, data: { totalAmountCents: 99999 } });

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, systemActor)).rejects.toThrow(
      ValidationError
    );
  });

  it("Revenue Allocation 总额超过可分配金额时拒绝 Finalize，也不会建立 Snapshot", async () => {
    await setRule({
      companyCommissionType: "FIXED_AMOUNT",
      companyCommissionValue: 8000,
      dispatcherCommissionType: "FIXED_AMOUNT",
      dispatcherCommissionValue: 5000
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.finalizeRevenueSharing(booking.id, systemActor)).rejects.toThrow(
      ValidationError
    );

    const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId: booking.id } });
    expect(snapshot).toBeNull();
    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("OPEN");
  });
});

describe("Snapshot 不可变（Financial Model v2 的 Append Only 原则）", () => {
  it("Finalize 之后对该 Booking 建立 Adjustment Charge，不会自动修改旧 Snapshot 的金额", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 15,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 0
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    const snapshot = await revenueSharingService.finalizeRevenueSharing(booking.id, systemActor);
    expect(snapshot.companyRevenueCents).toBe(1500);

    const originalCharge = await prisma.bookingCharge.findFirstOrThrow({
      where: { bookingId: booking.id, adjustmentType: "NONE" }
    });
    // FINALIZED 之后仍然允许新增 ADDITION（补收），不影响已经写死的 Snapshot。
    await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: originalCharge.chargeTypeId,
        amountCents: 5000,
        adjustsChargeId: originalCharge.id,
        adjustmentReason: "Finalize 后的补收，不应该影响旧 Snapshot"
      },
      systemActor
    );

    const reloadedSnapshot = await revenueSharingService.getRevenueSnapshot(booking.id);
    expect(reloadedSnapshot.companyRevenueCents).toBe(1500);
    expect(reloadedSnapshot.driverPoolCents).toBe(8500);
  });

  it("Company Settings 在 Finalize 之后修改，不会影响已经产生的 Snapshot", async () => {
    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 10,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 0
    });

    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    const snapshot = await revenueSharingService.finalizeRevenueSharing(booking.id, systemActor);
    expect(snapshot.companyRevenueCents).toBe(1000);

    await setRule({
      companyCommissionType: "PERCENTAGE",
      companyCommissionValue: 50,
      dispatcherCommissionType: "PERCENTAGE",
      dispatcherCommissionValue: 0
    });

    const reloadedSnapshot = await revenueSharingService.getRevenueSnapshot(booking.id);
    expect(reloadedSnapshot.companyRevenueCents).toBe(1000);
  });
});

describe("getRevenueSnapshot / listRevenueHistory", () => {
  it("还没 Finalize 的 Booking 查 Snapshot 会得到 404", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);

    await expect(revenueSharingService.getRevenueSnapshot(booking.id)).rejects.toThrow(NotFoundError);
  });

  it("History 列表会包含刚 Finalize 的这笔 Booking，且带有 Booking 摘要资讯", async () => {
    const booking = await createTestBooking(10000);
    bookingIds.push(booking.id);
    await revenueSharingService.finalizeRevenueSharing(booking.id, systemActor);

    const history = await revenueSharingService.listRevenueHistory({ page: 1, pageSize: 50 });

    const entry = history.data.find((s) => s.bookingId === booking.id);
    expect(entry).toBeDefined();
    expect(entry?.booking.id).toBe(booking.id);
    expect(history.total).toBeGreaterThanOrEqual(1);
  });
});
