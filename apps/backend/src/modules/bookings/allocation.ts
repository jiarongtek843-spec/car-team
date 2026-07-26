import { prisma } from "../../config/prisma.js";
import type { TxClient } from "../bookingCharges/bookingCharge.service.js";

/**
 * 「冻结」金额的总和：已经 COMPLETED（收入已经实际发放）或 Admin 明确手动 override
 * 过（earningAllocationManual=true）的 Leg。这些金额不会被 redistributeAutoAllocations
 * 自动平分覆盖，是分配总额检查真正该比对的基准——仍是自动模式的 Leg 会自己缩放去配合
 * 剩下的额度，不该被算进「会不会超过 Pool」的判断里。传入的 client 若是交易内的 tx
 * （且呼叫端已经用 `SELECT ... FOR UPDATE` 锁住 Booking row），这里读到的就是锁定后的
 * 一致视图，避免两个几乎同时的分配检查各自读到「更新之前」的总和一起通过检查。
 */
export async function getFrozenAllocationSumCents(client: TxClient, bookingId: number, excludeLegId?: number) {
  const legs = await client.leg.findMany({
    where: {
      bookingId,
      status: { not: "CANCELLED" },
      OR: [{ status: "COMPLETED" }, { earningAllocationManual: true }],
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

/**
 * 把 totalCents 尽量平均分给 count 份，分不尽的余数（cents）依序分给前几份，
 * 保证回传的每一份加总起来精确等于 totalCents（不会因为四舍五入让总数对不上）。
 */
export function splitPoolEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * Mobile UAT Round 2：Driver Income 预设不再手动输入，改成 Driver Pool 按未取消 Leg
 * 数量自动平分。Admin 明确编辑过某个 Leg 的收入（earningAllocationManual=true）之后，
 * 那笔金额就冻结不再被自动平分覆盖，剩下仍是自动模式的 Leg 平分「Pool 扣掉手动金额」
 * 之后的余额。已经 COMPLETED 的 Leg 一定也要冻结——它的收入已经实际发放（写进
 * WalletTransaction 或影响 V2 Revenue Sharing 权重），事后改动会让历史记账跟当下
 * 栏位对不上，不管它当初是手动还是自动分配的。
 *
 * 呼叫时机：addLeg/cancelLeg/deleteLeg（Leg 数量变了）、updateLeg 明确设定
 * earningAllocationCents（多一笔冻结金额）、updateBooking 改动 commission/total
 * （Driver Pool 变了）之后都要重新呼叫一次。一律在同一个 DB Transaction 内调用。
 *
 * 这里自己上锁（`SELECT ... FOR UPDATE`），不假设呼叫端已经锁过：addLeg 等大部分路径
 * 现在都不带 earningAllocationCents（Driver Income 预设自动），不会经过
 * assertAllocationFits 那个锁，如果这里不自己锁，两个几乎同时的 addLeg 仍然可能各自
 * 读到「新增前」的 Leg 集合去平分，导致其中一个的平分结果在另一个新增完成后就过期。
 * 同一个 Transaction 内重复对同一个 Row 上锁是安全的，不会死锁。
 */
export async function redistributeAutoAllocations(client: TxClient, bookingId: number) {
  await client.$queryRaw`SELECT id FROM "bookings" WHERE id = ${bookingId} FOR UPDATE`;

  const booking = await client.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { driverPoolAmountCents: true }
  });

  const legs = await client.leg.findMany({
    where: { bookingId, status: { not: "CANCELLED" } },
    orderBy: { sequence: "asc" },
    select: { id: true, status: true, earningAllocationCents: true, earningAllocationManual: true }
  });

  const frozenLegs = legs.filter((leg) => leg.status === "COMPLETED" || leg.earningAllocationManual);
  const autoLegs = legs.filter((leg) => leg.status !== "COMPLETED" && !leg.earningAllocationManual);

  const frozenSumCents = frozenLegs.reduce((sum, leg) => sum + (leg.earningAllocationCents ?? 0), 0);
  const remainingCents = Math.max(0, booking.driverPoolAmountCents - frozenSumCents);
  const shares = splitPoolEvenly(remainingCents, autoLegs.length);

  await Promise.all(
    autoLegs.map((leg, index) => client.leg.update({ where: { id: leg.id }, data: { earningAllocationCents: shares[index] } }))
  );
}
