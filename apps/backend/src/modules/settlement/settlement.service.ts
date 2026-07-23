import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { createReversalTransaction } from "../wallet/wallet.service.js";
import {
  getCollectionsInPeriod,
  getCollectionsOutsidePeriod,
  reopenCollectionsForVoidedSettlement,
  sumCollectionAmountCents
} from "../collections/collection.service.js";

type TxClient = Prisma.TransactionClient;

// periodEnd 是「当天结束」的边界，用来跟 effectiveDate（完整 DateTime）比较——跟
// collection.service.ts 的 getCollectionsInPeriod 用同一个修法，比较時只在这里转成
// 当天 23:59:59.999，不影响 Settlement.periodEnd 本身存的值。
function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatDateForReference(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

const transactionSummaryInclude = {
  booking: { select: { id: true, girlName: true } },
  leg: { select: { id: true, sequence: true } }
} satisfies Prisma.WalletTransactionInclude;

async function getTransactionsInPeriod(driverId: number, periodStart: Date, periodEnd: Date) {
  return prisma.walletTransaction.findMany({
    where: {
      driverId,
      status: "PENDING",
      effectiveDate: { gte: periodStart, lte: endOfDay(periodEnd) }
    },
    include: transactionSummaryInclude,
    orderBy: { effectiveDate: "asc" }
  });
}

/** 这个 Driver 目前所有 PENDING、但落在指定周期「之外」的 Transaction——提醒 Admin 别漏单。 */
async function getTransactionsOutsidePeriod(driverId: number, periodStart: Date, periodEnd: Date) {
  return prisma.walletTransaction.findMany({
    where: {
      driverId,
      status: "PENDING",
      OR: [{ effectiveDate: { lt: periodStart } }, { effectiveDate: { gt: endOfDay(periodEnd) } }]
    },
    include: transactionSummaryInclude,
    orderBy: { effectiveDate: "asc" }
  });
}

function summarizeWallet(transactions: { transactionType: string; amountCents: number }[]) {
  let completedLegEarningsCents = 0;
  let positiveAdjustmentsCents = 0;
  let negativeAdjustmentsCents = 0;

  for (const tx of transactions) {
    // LEG_EARNING 是 Financial V1 的即时记账；REVENUE_SHARE_PAYOUT 是 Financial V2 的
    // Revenue Sharing 分润——两者都代表「司机完成行程的收入」，只是机制不同，Settlement
    // 报表上归同一个桶，不该把 V2 的收入错误归类成 Adjustment（2026-07 driver-earnings
    // -after-leg-completion 修复的一部分：V2 的 Wallet Transaction 之前从未真的产生过，
    // 这个分类分支实际上从来没被走到过）。
    if (tx.transactionType === "LEG_EARNING" || tx.transactionType === "REVENUE_SHARE_PAYOUT") {
      completedLegEarningsCents += tx.amountCents;
    } else if (tx.amountCents >= 0) {
      positiveAdjustmentsCents += tx.amountCents;
    } else {
      negativeAdjustmentsCents += tx.amountCents;
    }
  }

  const walletAmountCents = completedLegEarningsCents + positiveAdjustmentsCents + negativeAdjustmentsCents;

  return { completedLegEarningsCents, positiveAdjustmentsCents, negativeAdjustmentsCents, walletAmountCents };
}

// "YYYY-MM-DD" 字串直接丢给 `new Date()` 会被当成 UTC 午夜解析（ISO 8601 date-only
// 字串的规定行为），但下面接的 setHours() 是用伺服器的「本地」时区运算——伺服器时区
// 只要不是 UTC（Railway/本地开发常见是 UTC+8），这两者混在一起会让算出来的 periodStart/
// periodEnd 悄悄偏移几个小时，偏移方向依时区而定：可能让「明明选进这个周期的日期」的资料
// 被排除在外（Mobile UX + Scheduling Sprint 用「自动选择全部未结算日期」测出来的），
// 也可能让周期外的资料被误算进来。直接照 Y/M/D 数字组一个本地时间的 Date，从源头避开
// 「UTC 解析 + 本地时区运算」这组混用陷阱，periodStart/periodEnd 才会精确对应使用者
// 选的那个（本地）日历日期区间。
function parseLocalDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parsePeriod(periodStartStr: string, periodEndStr: string) {
  const periodStart = parseLocalDateOnly(periodStartStr);
  const periodEnd = parseLocalDateOnly(periodEndStr);
  if (periodStart.getTime() > periodEnd.getTime()) {
    throw new ValidationError("periodStart must not be after periodEnd");
  }
  return { periodStart, periodEnd };
}

/**
 * Wallet（公司欠 Driver）跟 Collection（Driver 欠公司）是两本独立的 Ledger，Collection 永远
 * 不会直接修改 Wallet 的任何栏位——这里只在计算 Settlement 净额时把两本帐的总和相减一次。
 * netAmountCents 为正代表 Company Pay Driver，为负代表 Driver Need Return Company。
 */
export async function previewSettlement(driverId: number, periodStartStr: string, periodEndStr: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const { periodStart, periodEnd } = parsePeriod(periodStartStr, periodEndStr);

  const [includedTransactions, excludedTransactions, includedCollections, excludedCollections] = await Promise.all([
    getTransactionsInPeriod(driverId, periodStart, periodEnd),
    getTransactionsOutsidePeriod(driverId, periodStart, periodEnd),
    getCollectionsInPeriod(driverId, periodStart, periodEnd),
    getCollectionsOutsidePeriod(driverId, periodStart, periodEnd)
  ]);

  const walletSummary = summarizeWallet(includedTransactions);
  const collectionAmountCents = sumCollectionAmountCents(includedCollections);

  return {
    driver,
    periodStart,
    periodEnd,
    transactions: includedTransactions,
    excludedTransactions,
    collections: includedCollections,
    excludedCollections,
    ...walletSummary,
    collectionAmountCents,
    netAmountCents: walletSummary.walletAmountCents - collectionAmountCents
  };
}

/**
 * 用 Postgres advisory lock 把「同一天要生成的 Reference」序列化，避免两个几乎同时送出的
 * Settlement 算出同一个序号——lock 是 transaction-scoped，commit/rollback 时自动释放，
 * 不会卡住别的日期。Reference 格式：SET-YYYYMMDD-0001（YYYYMMDD 是建立当天，不是结算周期）。
 */
async function generateSettlementReference(tx: TxClient, createdOn: Date): Promise<string> {
  const dateStr = formatDateForReference(createdOn);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement-ref-${dateStr}`}))`;

  const existingCount = await tx.settlement.count({
    where: { reference: { startsWith: `SET-${dateStr}-` } }
  });

  return `SET-${dateStr}-${String(existingCount + 1).padStart(4, "0")}`;
}

export async function confirmSettlement(
  driverId: number,
  periodStartStr: string,
  periodEndStr: string,
  actor: AuditActor
) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const { periodStart, periodEnd } = parsePeriod(periodStartStr, periodEndStr);

  // Backend 自己重新算一次，绝对不相信前端传来的列表或总额。
  const [transactions, collections] = await Promise.all([
    getTransactionsInPeriod(driverId, periodStart, periodEnd),
    getCollectionsInPeriod(driverId, periodStart, periodEnd)
  ]);

  if (transactions.length === 0 && collections.length === 0) {
    throw new ValidationError("No pending wallet transactions or verified collections to settle for this driver in this period");
  }

  const { walletAmountCents } = summarizeWallet(transactions);
  const collectionAmountCents = sumCollectionAmountCents(collections);
  const netAmountCents = walletAmountCents - collectionAmountCents;
  const transactionIds = transactions.map((tx) => tx.id);
  const collectionIds = collections.map((c) => c.id);

  const settlement = await prisma.$transaction(async (tx) => {
    const reference = await generateSettlementReference(tx, new Date());

    const created = await tx.settlement.create({
      data: {
        reference,
        driverId,
        periodStart,
        periodEnd,
        status: "COMPLETED",
        walletAmountCents,
        collectionAmountCents,
        netAmountCents,
        createdBy: actor.id
      }
    });

    await tx.settlementItem.createMany({
      data: transactions.map((transaction) => ({
        settlementId: created.id,
        walletTransactionId: transaction.id,
        amountCents: transaction.amountCents
      }))
    });

    const settledResult = await tx.walletTransaction.updateMany({
      where: { id: { in: transactionIds }, status: "PENDING" },
      data: { status: "SETTLED", settledAt: new Date(), settlementId: created.id }
    });

    // 改动笔数跟原本要结算的笔数不一样，代表在我们算好总额之后、真正写入之前，
    // 有人（例如另一个 Admin）已经抢先把某几笔标成别的状态了——整个 Settlement 直接失败重来。
    if (settledResult.count !== transactionIds.length) {
      throw new ConflictError(
        "Some transactions were already settled by another request; please retry the settlement"
      );
    }

    if (collectionIds.length > 0) {
      const settledCollections = await tx.collection.updateMany({
        where: { id: { in: collectionIds }, status: "VERIFIED" },
        data: { status: "SETTLED", settledAt: new Date(), settlementId: created.id }
      });

      if (settledCollections.count !== collectionIds.length) {
        throw new ConflictError(
          "Some collections were already settled by another request; please retry the settlement"
        );
      }
    }

    await writeAuditLog(
      {
        actor,
        action: "SETTLEMENT_COMPLETED",
        entityType: "Settlement",
        entityId: created.id,
        afterData: {
          reference,
          driverId,
          periodStart,
          periodEnd,
          walletAmountCents,
          collectionAmountCents,
          netAmountCents,
          transactionCount: transactionIds.length,
          collectionCount: collectionIds.length
        }
      },
      tx
    );

    return created;
  });

  return getSettlementById(settlement.id);
}

export async function voidSettlement(settlementId: number, reason: string, actor: AuditActor) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: { items: { include: { walletTransaction: true } }, collections: true }
  });
  if (!settlement) {
    throw new NotFoundError(`Settlement ${settlementId} not found`);
  }
  if (settlement.status !== "COMPLETED") {
    throw new ConflictError(`Only a COMPLETED settlement can be voided (current status: ${settlement.status})`);
  }

  await prisma.$transaction(async (tx) => {
    // 条件式 UPDATE：跟 Leg 状态机同一套防冲突手法。两个 Admin 同时按 Void，
    // 或重复点两次，只有改到 1 笔的那一次会继续往下执行。
    const voidedResult = await tx.settlement.updateMany({
      where: { id: settlementId, status: "COMPLETED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }
    });

    if (voidedResult.count !== 1) {
      throw new ConflictError("Settlement was already voided or modified by another request");
    }

    // 原本已经 SETTLED 的 Wallet Transaction 完全不动，只针对每一笔原本结算的金额建一笔反向纪录，
    // PENDING 状态、会在下一次日结被纳入。
    for (const item of settlement.items) {
      const original = item.walletTransaction;
      await createReversalTransaction(
        tx,
        {
          driverId: original.driverId,
          bookingId: original.bookingId,
          amountCents: -original.amountCents,
          relatedSettlementId: settlementId,
          description: `Reversal of settlement ${settlement.reference}`
        },
        actor
      );
    }

    // Collection 不是不可变金额帐本，只是工作流程状态，所以直接把 SETTLED 打回 VERIFIED，
    // 让它们回到「还没被任何 Settlement 处理」的状态，可以被下一次日结纳入。
    await reopenCollectionsForVoidedSettlement(tx, settlementId, settlement.collections.length);

    await writeAuditLog(
      {
        actor,
        action: "SETTLEMENT_VOIDED",
        entityType: "Settlement",
        entityId: settlementId,
        beforeData: { status: "COMPLETED" },
        afterData: { status: "VOIDED", reason },
        metadata: {
          reversalTransactionCount: settlement.items.length,
          collectionsReopenedCount: settlement.collections.length
        }
      },
      tx
    );
  });

  return getSettlementById(settlementId);
}

const settlementDetailInclude = {
  driver: true,
  createdByUser: { select: { id: true, username: true } },
  voidedByUser: { select: { id: true, username: true } },
  items: {
    include: {
      walletTransaction: {
        include: {
          booking: { select: { id: true, girlName: true } },
          leg: { select: { id: true, sequence: true } }
        }
      }
    }
  },
  reversalTransactions: true,
  collections: {
    include: {
      booking: { select: { id: true, girlName: true } },
      leg: { select: { id: true, sequence: true } }
    }
  }
} satisfies Prisma.SettlementInclude;

export async function getSettlementById(id: number) {
  const settlement = await prisma.settlement.findUnique({
    where: { id },
    include: settlementDetailInclude
  });
  if (!settlement) {
    throw new NotFoundError(`Settlement ${id} not found`);
  }
  return settlement;
}

interface ListSettlementsFilters {
  driverId?: number;
  page: number;
  pageSize: number;
}

export async function listSettlements({ driverId, page, pageSize }: ListSettlementsFilters) {
  const where = driverId ? { driverId } : {};
  const [data, total] = await Promise.all([
    prisma.settlement.findMany({
      where,
      include: { driver: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.settlement.count({ where })
  ]);
  return { data, total, page, pageSize };
}

export function listDriverSettlements(driverId: number) {
  return prisma.settlement.findMany({
    where: { driverId },
    orderBy: { createdAt: "desc" }
  });
}
