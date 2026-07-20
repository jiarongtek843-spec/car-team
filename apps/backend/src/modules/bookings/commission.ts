import type { CommissionType } from "@prisma/client";
import { roundToNearestCent } from "../../common/money.js";

export interface CommissionSplit {
  platformAmountCents: number;
  driverPoolAmountCents: number;
}

/**
 * 算平台抽成跟司机分成池。Percentage 用统一的 roundToNearestCent 四舍五入到整数 cent；
 * Fixed Amount 不会让抽成超过 Booking 总价（避免 Driver Pool 变负数）。
 */
export function calculateCommissionSplit(
  totalAmountCents: number,
  commissionType: CommissionType,
  commissionValue: number
): CommissionSplit {
  let platformAmountCents: number;

  if (commissionType === "PERCENTAGE") {
    platformAmountCents = roundToNearestCent((totalAmountCents * commissionValue) / 100);
  } else {
    platformAmountCents = commissionValue;
  }

  platformAmountCents = Math.max(0, Math.min(platformAmountCents, totalAmountCents));
  const driverPoolAmountCents = totalAmountCents - platformAmountCents;

  return { platformAmountCents, driverPoolAmountCents };
}
