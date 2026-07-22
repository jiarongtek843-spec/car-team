import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { ConflictError, NotFoundError, ValidationError } from "../../common/errors.js";
import { writeAuditLog, type AuditActor } from "../../common/audit.js";
import { getCompanySettings } from "../companySettings/companySettings.service.js";
import { calculateRevenueSharing, type ChargeForRevenueSharing, type RevenueRuleConfig } from "./revenueSharing.calculator.js";

type TxClient = Prisma.TransactionClient | typeof prisma;

const chargeForRevenueSharingInclude = {
  chargeType: { select: { key: true, participatesInRevenueSharing: true, isCompanyRevenue: true } }
} satisfies Prisma.BookingChargeInclude;

async function loadRuleConfig(): Promise<RevenueRuleConfig> {
  const settings = await getCompanySettings();
  return {
    companyCommissionType: settings.companyCommissionType,
    companyCommissionValue: settings.companyCommissionValue,
    dispatcherCommissionType: settings.dispatcherCommissionType,
    dispatcherCommissionValue: settings.dispatcherCommissionValue
  };
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

/** Preview 是纯计算、零副作用——不写 Snapshot、不动 Booking 财务状态，任何时候都可以重复调用。 */
export async function previewRevenueSharing(bookingId: number) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }

  const charges = await loadChargesForRevenueSharing(prisma, bookingId);
  if (charges.length === 0) {
    throw new ValidationError("Booking 没有任何 Charge，无法计算 Revenue Sharing");
  }

  const rule = await loadRuleConfig();
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
 * 收敛成 FINALIZED。整个过程锁住 Booking row，避免两个并发请求各自算出一份、都尝试
 * 建立 Snapshot（DB 的 bookingId unique 约束是最后防线，这里先在应用层查一次给更清楚的
 * 错误讯息）。Finalize 之后：不允许重新计算、不允许修改 Snapshot、Company Settings
 * 之后再怎么改都不会影响这笔已经写死的历史资料——因为 Snapshot 只在这里被建立一次，
 * 没有任何其他 update 路径。
 */
export async function finalizeRevenueSharing(bookingId: number, actor: AuditActor) {
  const rule = await loadRuleConfig();

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

    return snapshot;
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
