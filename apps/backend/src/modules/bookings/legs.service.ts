import type { LegType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { recalculateBookingStatus } from "./bookings.service.js";
import { applyLegTransition } from "./legTransition.js";
import { getAllocatedSumCents } from "./allocation.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";

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

async function assertAllocationFits(bookingId: number, newAllocationCents: number, excludeLegId?: number) {
  if (newAllocationCents < 0) {
    throw new ValidationError("earningAllocationCents cannot be negative");
  }

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const otherLegsSum = await getAllocatedSumCents(bookingId, excludeLegId);
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

  if (input.earningAllocationCents !== undefined) {
    await assertAllocationFits(bookingId, input.earningAllocationCents);
  }

  const lastLeg = await prisma.leg.findFirst({
    where: { bookingId },
    orderBy: { sequence: "desc" }
  });

  await prisma.leg.create({
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

  if (input.earningAllocationCents !== undefined) {
    // 防呆：正常流程下已经产生 Wallet Transaction 的 Leg 一定已经是 COMPLETED（上面已经挡掉），
    // 这里多一层直接检查 Transaction 是否存在，避免任何未来的状态机改动意外打开这个漏洞。
    const hasTransaction = await prisma.walletTransaction.findFirst({ where: { legId } });
    if (hasTransaction) {
      throw new ConflictError("This leg already has a wallet transaction; allocation can no longer be changed");
    }
    await assertAllocationFits(bookingId, input.earningAllocationCents, legId);
  }

  await prisma.leg.update({
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
 * 首次指派或重新指派都走这里。重新指派会把之前的接受/抵达/上车/拒绝纪录清空，
 * 让新司机从 ASSIGNED 重新开始整个流程。
 */
export async function assignDriver(bookingId: number, legId: number, driverId: number) {
  await getOwnedLeg(bookingId, legId);

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }
  if (driver.status !== "ACTIVE") {
    throw new ConflictError("Cannot assign a disabled driver");
  }

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

  await prisma.leg.delete({ where: { id: legId } });

  return recalculateBookingStatus(bookingId);
}
