import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import {
  allocateDriverPool,
  calculateRevenueSharing,
  type ChargeForRevenueSharing,
  type RevenueRuleConfig
} from "./revenueSharing.calculator.js";
import { createRevenueSharePayouts } from "../wallet/wallet.service.js";

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
      const legs = await tx.leg.findMany({
        where: { bookingId, status: { not: "CANCELLED" }, driverId: { not: null } },
        select: { id: true, driverId: true, earningAllocationCents: true }
      });

      const allocations = allocateDriverPool(
        snapshot.driverPoolCents,
        legs.map((leg) => ({ legId: leg.id, driverId: leg.driverId!, earningAllocationCents: leg.earningAllocationCents ?? 0 }))
      );

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

/** Driver Wallet：Admin 视角查看某个 Driver 收到的所有 Revenue Sharing 分润。 */
export async function getDriverRevenueShareWallet(driverId: number) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) {
    throw new NotFoundError(`Driver ${driverId} not found`);
  }

  const transactions = await prisma.walletTransaction.findMany({
    where: { driverId, transactionType: "REVENUE_SHARE_PAYOUT" },
    include: payoutDetailInclude,
    orderBy: { createdAt: "desc" }
  });

  const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0);

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
