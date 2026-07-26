import { prisma } from "../../config/prisma.js";
import type { TxClient } from "../bookingCharges/bookingCharge.service.js";

/**
 * 目前已经分配给各个「未取消」Leg 的总金额。用来检查新增/修改 allocation
 * 时有没有超过 Driver Pool。传入的 client 若是交易内的 tx（且呼叫端已经用
 * `SELECT ... FOR UPDATE` 锁住 Booking row），这里读到的就是锁定后的一致视图，
 * 避免两个几乎同时的分配检查各自读到「超额之前」的总和一起通过检查。
 */
export async function getAllocatedSumCents(client: TxClient, bookingId: number, excludeLegId?: number) {
  const legs = await client.leg.findMany({
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
