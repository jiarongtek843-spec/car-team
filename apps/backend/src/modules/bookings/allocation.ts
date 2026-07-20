import { prisma } from "../../config/prisma.js";

/**
 * 目前已经分配给各个「未取消」Leg 的总金额。用来检查新增/修改 allocation
 * 时有没有超过 Driver Pool。
 */
export async function getAllocatedSumCents(bookingId: number, excludeLegId?: number) {
  const legs = await prisma.leg.findMany({
    where: {
      bookingId,
      status: { not: "CANCELLED" },
      ...(excludeLegId ? { id: { not: excludeLegId } } : {})
    },
    select: { earningAllocationCents: true }
  });

  return legs.reduce((sum, leg) => sum + (leg.earningAllocationCents ?? 0), 0);
}

/**
 * 这张 Booking 是否已经有收入相关的历史（Completed Leg 或 Wallet Transaction）。
 * 有的话总价/抽成就不能再随便改，避免历史记账跟当前设定对不上。
 */
export async function hasEarningHistory(bookingId: number) {
  const [completedLegCount, walletTransactionCount] = await Promise.all([
    prisma.leg.count({ where: { bookingId, status: "COMPLETED" } }),
    prisma.walletTransaction.count({ where: { bookingId } })
  ]);

  return completedLegCount > 0 || walletTransactionCount > 0;
}
