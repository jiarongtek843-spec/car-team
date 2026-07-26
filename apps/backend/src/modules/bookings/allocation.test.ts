import { describe, expect, it } from "vitest";
import { splitPoolEvenly } from "./allocation.js";

describe("splitPoolEvenly", () => {
  it("整除时每份金额相同", () => {
    expect(splitPoolEvenly(5100, 2)).toEqual([2550, 2550]);
    expect(splitPoolEvenly(5100, 3)).toEqual([1700, 1700, 1700]);
    expect(splitPoolEvenly(5100, 4)).toEqual([1275, 1275, 1275, 1275]);
  });

  it("除不尽时余数分给前几份，加总精确等于原始金额", () => {
    const shares = splitPoolEvenly(5101, 3);
    expect(shares).toEqual([1701, 1700, 1700]);
    expect(shares.reduce((sum, cents) => sum + cents, 0)).toBe(5101);
  });

  it("count 为 0 或负数回传空阵列", () => {
    expect(splitPoolEvenly(1000, 0)).toEqual([]);
    expect(splitPoolEvenly(1000, -1)).toEqual([]);
  });

  it("totalCents 为 0 时每份都是 0", () => {
    expect(splitPoolEvenly(0, 3)).toEqual([0, 0, 0]);
  });
});
