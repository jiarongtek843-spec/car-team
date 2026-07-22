import { describe, expect, it } from "vitest";
import { allocateDriverPool, calculateRevenueSharing, computeComponentCents } from "./revenueSharing.calculator.js";

const PERCENTAGE_RULE = {
  companyCommissionType: "PERCENTAGE" as const,
  companyCommissionValue: 15,
  dispatcherCommissionType: "PERCENTAGE" as const,
  dispatcherCommissionValue: 5
};

describe("computeComponentCents", () => {
  it("PERCENTAGE 四舍五入到最近的 cent", () => {
    expect(computeComponentCents(10000, "PERCENTAGE", 15)).toBe(1500);
    expect(computeComponentCents(333, "PERCENTAGE", 15)).toBe(50); // 49.95 -> 50
  });

  it("FIXED_AMOUNT 直接回传 value，跟 base 无关", () => {
    expect(computeComponentCents(10000, "FIXED_AMOUNT", 300)).toBe(300);
    expect(computeComponentCents(0, "FIXED_AMOUNT", 300)).toBe(300);
  });
});

describe("calculateRevenueSharing", () => {
  it("单一参与分润的 FARE Charge，套用 Company + Dispatcher Commission，余额归 Driver Pool", () => {
    const result = calculateRevenueSharing(
      [{ chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 10000 }],
      PERCENTAGE_RULE
    );

    expect(result.participatingAmountCents).toBe(10000);
    expect(result.companyCommissionCents).toBe(1500);
    expect(result.dispatcherCommissionCents).toBe(500);
    expect(result.companyRevenueCents).toBe(1500);
    expect(result.driverPoolCents).toBe(8000);
  });

  it("不参与分润但 isCompanyRevenue=true 的 Charge 全额算 Company Revenue，不套用 Commission", () => {
    const result = calculateRevenueSharing(
      [{ chargeTypeKey: "PLATFORM_FEE", participatesInRevenueSharing: false, isCompanyRevenue: true, amountCents: 500 }],
      PERCENTAGE_RULE
    );

    expect(result.participatingAmountCents).toBe(0);
    expect(result.companyCommissionCents).toBe(0);
    expect(result.companyRevenueCents).toBe(500);
    expect(result.driverPoolCents).toBe(0);
  });

  it("不参与分润且 isCompanyRevenue=false 的 Charge 全额算 Driver 收入（例如 Personal Tip）", () => {
    const result = calculateRevenueSharing(
      [{ chargeTypeKey: "PERSONAL_TIP", participatesInRevenueSharing: false, isCompanyRevenue: false, amountCents: 2000 }],
      PERCENTAGE_RULE
    );

    expect(result.companyRevenueCents).toBe(0);
    expect(result.driverPoolCents).toBe(2000);
  });

  it("混合多种 Charge Type：只有参与分润的部分套用 Commission，其余各自全额进对应桶", () => {
    const result = calculateRevenueSharing(
      [
        { chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 10000 },
        { chargeTypeKey: "SURCHARGE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 2000 },
        { chargeTypeKey: "PERSONAL_TIP", participatesInRevenueSharing: false, isCompanyRevenue: false, amountCents: 500 }
      ],
      PERCENTAGE_RULE
    );

    expect(result.participatingAmountCents).toBe(12000);
    expect(result.companyCommissionCents).toBe(1800); // 15% of 12000
    expect(result.dispatcherCommissionCents).toBe(600); // 5% of 12000
    expect(result.companyRevenueCents).toBe(1800);
    expect(result.driverPoolCents).toBe(500 + (12000 - 1800 - 600));
  });

  it("同一个 chargeTypeKey 出现多次（原始 Charge + ADDITION/REVERSAL）会合并成一笔加总", () => {
    const result = calculateRevenueSharing(
      [
        { chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 10000 },
        { chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 500 },
        { chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: -10000 } // REVERSAL
      ],
      PERCENTAGE_RULE
    );

    expect(result.participatingAmountCents).toBe(500);
    expect(result.chargeBreakdown).toEqual([
      { chargeTypeKey: "FARE", amountCents: 500, participatesInRevenueSharing: true, isCompanyRevenue: false }
    ]);
  });

  it("FIXED_AMOUNT 的 Company Commission 不随参与分润总额缩放", () => {
    const result = calculateRevenueSharing(
      [{ chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 5000 }],
      { companyCommissionType: "FIXED_AMOUNT", companyCommissionValue: 300, dispatcherCommissionType: "FIXED_AMOUNT", dispatcherCommissionValue: 200 }
    );

    expect(result.companyCommissionCents).toBe(300);
    expect(result.dispatcherCommissionCents).toBe(200);
    expect(result.driverPoolCents).toBe(4500);
  });

  it("Company + Dispatcher Commission 总额超过参与分润的总额时拒绝计算", () => {
    expect(() =>
      calculateRevenueSharing(
        [{ chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 1000 }],
        { companyCommissionType: "FIXED_AMOUNT", companyCommissionValue: 700, dispatcherCommissionType: "FIXED_AMOUNT", dispatcherCommissionValue: 400 }
      )
    ).toThrow(/超过可分配金额/);
  });

  it("没有任何 Charge 时，全部金额都是 0，不会报错", () => {
    const result = calculateRevenueSharing([], PERCENTAGE_RULE);
    expect(result.participatingAmountCents).toBe(0);
    expect(result.companyRevenueCents).toBe(0);
    expect(result.driverPoolCents).toBe(0);
    expect(result.chargeBreakdown).toEqual([]);
  });

  it("Company/Dispatcher Commission 加总恰好等于参与分润总额时允许（Driver Pool = 0，不报错）", () => {
    const result = calculateRevenueSharing(
      [{ chargeTypeKey: "FARE", participatesInRevenueSharing: true, isCompanyRevenue: false, amountCents: 1000 }],
      { companyCommissionType: "FIXED_AMOUNT", companyCommissionValue: 600, dispatcherCommissionType: "FIXED_AMOUNT", dispatcherCommissionValue: 400 }
    );

    expect(result.driverPoolCents).toBe(0);
  });
});

describe("allocateDriverPool", () => {
  it("单一 Leg 拿走全部 driverPoolCents", () => {
    const allocations = allocateDriverPool(8500, [{ legId: 1, driverId: 10, earningAllocationCents: 6000 }]);
    expect(allocations).toEqual([{ legId: 1, driverId: 10, amountCents: 8500 }]);
  });

  it("两个权重相等的 Leg 平分", () => {
    const allocations = allocateDriverPool(10000, [
      { legId: 1, driverId: 10, earningAllocationCents: 2400 },
      { legId: 2, driverId: 20, earningAllocationCents: 2400 }
    ]);
    expect(allocations).toEqual([
      { legId: 1, driverId: 10, amountCents: 5000 },
      { legId: 2, driverId: 20, amountCents: 5000 }
    ]);
  });

  it("权重不同时按比例分配（1:3）", () => {
    const allocations = allocateDriverPool(8000, [
      { legId: 1, driverId: 10, earningAllocationCents: 1000 },
      { legId: 2, driverId: 20, earningAllocationCents: 3000 }
    ]);
    expect(allocations).toEqual([
      { legId: 1, driverId: 10, amountCents: 2000 },
      { legId: 2, driverId: 20, amountCents: 6000 }
    ]);
  });

  it("多笔 Leg 四舍五入后的余数全部算给最后一笔，总和精确等于 driverPoolCents", () => {
    // 10000 分给权重 1:1:1 三笔，333.33...一笔算不尽——前两笔四舍五入各 3333，
    // 最后一笔吃剩下的 3334，总和仍然精确是 10000。
    const allocations = allocateDriverPool(10000, [
      { legId: 1, driverId: 10, earningAllocationCents: 1000 },
      { legId: 2, driverId: 20, earningAllocationCents: 1000 },
      { legId: 3, driverId: 30, earningAllocationCents: 1000 }
    ]);
    const sum = allocations.reduce((s, a) => s + a.amountCents, 0);
    expect(sum).toBe(10000);
    expect(allocations[0].amountCents).toBe(3333);
    expect(allocations[1].amountCents).toBe(3333);
    expect(allocations[2].amountCents).toBe(3334);
  });

  it("没有任何 Leg 时回传空阵列", () => {
    expect(allocateDriverPool(10000, [])).toEqual([]);
  });

  it("所有 Leg 的 earningAllocationCents 都是 0 时回传空阵列（没有权重可以分配）", () => {
    const allocations = allocateDriverPool(10000, [
      { legId: 1, driverId: 10, earningAllocationCents: 0 },
      { legId: 2, driverId: 20, earningAllocationCents: 0 }
    ]);
    expect(allocations).toEqual([]);
  });

  it("driverPoolCents 是 0 时每笔都分到 0，但仍然回传每个 Leg（不是空阵列）", () => {
    const allocations = allocateDriverPool(0, [
      { legId: 1, driverId: 10, earningAllocationCents: 1000 },
      { legId: 2, driverId: 20, earningAllocationCents: 1000 }
    ]);
    expect(allocations).toEqual([
      { legId: 1, driverId: 10, amountCents: 0 },
      { legId: 2, driverId: 20, amountCents: 0 }
    ]);
  });
});
