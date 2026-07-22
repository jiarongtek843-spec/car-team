import type { ChargeAdjustmentType } from "@prisma/client";

/**
 * 纯函数，不碰 DB，方便写单元测试。把「一笔原始 Charge + 它底下所有的 Adjustment」
 * 聚合成 List 用的净额视图——净额永远是加总算出来的，不是存在 DB 里的栏位
 * （见 docs/design/financial-model-v2.md 第 4 章）。
 */

export interface ChargeLike {
  id: number;
  amountCents: number;
  adjustmentType: ChargeAdjustmentType;
}

/**
 * original 必须是 adjustmentType=NONE 的原始 Charge；adjustments 是所有
 * adjustsChargeId 指向它的 ADDITION/REVERSAL 记录（顺序不拘）。
 */
export function computeNetAmountCents(original: ChargeLike, adjustments: ChargeLike[]): number {
  return adjustments.reduce((sum, adj) => sum + adj.amountCents, original.amountCents);
}

/** 只要有一笔 REVERSAL 指向它，这笔原始 Charge 就算被冲销了——Partial Unique Index
 * 保证最多只会有一笔，这里不用去重也不会算错。 */
export function isChargeVoided(adjustments: ChargeLike[]): boolean {
  return adjustments.some((adj) => adj.adjustmentType === "REVERSAL");
}

export interface ChargeListItem {
  original: ChargeLike;
  adjustments: ChargeLike[];
}

export interface ChargeListView {
  id: number;
  netAmountCents: number;
  isVoided: boolean;
  additionCount: number;
}

/** List Booking Charges 用的「当前净额视图」：一笔原始 Charge 一行，附带净额跟是否已冲销。 */
export function buildChargeListView(items: ChargeListItem[]): ChargeListView[] {
  return items.map(({ original, adjustments }) => ({
    id: original.id,
    netAmountCents: computeNetAmountCents(original, adjustments),
    isVoided: isChargeVoided(adjustments),
    additionCount: adjustments.filter((a) => a.adjustmentType === "ADDITION").length
  }));
}

/** Booking Total（Customer Total）= 全部未冲销净额的加总，REVERSAL 本身用负数金额
 * 自然抵销，不需要额外排除任何记录（呼应 database-schema-v2.md 第 6 章）。 */
export function sumBookingTotalCents(allCharges: ChargeLike[]): number {
  return allCharges.reduce((sum, charge) => sum + charge.amountCents, 0);
}
