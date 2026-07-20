import type { LegStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "../bookings/bookings.service.js";
import { applyLegTransition } from "../bookings/legTransition.js";

const bookingSummaryInclude = {
  booking: {
    select: { id: true, girlName: true, carFee: true, notes: true, status: true }
  }
} as const;

export function listMyLegs(driverId: number) {
  return prisma.leg.findMany({
    where: { driverId },
    include: bookingSummaryInclude,
    orderBy: [{ scheduledAt: "asc" }, { sequence: "asc" }]
  });
}

async function getMyLegOrThrow(driverId: number, legId: number) {
  const leg = await prisma.leg.findFirst({
    where: { id: legId, driverId },
    include: bookingSummaryInclude
  });
  if (!leg) {
    throw new NotFoundError(`Leg ${legId} not found`);
  }
  return leg;
}

async function transitionAndReturn(
  driverId: number,
  legId: number,
  fromStatuses: LegStatus[],
  data: Prisma.LegUncheckedUpdateManyInput
) {
  const leg = await applyLegTransition({ legId, driverId, fromStatuses, data });
  await recalculateBookingStatus(leg.bookingId);
  return getMyLegOrThrow(driverId, legId);
}

export function acceptLeg(driverId: number, legId: number) {
  return transitionAndReturn(driverId, legId, ["ASSIGNED"], {
    status: "ACCEPTED",
    acceptedAt: new Date()
  });
}

export function rejectLeg(driverId: number, legId: number, reason: string) {
  return transitionAndReturn(driverId, legId, ["ASSIGNED"], {
    status: "REJECTED",
    rejectedAt: new Date(),
    rejectionReason: reason
  });
}

export function markDriverArriving(driverId: number, legId: number) {
  return transitionAndReturn(driverId, legId, ["ACCEPTED"], {
    status: "DRIVER_ARRIVING",
    driverArrivingAt: new Date()
  });
}

export function markPassengerOnBoard(driverId: number, legId: number) {
  return transitionAndReturn(driverId, legId, ["DRIVER_ARRIVING"], {
    status: "PASSENGER_ON_BOARD",
    passengerOnBoardAt: new Date()
  });
}

export function completeLeg(driverId: number, legId: number) {
  return transitionAndReturn(driverId, legId, ["PASSENGER_ON_BOARD"], {
    status: "COMPLETED",
    completedAt: new Date()
  });
}
