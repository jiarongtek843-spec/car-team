import type { LegStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "../bookings/bookings.service.js";
import { applyLegTransition } from "../bookings/legTransition.js";
import { createLegEarning } from "../wallet/wallet.service.js";
import { payoutForCompletedLeg } from "../revenueSharing/revenueSharing.service.js";
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
 * Leg 状态转成 COMPLETED 跟产生收入一定要在同一个 DB Transaction 里，才能保证
 * 「第一次成功变 Completed」跟「产生一笔收入」是同一件事、不会因为中途出错而对不上。
 *
 * 按 Booking 的 financialVersion 决定要不要记账、怎么记账：
 * Financial V1（这次 migration 之前就存在的旧 Booking）继续用「Leg 完成当下立刻记账」
 * 的 LEG_EARNING 机制；Financial V2（migration 之后新建立的 Booking）改由
 * revenueSharing.service.ts 的 payoutForCompletedLeg 处理——同一张 Booking 不会同时
 * 出现 LEG_EARNING 跟 REVENUE_SHARE_PAYOUT。见 docs/modules/wallet-migration.md。
 *
 * 2026-07 修正（driver-earnings-after-leg-completion）：V2 原本设计成要等 Owner/Manager
 * 手动呼叫 Revenue Sharing Finalize 才会发放 Wallet，但前端从来没有做过这个手动按钮，
 * 导致所有 V2 Booking 的司机收入永远不会产生。改成这里直接呼叫 payoutForCompletedLeg，
 * 该 Booking 第一条 Leg 完成时自动建立 Revenue Sharing Snapshot（等同自动 Finalize），
 * 之后每条 Leg 各自完成时立刻拿到自己那一份，不需要等整张 Booking 全部完成。
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
    } else {
      await payoutForCompletedLeg(tx, { bookingId: updatedLeg.bookingId, legId: updatedLeg.id }, actor);
    }

    return updatedLeg;
  });

  await recalculateBookingStatus(leg.bookingId);
  return getMyLegOrThrow(driverId, legId);
}
