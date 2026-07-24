import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as legsService from "../bookings/legs.service.js";
import * as driverJobsService from "../driverJobs/driverJobs.service.js";
import * as settlementService from "../settlement/settlement.service.js";
import * as walletService from "./wallet.service.js";
import { ConflictError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

// completeLeg/confirmSettlement 的 actor.id 会写进 created_by 之类的外键，指向真实的 users
// 表，所以这里一律用种子帐号 admin 的身份，而不是测试用的 driver.id（那不是 User）。
let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

/** 直接把 Leg 推到 PASSENGER_ON_BOARD，跳过 Accept/Arriving 这些中间步骤，
 * 方便测试聚焦在「完成时记账」这件事本身。 */
async function fastForwardToOnBoard(legId: number, driverId: number) {
  await prisma.leg.update({
    where: { id: legId },
    data: { driverId, status: "PASSENGER_ON_BOARD" }
  });
}

// 刻意用「本地」日历日期（跟前端 dayjs().format("YYYY-MM-DD") 以及 Backend startOfDay() 的
// setHours() 语意一致），不能用 toISOString() 的 UTC 日期——本地时区不是 UTC 时会在一天中的
// 某几个小时（本地日期已经跨天、但 UTC 日期还没跨）算出跟真实 effectiveDate 差一天的周期。
function toDateStr(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.settlementItem.deleteMany({ where: { walletTransaction: { driverId: { in: driverIds } } } });
  await prisma.settlement.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Wallet + Settlement (Module 3 scenarios)", () => {
  it("Scenario 1: two drivers each complete one leg of a 20% commission booking -> each gets RM24", async () => {
    const driver1 = await createTestDriver("Scenario1 Driver A");
    const driver2 = await createTestDriver("Scenario1 Driver B");
    driverIds.push(driver1.id, driver2.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario1",
      financialVersion: "V1",
      totalAmountCents: 6000,
      commissionType: "PERCENTAGE",
      commissionValue: 20,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 },
        { pickupLocation: "B", dropoffLocation: "A", earningAllocationCents: 2400 }
      ]
    });
    bookingIds.push(booking.id);

    expect(booking.platformAmountCents).toBe(1200);
    expect(booking.driverPoolAmountCents).toBe(4800);

    const [leg1, leg2] = booking.legs;
    await fastForwardToOnBoard(leg1.id, driver1.id);
    await fastForwardToOnBoard(leg2.id, driver2.id);

    await driverJobsService.completeLeg(driver1.id, leg1.id, systemActor);
    await driverJobsService.completeLeg(driver2.id, leg2.id, systemActor);

    const driver1Sum = await prisma.walletTransaction.aggregate({
      where: { driverId: driver1.id, status: "PENDING" },
      _sum: { amountCents: true }
    });
    const driver2Sum = await prisma.walletTransaction.aggregate({
      where: { driverId: driver2.id, status: "PENDING" },
      _sum: { amountCents: true }
    });

    expect(driver1Sum._sum.amountCents).toBe(2400);
    expect(driver2Sum._sum.amountCents).toBe(2400);
  });

  it("Scenario 2: one driver completes both legs -> total pending is RM48", async () => {
    const driver = await createTestDriver("Scenario2 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario2",
      financialVersion: "V1",
      totalAmountCents: 6000,
      commissionType: "PERCENTAGE",
      commissionValue: 20,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 },
        { pickupLocation: "B", dropoffLocation: "A", earningAllocationCents: 2400 }
      ]
    });
    bookingIds.push(booking.id);

    const [leg1, leg2] = booking.legs;
    await fastForwardToOnBoard(leg1.id, driver.id);
    await fastForwardToOnBoard(leg2.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg1.id, systemActor);
    await driverJobsService.completeLeg(driver.id, leg2.id, systemActor);

    const sum = await prisma.walletTransaction.aggregate({
      where: { driverId: driver.id, status: "PENDING" },
      _sum: { amountCents: true }
    });
    expect(sum._sum.amountCents).toBe(4800);
  });

  it("Scenario 3: calling complete twice does not create a duplicate LEG_EARNING", async () => {
    const driver = await createTestDriver("Scenario3 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario3",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    await expect(driverJobsService.completeLeg(driver.id, leg.id, systemActor)).rejects.toThrow(ConflictError);

    const count = await prisma.walletTransaction.count({ where: { legId: leg.id, transactionType: "LEG_EARNING" } });
    expect(count).toBe(1);
  });

  it("Scenario 4: only the completed leg produces earnings", async () => {
    const driver = await createTestDriver("Scenario4 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario4",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 },
        { pickupLocation: "B", dropoffLocation: "A", earningAllocationCents: 2400 }
      ]
    });
    bookingIds.push(booking.id);

    const [leg1] = booking.legs;
    await fastForwardToOnBoard(leg1.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg1.id, systemActor);

    const transactions = await prisma.walletTransaction.findMany({ where: { driverId: driver.id } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].legId).toBe(leg1.id);
  });

  it("Scenario 5: settling a driver marks transactions SETTLED but keeps full history", async () => {
    const driver = await createTestDriver("Scenario5 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario5",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    const today = toDateStr(new Date());
    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(settlement.reference).toMatch(/^SET-\d{8}-\d{4}$/);

    const transaction = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: leg.id } });
    expect(transaction.status).toBe("SETTLED");
    expect(transaction.settlementId).toBe(settlement.id);

    const stillExists = await prisma.walletTransaction.findUnique({ where: { id: transaction.id } });
    expect(stillExists).not.toBeNull();
  });

  it("Scenario 6: two concurrent settlement confirmations for the same driver -> only one succeeds", async () => {
    const driver = await createTestDriver("Scenario6 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario6",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    const today = toDateStr(new Date());
    const results = await Promise.allSettled([
      settlementService.confirmSettlement(driver.id, today, today, systemActor),
      settlementService.confirmSettlement(driver.id, today, today, systemActor)
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const settlementCount = await prisma.settlement.count({ where: { driverId: driver.id, status: "COMPLETED" } });
    expect(settlementCount).toBe(1);
  });

  it("Scenario 7: total leg allocation cannot exceed the driver pool", async () => {
    const booking = await bookingsService.createBooking({
      girlName: "Scenario7",
      financialVersion: "V1",
      totalAmountCents: 6000,
      commissionType: "PERCENTAGE",
      commissionValue: 20 // driver pool = 4800
    });
    bookingIds.push(booking.id);

    await legsService.addLeg(booking.id, { pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 3000 });

    await expect(
      legsService.addLeg(booking.id, { pickupLocation: "B", dropoffLocation: "A", earningAllocationCents: 2000 })
    ).rejects.toThrow(ValidationError);
  });

  it("Scenario 8: a completed leg's allocation cannot be modified", async () => {
    const driver = await createTestDriver("Scenario8 Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "Scenario8",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    await expect(
      legsService.updateLeg(booking.id, leg.id, { earningAllocationCents: 1000 }, systemActor)
    ).rejects.toThrow(ConflictError);
  });
});

describe("Selective Settlement (Mobile UAT Bug Fix：功能五)", () => {
  async function createCompletedLegEarning(girlName: string, driverId: number, earningCents: number) {
    const booking = await bookingsService.createBooking({
      girlName,
      financialVersion: "V1",
      totalAmountCents: earningCents * 2,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: earningCents }]
    });
    bookingIds.push(booking.id);
    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driverId);
    const completed = await driverJobsService.completeLeg(driverId, leg.id, systemActor);
    const transaction = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: completed.id } });
    return transaction;
  }

  it("只选一笔 Wallet Transaction 结算：只有被选的那笔变 SETTLED，其余三笔留 PENDING", async () => {
    const driver = await createTestDriver("Selective Settlement Driver");
    driverIds.push(driver.id);

    // 对应需求范例：Booking#6 Leg1 RM51、Booking#7 Leg1 RM68、Booking#7 Leg2 RM68、
    // Booking#8 Leg1 RM68——今天只想结算第一笔，其余留到下次。
    const tx1 = await createCompletedLegEarning("Selective#1", driver.id, 5100);
    const tx2 = await createCompletedLegEarning("Selective#2", driver.id, 6800);
    const tx3 = await createCompletedLegEarning("Selective#3", driver.id, 6800);
    const tx4 = await createCompletedLegEarning("Selective#4", driver.id, 6800);

    const today = toDateStr(new Date());
    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor, {
      walletTransactionIds: [tx1.id]
    });

    expect(settlement.walletAmountCents).toBe(5100);
    expect(settlement.collectionAmountCents).toBe(0);

    const [reloaded1, reloaded2, reloaded3, reloaded4] = await Promise.all(
      [tx1, tx2, tx3, tx4].map((tx) => prisma.walletTransaction.findUniqueOrThrow({ where: { id: tx.id } }))
    );
    expect(reloaded1.status).toBe("SETTLED");
    expect(reloaded1.settlementId).toBe(settlement.id);
    expect(reloaded2.status).toBe("PENDING");
    expect(reloaded3.status).toBe("PENDING");
    expect(reloaded4.status).toBe("PENDING");

    // 没被选的三笔仍然完整出现在下一次的 Preview 里，不会因为「这个周期已经结算过一次」而消失。
    const preview = await settlementService.previewSettlement(driver.id, today, today);
    const previewIds = preview.transactions.map((tx) => tx.id);
    expect(previewIds).toContain(tx2.id);
    expect(previewIds).toContain(tx3.id);
    expect(previewIds).toContain(tx4.id);
    expect(previewIds).not.toContain(tx1.id);
  });

  it("已经被选进上一次 Settlement 的 Transaction 不能再被选第二次（同一笔不能结算两次）", async () => {
    const driver = await createTestDriver("Selective Repeat Driver");
    driverIds.push(driver.id);
    const tx = await createCompletedLegEarning("SelectiveRepeat", driver.id, 4000);

    const today = toDateStr(new Date());
    await settlementService.confirmSettlement(driver.id, today, today, systemActor, { walletTransactionIds: [tx.id] });

    await expect(
      settlementService.confirmSettlement(driver.id, today, today, systemActor, { walletTransactionIds: [tx.id] })
    ).rejects.toThrow(ConflictError);
  });

  it("两个 Admin 同时选同一笔结算：只有一个成功", async () => {
    const driver = await createTestDriver("Selective Concurrent Driver");
    driverIds.push(driver.id);
    const tx = await createCompletedLegEarning("SelectiveConcurrent", driver.id, 4500);

    const today = toDateStr(new Date());
    const results = await Promise.allSettled([
      settlementService.confirmSettlement(driver.id, today, today, systemActor, { walletTransactionIds: [tx.id] }),
      settlementService.confirmSettlement(driver.id, today, today, systemActor, { walletTransactionIds: [tx.id] })
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("选到的 Transaction 不属于这个 Driver 时拒绝（防止跨 Driver 混选）", async () => {
    const driver = await createTestDriver("Selective Owner Driver");
    const otherDriver = await createTestDriver("Selective Other Driver");
    driverIds.push(driver.id, otherDriver.id);

    const otherTx = await createCompletedLegEarning("SelectiveOtherDriver", otherDriver.id, 3000);

    const today = toDateStr(new Date());
    await expect(
      settlementService.confirmSettlement(driver.id, today, today, systemActor, { walletTransactionIds: [otherTx.id] })
    ).rejects.toThrow(ValidationError);
  });

  it("选到的 Transaction 落在目前日期范围之外时拒绝，要求先调整日期范围（v1 限制）", async () => {
    const driver = await createTestDriver("Selective Outside Range Driver");
    driverIds.push(driver.id);
    const tx = await createCompletedLegEarning("SelectiveOutsideRange", driver.id, 2000);

    // 故意选一个离今天很远（30 天前）的日期，而不是「昨天」——effectiveDate 是
    // @db.Date 栏位，Prisma 对它的日期序列化是以 UTC 日期为准，跟这个测试环境的本地时区
    // （UTC+8）换算「昨天 23:59:59.999 本地」时，UTC 日期可能跟「今天本地凌晨」落在同一个
    // UTC 日历日，让「昨天」这个边界不够可靠。往前拉开 30 天可以确定不受任何时区换算影响，
    // 单纯测「选到的项目落在目前显示周期之外时会被挡下来」这件事本身。
    const farInThePast = toDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    await expect(
      settlementService.confirmSettlement(driver.id, farInThePast, farInThePast, systemActor, {
        walletTransactionIds: [tx.id]
      })
    ).rejects.toThrow(ValidationError);
  });
});

describe("Financial hardening scenarios", () => {
  it("supports both positive and negative manual adjustments", async () => {
    const driver = await createTestDriver("Hardening Adjustment Driver");
    driverIds.push(driver.id);

    const today = toDateStr(new Date());
    const positive = await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 500, reason: "Bonus", effectiveDate: today },
      systemActor
    );
    const negative = await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: -200, reason: "Penalty", effectiveDate: today },
      systemActor
    );

    expect(positive.amountCents).toBe(500);
    expect(negative.amountCents).toBe(-200);

    const sum = await prisma.walletTransaction.aggregate({
      where: { driverId: driver.id, status: "PENDING" },
      _sum: { amountCents: true }
    });
    expect(sum._sum.amountCents).toBe(300);
  });

  it("rejects a zero-amount adjustment", async () => {
    const driver = await createTestDriver("Hardening Zero Driver");
    driverIds.push(driver.id);

    await expect(
      walletService.createAdjustment(
        "MANUAL_ADJUSTMENT",
        { driverId: driver.id, amountCents: 0, reason: "Oops", effectiveDate: toDateStr(new Date()) },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("voiding the same settlement twice only succeeds once", async () => {
    const driver = await createTestDriver("Hardening Void Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "HardeningVoid",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    const today = toDateStr(new Date());
    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);

    await settlementService.voidSettlement(settlement.id, "Wrong amount", systemActor);
    await expect(settlementService.voidSettlement(settlement.id, "Trying again", systemActor)).rejects.toThrow(
      ConflictError
    );
  });

  it("voiding a settlement creates a correct reversal transaction and leaves the original untouched", async () => {
    const driver = await createTestDriver("Hardening Reversal Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "HardeningReversal",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    const today = toDateStr(new Date());
    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);

    const original = await prisma.walletTransaction.findFirstOrThrow({ where: { legId: leg.id } });

    await settlementService.voidSettlement(settlement.id, "Driver disputed the amount", systemActor);

    const unchanged = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: original.id } });
    expect(unchanged.status).toBe("SETTLED");
    expect(unchanged.amountCents).toBe(2400);

    const reversal = await prisma.walletTransaction.findFirstOrThrow({
      where: { relatedSettlementId: settlement.id, transactionType: "SETTLEMENT_ADJUSTMENT" }
    });
    expect(reversal.amountCents).toBe(-2400);
    expect(reversal.status).toBe("PENDING");
    expect(reversal.driverId).toBe(driver.id);

    const voidedSettlement = await prisma.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(voidedSettlement.status).toBe("VOIDED");
    expect(voidedSettlement.voidReason).toBe("Driver disputed the amount");
  });

  it("only includes pending transactions whose effectiveDate falls inside the settlement period", async () => {
    const driver = await createTestDriver("Hardening Period Driver");
    driverIds.push(driver.id);

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 1000, reason: "In period", effectiveDate: toDateStr(yesterday) },
      systemActor
    );
    const outsideTx = await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 2000, reason: "Outside period", effectiveDate: toDateStr(twoDaysAgo) },
      systemActor
    );

    const preview = await settlementService.previewSettlement(driver.id, toDateStr(yesterday), toDateStr(today));
    expect(preview.transactions).toHaveLength(1);
    expect(preview.transactions[0].amountCents).toBe(1000);
    expect(preview.excludedTransactions.map((t) => t.id)).toContain(outsideTx.id);

    const settlement = await settlementService.confirmSettlement(
      driver.id,
      toDateStr(yesterday),
      toDateStr(today),
      systemActor
    );
    expect(settlement.netAmountCents).toBe(1000);

    const stillPending = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: outsideTx.id } });
    expect(stillPending.status).toBe("PENDING");
  });

  it("includes a transaction whose effectiveDate is exactly periodStart===periodEnd (regression: UTC-parse vs local-setHours day-boundary bug)", async () => {
    // Mobile UX + Scheduling Sprint 用「自动选择全部未结算日期」测出来的真实 Bug：Settlement
    // 的 periodStart/periodEnd 之前是用 startOfDay(new Date("YYYY-MM-DD")) 算出来的——
    // date-only 字串丢给 new Date() 一律被当成 UTC 午夜解析，但 startOfDay() 的 setHours()
    // 是用伺服器「本地」时区运算，两者混用会让 periodStart/periodEnd 偷偷偏移几个小时（伺服器
    // 时区不是 UTC 时就会发生，Railway/本地开发常见是 UTC+8），偏移方向依时区而定：使用者
    // 选的日期范围明明包含这笔资料的日期，画面却显示「周期外待结算」。这里刻意用跟
    // parsePeriod 现在的写法（拆 Y/M/D 直接组本地 Date）完全一致的方式构造 effectiveDate，
    // 直接验证「插入时用的日期」跟「查询时选的同一天」不会因为解析方式不同而对不起来。
    const driver = await createTestDriver("Same Day Boundary Driver");
    driverIds.push(driver.id);

    const dateStr = toDateStr(new Date());
    const [year, month, day] = dateStr.split("-").map(Number);
    const effectiveDate = new Date(year, month - 1, day);

    await prisma.walletTransaction.create({
      data: {
        driverId: driver.id,
        transactionType: "MANUAL_ADJUSTMENT",
        source: "MANUAL",
        amountCents: 750,
        description: "Same day boundary test",
        status: "PENDING",
        effectiveDate,
        createdBy: systemActor.id
      }
    });

    const preview = await settlementService.previewSettlement(driver.id, dateStr, dateStr);

    expect(preview.transactions.map((t) => t.amountCents)).toContain(750);
    expect(preview.excludedTransactions.map((t) => t.amountCents)).not.toContain(750);
  });

  it("generates unique settlement references for two drivers settled at the same time", async () => {
    const driverA = await createTestDriver("Hardening Concurrency Driver A");
    const driverB = await createTestDriver("Hardening Concurrency Driver B");
    driverIds.push(driverA.id, driverB.id);

    const today = toDateStr(new Date());

    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driverA.id, amountCents: 100, reason: "A", effectiveDate: today },
      systemActor
    );
    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driverB.id, amountCents: 100, reason: "B", effectiveDate: today },
      systemActor
    );

    const [settlementA, settlementB] = await Promise.all([
      settlementService.confirmSettlement(driverA.id, today, today, systemActor),
      settlementService.confirmSettlement(driverB.id, today, today, systemActor)
    ]);

    expect(settlementA.reference).not.toBe(settlementB.reference);
  });

  it("blocks changing total amount or commission once a booking has completed legs", async () => {
    const driver = await createTestDriver("Hardening Locked Booking Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "HardeningLocked",
      financialVersion: "V1",
      totalAmountCents: 6000,
      legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 2400 }]
    });
    bookingIds.push(booking.id);

    const [leg] = booking.legs;
    await fastForwardToOnBoard(leg.id, driver.id);
    await driverJobsService.completeLeg(driver.id, leg.id, systemActor);

    await expect(
      bookingsService.updateBooking(booking.id, { totalAmountCents: 9000 }, systemActor)
    ).rejects.toThrow(ConflictError);
  });
});
