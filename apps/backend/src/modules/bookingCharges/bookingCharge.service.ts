import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { buildChargeListView, sumBookingTotalCents } from "./bookingCharge.aggregation.js";

export type TxClient = Prisma.TransactionClient | typeof prisma;

const chargeDetailInclude = {
  chargeType: { select: { id: true, key: true, label: true } },
  createdByUser: { select: { id: true, username: true } }
} satisfies Prisma.BookingChargeInclude;

/**
 * Booking.totalAmountCents（Customer Total）永远等于这张 Booking 底下全部 BookingCharge
 * 的加总——REVERSAL 本身是负数，天然抵销，不需要排除任何记录（database-schema-v2.md 第 6 章）。
 * 每次新增/冲销 Charge 后都要重算一次，写回 Booking 的快取栏位。
 */
export async function recalculateBookingTotal(client: TxClient, bookingId: number) {
  const charges = await client.bookingCharge.findMany({
    where: { bookingId },
    select: { id: true, amountCents: true, adjustmentType: true }
  });
  const totalAmountCents = sumBookingTotalCents(charges);
  await client.booking.update({ where: { id: bookingId }, data: { totalAmountCents } });
  return totalAmountCents;
}

interface CreateBookingChargeInput {
  bookingId: number;
  legId?: number;
  chargeTypeId: number;
  amountCents: number;
  description?: string;
  /** 提供这个欄位代表这是「补收」（ADDITION），必须指向一笔原始 Charge（adjustmentType=NONE）。 */
  adjustsChargeId?: number;
  adjustmentReason?: string;
}

/**
 * 建立一笔 Booking Charge 的核心逻辑——假设呼叫者已经在一个 Transaction 里，且已经视情况
 * 处理好 Booking row 的锁（避免并发覆盖 Booking Total）。这支函数本身不开 Transaction、
 * 不上锁，让 bookings.service.ts 可以在「建立 Booking」这类已经在自己的 Transaction 里、
 * 且 Booking row 本来就不可能被并发访问（刚建立、还没 commit）的场景下直接复用，不必
 * 承受巢状 Transaction 的问题。独立的 Booking Charge API（下面的 createBookingCharge）
 * 才是需要自己开 Transaction + 上锁的公开入口。
 */
export async function createBookingChargeWithClient(
  tx: TxClient,
  input: CreateBookingChargeInput,
  actor: AuditActor | null
) {
  if (input.amountCents === 0) {
    throw new ValidationError("amountCents cannot be zero");
  }

  const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${input.bookingId} not found`);
  }

  if (input.legId !== undefined) {
    const leg = await tx.leg.findUnique({ where: { id: input.legId } });
    if (!leg || leg.bookingId !== input.bookingId) {
      throw new NotFoundError(`Leg ${input.legId} not found on this booking`);
    }
  }

  const chargeType = await tx.chargeType.findUnique({ where: { id: input.chargeTypeId } });
  if (!chargeType || !chargeType.active) {
    throw new ValidationError("Invalid or inactive charge type");
  }

  let adjustmentType: "NONE" | "ADDITION" = "NONE";

  if (input.adjustsChargeId !== undefined) {
    const originalCharge = await tx.bookingCharge.findUnique({ where: { id: input.adjustsChargeId } });
    if (!originalCharge || originalCharge.bookingId !== input.bookingId) {
      throw new NotFoundError(`Charge ${input.adjustsChargeId} not found on this booking`);
    }
    if (originalCharge.adjustmentType !== "NONE") {
      throw new ValidationError(
        "adjustsChargeId 必须指向原始 Charge（adjustmentType=NONE），不能对另一笔 Adjustment 建立 Adjustment"
      );
    }
    if (!input.adjustmentReason?.trim()) {
      throw new ValidationError("adjustmentReason is required when adjustsChargeId is provided");
    }
    adjustmentType = "ADDITION";
  }

  if (booking.financialStatus === "FINALIZED" && adjustmentType === "NONE") {
    throw new ValidationError(
      "Booking 已经 FINALIZED，只能新增 Adjustment（补收 ADDITION 或冲销 REVERSAL），不能再新增原始 Charge"
    );
  }

  if (adjustmentType === "NONE" && input.amountCents <= 0) {
    throw new ValidationError("金额必须大于 0");
  }

  const charge = await tx.bookingCharge.create({
    data: {
      bookingId: input.bookingId,
      legId: input.legId,
      chargeTypeId: input.chargeTypeId,
      amountCents: input.amountCents,
      description: input.description,
      adjustmentType,
      adjustsChargeId: input.adjustsChargeId,
      adjustmentReason: input.adjustmentReason,
      createdBy: actor?.id
    },
    include: chargeDetailInclude
  });

  const totalAmountCents = await recalculateBookingTotal(tx, input.bookingId);

  await writeAuditLog(
    {
      actor,
      action: "BOOKING_CHARGE_CREATED",
      entityType: "BookingCharge",
      entityId: charge.id,
      afterData: {
        bookingId: charge.bookingId,
        legId: charge.legId,
        chargeTypeId: charge.chargeTypeId,
        amountCents: charge.amountCents,
        adjustmentType: charge.adjustmentType,
        adjustsChargeId: charge.adjustsChargeId,
        adjustmentReason: charge.adjustmentReason
      },
      metadata: { bookingTotalAmountCentsAfter: totalAmountCents }
    },
    tx
  );

  return charge;
}

/**
 * 公开入口：自己开 Transaction + 锁 Booking row，再委派给上面的核心逻辑。
 * Booking Charge API（controller）走这支；bookings.service.ts 建立全新 Booking 时
 * 直接呼叫 createBookingChargeWithClient，不透过这层（新建立的 Booking row 不可能被
 * 并发访问，不需要额外上锁，也不能巢状开两层 Transaction）。
 */
export async function createBookingCharge(input: CreateBookingChargeInput, actor: AuditActor) {
  return prisma.$transaction(async (tx) => {
    // 锁住 Booking row，避免两个并发新增各自算出一份「重算前」的总额、互相覆盖对方的结果。
    await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${input.bookingId} FOR UPDATE`;
    return createBookingChargeWithClient(tx, input, actor);
  });
}

interface VoidBookingChargeInput {
  reason: string;
}

/**
 * Void 不删除、不修改原始 Charge——新增一笔 amountCents 相反、adjustmentType=REVERSAL、
 * adjustsChargeId 指回原始记录的冲销纪录。Partial Unique Index 保证同一笔原始 Charge
 * 只能被冲销一次，这里先在应用层查一次给更清楚的错误讯息，DB constraint 是最后防线。
 */
export async function voidBookingCharge(chargeId: number, input: VoidBookingChargeInput, actor: AuditActor) {
  if (!input.reason?.trim()) {
    throw new ValidationError("reason is required");
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.bookingCharge.findUnique({ where: { id: chargeId } });
    if (!original) {
      throw new NotFoundError(`BookingCharge ${chargeId} not found`);
    }
    if (original.adjustmentType === "REVERSAL") {
      throw new ValidationError("不能 Void 一笔 REVERSAL 记录");
    }

    await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${original.bookingId} FOR UPDATE`;

    const existingReversal = await tx.bookingCharge.findFirst({
      where: { adjustsChargeId: chargeId, adjustmentType: "REVERSAL" }
    });
    if (existingReversal) {
      throw new ConflictError("这笔 Charge 已经被冲销过");
    }

    const reversal = await tx.bookingCharge.create({
      data: {
        bookingId: original.bookingId,
        legId: original.legId,
        chargeTypeId: original.chargeTypeId,
        amountCents: -original.amountCents,
        adjustmentType: "REVERSAL",
        adjustsChargeId: original.id,
        adjustmentReason: input.reason,
        createdBy: actor.id
      },
      include: chargeDetailInclude
    });

    const totalAmountCents = await recalculateBookingTotal(tx, original.bookingId);

    await writeAuditLog(
      {
        actor,
        action: "BOOKING_CHARGE_VOIDED",
        entityType: "BookingCharge",
        entityId: reversal.id,
        beforeData: { originalChargeId: original.id, originalAmountCents: original.amountCents },
        afterData: { reversalChargeId: reversal.id, amountCents: reversal.amountCents, reason: input.reason },
        metadata: { bookingTotalAmountCentsAfter: totalAmountCents }
      },
      tx
    );

    return reversal;
  });
}

/** List Booking Charges：一笔原始 Charge 一行，附带净额（原始 + 所有 ADDITION/REVERSAL）跟是否已冲销。 */
export async function listBookingCharges(bookingId: number) {
  const originals = await prisma.bookingCharge.findMany({
    where: { bookingId, adjustmentType: "NONE" },
    include: chargeDetailInclude,
    orderBy: { createdAt: "asc" }
  });

  const adjustments = await prisma.bookingCharge.findMany({
    where: { bookingId, adjustmentType: { in: ["ADDITION", "REVERSAL"] } }
  });

  const adjustmentsByOriginal = new Map<number, typeof adjustments>();
  for (const adj of adjustments) {
    if (adj.adjustsChargeId === null) continue;
    const list = adjustmentsByOriginal.get(adj.adjustsChargeId) ?? [];
    list.push(adj);
    adjustmentsByOriginal.set(adj.adjustsChargeId, list);
  }

  const views = buildChargeListView(
    originals.map((original) => ({
      original,
      adjustments: adjustmentsByOriginal.get(original.id) ?? []
    }))
  );
  const viewById = new Map(views.map((v) => [v.id, v]));

  return originals.map((original) => {
    const view = viewById.get(original.id)!;
    return {
      ...original,
      netAmountCents: view.netAmountCents,
      isVoided: view.isVoided,
      additionCount: view.additionCount
    };
  });
}

export async function getBookingCharge(id: number) {
  const charge = await prisma.bookingCharge.findUnique({ where: { id }, include: chargeDetailInclude });
  if (!charge) {
    throw new NotFoundError(`BookingCharge ${id} not found`);
  }
  return charge;
}

/** 一笔 Charge 的完整生命周期：原始 Charge + 所有指向它的 ADDITION/REVERSAL，依建立时间排序。 */
export async function getChargeHistory(id: number) {
  const charge = await prisma.bookingCharge.findUnique({ where: { id } });
  if (!charge) {
    throw new NotFoundError(`BookingCharge ${id} not found`);
  }

  const rootId = charge.adjustmentType === "NONE" ? charge.id : charge.adjustsChargeId;
  if (rootId === null || rootId === undefined) {
    throw new NotFoundError(`BookingCharge ${id} has no resolvable original charge`);
  }

  return prisma.bookingCharge.findMany({
    where: { OR: [{ id: rootId }, { adjustsChargeId: rootId }] },
    include: chargeDetailInclude,
    orderBy: { createdAt: "asc" }
  });
}
