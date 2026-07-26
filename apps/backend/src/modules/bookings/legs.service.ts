import type { LegType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { recalculateBookingStatus } from "./bookings.service.js";
import { applyLegTransition } from "./legTransition.js";
import { getFrozenAllocationSumCents, redistributeAutoAllocations } from "./allocation.js";
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
 * 验证一笔手动 override 的 Driver Income 金额，跟其他已经冻结（COMPLETED 或先前
 * 手动设定过）的金额加总起来，有没有超过 Driver Pool——仍是自动模式的其他 Leg 不算
 * 进这个总和，因为 redistributeAutoAllocations 之后会自动缩放去配合剩下的额度，
 * 不该被当成「会超额」的一部分。这里先用 `SELECT ... FOR UPDATE` 锁住 Booking row
 * 再读总额，直到交易 commit 前都不会释放锁，避免两个几乎同时的手动 override 各自读到
 * 「更新之前」的总和一起通过检查。
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
  const frozenSum = await getFrozenAllocationSumCents(client, bookingId, excludeLegId);
  const totalAfter = frozenSum + newAllocationCents;

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
  estimatedDurationMinutes?: number | null;
  estimatedFinishAt?: string | null;
  driverId?: number;
  notes?: string;
  // Mobile UAT Round 2：正常流程不会再传这个栏位（前端已经不给手动输入），
  // Driver Income 交给 redistributeAutoAllocations 自动算。传了才代表 Admin
  // 明确要 override 这笔的金额，才会走「冻结成手动」的路径。
  earningAllocationCents?: number;
}

function resolveScheduledAt(scheduledAt: string | null | undefined): Date | null | undefined {
  if (scheduledAt === undefined) return undefined;
  if (scheduledAt === null) return null;
  return new Date(scheduledAt);
}

function resolveEstimatedFinishAt(estimatedFinishAt: string | null | undefined): Date | null | undefined {
  if (estimatedFinishAt === undefined) return undefined;
  if (estimatedFinishAt === null) return null;
  return new Date(estimatedFinishAt);
}

/**
 * Mobile UAT Round 2：Estimated Duration 若填了必须是正数；Estimated Finish Time
 * 若跟 Pickup Time（scheduledAt）同时都有值，Finish 不能早于 Pickup——这两个栏位各自
 * 独立存，前端会自动帮忙算好 Finish Time 填入，但这里仍然要在后端把关，避免任何
 * 前端算错或直接打 API 的情况留下不合理的资料。
 */
export function assertLegScheduleFields(input: {
  scheduledAt?: Date | null;
  estimatedDurationMinutes?: number | null;
  estimatedFinishAt?: Date | null;
}) {
  if (input.estimatedDurationMinutes !== undefined && input.estimatedDurationMinutes !== null && input.estimatedDurationMinutes <= 0) {
    throw new ValidationError("estimatedDurationMinutes must be greater than 0");
  }
  if (input.scheduledAt && input.estimatedFinishAt && input.estimatedFinishAt < input.scheduledAt) {
    throw new ValidationError("estimatedFinishAt cannot be earlier than the pickup time (scheduledAt)");
  }
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

  const scheduledAt = resolveScheduledAt(input.scheduledAt);
  const estimatedFinishAt = resolveEstimatedFinishAt(input.estimatedFinishAt);
  assertLegScheduleFields({
    scheduledAt,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    estimatedFinishAt
  });

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
        scheduledAt,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        estimatedFinishAt,
        driverId: input.driverId,
        notes: input.notes,
        earningAllocationCents: input.earningAllocationCents,
        earningAllocationManual: input.earningAllocationCents !== undefined
      }
    });

    await redistributeAutoAllocations(tx, bookingId);
  });

  return recalculateBookingStatus(bookingId);
}

interface UpdateLegInput {
  legType?: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string | null;
  estimatedDurationMinutes?: number | null;
  estimatedFinishAt?: string | null;
  notes?: string;
  earningAllocationCents?: number;
}

export async function updateLeg(bookingId: number, legId: number, input: UpdateLegInput, actor: AuditActor | null) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status === "COMPLETED" || leg.status === "CANCELLED") {
    throw new ConflictError(`Leg is already ${leg.status} and cannot be edited`);
  }

  const scheduledAt = resolveScheduledAt(input.scheduledAt);
  const estimatedFinishAt = resolveEstimatedFinishAt(input.estimatedFinishAt);
  assertLegScheduleFields({
    scheduledAt: scheduledAt !== undefined ? scheduledAt : leg.scheduledAt,
    estimatedDurationMinutes:
      input.estimatedDurationMinutes !== undefined ? input.estimatedDurationMinutes : leg.estimatedDurationMinutes,
    estimatedFinishAt: estimatedFinishAt !== undefined ? estimatedFinishAt : leg.estimatedFinishAt
  });

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
        scheduledAt,
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        estimatedFinishAt,
        notes: input.notes,
        earningAllocationCents: input.earningAllocationCents,
        earningAllocationManual: input.earningAllocationCents !== undefined ? true : undefined
      }
    });

    if (input.earningAllocationCents !== undefined) {
      await redistributeAutoAllocations(tx, bookingId);
    }
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

  await prisma.$transaction(async (tx) => {
    await applyLegTransition({
      legId,
      fromStatuses: [...CANCELLABLE_STATUSES],
      data: { status: "CANCELLED" },
      client: tx
    });
    // Leg 数量（有效的部分）变了，剩下的自动分配 Leg 要重新平分 Driver Pool。
    await redistributeAutoAllocations(tx, bookingId);
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

  await prisma.$transaction(async (tx) => {
    await tx.leg.delete({ where: { id: legId } });
    await redistributeAutoAllocations(tx, bookingId);
  });

  return recalculateBookingStatus(bookingId);
}
