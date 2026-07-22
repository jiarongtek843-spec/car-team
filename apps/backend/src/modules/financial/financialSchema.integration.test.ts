import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";

/**
 * Module 9（Financial Model v2）的 Database Integration Test。这次只到 Schema 层——
 * 还没有 booking_charges/trip_expenses 的 service/controller/API，所以这里直接用
 * Prisma Client 操作新表，验证的是 migration 建出来的约束（CHECK/Partial Unique Index/
 * FK 删除策略）本身有没有正确生效，不是业务逻辑（业务逻辑留到 API 阶段）。
 */

let adminId: number;
let fareChargeTypeId: number;
let personalTipChargeTypeId: number;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  adminId = admin.id;

  const fare = await prisma.chargeType.findUniqueOrThrow({ where: { key: "FARE" } });
  fareChargeTypeId = fare.id;
  const tip = await prisma.chargeType.findUniqueOrThrow({ where: { key: "PERSONAL_TIP" } });
  personalTipChargeTypeId = tip.id;
});

async function createTestBooking(totalAmountCents = 10000) {
  return bookingsService.createBooking({
    girlName: "FinancialSchemaTest",
    totalAmountCents,
    legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
  });
}

let bookingIds: number[] = [];
let driverIds: number[] = [];

afterEach(async () => {
  // 先清掉这次测试自己建的资料，顺序要照 FK 方向（子表先清）。用 driverId 一并过滤，
  // 因为有些测试建的 WalletTransaction 只带 driverId + tripExpenseId，没有 bookingId。
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ bookingId: { in: bookingIds } }, { driverId: { in: driverIds } }] }
  });
  await prisma.collection.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.revenueSharingSnapshot.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.tripExpense.deleteMany({ where: { bookingId: { in: bookingIds } } });
  // BookingCharge 有自关联 FK（adjustsChargeId 指向同表），先清掉指向别人的那些（adjustment）
  // 再清原始记录，避免违反 Restrict。
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  bookingIds = [];
  driverIds = [];
});

describe("charge_types Seed 资料（Task 12 / financial-model-v2.md 第 4 章）", () => {
  it("只 Seed 4 个 Charge Type，flag 值符合设计", async () => {
    const types = await prisma.chargeType.findMany({ orderBy: { key: "asc" } });
    const byKey = new Map(types.map((t) => [t.key, t]));

    expect([...byKey.keys()].sort()).toEqual(["EXTRA_SERVICE", "FARE", "PERSONAL_TIP", "SURCHARGE"]);

    expect(byKey.get("FARE")?.participatesInRevenueSharing).toBe(true);
    expect(byKey.get("SURCHARGE")?.participatesInRevenueSharing).toBe(true);
    expect(byKey.get("EXTRA_SERVICE")?.participatesInRevenueSharing).toBe(true);

    expect(byKey.get("PERSONAL_TIP")?.participatesInRevenueSharing).toBe(false);
    expect(byKey.get("PERSONAL_TIP")?.isCompanyRevenue).toBe(false);

    for (const type of types) {
      expect(type.active).toBe(true);
    }
  });

  it("不允许物理删除一个还有 BookingCharge 在用的 ChargeType（Restrict）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    await prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 10000,
        createdBy: adminId
      }
    });

    await expect(prisma.chargeType.delete({ where: { id: fareChargeTypeId } })).rejects.toThrow();
  });
});

describe("booking_charges Append Only 约束（Task 12 / financial-model-v2.md 第 4 章）", () => {
  it("建立原始 Charge，adjustmentType 默认 NONE，adjustsChargeId 是 null", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const charge = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    expect(charge.adjustmentType).toBe("NONE");
    expect(charge.adjustsChargeId).toBeNull();
  });

  it("CHECK constraint：adjustmentType=NONE 但带了 adjustsChargeId 会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const original = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    await expect(
      prisma.bookingCharge.create({
        data: {
          bookingId: booking.id,
          chargeTypeId: fareChargeTypeId,
          amountCents: 500,
          adjustmentType: "NONE",
          adjustsChargeId: original.id,
          createdBy: adminId
        }
      })
    ).rejects.toThrow();
  });

  it("CHECK constraint：adjustmentType=ADDITION 但没带 adjustsChargeId 会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await expect(
      prisma.bookingCharge.create({
        data: {
          bookingId: booking.id,
          chargeTypeId: fareChargeTypeId,
          amountCents: 500,
          adjustmentType: "ADDITION",
          createdBy: adminId
        }
      })
    ).rejects.toThrow();
  });

  it("允许多笔 ADDITION 指向同一笔原始 Charge（补收可以发生多次）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const original = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    await prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustmentType: "ADDITION",
        adjustsChargeId: original.id,
        adjustmentReason: "补收第一次",
        createdBy: adminId
      }
    });
    const secondAddition = await prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 300,
        adjustmentType: "ADDITION",
        adjustsChargeId: original.id,
        adjustmentReason: "补收第二次",
        createdBy: adminId
      }
    });

    expect(secondAddition.id).toBeDefined();

    const additions = await prisma.bookingCharge.count({
      where: { adjustsChargeId: original.id, adjustmentType: "ADDITION" }
    });
    expect(additions).toBe(2);
  });

  it("Partial Unique Index：同一笔原始 Charge 只能有一笔 REVERSAL，第二笔会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const original = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    await prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: -10000,
        adjustmentType: "REVERSAL",
        adjustsChargeId: original.id,
        adjustmentReason: "第一次冲销",
        createdBy: adminId
      }
    });

    await expect(
      prisma.bookingCharge.create({
        data: {
          bookingId: booking.id,
          chargeTypeId: fareChargeTypeId,
          amountCents: -10000,
          adjustmentType: "REVERSAL",
          adjustsChargeId: original.id,
          adjustmentReason: "第二次冲销（应该被拒绝）",
          createdBy: adminId
        }
      })
    ).rejects.toThrow();
  });

  it("SUM(amountCents) 正确反映原始 Charge + ADDITION + REVERSAL 的净额", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const original = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });
    await prisma.bookingCharge.create({
      data: {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustmentType: "ADDITION",
        adjustsChargeId: original.id,
        adjustmentReason: "补收",
        createdBy: adminId
      }
    });

    const sum = await prisma.bookingCharge.aggregate({
      where: { bookingId: booking.id },
      _sum: { amountCents: true }
    });
    expect(sum._sum.amountCents).toBe(10500);
  });

  it("删除策略：Leg 被删除时，挂在它身上的 BookingCharge.legId 变成 null（SetNull），Charge 本身不消失", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const leg = await prisma.leg.findFirstOrThrow({ where: { bookingId: booking.id } });

    const charge = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, legId: leg.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    await prisma.leg.delete({ where: { id: leg.id } });

    const reloaded = await prisma.bookingCharge.findUniqueOrThrow({ where: { id: charge.id } });
    expect(reloaded.legId).toBeNull();
    expect(reloaded.bookingId).toBe(booking.id);
  });

  it("删除策略：Booking 不能因为有 BookingCharge 而被直接删除（Restrict）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, createdBy: adminId }
    });

    await expect(prisma.booking.delete({ where: { id: booking.id } })).rejects.toThrow();
  });
});

describe("trip_expenses（Task 12 / financial-model-v2.md 第 5 章）", () => {
  it("建立一笔 TripExpense，status 默认 PENDING", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const expense = await prisma.tripExpense.create({
      data: {
        bookingId: booking.id,
        expenseType: "TOLL",
        amountCents: 650,
        paidBy: "DRIVER",
        reimbursementRequired: true,
        createdBy: adminId
      }
    });

    expect(expense.status).toBe("PENDING");
    expect(expense.reimbursementRequired).toBe(true);
  });

  it("Unique 约束：同一笔原始 Expense 只能被冲销一次", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const original = await prisma.tripExpense.create({
      data: { bookingId: booking.id, expenseType: "PARKING", amountCents: 500, paidBy: "COMPANY", createdBy: adminId }
    });

    await prisma.tripExpense.create({
      data: {
        bookingId: booking.id,
        expenseType: "PARKING",
        amountCents: -500,
        paidBy: "COMPANY",
        status: "VOIDED",
        reversesExpenseId: original.id,
        createdBy: adminId
      }
    });

    await expect(
      prisma.tripExpense.create({
        data: {
          bookingId: booking.id,
          expenseType: "PARKING",
          amountCents: -500,
          paidBy: "COMPANY",
          status: "VOIDED",
          reversesExpenseId: original.id,
          createdBy: adminId
        }
      })
    ).rejects.toThrow();
  });

  it("paidBy=COMPANY 的 Expense 不需要任何 WalletTransaction 就能独立存在", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const expense = await prisma.tripExpense.create({
      data: { bookingId: booking.id, expenseType: "FUEL", amountCents: 8000, paidBy: "COMPANY", createdBy: adminId }
    });

    const transactionCount = await prisma.walletTransaction.count({ where: { tripExpenseId: expense.id } });
    expect(transactionCount).toBe(0);
    expect(expense.id).toBeDefined();
  });
});

describe("revenue_sharing_snapshots（Task 12 / financial-model-v2.md 第 7 章）", () => {
  it("每张 Booking 最多一笔 Snapshot（Unique bookingId），第二笔会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await prisma.revenueSharingSnapshot.create({
      data: {
        bookingId: booking.id,
        triggeredBy: "BOOKING_FINALIZED",
        companyRevenueCents: 1500,
        driverPoolCents: 8500,
        chargeBreakdown: [{ chargeTypeKey: "FARE", amountCents: 10000 }]
      }
    });

    await expect(
      prisma.revenueSharingSnapshot.create({
        data: {
          bookingId: booking.id,
          triggeredBy: "BOOKING_FINALIZED",
          companyRevenueCents: 1500,
          driverPoolCents: 8500,
          chargeBreakdown: []
        }
      })
    ).rejects.toThrow();
  });
});

describe("wallet_transactions 扩充栏位（Task 12 / financial-model-v2.md 第 8/10 章）", () => {
  it("source 是必填栏位，既有的 backfill 逻辑不受影响（既有 enum 值仍可正常写入）", async () => {
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver" } });
    driverIds.push(driver.id);

    const transaction = await prisma.walletTransaction.create({
      data: {
        driverId: driver.id,
        transactionType: "MANUAL_ADJUSTMENT",
        source: "MANUAL",
        amountCents: 1000,
        status: "PENDING",
        effectiveDate: new Date(),
        createdBy: adminId
      }
    });

    expect(transaction.source).toBe("MANUAL");
  });

  it("Unique 约束：同一笔 TripExpense 不能被报销两次（tripExpenseId unique）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver 2" } });
    driverIds.push(driver.id);

    const expense = await prisma.tripExpense.create({
      data: { bookingId: booking.id, expenseType: "TOLL", amountCents: 400, paidBy: "DRIVER", reimbursementRequired: true, createdBy: adminId }
    });

    await prisma.walletTransaction.create({
      data: {
        driverId: driver.id,
        transactionType: "EXPENSE_REIMBURSEMENT",
        source: "TRIP_EXPENSE",
        tripExpenseId: expense.id,
        amountCents: 400,
        status: "PENDING",
        effectiveDate: new Date(),
        createdBy: adminId
      }
    });

    await expect(
      prisma.walletTransaction.create({
        data: {
          driverId: driver.id,
          transactionType: "EXPENSE_REIMBURSEMENT",
          source: "TRIP_EXPENSE",
          tripExpenseId: expense.id,
          amountCents: 400,
          status: "PENDING",
          effectiveDate: new Date(),
          createdBy: adminId
        }
      })
    ).rejects.toThrow();
  });

  it("删除策略：删除一笔没有其他记录引用的 BookingCharge 时，指向它的 WalletTransaction.bookingChargeId 变成 null（SetNull）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver 3" } });
    driverIds.push(driver.id);

    const charge = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 500, createdBy: adminId }
    });
    const transaction = await prisma.walletTransaction.create({
      data: {
        driverId: driver.id,
        transactionType: "LEG_EARNING",
        source: "BOOKING_REVENUE",
        bookingChargeId: charge.id,
        amountCents: 500,
        status: "PENDING",
        effectiveDate: new Date(),
        createdBy: adminId
      }
    });

    await prisma.bookingCharge.delete({ where: { id: charge.id } });

    const reloaded = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(reloaded.bookingChargeId).toBeNull();
  });
});

describe("collections 扩充栏位（Partial Collection，Task 12 / financial-model-v2.md 第 6 章）", () => {
  it("Received/Outstanding 是从 parentCollectionId 分组加总算出来的衍生值", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver 4" } });
    driverIds.push(driver.id);

    const parent = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 3000,
        expectedAmountCents: 10000,
        paymentMethod: "CASH",
        status: "COLLECTED",
        createdBy: adminId
      }
    });
    await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 4000,
        parentCollectionId: parent.id,
        paymentMethod: "TRANSFER_TO_COMPANY",
        status: "COLLECTED",
        createdBy: adminId
      }
    });

    const group = await prisma.collection.findMany({
      where: { OR: [{ id: parent.id }, { parentCollectionId: parent.id }] }
    });
    const received = group.reduce((sum, c) => sum + c.amountCents, 0);
    const outstanding = (parent.expectedAmountCents ?? 0) - received;

    expect(received).toBe(7000);
    expect(outstanding).toBe(3000);
  });

  it("删除策略：分组的父记录不能被直接删除（Restrict），因为还有子记录指向它", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver 5" } });
    driverIds.push(driver.id);

    const parent = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 3000,
        expectedAmountCents: 10000,
        paymentMethod: "CASH",
        status: "COLLECTED",
        createdBy: adminId
      }
    });
    await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 4000,
        parentCollectionId: parent.id,
        paymentMethod: "CASH",
        status: "COLLECTED",
        createdBy: adminId
      }
    });

    await expect(prisma.collection.delete({ where: { id: parent.id } })).rejects.toThrow();
  });

  it("relatedChargeId 单向关联 BookingCharge，删除 Charge 时 Collection.relatedChargeId 变成 null（SetNull）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const driver = await prisma.driver.create({ data: { name: "Financial Schema Test Driver 6" } });
    driverIds.push(driver.id);

    const charge = await prisma.bookingCharge.create({
      data: { bookingId: booking.id, chargeTypeId: personalTipChargeTypeId, amountCents: 2000, createdBy: adminId }
    });
    const collection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 2000,
        relatedChargeId: charge.id,
        paymentMethod: "CASH",
        status: "COLLECTED",
        createdBy: adminId
      }
    });

    await prisma.bookingCharge.delete({ where: { id: charge.id } });

    const reloaded = await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } });
    expect(reloaded.relatedChargeId).toBeNull();
  });
});

describe("bookings.financialStatus（Task 12 / financial-model-v2.md 第 3 章）", () => {
  it("新建的 Booking 默认 financialStatus = OPEN", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("OPEN");
  });
});
