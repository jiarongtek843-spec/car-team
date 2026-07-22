import type { CommissionType } from "@prisma/client";
import { ValidationError } from "../../common/errors.js";
import { roundToNearestCent } from "../../common/money.js";

export interface RevenueRuleConfig {
  companyCommissionType: CommissionType;
  companyCommissionValue: number;
  dispatcherCommissionType: CommissionType;
  dispatcherCommissionValue: number;
}

/** 计算用的最小 Charge 形状——只带 Revenue Sharing 计算需要的栏位，不是完整的 BookingCharge。 */
export interface ChargeForRevenueSharing {
  chargeTypeKey: string;
  participatesInRevenueSharing: boolean;
  isCompanyRevenue: boolean;
  amountCents: number;
}

export interface ChargeTypeBreakdownEntry {
  chargeTypeKey: string;
  amountCents: number;
  participatesInRevenueSharing: boolean;
  isCompanyRevenue: boolean;
}

export interface RuleComponentBreakdownEntry {
  key: "COMPANY_COMMISSION" | "DISPATCHER_COMMISSION";
  type: CommissionType;
  value: number;
  amountCents: number;
}

export interface RevenueSharingResult {
  /** 参与 Revenue Sharing 的 Charge 净额加总——Company/Dispatcher Commission 都是这个数字的函数。 */
  participatingAmountCents: number;
  /** 不参与 Revenue Sharing、直接算 Company Revenue 的 Charge 净额加总（例如未来的平台服务费）。 */
  nonParticipatingCompanyCents: number;
  /** 不参与 Revenue Sharing、直接算 Driver 收入的 Charge 净额加总（例如 Personal Tip）。 */
  nonParticipatingDriverCents: number;
  companyCommissionCents: number;
  dispatcherCommissionCents: number;
  /** = nonParticipatingCompanyCents + companyCommissionCents */
  companyRevenueCents: number;
  /** = nonParticipatingDriverCents + (participatingAmountCents - companyCommissionCents - dispatcherCommissionCents) */
  driverPoolCents: number;
  chargeBreakdown: ChargeTypeBreakdownEntry[];
  ruleBreakdown: RuleComponentBreakdownEntry[];
}

/** PERCENTAGE 是 baseCents 的整数百分比（四舍五入到最近的 cent）；FIXED_AMOUNT 直接是 cents。 */
export function computeComponentCents(baseCents: number, type: CommissionType, value: number): number {
  if (type === "PERCENTAGE") {
    return roundToNearestCent((baseCents * value) / 100);
  }
  return value;
}

/**
 * Revenue Sharing 的核心计算，不碰 DB、不知道 Booking/Snapshot 的存在——纯函数方便测试。
 * 按 ChargeType 的两个 flag 把每笔 Charge 分进三个桶（database-schema-v2.md 的既有设计）：
 *   participatesInRevenueSharing=true         -> 参与分润，套用 Company/Dispatcher Commission
 *   participatesInRevenueSharing=false + isCompanyRevenue=true  -> 全额算 Company Revenue
 *   participatesInRevenueSharing=false + isCompanyRevenue=false -> 全额算 Driver 收入
 * Company/Dispatcher Commission 各自独立、平行地对参与分润的总额计算（不是依序从余额扣），
 * 两者加总不能超过参与分润的总额——否则代表设定不合理，直接拒绝而不是静默夹紧到 0，
 * 因为这是一个「即将写入不可变 Snapshot」的动作，不该悄悄吃掉使用者设错的数字。
 */
export function calculateRevenueSharing(
  charges: ChargeForRevenueSharing[],
  rule: RevenueRuleConfig
): RevenueSharingResult {
  const byChargeType = new Map<string, ChargeTypeBreakdownEntry>();
  let participatingAmountCents = 0;
  let nonParticipatingCompanyCents = 0;
  let nonParticipatingDriverCents = 0;

  for (const charge of charges) {
    const existing = byChargeType.get(charge.chargeTypeKey);
    if (existing) {
      existing.amountCents += charge.amountCents;
    } else {
      byChargeType.set(charge.chargeTypeKey, {
        chargeTypeKey: charge.chargeTypeKey,
        amountCents: charge.amountCents,
        participatesInRevenueSharing: charge.participatesInRevenueSharing,
        isCompanyRevenue: charge.isCompanyRevenue
      });
    }

    if (charge.participatesInRevenueSharing) {
      participatingAmountCents += charge.amountCents;
    } else if (charge.isCompanyRevenue) {
      nonParticipatingCompanyCents += charge.amountCents;
    } else {
      nonParticipatingDriverCents += charge.amountCents;
    }
  }

  const companyCommissionCents = computeComponentCents(
    participatingAmountCents,
    rule.companyCommissionType,
    rule.companyCommissionValue
  );
  const dispatcherCommissionCents = computeComponentCents(
    participatingAmountCents,
    rule.dispatcherCommissionType,
    rule.dispatcherCommissionValue
  );

  if (companyCommissionCents + dispatcherCommissionCents > participatingAmountCents) {
    throw new ValidationError(
      `Revenue Allocation 总额（Company ${companyCommissionCents} + Dispatcher ${dispatcherCommissionCents} = ${
        companyCommissionCents + dispatcherCommissionCents
      }）超过可分配金额（${participatingAmountCents}）`
    );
  }

  const driverPoolFromParticipating = participatingAmountCents - companyCommissionCents - dispatcherCommissionCents;

  return {
    participatingAmountCents,
    nonParticipatingCompanyCents,
    nonParticipatingDriverCents,
    companyCommissionCents,
    dispatcherCommissionCents,
    companyRevenueCents: nonParticipatingCompanyCents + companyCommissionCents,
    driverPoolCents: nonParticipatingDriverCents + driverPoolFromParticipating,
    chargeBreakdown: [...byChargeType.values()],
    ruleBreakdown: [
      {
        key: "COMPANY_COMMISSION",
        type: rule.companyCommissionType,
        value: rule.companyCommissionValue,
        amountCents: companyCommissionCents
      },
      {
        key: "DISPATCHER_COMMISSION",
        type: rule.dispatcherCommissionType,
        value: rule.dispatcherCommissionValue,
        amountCents: dispatcherCommissionCents
      }
    ]
  };
}

/** 一笔 Leg 的分润权重输入——只带 allocateDriverPool 需要的栏位。 */
export interface LegAllocationInput {
  legId: number;
  driverId: number;
  earningAllocationCents: number;
}

export interface DriverPoolAllocation {
  legId: number;
  driverId: number;
  amountCents: number;
}

/**
 * Module 12（Wallet Migration）：把 Revenue Sharing Snapshot 的 driverPoolCents 按每个
 * （未取消、已指派 Driver 的）Leg 的 earningAllocationCents 比例分配——这是 Financial V2
 * Booking「Revenue Allocation」的具体定义：沿用既有的 Leg 分配比例机制，只是套用在新的
 * Revenue Sharing 总额上，而不是旧的 driverPoolAmountCents。用统一的「四舍五入到最近的
 * cent」规则算前 n-1 笔，最后一笔吃掉四舍五入后的余数，保证总和永远精确等于
 * driverPoolCents（Validation：所有金额必须一致）。没有任何合格 Leg（totalWeight <= 0）
 * 时回传空阵列——没有 Driver 可以分，不是错误。
 */
export function allocateDriverPool(driverPoolCents: number, legs: LegAllocationInput[]): DriverPoolAllocation[] {
  const totalWeight = legs.reduce((sum, leg) => sum + leg.earningAllocationCents, 0);
  if (totalWeight <= 0 || legs.length === 0) {
    return [];
  }

  let distributed = 0;
  return legs.map((leg, index) => {
    const isLast = index === legs.length - 1;
    const amountCents = isLast
      ? driverPoolCents - distributed
      : roundToNearestCent((driverPoolCents * leg.earningAllocationCents) / totalWeight);
    distributed += amountCents;
    return { legId: leg.legId, driverId: leg.driverId, amountCents };
  });
}
