import type { LegStatus, Prisma, WalletTransactionStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError } from "../../common/errors.js";
import { recalculateBookingStatus } from "../bookings/bookings.service.js";
import { applyLegTransition } from "../bookings/legTransition.js";
import { createLegEarning } from "../wallet/wallet.service.js";
import { payoutForCompletedLeg } from "../revenueSharing/revenueSharing.service.js";
import { createActivity } from "../activityLog/activityLog.service.js";
import type { AuditActor } from "../../common/audit.js";

const bookingSummaryInclude = {
  booking: {
    select: { id: true, girlName: true, totalAmountCents: true, driverPoolAmountCents: true, notes: true, status: true }
  },
  // Mobile UAT Bug Fix（Completed Job 显示金额）：Driver 只能看到「这条 Leg 自己那份」的
  // 收入，不是 Booking 的顾客总车费（那是 booking.totalAmountCents），也不是其他 Driver 的
  // 分润或公司抽成。V1 Booking 用 LEG_EARNING、V2 用 REVENUE_SHARE_PAYOUT，两者互斥
  // （@@unique([legId, transactionType]) 加上同一张 Booking 不会同时出现两种类型），所以
  // 这里最多只会查到一笔。V2 的实际发放金额是按 earningAllocationCents 当权重、从
  // Revenue Sharing Snapshot 按比例分配算出来的，不等同于 earningAllocationCents 本身，
  // 所以要读实际产生的 WalletTransaction.amountCents，不能直接显示 earningAllocationCents。
  walletTransactions: {
    where: { transactionType: { in: ["LEG_EARNING", "REVENUE_SHARE_PAYOUT"] } },
    select: { amountCents: true, status: true, settlement: { select: { reference: true } } }
  }
} satisfies Prisma.LegInclude;

function serializeLeg<
  T extends {
    walletTransactions: { amountCents: number; status: WalletTransactionStatus; settlement: { reference: string } | null }[];
  }
>(leg: T) {
  const { walletTransactions, ...rest } = leg;
  const earning = walletTransactions[0] ?? null;
  return {
    ...rest,
    driverEarningCents: earning?.amountCents ?? null,
    walletStatus: earning?.status ?? null,
    settlementReference: earning?.settlement?.reference ?? null
  };
}

// Stabilization：这支是 Driver App 的「My Jobs」主画面，之前完全没有上限——正式改成
// 分页/日期筛选牵涉前端契约改动，风险跟这次 Stabilization 要的「低风险」不成比例，
// 先加一个防御性的 take 上限，避免这份清单随著历史 Leg 累积无止尽变大变慢；跟
// dispatch.service.ts 的 listWaitingBookings 用同一个 500 笔上限当先例。
const MAX_MY_LEGS = 500;

export async function listMyLegs(driverId: number) {
  const legs = await prisma.leg.findMany({
    where: { driverId },
    include: bookingSummaryInclude,
    orderBy: [{ scheduledAt: "asc" }, { sequence: "asc" }],
    take: MAX_MY_LEGS
  });
  return legs.map(serializeLeg);
}

async function getMyLegOrThrow(driverId: number, legId: number) {
  const leg = await prisma.leg.findFirst({
    where: { id: legId, driverId },
    include: bookingSummaryInclude
  });
  if (!leg) {
    throw new NotFoundError(`Leg ${legId} not found`);
  }
  return serializeLeg(leg);
}

/**
 * Bug Fix（UAT 稳定化阶段）：Leg 状态机之前只检查 leg 状态跟 driverId 对不对，从来不检查
 * driver.status。Admin 可以把一个正在跑单的 Driver 设成 INACTIVE，这个 Driver 事后还是能
 * 继续 acceptLeg/rejectLeg/markDriverArriving/markPassengerOnBoard，跟 assignDriver 已经在
 * 挡的「不能指派已停用 Driver」规则不一致。completeLeg 刻意不挡——已经在跑的行程走到完成
 * 不该被这个卡住，只挡后续的新接单/新状态推进类操作。
 */
async function assertDriverActiveForJobAction(driverId: number) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }
  if (driver.status !== "ACTIVE") {
    throw new ConflictError("This driver account has been disabled and can no longer act on this job");
  }
}

async function transitionAndReturn(
  driverId: number,
  legId: number,
  fromStatuses: LegStatus[],
  data: Prisma.LegUncheckedUpdateManyInput,
  activityType: string,
  summary: string
) {
  await assertDriverActiveForJobAction(driverId);
  const leg = await prisma.$transaction(async (tx) => {
    const updated = await applyLegTransition({ legId, driverId, fromStatuses, data, client: tx });
    await createActivity(
      {
        module: "DRIVER_JOBS",
        activityType,
        entityType: "Leg",
        entityId: legId,
        summary,
        actor: { driverId },
        subjectDriverId: driverId
      },
      tx
    );
    return updated;
  });
  await recalculateBookingStatus(leg.bookingId);
  return getMyLegOrThrow(driverId, legId);
}

export function acceptLeg(driverId: number, legId: number) {
  return transitionAndReturn(
    driverId,
    legId,
    ["ASSIGNED"],
    { status: "ACCEPTED", acceptedAt: new Date() },
    "LEG_ACCEPTED",
    "Driver accepted the job"
  );
}

export function rejectLeg(driverId: number, legId: number, reason: string) {
  return transitionAndReturn(
    driverId,
    legId,
    ["ASSIGNED"],
    { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason },
    "LEG_REJECTED",
    "Driver rejected the job"
  );
}

export function markDriverArriving(driverId: number, legId: number) {
  return transitionAndReturn(
    driverId,
    legId,
    ["ACCEPTED"],
    { status: "DRIVER_ARRIVING", driverArrivingAt: new Date() },
    "DRIVER_ARRIVING",
    "Driver is on the way"
  );
}

export function markPassengerOnBoard(driverId: number, legId: number) {
  return transitionAndReturn(
    driverId,
    legId,
    ["DRIVER_ARRIVING"],
    { status: "PASSENGER_ON_BOARD", passengerOnBoardAt: new Date() },
    "PASSENGER_ON_BOARD",
    "Passenger is on board"
  );
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

    await createActivity(
      {
        module: "DRIVER_JOBS",
        activityType: "LEG_COMPLETED",
        entityType: "Leg",
        entityId: legId,
        summary: "Driver completed the job",
        actor: { driverId },
        subjectDriverId: driverId
      },
      tx
    );

    return updatedLeg;
  });

  await recalculateBookingStatus(leg.bookingId);
  return getMyLegOrThrow(driverId, legId);
}
