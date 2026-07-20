import { describe, expect, it } from "vitest";
import { calculateCommissionSplit } from "./commission.js";

describe("calculateCommissionSplit", () => {
  it("splits a percentage commission (15% of RM60)", () => {
    expect(calculateCommissionSplit(6000, "PERCENTAGE", 15)).toEqual({
      platformAmountCents: 900,
      driverPoolAmountCents: 5100
    });
  });

  it("splits a percentage commission (20% of RM60)", () => {
    expect(calculateCommissionSplit(6000, "PERCENTAGE", 20)).toEqual({
      platformAmountCents: 1200,
      driverPoolAmountCents: 4800
    });
  });

  it("splits a fixed amount commission (RM10 of RM60)", () => {
    expect(calculateCommissionSplit(6000, "FIXED_AMOUNT", 1000)).toEqual({
      platformAmountCents: 1000,
      driverPoolAmountCents: 5000
    });
  });

  it("never lets the fixed amount exceed the total (driver pool floors at 0)", () => {
    expect(calculateCommissionSplit(500, "FIXED_AMOUNT", 1000)).toEqual({
      platformAmountCents: 500,
      driverPoolAmountCents: 0
    });
  });

  it("rounds percentage splits to the nearest cent", () => {
    // 15% of RM25.55 (2555 cents) = 383.25 -> rounds to 383
    expect(calculateCommissionSplit(2555, "PERCENTAGE", 15)).toEqual({
      platformAmountCents: 383,
      driverPoolAmountCents: 2172
    });
  });

  it("handles zero total amount", () => {
    expect(calculateCommissionSplit(0, "PERCENTAGE", 15)).toEqual({
      platformAmountCents: 0,
      driverPoolAmountCents: 0
    });
  });
});
