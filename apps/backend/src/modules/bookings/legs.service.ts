import type { LegType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { recalculateBookingStatus } from "./bookings.service.js";
import { applyLegTransition } from "./legTransition.js";
import { getAllocatedSumCents } from "./allocation.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import type { TxClient } from "../bookingCharges/bookingCharge.service.js";

const REASSIGNABLE_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "PASSENGER_ON_BOARD",
  "REJECTED"
] as const;

const CANCELLABLE_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "PASSENGER_ON_BOARD",
  "REJECTED"
] as const;

async function getOwnedLeg(bookingId: number, legId: number) {
  const leg = await prisma.leg.findUnique({ where: { id: legId } });
  if (!leg || leg.bookingId !== bookingId) {
    throw new NotFoundError(`Leg ${legId} not found on booking ${bookingId}`);
  }
  return leg;
}

/**
 * Bug Fix（UAT 稳定化阶段）：V2 Booking 的分润权重（revenueSharing.service.ts 的
 * payoutForCompletedLeg）是每次 Leg 完成时，用「当下还活着的合格 Leg 集合」重新算的，
 * 不是在 Finalize 当下就把权重定死。如果 Booking 已经因为第一个 Leg 完成而自动 Finalize
 * 之后，还能对同一个 Booking 增删 Leg，第二个 Leg 完成时会用新的 Leg 集合重新分摊同一笔
 * driverPoolCents，造成总发放金额跟 Pool 对不上（超付或少付）。Finalize 之后的 Leg 集合
 * 就是分润权重的锚点，事后不该再被改变——用跟 BookingCharge 一样的「FINALIZED 之后原始
 * 项目冻结」精神来处理，不是另外设计一套权重快照机制。
 */
async function assertNotFinalizedV2(booking: { financialVersion: string; financialStatus: string }) {
  if (booking.financialVersion === "V2" && booking.financialStatus === "FINALIZED") {
    throw new ConflictError(
      "This booking's revenue sharing has already been finalized; legs can no longer be added, cancelled, or deleted"
    );
  }
}

/**
 * Bug Fix（UAT 稳定化阶段）：这里读取「目前已分配总额」时之前没有上锁，跟
 * bookingCharge.service.ts 建立 Charge 时明确用 `SELECT ... FOR UPDATE` 的做法不一致——
 * 两个几乎同时的 addLeg/updateLeg 可能都读到同一份「超额之前」的总和，一起通过检查，
 * 让总分配超过 Driver Pool。呼叫端必须传入交易中的 tx client，这里先锁住 Booking row
 * 再读总额，直到交易 commit 前都不会释放锁，第二个并发呼叫会等到第一个写完才能读到
 * 最新总额。
 */
export async function assertAllocationFits(
  client: TxClient,
  bookingId: number,
  newAllocationCents: number,
  excludeLegId?: number
) {
  if (newAllocationCents < 0) {
    throw new ValidationError("earningAllocationCents cannot be negative");
  }

  await client.$queryRaw`SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;
  const booking = await client.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const otherLegsSum = await getAllocatedSumCents(client, bookingId, excludeLegId);
  const totalAfter = otherLegsSum + newAllocationCents;

  if (totalAfter > booking.driverPoolAmountCents) {
    throw new ValidationError(
      `Total leg allocation (RM${(totalAfter / 100).toFixed(2)}) would exceed the driver pool (RM${(
        booking.driverPoolAmountCents / 100
      ).toFixed(2)})`
    );
  }
}

interface AddLegInput {
  legType?: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  // undefined = 没带这个栏位；null = 明确选择「时间未定」；string = 实际时间。
  scheduledAt?: string | null;
  driverId?: number;
  notes?: string;
  earningAllocationCents?: number;
}

function resolveScheduledAt(scheduledAt: string | null | undefined): Date | null | undefined {
  if (scheduledAt === undefined) return undefined;
  if (scheduledAt === null) return null;
  return new Date(scheduledAt);
}

export async function addLeg(bookingId: number, input: AddLegInput) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }
  if (booking.status === "CANCELLED") {
    throw new ConflictError("Cannot add a leg to a cancelled booking");
  }
  await assertNotFinalizedV2(booking);
  if (input.driverId !== undefined) {
    await assertDriverAssignable(input.driverId);
  }

  await prisma.$transaction(async (tx) => {
    if (input.earningAllocationCents !== undefined) {
      await assertAllocationFits(tx, bookingId, input.earningAllocationCents);
    }

    const lastLeg = await tx.leg.findFirst({
      where: { bookingId },
      orderBy: { sequence: "desc" }
    });

    await tx.leg.create({
      data: {
        bookingId,
        sequence: (lastLeg?.sequence ?? 0) + 1,
        legType: input.legType,
        pickupLocation: input.pickupLocation,
        dropoffLocation: input.dropoffLocation,
        scheduledAt: resolveScheduledAt(input.scheduledAt),
        driverId: input.driverId,
        notes: input.notes,
        earningAllocationCents: input.earningAllocationCents
      }
    });
  });

  return recalculateBookingStatus(bookingId);
}

interface UpdateLegInput {
  legType?: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string | null;
  notes?: string;
  earningAllocationCents?: number;
}

export async function updateLeg(bookingId: number, legId: number, input: UpdateLegInput, actor: AuditActor | null) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status === "COMPLETED" || leg.status === "CANCELLED") {
    throw new ConflictError(`Leg is already ${leg.status} and cannot be edited`);
  }

  await prisma.$transaction(async (tx) => {
    if (input.earningAllocationCents !== undefined) {
      // 防呆：正常流程下已经产生 Wallet Transaction 的 Leg 一定已经是 COMPLETED（上面已经挡掉），
      // 这里多一层直接检查 Transaction 是否存在，避免任何未来的状态机改动意外打开这个漏洞。
      const hasTransaction = await tx.walletTransaction.findFirst({ where: { legId } });
      if (hasTransaction) {
        throw new ConflictError("This leg already has a wallet transaction; allocation can no longer be changed");
      }
      await assertAllocationFits(tx, bookingId, input.earningAllocationCents, legId);
    }

    await tx.leg.update({
      where: { id: legId },
      data: {
        legType: input.legType,
        pickupLocation: input.pickupLocation,
        dropoffLocation: input.dropoffLocation,
        scheduledAt: resolveScheduledAt(input.scheduledAt),
        notes: input.notes,
        earningAllocationCents: input.earningAllocationCents
      }
    });
  });

  if (input.earningAllocationCents !== undefined) {
    await writeAuditLog({
      actor,
      action: "LEG_ALLOCATION_UPDATE",
      entityType: "Leg",
      entityId: legId,
      beforeData: { earningAllocationCents: leg.earningAllocationCents },
      afterData: { earningAllocationCents: input.earningAllocationCents }
    });
  }

  return recalculateBookingStatus(bookingId);
}

/**
 * Bug Fix（UAT 稳定化阶段）：建立 Booking 时内联建 Leg（bookings.service.ts）跟
 * addLeg（本档）之前都直接把 driverId 丢给 prisma.leg.create，完全没检查这个 Driver
 * 存不存在、是不是 ACTIVE——跟 assignDriver 的检查方式不一致。传一个不存在的 driverId
 * 会撞 Prisma FK 违反（P2003），没有被特别处理，会变成不明确的 500，也让一个 INACTIVE
 * 的 Driver 被直接指派，绕过 assignDriver 已经在把关的规则。抽出来给三个地方共用。
 */
export async function assertDriverAssignable(driverId: number) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }
  if (driver.status !== "ACTIVE") {
    throw new ConflictError("Cannot assign a disabled driver");
  }
}

/**
 * 首次指派或重新指派都走这里。重新指派会把之前的接受/抵达/上车/拒绝纪录清空，
 * 让新司机从 ASSIGNED 重新开始整个流程。
 */
export async function assignDriver(bookingId: number, legId: number, driverId: number) {
  await getOwnedLeg(bookingId, legId);
  await assertDriverAssignable(driverId);

  await applyLegTransition({
    legId,
    fromStatuses: [...REASSIGNABLE_STATUSES],
    data: {
      driverId,
      status: "ASSIGNED",
      assignedAt: new Date(),
      acceptedAt: null,
      driverArrivingAt: null,
      passengerOnBoardAt: null,
      rejectedAt: null,
      rejectionReason: null
    }
  });

  return recalculateBookingStatus(bookingId);
}

export async function cancelLeg(bookingId: number, legId: number) {
  await getOwnedLeg(bookingId, legId);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  await assertNotFinalizedV2(booking);

  await applyLegTransition({
    legId,
    fromStatuses: [...CANCELLABLE_STATUSES],
    data: { status: "CANCELLED" }
  });

  return recalculateBookingStatus(bookingId);
}

export async function deleteLeg(bookingId: number, legId: number) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status !== "PENDING") {
    throw new ConflictError("Only a PENDING leg can be deleted; cancel it instead");
  }
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  await assertNotFinalizedV2(booking);

  await prisma.leg.delete({ where: { id: legId } });

  return recalculateBookingStatus(bookingId);
}
