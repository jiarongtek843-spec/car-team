import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "./bookings.service.js";
import { applyLegTransition } from "./legTransition.js";

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

interface AddLegInput {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  driverId?: number;
  notes?: string;
}

export async function addLeg(bookingId: number, input: AddLegInput) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }
  if (booking.status === "CANCELLED") {
    throw new ConflictError("Cannot add a leg to a cancelled booking");
  }

  const lastLeg = await prisma.leg.findFirst({
    where: { bookingId },
    orderBy: { sequence: "desc" }
  });

  await prisma.leg.create({
    data: {
      bookingId,
      sequence: (lastLeg?.sequence ?? 0) + 1,
      pickupLocation: input.pickupLocation,
      dropoffLocation: input.dropoffLocation,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      driverId: input.driverId,
      notes: input.notes
    }
  });

  return recalculateBookingStatus(bookingId);
}

interface UpdateLegInput {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  notes?: string;
}

export async function updateLeg(bookingId: number, legId: number, input: UpdateLegInput) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status === "COMPLETED" || leg.status === "CANCELLED") {
    throw new ConflictError(`Leg is already ${leg.status} and cannot be edited`);
  }

  await prisma.leg.update({
    where: { id: legId },
    data: {
      pickupLocation: input.pickupLocation,
      dropoffLocation: input.dropoffLocation,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      notes: input.notes
    }
  });

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
