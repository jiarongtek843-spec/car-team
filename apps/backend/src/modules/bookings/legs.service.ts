import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "./bookings.service.js";

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

export async function assignDriver(bookingId: number, legId: number, driverId: number) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status === "COMPLETED" || leg.status === "CANCELLED") {
    throw new ConflictError(`Leg is already ${leg.status} and cannot be reassigned`);
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  await prisma.leg.update({ where: { id: legId }, data: { driverId } });

  return recalculateBookingStatus(bookingId);
}

export async function startLeg(bookingId: number, legId: number) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status !== "PENDING") {
    throw new ConflictError(`Leg must be PENDING to start (currently ${leg.status})`);
  }
  if (!leg.driverId) {
    throw new ConflictError("Cannot start a leg without an assigned driver");
  }

  await prisma.leg.update({ where: { id: legId }, data: { status: "IN_PROGRESS" } });

  return recalculateBookingStatus(bookingId);
}

export async function completeLeg(bookingId: number, legId: number) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status !== "IN_PROGRESS") {
    throw new ConflictError(`Leg must be IN_PROGRESS to complete (currently ${leg.status})`);
  }

  await prisma.leg.update({ where: { id: legId }, data: { status: "COMPLETED" } });

  return recalculateBookingStatus(bookingId);
}

export async function cancelLeg(bookingId: number, legId: number) {
  const leg = await getOwnedLeg(bookingId, legId);
  if (leg.status !== "PENDING" && leg.status !== "IN_PROGRESS") {
    throw new ConflictError(`Leg is already ${leg.status}`);
  }

  await prisma.leg.update({ where: { id: legId }, data: { status: "CANCELLED" } });

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
