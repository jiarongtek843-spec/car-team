import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as bookingChargeService from "./bookingCharge.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import type { AuditActor } from "../../common/audit.js";

let systemActor: AuditActor;
let fareChargeTypeId: number;
let personalTipChargeTypeId: number;
let inactiveChargeTypeId: number;

beforeAll(async () => {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  systemActor = { id: admin.id, role: "OWNER" };

  const fare = await prisma.chargeType.findUniqueOrThrow({ where: { key: "FARE" } });
  fareChargeTypeId = fare.id;
  const tip = await prisma.chargeType.findUniqueOrThrow({ where: { key: "PERSONAL_TIP" } });
  personalTipChargeTypeId = tip.id;

  const inactive = await prisma.chargeType.create({
    data: { key: "TEST_INACTIVE_TYPE", label: "Test Inactive", active: false }
  });
  inactiveChargeTypeId = inactive.id;
});

afterAll(async () => {
  // 这笔是测试自己建的额外 ChargeType，不属于 Module 9 的 4 个 Seed 资料，跑完要清掉，
  // 否则会污染 financialSchema.integration.test.ts 那边「只 Seed 4 个」的断言。
  await prisma.chargeType.delete({ where: { id: inactiveChargeTypeId } });
});

async function createTestBooking() {
  return bookingsService.createBooking({
    girlName: "BookingChargeApiTest",
    totalAmountCents: 0,
    legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
  });
}

let bookingIds: number[] = [];

afterEach(async () => {
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds }, adjustmentType: { not: "NONE" } } });
  await prisma.bookingCharge.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  bookingIds = [];
});

describe("createBookingCharge — 建立原始 Charge", () => {
  it("成功建立一笔原始 Charge，并把 Booking Total 重算为该笔金额", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const charge = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );

    expect(charge.adjustmentType).toBe("NONE");
    expect(charge.amountCents).toBe(10000);
    expect(charge.chargeType.key).toBe("FARE");

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.totalAmountCents).toBe(10000);
  });

  it("Customer Total 是所有有效 Charge 的合计（多笔原始 Charge 加总）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: personalTipChargeTypeId, amountCents: 2000 },
      systemActor
    );

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.totalAmountCents).toBe(12000);
  });

  it("写入 Audit Log（BOOKING_CHARGE_CREATED）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const charge = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 5000 },
      systemActor
    );

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "BookingCharge", entityId: charge.id, action: "BOOKING_CHARGE_CREATED" }
    });
    expect(log).not.toBeNull();
    expect(log?.actorUserId).toBe(systemActor.id);
  });
});

describe("createBookingCharge — Validation", () => {
  it("Validation：原始 Charge 金额必须大于 0（0 被拒绝）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 0 },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Validation：原始 Charge 金额必须大于 0（负数被拒绝）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: -100 },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Validation：Charge Type 必须合法——不存在的 chargeTypeId 被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: 999999, amountCents: 1000 },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Validation：Charge Type 必须合法——已停用（active=false）的 chargeTypeId 被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: inactiveChargeTypeId, amountCents: 1000 },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Validation：不存在的 Booking 被拒绝（404）", async () => {
    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: 999999, chargeTypeId: fareChargeTypeId, amountCents: 1000 },
        systemActor
      )
    ).rejects.toThrow(NotFoundError);
  });

  it("Validation：legId 属于别的 Booking 时被拒绝", async () => {
    const booking = await createTestBooking();
    const otherBooking = await createTestBooking();
    bookingIds.push(booking.id, otherBooking.id);
    const otherLeg = await prisma.leg.findFirstOrThrow({ where: { bookingId: otherBooking.id } });

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, legId: otherLeg.id, chargeTypeId: fareChargeTypeId, amountCents: 1000 },
        systemActor
      )
    ).rejects.toThrow(NotFoundError);
  });

  it("已 FINALIZED 的 Booking 不允许新增原始 Charge（只能新增 Adjustment）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    await prisma.booking.update({ where: { id: booking.id }, data: { financialStatus: "FINALIZED" } });

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 1000 },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });
});

describe("createBookingCharge — ADDITION（补收）", () => {
  it("成功建立 ADDITION，adjustsChargeId 指回原始 Charge，Booking Total 一并重算", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );

    const addition = await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustsChargeId: original.id,
        adjustmentReason: "客户补收停车费差额"
      },
      systemActor
    );

    expect(addition.adjustmentType).toBe("ADDITION");
    expect(addition.adjustsChargeId).toBe(original.id);

    const reloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(reloaded.totalAmountCents).toBe(10500);
  });

  it("Validation：ADDITION 没有填 adjustmentReason 会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );

    await expect(
      bookingChargeService.createBookingCharge(
        { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 500, adjustsChargeId: original.id },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("Validation：adjustsChargeId 指向另一笔 Adjustment（不是原始 Charge）会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    const addition = await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustsChargeId: original.id,
        adjustmentReason: "第一次补收"
      },
      systemActor
    );

    await expect(
      bookingChargeService.createBookingCharge(
        {
          bookingId: booking.id,
          chargeTypeId: fareChargeTypeId,
          amountCents: 200,
          adjustsChargeId: addition.id,
          adjustmentReason: "对 Adjustment 再次调整（应该被拒绝）"
        },
        systemActor
      )
    ).rejects.toThrow(ValidationError);
  });

  it("已 FINALIZED 的 Booking 仍然允许新增 ADDITION", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    await prisma.booking.update({ where: { id: booking.id }, data: { financialStatus: "FINALIZED" } });

    const addition = await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustsChargeId: original.id,
        adjustmentReason: "FINALIZED 后补收"
      },
      systemActor
    );
    expect(addition.adjustmentType).toBe("ADDITION");
  });
});

describe("voidBookingCharge — Void（REVERSAL）", () => {
  it("Void 建立一笔 REVERSAL，不删除、不修改原始 Charge，Booking Total 归零", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );

    const reversal = await bookingChargeService.voidBookingCharge(original.id, { reason: "客户取消" }, systemActor);

    expect(reversal.adjustmentType).toBe("REVERSAL");
    expect(reversal.amountCents).toBe(-10000);
    expect(reversal.adjustsChargeId).toBe(original.id);

    const originalReloaded = await prisma.bookingCharge.findUniqueOrThrow({ where: { id: original.id } });
    expect(originalReloaded.amountCents).toBe(10000);
    expect(originalReloaded.adjustmentType).toBe("NONE");

    const bookingReloaded = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingReloaded.totalAmountCents).toBe(0);
  });

  it("已 FINALIZED 的 Booking 仍然允许 Void（REVERSAL 是允许的两种 Adjustment 之一）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    await prisma.booking.update({ where: { id: booking.id }, data: { financialStatus: "FINALIZED" } });

    const reversal = await bookingChargeService.voidBookingCharge(original.id, { reason: "FINALIZED 后冲销" }, systemActor);
    expect(reversal.adjustmentType).toBe("REVERSAL");
  });

  it("Validation：Void 一笔不存在的 Charge 会得到 404", async () => {
    await expect(bookingChargeService.voidBookingCharge(999999, { reason: "x" }, systemActor)).rejects.toThrow(
      NotFoundError
    );
  });

  it("Validation：Void 缺少 reason 会被拒绝", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );

    await expect(bookingChargeService.voidBookingCharge(original.id, { reason: "" }, systemActor)).rejects.toThrow(
      ValidationError
    );
  });

  it("同一笔 Charge 不能被 Void 两次（第二次得到 409 Conflict）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    await bookingChargeService.voidBookingCharge(original.id, { reason: "第一次" }, systemActor);

    await expect(
      bookingChargeService.voidBookingCharge(original.id, { reason: "第二次（应该被拒绝）" }, systemActor)
    ).rejects.toThrow(ConflictError);
  });

  it("不能 Void 一笔 REVERSAL 记录本身", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    const reversal = await bookingChargeService.voidBookingCharge(original.id, { reason: "冲销" }, systemActor);

    await expect(
      bookingChargeService.voidBookingCharge(reversal.id, { reason: "试图 Void REVERSAL" }, systemActor)
    ).rejects.toThrow(ValidationError);
  });

  it("写入 Audit Log（BOOKING_CHARGE_VOIDED）", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    const reversal = await bookingChargeService.voidBookingCharge(original.id, { reason: "客户取消" }, systemActor);

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "BookingCharge", entityId: reversal.id, action: "BOOKING_CHARGE_VOIDED" }
    });
    expect(log).not.toBeNull();
  });
});

describe("listBookingCharges — List", () => {
  it("回传每笔原始 Charge 的净额跟是否已冲销", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);

    const fare = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustsChargeId: fare.id,
        adjustmentReason: "补收"
      },
      systemActor
    );

    const tip = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: personalTipChargeTypeId, amountCents: 2000 },
      systemActor
    );
    await bookingChargeService.voidBookingCharge(tip.id, { reason: "小费给错了" }, systemActor);

    const list = await bookingChargeService.listBookingCharges(booking.id);
    expect(list).toHaveLength(2);

    const fareRow = list.find((c) => c.id === fare.id)!;
    expect(fareRow.netAmountCents).toBe(10500);
    expect(fareRow.isVoided).toBe(false);
    expect(fareRow.additionCount).toBe(1);

    const tipRow = list.find((c) => c.id === tip.id)!;
    expect(tipRow.netAmountCents).toBe(0);
    expect(tipRow.isVoided).toBe(true);
  });

  it("空 Booking（没有任何 Charge）回传空阵列", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const list = await bookingChargeService.listBookingCharges(booking.id);
    expect(list).toEqual([]);
  });
});

describe("getBookingCharge — Detail", () => {
  it("回传单笔 Charge 的完整内容", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const charge = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000, description: "机场接送" },
      systemActor
    );

    const detail = await bookingChargeService.getBookingCharge(charge.id);
    expect(detail.id).toBe(charge.id);
    expect(detail.description).toBe("机场接送");
    expect(detail.chargeType.key).toBe("FARE");
  });

  it("找不到时抛出 404", async () => {
    await expect(bookingChargeService.getBookingCharge(999999)).rejects.toThrow(NotFoundError);
  });
});

describe("getChargeHistory — History", () => {
  it("回传原始 Charge + 所有 ADDITION/REVERSAL，依时间排序", async () => {
    const booking = await createTestBooking();
    bookingIds.push(booking.id);
    const original = await bookingChargeService.createBookingCharge(
      { bookingId: booking.id, chargeTypeId: fareChargeTypeId, amountCents: 10000 },
      systemActor
    );
    const addition = await bookingChargeService.createBookingCharge(
      {
        bookingId: booking.id,
        chargeTypeId: fareChargeTypeId,
        amountCents: 500,
        adjustsChargeId: original.id,
        adjustmentReason: "补收"
      },
      systemActor
    );
    const reversal = await bookingChargeService.voidBookingCharge(original.id, { reason: "最后取消" }, systemActor);

    const history = await bookingChargeService.getChargeHistory(original.id);
    expect(history.map((h) => h.id)).toEqual([original.id, addition.id, reversal.id]);

    // 用 addition 或 reversal 的 id 查 History，应该得到同样完整的一串。
    const historyFromAddition = await bookingChargeService.getChargeHistory(addition.id);
    expect(historyFromAddition.map((h) => h.id)).toEqual([original.id, addition.id, reversal.id]);
  });

  it("找不到时抛出 404", async () => {
    await expect(bookingChargeService.getChargeHistory(999999)).rejects.toThrow(NotFoundError);
  });
});
