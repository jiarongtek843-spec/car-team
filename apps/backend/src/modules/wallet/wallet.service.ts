import type { Prisma, WalletTransactionStatus, WalletTransactionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";

type TxClient = Prisma.TransactionClient | typeof prisma;

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Leg 第一次变 Completed 时呼叫。刻意不判断金额是否 > 0——就算这段 Leg 没有分配收入，
 * 也照样留一笔金额 0 的纪录，帐本才完整、不用另外猜「为什么这个 Leg 没有 Transaction」。
 * 靠 DB 的 @@unique([legId, transactionType]) 挡住任何重复呼叫。
 */
export async function createLegEarning(
  client: TxClient,
  leg: { id: number; bookingId: number; driverId: number | null; sequence: number; earningAllocationCents: number | null },
  actor: AuditActor
) {
  if (!leg.driverId) {
    return null;
  }

  const transaction = await client.walletTransaction.create({
    data: {
      driverId: leg.driverId,
      bookingId: leg.bookingId,
      legId: leg.id,
      transactionType: "LEG_EARNING",
      source: "BOOKING_REVENUE",
      amountCents: leg.earningAllocationCents ?? 0,
      description: `Leg #${leg.sequence} earning`,
      status: "PENDING",
      effectiveDate: startOfDay(new Date()),
      createdBy: actor.id
    }
  });

  await writeAuditLog(
    {
      actor,
      action: "LEG_EARNING_CREATED",
      entityType: "WalletTransaction",
      entityId: transaction.id,
      afterData: {
        driverId: leg.driverId,
        legId: leg.id,
        bookingId: leg.bookingId,
        amountCents: transaction.amountCents
      }
    },
    client
  );

  return transaction;
}

export interface RevenueSharePayoutAllocation {
  driverId: number;
  legId: number | null;
  amountCents: number;
}

/**
 * Revenue Sharing Issue Wallet 时呼叫（Module 12，Financial V2 专用）。跟 createLegEarning
 * 不同：这里的 amountCents 已经是按 Leg 分配比例算好的最终金额（由呼叫方——
 * revenueSharing.service.ts 计算），这支函数只负责逐笔写入、写 Audit Log，不做任何计算。
 * `@@unique([legId, transactionType])` 天然防止同一个 Leg 被重复发放（即使呼叫方本身的
 * 「Snapshot 是否已发放」检查失效，DB 这一层还是会挡下来）。
 */
export async function createRevenueSharePayouts(
  client: TxClient,
  input: { bookingId: number; revenueSnapshotId: number; allocations: RevenueSharePayoutAllocation[] },
  actor: AuditActor
) {
  const transactions = [];

  for (const allocation of input.allocations) {
    const transaction = await client.walletTransaction.create({
      data: {
        driverId: allocation.driverId,
        bookingId: input.bookingId,
        legId: allocation.legId,
        revenueSnapshotId: input.revenueSnapshotId,
        transactionType: "REVENUE_SHARE_PAYOUT",
        source: "BOOKING_REVENUE",
        amountCents: allocation.amountCents,
        description: `Revenue Sharing payout for booking #${input.bookingId}`,
        status: "PENDING",
        effectiveDate: startOfDay(new Date()),
        createdBy: actor.id
      }
    });

    await writeAuditLog(
      {
        actor,
        action: "REVENUE_SHARE_PAYOUT_CREATED",
        entityType: "WalletTransaction",
        entityId: transaction.id,
        afterData: {
          driverId: allocation.driverId,
          legId: allocation.legId,
          bookingId: input.bookingId,
          revenueSnapshotId: input.revenueSnapshotId,
          amountCents: transaction.amountCents
        }
      },
      client
    );

    transactions.push(transaction);
  }

  return transactions;
}

export async function getDriverWalletSummary(driverId: number) {
  const today = startOfDay(new Date());

  const [todayPending, unsettled, settled] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { driverId, status: "PENDING", effectiveDate: today },
      _sum: { amountCents: true }
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, status: "PENDING" },
      _sum: { amountCents: true }
    }),
    prisma.walletTransaction.aggregate({
      where: { driverId, status: "SETTLED" },
      _sum: { amountCents: true }
    })
  ]);

  return {
    todayPendingCents: todayPending._sum.amountCents ?? 0,
    unsettledCents: unsettled._sum.amountCents ?? 0,
    settledCents: settled._sum.amountCents ?? 0
  };
}

export const transactionDetailInclude = {
  booking: { select: { id: true, girlName: true } },
  // Driver Wallet Transaction History（standalone feature）需要 Pickup/Destination/
  // 完成时间才能在列表直接显示，不用为了这三个欄位另外查一次 Booking/Leg——
  // 沿用既有的 transactionDetailInclude，Admin 端的用法完全不受影响（多几个欄位而已）。
  leg: { select: { id: true, sequence: true, pickupLocation: true, dropoffLocation: true, completedAt: true } },
  settlement: { select: { id: true, reference: true } },
  relatedSettlement: { select: { id: true, reference: true } },
  driver: { select: { id: true, name: true } }
} satisfies Prisma.WalletTransactionInclude;

interface ListTransactionsFilters {
  driverId?: number;
  status?: WalletTransactionStatus;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export async function listTransactions({ driverId, status, dateFrom, dateTo, page, pageSize }: ListTransactionsFilters) {
  const where: Prisma.WalletTransactionWhereInput = {
    driverId,
    status,
    effectiveDate: {
      gte: dateFrom ? startOfDay(new Date(dateFrom)) : undefined,
      lte: dateTo ? startOfDay(new Date(dateTo)) : undefined
    }
  };

  const [data, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: transactionDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.walletTransaction.count({ where })
  ]);

  return { data, total, page, pageSize };
}

export async function getUnsettledByDriver() {
  const grouped = await prisma.walletTransaction.groupBy({
    by: ["driverId"],
    where: { status: "PENDING" },
    _sum: { amountCents: true }
  });

  const driverIds = grouped.map((g) => g.driverId);
  const drivers = await prisma.driver.findMany({ where: { id: { in: driverIds } } });
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  return grouped.map((g) => ({
    driver: driverById.get(g.driverId) ?? null,
    driverId: g.driverId,
    unsettledCents: g._sum.amountCents ?? 0
  }));
}

interface CreateAdjustmentInput {
  driverId: number;
  amountCents: number;
  reason: string;
  effectiveDate: string;
  relatedSettlementId?: number;
}

/**
 * Manual Adjustment 跟 Settlement Adjustment 规则完全一样（都是 Admin 手动开、正负皆可、
 * 必填 Reason/Effective Date、记录 Created By），差别只在 transactionType，以及 Settlement
 * Adjustment 通常会关联一个 relatedSettlementId 方便追查是在更正哪一次结算。
 */
export async function createAdjustment(
  type: "MANUAL_ADJUSTMENT" | "SETTLEMENT_ADJUSTMENT",
  input: CreateAdjustmentInput,
  actor: AuditActor
) {
  if (input.amountCents === 0) {
    throw new ValidationError("Adjustment amount cannot be zero");
  }

  const transaction = await prisma.walletTransaction.create({
    data: {
      driverId: input.driverId,
      transactionType: type,
      source: type === "MANUAL_ADJUSTMENT" ? "MANUAL" : "SETTLEMENT_CORRECTION",
      amountCents: input.amountCents,
      description: input.reason,
      status: "PENDING",
      effectiveDate: startOfDay(new Date(input.effectiveDate)),
      createdBy: actor.id,
      relatedSettlementId: input.relatedSettlementId
    },
    include: transactionDetailInclude
  });

  await writeAuditLog({
    actor,
    action: type === "MANUAL_ADJUSTMENT" ? "MANUAL_ADJUSTMENT_CREATED" : "SETTLEMENT_ADJUSTMENT_CREATED",
    entityType: "WalletTransaction",
    entityId: transaction.id,
    afterData: {
      driverId: input.driverId,
      amountCents: input.amountCents,
      reason: input.reason,
      effectiveDate: input.effectiveDate,
      relatedSettlementId: input.relatedSettlementId ?? null
    }
  });

  return transaction;
}

interface ReversalTransactionInput {
  driverId: number;
  bookingId: number | null;
  amountCents: number;
  relatedSettlementId: number;
  description: string;
}

/**
 * Void Settlement 时，针对每一笔原本被结算的 Transaction 建一笔反向纪录。
 * 一律是 SETTLEMENT_ADJUSTMENT、PENDING、会在下一次日结被纳入——原本那笔 SETTLED 的纪录完全不动。
 * 刻意不带 legId：legId 有 @@unique([legId, transactionType])，同一个 Leg 如果之后又被牵涉到
 * 第二次 Void/反向，会撞到这个限制；bookingId + description 已经足够追溯来源。
 */
export async function createReversalTransaction(
  client: TxClient,
  input: ReversalTransactionInput,
  actor: AuditActor
) {
  const transaction = await client.walletTransaction.create({
    data: {
      driverId: input.driverId,
      bookingId: input.bookingId,
      transactionType: "SETTLEMENT_ADJUSTMENT",
      source: "SETTLEMENT_CORRECTION",
      amountCents: input.amountCents,
      description: input.description,
      status: "PENDING",
      effectiveDate: startOfDay(new Date()),
      createdBy: actor.id,
      relatedSettlementId: input.relatedSettlementId
    }
  });

  await writeAuditLog(
    {
      actor,
      action: "SETTLEMENT_ADJUSTMENT_CREATED",
      entityType: "WalletTransaction",
      entityId: transaction.id,
      afterData: {
        driverId: input.driverId,
        amountCents: input.amountCents,
        relatedSettlementId: input.relatedSettlementId,
        reason: input.description
      }
    },
    client
  );

  return transaction;
}

export type { WalletTransactionType };
