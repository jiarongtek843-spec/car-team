import { describe, expect, it } from "vitest";
import {
  buildChargeListView,
  computeNetAmountCents,
  isChargeVoided,
  sumBookingTotalCents,
  type ChargeLike
} from "./bookingCharge.aggregation.js";

function charge(id: number, amountCents: number, adjustmentType: ChargeLike["adjustmentType"] = "NONE"): ChargeLike {
  return { id, amountCents, adjustmentType };
}

describe("computeNetAmountCents", () => {
  it("returns the original amount when there are no adjustments", () => {
    expect(computeNetAmountCents(charge(1, 10000), [])).toBe(10000);
  });

  it("adds ADDITION adjustments on top of the original amount", () => {
    const original = charge(1, 10000);
    const additions = [charge(2, 500, "ADDITION"), charge(3, 300, "ADDITION")];
    expect(computeNetAmountCents(original, additions)).toBe(10800);
  });

  it("nets out to zero when a REVERSAL exactly negates the original", () => {
    const original = charge(1, 10000);
    const reversal = [charge(2, -10000, "REVERSAL")];
    expect(computeNetAmountCents(original, reversal)).toBe(0);
  });

  it("combines ADDITION and REVERSAL correctly", () => {
    const original = charge(1, 10000);
    const adjustments = [charge(2, 500, "ADDITION"), charge(3, -10500, "REVERSAL")];
    expect(computeNetAmountCents(original, adjustments)).toBe(0);
  });
});

describe("isChargeVoided", () => {
  it("is false when there are no adjustments", () => {
    expect(isChargeVoided([])).toBe(false);
  });

  it("is false when only ADDITION adjustments exist", () => {
    expect(isChargeVoided([charge(2, 500, "ADDITION")])).toBe(false);
  });

  it("is true when a REVERSAL exists among the adjustments", () => {
    expect(isChargeVoided([charge(2, 500, "ADDITION"), charge(3, -10500, "REVERSAL")])).toBe(true);
  });
});

describe("buildChargeListView", () => {
  it("computes netAmountCents/isVoided/additionCount per original charge", () => {
    const view = buildChargeListView([
      { original: charge(1, 10000), adjustments: [] },
      {
        original: charge(2, 5000),
        adjustments: [charge(3, 1000, "ADDITION"), charge(4, 500, "ADDITION")]
      },
      { original: charge(5, 2000), adjustments: [charge(6, -2000, "REVERSAL")] }
    ]);

    expect(view).toEqual([
      { id: 1, netAmountCents: 10000, isVoided: false, additionCount: 0 },
      { id: 2, netAmountCents: 6500, isVoided: false, additionCount: 2 },
      { id: 5, netAmountCents: 0, isVoided: true, additionCount: 0 }
    ]);
  });
});

describe("sumBookingTotalCents", () => {
  it("sums every charge row including REVERSAL's negative amount, no exclusion needed", () => {
    const all = [charge(1, 10000, "NONE"), charge(2, 500, "ADDITION"), charge(3, -10000, "REVERSAL")];
    expect(sumBookingTotalCents(all)).toBe(500);
  });

  it("returns 0 for an empty charge list", () => {
    expect(sumBookingTotalCents([])).toBe(0);
  });
});
