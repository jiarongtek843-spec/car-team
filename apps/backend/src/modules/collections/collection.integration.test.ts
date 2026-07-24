import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as walletService from "../wallet/wallet.service.js";
import * as settlementService from "../settlement/settlement.service.js";
import * as collectionService from "./collection.service.js";
import { ConflictError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

async function createTestDriver(name: string) {
  return prisma.driver.create({ data: { name } });
}

// createCollection/confirmSettlement 的 actor.id 会写进 created_by 之类的外键，指向真实的
// users 表，所以一律用种子帐号 admin 的身份，而不是测试用的 driver.id（那不是 User）。
let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

// 用「本地」日历日期，理由同 wallet.integration.test.ts 的 toDateStr。
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
  await prisma.collection.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.settlement.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.walletTransaction.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

async function createTestBooking(girlName: string) {
  const booking = await bookingsService.createBooking({ girlName, totalAmountCents: 0 });
  bookingIds.push(booking.id);
  return booking;
}

describe("Collection module (Module 4 scenarios)", () => {
  it("Cash: driver records a cash collection and admin verifies it", async () => {
    const driver = await createTestDriver("Cash Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CashCollection");

    const collection = await collectionService.createCollection(
      {
        bookingId: booking.id,
        driverId: driver.id,
        customerName: "Ah Beng",
        purpose: "ITEM_PURCHASE",
        amountCents: 5000,
        paymentMethod: "CASH"
      },
      systemActor
    );
    expect(collection.status).toBe("COLLECTED");
    expect(collection.paymentMethod).toBe("CASH");

    const verified = await collectionService.verifyCollection(collection.id, systemActor);
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedByUser?.id).toBe(systemActor.id);
  });

  it("Transfer: Transfer To Driver collection can be created and verified", async () => {
    const driver = await createTestDriver("Transfer Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("TransferCollection");

    const collection = await collectionService.createCollection(
      {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "DELIVERY_FEE",
        amountCents: 3000,
        paymentMethod: "TRANSFER_TO_DRIVER"
      },
      systemActor
    );
    expect(collection.paymentMethod).toBe("TRANSFER_TO_DRIVER");

    const verified = await collectionService.verifyCollection(collection.id, systemActor);
    expect(verified.status).toBe("VERIFIED");
  });

  it("Company Transfer: Transfer To Company collection can be created and verified", async () => {
    const driver = await createTestDriver("Company Transfer Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CompanyTransferCollection");

    const collection = await collectionService.createCollection(
      {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "PARCEL",
        amountCents: 7000,
        paymentMethod: "TRANSFER_TO_COMPANY"
      },
      systemActor
    );
    expect(collection.paymentMethod).toBe("TRANSFER_TO_COMPANY");

    const verified = await collectionService.verifyCollection(collection.id, systemActor);
    expect(verified.status).toBe("VERIFIED");
  });

  it("Settlement: Company Pay Driver when earnings exceed collections", async () => {
    const driver = await createTestDriver("Settlement Net Positive Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("SettlementNetPositive");

    // Driver Earnings RM120
    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 12000, reason: "Earnings", effectiveDate: toDateStr(new Date()) },
      systemActor
    );

    // Collection RM80
    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "EXTRA_CHARGE", amountCents: 8000, paymentMethod: "CASH" },
      systemActor
    );
    await collectionService.verifyCollection(collection.id, systemActor);

    const today = toDateStr(new Date());
    const preview = await settlementService.previewSettlement(driver.id, today, today);
    expect(preview.walletAmountCents).toBe(12000);
    expect(preview.collectionAmountCents).toBe(8000);
    expect(preview.netAmountCents).toBe(4000); // Company Pay Driver RM40

    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(settlement.walletAmountCents).toBe(12000);
    expect(settlement.collectionAmountCents).toBe(8000);
    expect(settlement.netAmountCents).toBe(4000);

    const settledCollection = await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } });
    expect(settledCollection.status).toBe("SETTLED");
    expect(settledCollection.settlementId).toBe(settlement.id);
  });

  it("Settlement: Driver Need Return Company when collections exceed earnings", async () => {
    const driver = await createTestDriver("Settlement Net Negative Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("SettlementNetNegative");

    // Driver Earnings RM120
    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 12000, reason: "Earnings", effectiveDate: toDateStr(new Date()) },
      systemActor
    );

    // Collection RM200
    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "EXTRA_CHARGE", amountCents: 20000, paymentMethod: "CASH" },
      systemActor
    );
    await collectionService.verifyCollection(collection.id, systemActor);

    const today = toDateStr(new Date());
    const preview = await settlementService.previewSettlement(driver.id, today, today);
    expect(preview.netAmountCents).toBe(-8000); // Driver Need Return Company RM80

    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(settlement.netAmountCents).toBe(-8000);
  });

  it("Void: a collection can be voided before settlement, but not twice", async () => {
    const driver = await createTestDriver("Void Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("VoidCollection");

    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "TOLL", amountCents: 1500, paymentMethod: "CASH" },
      systemActor
    );

    const voided = await collectionService.voidCollection(collection.id, "Duplicate entry", systemActor);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("Duplicate entry");

    await expect(collectionService.voidCollection(collection.id, "Again", systemActor)).rejects.toThrow(ConflictError);
  });

  it("Void: a settled collection cannot be voided directly", async () => {
    const driver = await createTestDriver("Void Settled Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("VoidSettledCollection");

    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "PARKING", amountCents: 1000, paymentMethod: "CASH" },
      systemActor
    );
    await collectionService.verifyCollection(collection.id, systemActor);

    const today = toDateStr(new Date());
    await settlementService.confirmSettlement(driver.id, today, today, systemActor);

    await expect(collectionService.voidCollection(collection.id, "Too late", systemActor)).rejects.toThrow(ConflictError);
  });

  it("重复 Verify: verifying an already-verified collection fails", async () => {
    const driver = await createTestDriver("Repeat Verify Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("RepeatVerifyCollection");

    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 2500, paymentMethod: "TNG" },
      systemActor
    );

    await collectionService.verifyCollection(collection.id, systemActor);
    await expect(collectionService.verifyCollection(collection.id, systemActor)).rejects.toThrow(ConflictError);
  });

  it("重复 Settlement: a settled collection is not counted again in a second settlement of the same period", async () => {
    const driver = await createTestDriver("Repeat Settlement Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("RepeatSettlementCollection");

    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 4000, paymentMethod: "CASH" },
      systemActor
    );
    await collectionService.verifyCollection(collection.id, systemActor);

    const today = toDateStr(new Date());
    const first = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(first.collectionAmountCents).toBe(4000);

    // 第二次对同一个 driver + 同一个周期结算：collection 已经 SETTLED，wallet 也没有新的 PENDING，
    // 应该直接被挡下来，不会把同一笔 Collection 算进第二个 Settlement。
    await expect(settlementService.confirmSettlement(driver.id, today, today, systemActor)).rejects.toThrow(
      ValidationError
    );

    const settlementCount = await prisma.settlement.count({ where: { driverId: driver.id } });
    expect(settlementCount).toBe(1);

    const stillSettled = await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } });
    expect(stillSettled.settlementId).toBe(first.id);
  });

  it("Void Settlement reopens its collections back to VERIFIED so they can be settled again", async () => {
    const driver = await createTestDriver("Void Settlement Reopen Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("VoidSettlementReopenCollection");

    const collection = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 6000, paymentMethod: "CASH" },
      systemActor
    );
    await collectionService.verifyCollection(collection.id, systemActor);

    const today = toDateStr(new Date());
    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);

    await settlementService.voidSettlement(settlement.id, "Recalculate", systemActor);

    const reopened = await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } });
    expect(reopened.status).toBe("VERIFIED");
    expect(reopened.settlementId).toBeNull();
    expect(reopened.settledAt).toBeNull();

    // 现在可以被下一次日结重新纳入。
    const second = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(second.collectionAmountCents).toBe(6000);
  });

  it("Mobile UAT Bug Fix：Company 收款（collectedBy=COMPANY）不会被算成 Driver 欠公司的负债", async () => {
    const driver = await createTestDriver("Company Collection Not Debt Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("CompanyCollectionNotDebt");

    // Driver Earnings RM50
    await walletService.createAdjustment(
      "MANUAL_ADJUSTMENT",
      { driverId: driver.id, amountCents: 5000, reason: "Earnings", effectiveDate: toDateStr(new Date()) },
      systemActor
    );

    // Company 直接收款 RM1000，只是保留这个 Driver 的行程做参照，不该被当成这个 Driver 欠公司的钱。
    const companyCollection = await prisma.collection.create({
      data: {
        bookingId: booking.id,
        driverId: driver.id,
        purpose: "OTHER",
        amountCents: 100000,
        paymentMethod: "TRANSFER_TO_COMPANY",
        status: "VERIFIED",
        collectedBy: "COMPANY",
        receiverType: "COMPANY",
        verifiedAt: new Date(),
        verifiedBy: systemActor.id
      }
    });

    const today = toDateStr(new Date());
    const preview = await settlementService.previewSettlement(driver.id, today, today);
    expect(preview.collectionAmountCents).toBe(0);
    expect(preview.netAmountCents).toBe(5000); // Company Pay Driver RM50，完全不受 Company 收款影响
    expect(preview.collections.some((c) => c.id === companyCollection.id)).toBe(false);
    expect(preview.excludedCollections.some((c) => c.id === companyCollection.id)).toBe(false);

    const settlement = await settlementService.confirmSettlement(driver.id, today, today, systemActor);
    expect(settlement.collectionAmountCents).toBe(0);
    expect(settlement.netAmountCents).toBe(5000);

    const stillVerified = await prisma.collection.findUniqueOrThrow({ where: { id: companyCollection.id } });
    expect(stillVerified.status).toBe("VERIFIED"); // 没有被这次 Settlement 动到
  });

  it("Mobile UAT Bug Fix：还没 Verify 的 Driver 代收款不会静默消失，会出现在 Excluded Collections", async () => {
    const driver = await createTestDriver("Unverified Collection Driver");
    driverIds.push(driver.id);
    const booking = await createTestBooking("UnverifiedCollectionExcluded");

    // 对应 Bug 报告：RM1000 代收款还没 Verify，Settlement Summary 却显示 RM0.00，
    // 好像这笔钱凭空消失了。
    const unverified = await collectionService.createCollection(
      { bookingId: booking.id, driverId: driver.id, purpose: "OTHER", amountCents: 100000, paymentMethod: "CASH" },
      systemActor
    );
    expect(unverified.status).toBe("COLLECTED");

    const today = toDateStr(new Date());
    const preview = await settlementService.previewSettlement(driver.id, today, today);
    expect(preview.collectionAmountCents).toBe(0);
    expect(preview.collections.some((c) => c.id === unverified.id)).toBe(false);
    expect(preview.excludedCollections.some((c) => c.id === unverified.id)).toBe(true);

    // Verify 之后才真的被算进 Settlement。
    await collectionService.verifyCollection(unverified.id, systemActor);
    const previewAfterVerify = await settlementService.previewSettlement(driver.id, today, today);
    expect(previewAfterVerify.collectionAmountCents).toBe(100000);
    expect(previewAfterVerify.collections.some((c) => c.id === unverified.id)).toBe(true);
    expect(previewAfterVerify.excludedCollections.some((c) => c.id === unverified.id)).toBe(false);
  });
});
