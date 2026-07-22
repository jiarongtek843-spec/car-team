import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "./bookings.service.js";
import type { AuditActor } from "../../common/audit.js";

/**
 * Booking Flow Migration：Booking Total 不再是直接写入的栏位，而是由 Booking Charges
 * 汇总出来的。这里验证 createBooking/updateBooking/cancelBooking/getBookingById 透过
 * Booking Charge 维持正确的 totalAmountCents，同时既有 Booking API 的输入/输出形状不变。
 */

let systemActor: AuditActor;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };
});

let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.walletTransaction.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  bookingIds = [];
});

describe("createBooking — 自动建立 FARE Charge", () => {
  it("totalAmountCents > 0 时自动建立一笔原始 FARE Charge，Booking Total 来自 Charge 汇总", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowTest", totalAmountCents: 15000 },
      systemActor
    );
    bookingIds.push(booking.id);

    expect(booking.totalAmountCents).toBe(15000);
    expect(booking.charges).toHaveLength(1);
    expect(booking.charges[0].chargeType.key).toBe("FARE");
    expect(booking.charges[0].amountCents).toBe(15000);
    expect(booking.charges[0].adjustmentType).toBe("NONE");
    expect(booking.charges[0].createdByUser?.id).toBe(systemActor.id);

    const persistedCharge = await prisma.bookingCharge.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(persistedCharge.amountCents).toBe(15000);
  });

  it("totalAmountCents 省略或为 0 时不建立任何 Charge，Booking Total 维持 0", async () => {
    const booking = await bookingsService.createBooking({ girlName: "ChargeFlowTestZero" }, systemActor);
    bookingIds.push(booking.id);

    expect(booking.totalAmountCents).toBe(0);
    expect(booking.charges).toHaveLength(0);
  });

  it("没有传 actor 也能建立（BookingCharge.createdBy 允许为 null）", async () => {
    const booking = await bookingsService.createBooking({ girlName: "ChargeFlowTestNoActor", totalAmountCents: 8000 });
    bookingIds.push(booking.id);

    expect(booking.totalAmountCents).toBe(8000);
    expect(booking.charges[0].createdByUser).toBeNull();
  });

  it("带 legs 建立时，Booking Total 依然正确（既有 driverPoolAmountCents/allocation 校验不受影响）", async () => {
    const booking = await bookingsService.createBooking(
      {
        girlName: "ChargeFlowTestLegs",
        totalAmountCents: 10000,
        commissionType: "PERCENTAGE",
        commissionValue: 20,
        legs: [{ pickupLocation: "A", dropoffLocation: "B", earningAllocationCents: 8000 }]
      },
      systemActor
    );
    bookingIds.push(booking.id);

    expect(booking.totalAmountCents).toBe(10000);
    expect(booking.driverPoolAmountCents).toBe(8000);
    expect(booking.legs).toHaveLength(1);
    expect(booking.charges).toHaveLength(1);
  });
});

describe("updateBooking — 透过 Adjustment Charge 调整总额", () => {
  it("调高 totalAmountCents 时对既有 FARE Charge 建立正数 ADDITION", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowUpdateUp", totalAmountCents: 10000 },
      systemActor
    );
    bookingIds.push(booking.id);

    const updated = await bookingsService.updateBooking(booking.id, { totalAmountCents: 12000 }, systemActor);

    expect(updated.totalAmountCents).toBe(12000);
    expect(updated.charges).toHaveLength(1);
    expect(updated.charges[0].netAmountCents).toBe(12000);

    const allCharges = await prisma.bookingCharge.findMany({ where: { bookingId: booking.id } });
    expect(allCharges).toHaveLength(2);
    const addition = allCharges.find((c) => c.adjustmentType === "ADDITION");
    expect(addition?.amountCents).toBe(2000);
  });

  it("调低 totalAmountCents 时对既有 FARE Charge 建立负数 ADDITION", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowUpdateDown", totalAmountCents: 10000 },
      systemActor
    );
    bookingIds.push(booking.id);

    const updated = await bookingsService.updateBooking(booking.id, { totalAmountCents: 6000 }, systemActor);

    expect(updated.totalAmountCents).toBe(6000);
    const addition = await prisma.bookingCharge.findFirstOrThrow({
      where: { bookingId: booking.id, adjustmentType: "ADDITION" }
    });
    expect(addition.amountCents).toBe(-4000);
  });

  it("原本是 0 元的 Booking，Edit 成有金额时直接建立原始 FARE Charge（不是 Adjustment）", async () => {
    const booking = await bookingsService.createBooking({ girlName: "ChargeFlowUpdateFromZero" }, systemActor);
    bookingIds.push(booking.id);

    const updated = await bookingsService.updateBooking(booking.id, { totalAmountCents: 5000 }, systemActor);

    expect(updated.totalAmountCents).toBe(5000);
    expect(updated.charges).toHaveLength(1);
    expect(updated.charges[0].adjustmentType).toBe("NONE");
  });

  it("totalAmountCents 不变时不建立任何多余的 Charge", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowUpdateNoop", totalAmountCents: 10000 },
      systemActor
    );
    bookingIds.push(booking.id);

    await bookingsService.updateBooking(booking.id, { totalAmountCents: 10000, commissionValue: 15 }, systemActor);

    const allCharges = await prisma.bookingCharge.findMany({ where: { bookingId: booking.id } });
    expect(allCharges).toHaveLength(1);
  });

  it("只改 girlName/notes（不碰金额）完全不触及 Charge", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowUpdateNameOnly", totalAmountCents: 10000 },
      systemActor
    );
    bookingIds.push(booking.id);

    const updated = await bookingsService.updateBooking(booking.id, { girlName: "Renamed" }, systemActor);

    expect(updated.girlName).toBe("Renamed");
    expect(updated.totalAmountCents).toBe(10000);
    const allCharges = await prisma.bookingCharge.findMany({ where: { bookingId: booking.id } });
    expect(allCharges).toHaveLength(1);
  });
});

describe("cancelBooking — 同步 Financial Status", () => {
  it("取消 Booking 时把 financialStatus 设成 VOIDED，Charge 本身不受影响", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowCancel", totalAmountCents: 9000 },
      systemActor
    );
    bookingIds.push(booking.id);

    const cancelled = await bookingsService.cancelBooking(booking.id);

    expect(cancelled.status).toBe("CANCELLED");
    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.financialStatus).toBe("VOIDED");
    expect(reloaded.totalAmountCents).toBe(9000);

    const charge = await prisma.bookingCharge.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(charge.adjustmentType).toBe("NONE");
    expect(charge.amountCents).toBe(9000);
  });
});

describe("getBookingById — Detail 附带 charges", () => {
  it("回传的 Booking Detail 带有净额视图的 charges 阵列", async () => {
    const booking = await bookingsService.createBooking(
      { girlName: "ChargeFlowDetail", totalAmountCents: 7000 },
      systemActor
    );
    bookingIds.push(booking.id);

    const detail = await bookingsService.getBookingById(booking.id);

    expect(detail.charges).toHaveLength(1);
    expect(detail.charges[0].netAmountCents).toBe(7000);
    expect(detail.charges[0].isVoided).toBe(false);
  });
});
