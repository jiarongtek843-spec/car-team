import { describe, expect, it } from "vitest";
import { formatDateSafe, formatDateTimeSafe } from "./formatDate";

describe("formatDateSafe / formatDateTimeSafe", () => {
  it("合法的 ISO 日期字串会正确格式化", () => {
    expect(formatDateSafe("2026-07-27T00:13:26.000Z")).not.toBe("-");
    expect(formatDateTimeSafe("2026-07-27T00:13:26.000Z")).not.toBe("-");
  });

  it("null/undefined 回传 -，不是 Invalid Date", () => {
    expect(formatDateSafe(null)).toBe("-");
    expect(formatDateSafe(undefined)).toBe("-");
    expect(formatDateTimeSafe(null)).toBe("-");
    expect(formatDateTimeSafe(undefined)).toBe("-");
  });

  it("空字串回传 -", () => {
    expect(formatDateSafe("")).toBe("-");
  });

  it("Mobile UAT Round 3 回归：格式不合法的字串（无法被 Date 解析）回传 -，不是 Invalid Date", () => {
    expect(formatDateSafe("not-a-real-date")).toBe("-");
    expect(formatDateTimeSafe("not-a-real-date")).toBe("-");
  });
});
