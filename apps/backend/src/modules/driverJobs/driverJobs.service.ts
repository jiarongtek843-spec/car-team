import type { LegStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "../bookings/bookings.service.js";
import { applyLegTransition } from "../bookings/legTransition.js";
import { createLegEarning } from "../wallet/wallet.service.js";
import type { AuditActor } from "../../common/audit.js";

const bookingSummaryInclude = {
  booking: {
    select: { id: true, girlName: true, totalAmountCents: true, driverPoolAmountCents: true, notes: true, status: true }
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

/**
 * Leg 状态转成 COMPLETED 跟建立 LEG_EARNING 一定要在同一个 DB Transaction 里，
 * 才能保证「第一次成功变 Completed」跟「产生一笔收入」是同一件事、不会因为中途出错而对不上。
 *
 * Module 12（Wallet Migration）起，这里改成按 Booking 的 financialVersion 决定要不要记账：
 * Financial V1（这次 migration 之前就存在的旧 Booking）继续用这套「Leg 完成当下立刻记账」
 * 的机制；Financial V2（migration 之后新建立的 Booking）完全不在这里记账，收入改由
 * Revenue Sharing Finalize + Issue Wallet 统一处理——同一张 Booking 不会同时出现
 * LEG_EARNING 跟 REVENUE_SHARE_PAYOUT。见 docs/modules/wallet-migration.md。
 */
export async function completeLeg(driverId: number, legId: number, actor: AuditActor) {
  const leg = await prisma.$transaction(async (tx) => {
    const updatedLeg = await applyLegTransition({
      legId,
      driverId,
      fromStatuses: ["PASSENGER_ON_BOARD"],
      data: { status: "COMPLETED", completedAt: new Date() },
      client: tx
    });

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: updatedLeg.bookingId },
      select: { financialVersion: true }
    });

    if (booking.financialVersion === "V1") {
      await createLegEarning(tx, updatedLeg, actor);
    }

    return updatedLeg;
  });

  await recalculateBookingStatus(leg.bookingId);
  return getMyLegOrThrow(driverId, legId);
}
