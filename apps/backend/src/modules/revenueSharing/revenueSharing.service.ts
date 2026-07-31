import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import {
  allocateDriverPool,
  calculateRevenueSharing,
  type ChargeForRevenueSharing,
  type LegAllocationInput,
  type RevenueRuleConfig
} from "./revenueSharing.calculator.js";
import { createRevenueSharePayouts } from "../wallet/wallet.service.js";
import { roundToNearestCent } from "../../common/money.js";

type TxClient = Prisma.TransactionClient | typeof prisma;

const chargeForRevenueSharingInclude = {
  chargeType: { select: { key: true, participatesInRevenueSharing: true, isCompanyRevenue: true } }
} satisfies Prisma.BookingChargeInclude;

const payoutDetailInclude = {
  driver: { select: { id: true, name: true } },
  leg: { select: { id: true, sequence: true } },
  booking: { select: { id: true, girlName: true } }
} satisfies Prisma.WalletTransactionInclude;

function toRuleConfig(settings: { companyCommissionType: RevenueRuleConfig["companyCommissionType"]; companyCommissionValue: number; dispatcherCommissionType: RevenueRuleConfig["dispatcherCommissionType"]; dispatcherCommissionValue: number }): RevenueRuleConfig {
  return {
    companyCommissionType: settings.companyCommissionType,
    companyCommissionValue: settings.companyCommissionValue,
    dispatcherCommissionType: settings.dispatcherCommissionType,
    dispatcherCommissionValue: settings.dispatcherCommissionValue
  };
}

/**
 * 谁能执行 Finalize（现在会自动发放 Wallet，比单纯冻结计算结果更敏感）不写死在
 * Permission 里——OWNER 永远可以；MANAGER 即使在 RBAC 层拥有 revenueSharing:finalize，
 * 还要 Company Settings 的 allowManagerFinalizeRevenueSharing 是 true 才真的放行
 * （第一版默认 false，等同只有 OWNER）。未来如果要开放给 MANAGER，OWNER 直接在
 * Company Settings 切换，不需要改代码或重新部署。
 */
function assertCanFinalize(actor: AuditActor, settings: { allowManagerFinalizeRevenueSharing: boolean }) {
  if (actor.role === "OWNER") {
    return;
  }
  if (actor.role === "MANAGER" && settings.allowManagerFinalizeRevenueSharing) {
    return;
  }
  throw new ForbiddenError(
    "目前只有 OWNER 能执行 Revenue Sharing Finalize（可在 Company Settings 开放给 MANAGER）"
  );
}

async function loadChargesForRevenueSharing(client: TxClient, bookingId: number): Promise<ChargeForRevenueSharing[]> {
  const charges = await client.bookingCharge.findMany({
    where: { bookingId },
    include: chargeForRevenueSharingInclude
  });

  return charges.map((charge) => ({
    chargeTypeKey: charge.chargeType.key,
    participatesInRevenueSharing: charge.chargeType.participatesInRevenueSharing,
    isCompanyRevenue: charge.chargeType.isCompanyRevenue,
    amountCents: charge.amountCents
  }));
}

async function loadEligibleLegsForAllocation(client: TxClient, bookingId: number) {
  return client.leg.findMany({
    where: { bookingId, status: { not: "CANCELLED" }, driverId: { not: null } },
    select: { id: true, driverId: true, earningAllocationCents: true },
    orderBy: { sequence: "asc" }
  });
}

/**
 * 准备喂给 allocateDriverPool 的权重。Dispatch Center 的 Quick Assign 流程完全不会经过
 * 「司机收入 (RM)」这个欄位（那是 AddLeg/EditAllocation 才有的可选栏位），实际使用上几乎
 * 没有人会手动去填——照原本「未填 = 权重 0」的规则，会让每一张 V2 Booking 的 Driver Pool
 * 永远卡在没人可以分（2026-07 Railway Staging 验证发现的真实 Bug 之一）。
 * 修正规则：这张 Booking 底下「所有」合格 Leg 都没有人手动填过司机收入时，视为「均分」
 * （每条权重相等，单一 Leg 因此拿到 100%）；只要「有任何一条」被手动填过，完全照旧维持
 * 「按填写的 cents 数字加权」，没填的那条权重是 0——不影响任何已经手动设定过分配比例的
 * 既有使用情境。
 */
function buildAllocationWeights(
  legs: { id: number; driverId: number | null; earningAllocationCents: number | null }[]
): LegAllocationInput[] {
  const withDriver = legs.filter(
    (leg): leg is typeof legs[number] & { driverId: number } => leg.driverId !== null
  );
  const hasExplicitAllocation = withDriver.some((leg) => (leg.earningAllocationCents ?? 0) > 0);

  return withDriver.map((leg) => ({
    legId: leg.id,
    driverId: leg.driverId,
    earningAllocationCents: hasExplicitAllocation ? leg.earningAllocationCents ?? 0 : 1
  }));
}

/**
 * payoutForCompletedLeg 专用：算「这条刚完成的 Leg，现在该拿多少钱」。
 *
 * 跟 finalizeRevenueSharing/loadEligibleLegsForAllocation 那条路径不一样——那边是整张
 * Booking 所有 Leg 都已经跑完、一次性分完整个 Pool，`allocateDriverPool` 的「最后一笔吃
 * 余数」写法在那个情境下是对的。但 payoutForCompletedLeg 是「每条 Leg 各自完成的当下」
 * 分批发放，如果沿用同一套 loadEligibleLegsForAllocation（只看「已指派 Driver」的 Leg）
 * 当权重分母，会在回程 Leg 还没被指派/接单之前，让去程 Leg 誤以为自己是唯一一条 Leg、
 * 拿走整个 Driver Pool——回程之后再完成时，同一个 Pool 又被重新分一次，两笔加起来超发
 * （这正是 2026-07 Railway 生产环境回报的 RM68 vs RM34 Bug 的实际成因）。
 *
 * 正确做法：权重分母要跟 redistributeAutoAllocations 用同一个定义——这张 Booking「所有
 * 未取消」的 Leg（不限已指派 Driver 的），才能让去程即使在回程还没指派时完成，也只拿到
 * 自己该有的那一份，把剩下的份额留给回程之后领。已经发放过的金额（其他 Leg 的
 * WalletTransaction）视为锁定不动——从 Pool 里扣掉之后，剩下的才拿来在「还没领过」的
 * Leg 之间按权重分（最后一条还没领的 Leg 拿剩余全部，避免多条 Leg 各自四舍五入导致总和
 * 跟 Pool 对不上）。
 */
async function computeIncrementalPayoutForLeg(tx: TxClient, bookingId: number, legId: number, driverPoolCents: number) {
  const allLegs = await tx.leg.findMany({
    where: { bookingId, status: { not: "CANCELLED" } },
    select: { id: true, earningAllocationCents: true }
  });

  const paidLegIds = new Set(
    (
      await tx.walletTransaction.findMany({
        where: { bookingId, transactionType: "REVENUE_SHARE_PAYOUT", legId: { not: null } },
        select: { legId: true }
      })
    ).map((t) => t.legId)
  );

  const hasExplicitAllocation = allLegs.some((leg) => (leg.earningAllocationCents ?? 0) > 0);
  const weightOf = (leg: { earningAllocationCents: number | null }) =>
    hasExplicitAllocation ? leg.earningAllocationCents ?? 0 : 1;

  const paidSum = await tx.walletTransaction.aggregate({
    where: { bookingId, transactionType: "REVENUE_SHARE_PAYOUT" },
    _sum: { amountCents: true }
  });
  const remainingPoolCents = driverPoolCents - (paidSum._sum.amountCents ?? 0);

  const unpaidLegs = allLegs.filter((leg) => !paidLegIds.has(leg.id));
  const thisLeg = unpaidLegs.find((leg) => leg.id === legId);
  if (!thisLeg) {
    return null;
  }

  if (unpaidLegs.length === 1) {
    return remainingPoolCents;
  }

  const unpaidWeightTotal = unpaidLegs.reduce((sum, leg) => sum + weightOf(leg), 0);
  if (unpaidWeightTotal <= 0) {
    return 0;
  }
  return roundToNearestCent((remainingPoolCents * weightOf(thisLeg)) / unpaidWeightTotal);
}

/** Preview 是纯计算、零副作用——不写 Snapshot、不动 Booking 财务状态、不发 Wallet，任何时候都可以重复调用。 */
export async function previewRevenueSharing(bookingId: number) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }

  const charges = await loadChargesForRevenueSharing(prisma, bookingId);
  if (charges.length === 0) {
    throw new ValidationError("Booking 没有任何 Charge，无法计算 Revenue Sharing");
  }

  const settings = await getCompanySettings();
  const rule = toRuleConfig(settings);
  const result = calculateRevenueSharing(charges, rule);

  return {
    bookingId,
    financialStatus: booking.financialStatus,
    rule,
    ...result
  };
}

/**
 * Finalize 是不可逆动作：建立唯一的 Revenue Sharing Snapshot、把 Booking.financialStatus
 * 收敛成 FINALIZED，**并且在同一个 Transaction 里自动把 driverPoolCents 发放成 Wallet
 * Transaction**——不再有独立的「Issue Wallet」手动步骤（业务流程简化：Finalize 本身就
 * 代表财务确认，分两步只会增加漏发、重复操作的风险）。只有 Financial V2 的 Booking
 * 会真的发 Wallet；V1 Booking 的收入永远走既有的 LEG_EARNING 机制，两者不会混用
 * （Migration Cut-over，见 docs/modules/wallet-migration.md）。
 *
 * 整个过程锁住 Booking row，避免两个并发请求各自算出一份、都尝试建立 Snapshot（DB 的
 * bookingId unique 约束是最后防线）。Finalize 之后：不允许重新计算、不允许修改
 * Snapshot、Company Settings 之后再怎么改都不会影响这笔已经写死的历史资料——因为
 * Snapshot 只在这里被建立一次，没有任何其他 update 路径。
 *
 * 未来如果需要审批流程，预期会是 Preview -> Approve -> Finalize（自动 Issue Wallet）
 * 三步，Approve 是新增的独立步骤，不是把 Issue Wallet 拆回来。这次不实作 Approve。
 */
export async function finalizeRevenueSharing(bookingId: number, actor: AuditActor) {
  const settings = await getCompanySettings();
  assertCanFinalize(actor, settings);
  const rule = toRuleConfig(settings);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;

    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundError(`Booking ${bookingId} not found`);
    }

    if (booking.financialStatus === "VOIDED") {
      throw new ValidationError("Booking 已取消（VOIDED），不能 Finalize Revenue Sharing");
    }
    if (booking.financialStatus === "FINALIZED") {
      throw new ConflictError("Booking 已经 FINALIZED，不能重复 Finalize");
    }

    const existingSnapshot = await tx.revenueSharingSnapshot.findUnique({ where: { bookingId } });
    if (existingSnapshot) {
      throw new ConflictError("这张 Booking 已经有 Revenue Sharing Snapshot");
    }

    const charges = await tx.bookingCharge.findMany({
      where: { bookingId },
      include: chargeForRevenueSharingInclude
    });
    if (charges.length === 0) {
      throw new ValidationError("Booking 没有任何 Charge，无法计算 Revenue Sharing");
    }

    // 一致性检查：Booking.totalAmountCents 这个快取栏位必须跟 Charge 实际加总一致，
    // 才能保证 Finalize 当下算出来的 Revenue Sharing 反映的是「真正」的 Booking Total。
    const chargeSumCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
    if (chargeSumCents !== booking.totalAmountCents) {
      throw new ValidationError(
        `Booking Total（${booking.totalAmountCents}）与 Booking Charge 实际加总（${chargeSumCents}）不一致，Finalize 已中止，请先检查资料`
      );
    }

    const chargeInputs: ChargeForRevenueSharing[] = charges.map((charge) => ({
      chargeTypeKey: charge.chargeType.key,
      participatesInRevenueSharing: charge.chargeType.participatesInRevenueSharing,
      isCompanyRevenue: charge.chargeType.isCompanyRevenue,
      amountCents: charge.amountCents
    }));

    const result = calculateRevenueSharing(chargeInputs, rule);

    const snapshot = await tx.revenueSharingSnapshot.create({
      data: {
        bookingId,
        triggeredBy: "BOOKING_FINALIZED",
        companyRevenueCents: result.companyRevenueCents,
        dispatcherCommissionCents: result.dispatcherCommissionCents,
        driverPoolCents: result.driverPoolCents,
        chargeBreakdown: {
          charges: JSON.parse(JSON.stringify(result.chargeBreakdown)),
          rule: JSON.parse(JSON.stringify(result.ruleBreakdown)),
          participatingAmountCents: result.participatingAmountCents,
          nonParticipatingCompanyCents: result.nonParticipatingCompanyCents,
          nonParticipatingDriverCents: result.nonParticipatingDriverCents
        }
      }
    });

    await tx.booking.update({ where: { id: bookingId }, data: { financialStatus: "FINALIZED" } });

    await writeAuditLog(
      {
        actor,
        action: "REVENUE_SHARING_FINALIZED",
        entityType: "RevenueSharingSnapshot",
        entityId: snapshot.id,
        afterData: {
          bookingId,
          companyRevenueCents: snapshot.companyRevenueCents,
          dispatcherCommissionCents: snapshot.dispatcherCommissionCents,
          driverPoolCents: snapshot.driverPoolCents
        },
        metadata: { rule }
      },
      tx
    );

    let walletTransactions: Awaited<ReturnType<typeof createRevenueSharePayouts>> = [];

    if (booking.financialVersion === "V2") {
      const legs = await loadEligibleLegsForAllocation(tx, bookingId);
      const allocations = allocateDriverPool(snapshot.driverPoolCents, buildAllocationWeights(legs));

      if (allocations.length > 0) {
        walletTransactions = await createRevenueSharePayouts(
          tx,
          { bookingId, revenueSnapshotId: snapshot.id, allocations },
          actor
        );
      }
    }

    return { ...snapshot, walletTransactions };
  });
}

/**
 * V2 专用：Leg 第一次变成 COMPLETED 时，从 driverJobs.service.ts 的 completeLeg 在同一个
 * Transaction 内呼叫——取代原本「必须由 Owner/Manager 手动呼叫 Finalize」的设计
 * （2026-07 Railway Staging 验证发现：前端从来没有做过这个手动按钮，所有 V2 Booking 的
 * 司机收入永远不会产生，见 docs/modules/wallet-migration.md「自动触发」章节）。
 *
 * 规则：
 * - 这张 Booking 第一条 Leg 完成时，当场建立 Revenue Sharing Snapshot（等同自动
 *   Finalize），Company/Dispatcher Commission 跟 Driver Pool 总额从此定案（Booking
 *   financialStatus 收敛成 FINALIZED，之后只能新增 Adjustment，不能再新增原始
 *   Charge——跟手动 Finalize 完全一样的约束）。
 * - 每条 Leg 只在「自己完成的当下」拿到自己那一份分配额，不需要等整张 Booking 全部
 *   完成——分配比例在 Snapshot 建立当下就用「当下所有合格 Leg」算好一次，只是实际
 *   发放逐条进行，先完成的先拿到。
 * - `applyLegTransition` 的条件式 update（WHERE 状态在期望范围内）加上
 *   `@@unique([legId, transactionType])`，双重保证同一条 Leg 不会被发放两次。
 * - 呼叫方（completeLeg）已经在同一个 DB Transaction 里完成了 Leg 状态转换，这里任何
 *   一步失败都会让整个 Transaction 一起回滚——Leg 也不会被标记 COMPLETED。这是刻意的：
 *   算不出该发多少钱，就不能假装这段行程完成了，比静默产生一笔错误金额更安全。
 */
export async function payoutForCompletedLeg(
  tx: Prisma.TransactionClient,
  input: { bookingId: number; legId: number },
  actor: AuditActor
) {
  await tx.$queryRaw`SELECT id FROM "bookings" WHERE id = ${input.bookingId} FOR UPDATE`;

  const booking = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });

  let snapshot = await tx.revenueSharingSnapshot.findUnique({ where: { bookingId: input.bookingId } });

  if (!snapshot) {
    const settings = await getCompanySettings();
    const rule = toRuleConfig(settings);

    const charges = await tx.bookingCharge.findMany({
      where: { bookingId: input.bookingId },
      include: chargeForRevenueSharingInclude
    });
    if (charges.length === 0) {
      throw new ValidationError(
        `Booking #${input.bookingId} 还没有任何 Charge（尚未设定车资），无法计算司机收入，请先联系管理员补上 Booking 金额后再完成行程`
      );
    }

    const chargeSumCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
    if (chargeSumCents !== booking.totalAmountCents) {
      throw new ValidationError(
        `Booking #${input.bookingId} 的 Total（${booking.totalAmountCents}）与 Charge 实际加总（${chargeSumCents}）不一致，无法计算司机收入，请先联系管理员检查资料`
      );
    }

    const chargeInputs: ChargeForRevenueSharing[] = charges.map((charge) => ({
      chargeTypeKey: charge.chargeType.key,
      participatesInRevenueSharing: charge.chargeType.participatesInRevenueSharing,
      isCompanyRevenue: charge.chargeType.isCompanyRevenue,
      amountCents: charge.amountCents
    }));

    const result = calculateRevenueSharing(chargeInputs, rule);

    snapshot = await tx.revenueSharingSnapshot.create({
      data: {
        bookingId: input.bookingId,
        triggeredBy: "LEG_COMPLETED",
        companyRevenueCents: result.companyRevenueCents,
        dispatcherCommissionCents: result.dispatcherCommissionCents,
        driverPoolCents: result.driverPoolCents,
        chargeBreakdown: {
          charges: JSON.parse(JSON.stringify(result.chargeBreakdown)),
          rule: JSON.parse(JSON.stringify(result.ruleBreakdown)),
          participatingAmountCents: result.participatingAmountCents,
          nonParticipatingCompanyCents: result.nonParticipatingCompanyCents,
          nonParticipatingDriverCents: result.nonParticipatingDriverCents
        }
      }
    });

    await tx.booking.update({ where: { id: input.bookingId }, data: { financialStatus: "FINALIZED" } });

    await writeAuditLog(
      {
        actor,
        action: "REVENUE_SHARING_FINALIZED",
        entityType: "RevenueSharingSnapshot",
        entityId: snapshot.id,
        afterData: {
          bookingId: input.bookingId,
          companyRevenueCents: snapshot.companyRevenueCents,
          dispatcherCommissionCents: snapshot.dispatcherCommissionCents,
          driverPoolCents: snapshot.driverPoolCents,
          triggeredBy: "LEG_COMPLETED"
        },
        metadata: { rule, legId: input.legId }
      },
      tx
    );
  }

  const amountCents = await computeIncrementalPayoutForLeg(tx, input.bookingId, input.legId, snapshot.driverPoolCents);
  if (amountCents === null) {
    // 这条 Leg 已经领过（WalletTransaction 已存在）——理论上不该发生（applyLegTransition
    // 加上 @@unique([legId, transactionType]) 已经双重挡住重复 Complete），这里只是
    // 再多一层防御，静默跳过而不是让整个 Complete 失败。
    return null;
  }

  const leg = await tx.leg.findUniqueOrThrow({ where: { id: input.legId }, select: { driverId: true } });
  if (!leg.driverId) {
    return null;
  }

  const [payout] = await createRevenueSharePayouts(
    tx,
    {
      bookingId: input.bookingId,
      revenueSnapshotId: snapshot.id,
      allocations: [{ legId: input.legId, driverId: leg.driverId, amountCents }]
    },
    actor
  );

  return payout;
}

export async function getRevenueSnapshot(bookingId: number) {
  const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId } });
  if (!snapshot) {
    throw new NotFoundError(`Booking ${bookingId} 还没有 Revenue Sharing Snapshot（还没 Finalize）`);
  }
  return snapshot;
}

interface ListRevenueHistoryParams {
  page: number;
  pageSize: number;
}

/** Revenue History：跨 Booking 的 Snapshot 列表，依建立时间新到旧排序，给报表/审计用。 */
export async function listRevenueHistory({ page, pageSize }: ListRevenueHistoryParams) {
  const [data, total] = await Promise.all([
    prisma.revenueSharingSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { booking: { select: { id: true, girlName: true, totalAmountCents: true } } }
    }),
    prisma.revenueSharingSnapshot.count()
  ]);

  return { data, total, page, pageSize };
}

/** Wallet Detail：这张 Booking 的 Revenue Sharing Snapshot（Finalize 时自动）发放的 Wallet Transaction。 */
export async function getWalletForBooking(bookingId: number) {
  const snapshot = await prisma.revenueSharingSnapshot.findUnique({ where: { bookingId } });
  if (!snapshot) {
    throw new NotFoundError(`Booking ${bookingId} 还没有 Revenue Sharing Snapshot（还没 Finalize）`);
  }

  const transactions = await prisma.walletTransaction.findMany({
    where: { revenueSnapshotId: snapshot.id },
    include: payoutDetailInclude,
    orderBy: { createdAt: "asc" }
  });

  return {
    bookingId,
    snapshotId: snapshot.id,
    driverPoolCents: snapshot.driverPoolCents,
    issued: transactions.length > 0,
    transactions
  };
}

// Stabilization：这份清单之前完全没有上限，随著 Booking 数量累积会一直变大变慢。
// totalCents 改用 aggregate 直接在 DB 端算总和（不受 take 影响，金额一定正确），
// 只有拿来显示的 transactions 列表本身加上限——避免「加了 take 却让总额跟着变
// 不完整」这种看起来修好、实际上做出错误金额的假修复。
const MAX_DRIVER_REVENUE_SHARE_TRANSACTIONS = 500;

/** Driver Wallet：Admin 视角查看某个 Driver 收到的所有 Revenue Sharing 分润。 */
export async function getDriverRevenueShareWallet(driverId: number) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const where = { driverId, transactionType: "REVENUE_SHARE_PAYOUT" } as const;

  const [transactions, aggregate] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: payoutDetailInclude,
      orderBy: { createdAt: "desc" },
      take: MAX_DRIVER_REVENUE_SHARE_TRANSACTIONS
    }),
    prisma.walletTransaction.aggregate({ where, _sum: { amountCents: true } })
  ]);

  const totalCents = aggregate._sum.amountCents ?? 0;

  return { driverId, totalCents, transactions };
}

interface ListWalletHistoryParams {
  page: number;
  pageSize: number;
}

/** Wallet History：跨 Booking/Driver 的 REVENUE_SHARE_PAYOUT 列表，依建立时间新到旧排序。 */
export async function listWalletHistory({ page, pageSize }: ListWalletHistoryParams) {
  const where: Prisma.WalletTransactionWhereInput = { transactionType: "REVENUE_SHARE_PAYOUT" };

  const [data, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: payoutDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.walletTransaction.count({ where })
  ]);

  return { data, total, page, pageSize };
}
