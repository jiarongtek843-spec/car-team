import { describe, expect, it, vi, afterEach } from "vitest";
import dayjs from "dayjs";
import { parseBookingText } from "./parseBookingText";

describe("parseBookingText", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Mobile UAT Round 3 回归：Date/Pick up/Time 三个栏位要正确解析成 scheduledAt/estimatedDurationMinutes（之前 10pm 这种没有分钟数的整点格式解析失败，departAt 永远是 undefined）", () => {
    const text = "Date: 26/7\nGirl: Kara\nPick up: 10pm\nTime: 9 hrs\nCollect: 1170\nAddress:\n====================\nElement by marriot\n====================";
    const parsed = parseBookingText(text);

    expect(parsed.girlName).toBe("Kara");
    expect(parsed.legs).toBeDefined();
    const [outbound] = parsed.legs!;
    expect(outbound.scheduledAt).toBeDefined();
    expect(outbound.scheduledAt!.hour()).toBe(22);
    expect(outbound.scheduledAt!.minute()).toBe(0);
    expect(outbound.scheduledAt!.date()).toBe(26);
    expect(outbound.scheduledAt!.month()).toBe(6); // dayjs 月份从 0 开始，7 月是 6
    expect(outbound.estimatedDurationMinutes).toBe(540);
    expect(outbound.dropoffLocation).toBe("Element by marriot");
  });

  describe("时间格式", () => {
    const cases: [string, { hour: number; minute: number }][] = [
      ["10pm", { hour: 22, minute: 0 }],
      ["10 pm", { hour: 22, minute: 0 }],
      ["22:00", { hour: 22, minute: 0 }],
      ["9:30pm", { hour: 21, minute: 30 }],
      ["9.30pm", { hour: 21, minute: 30 }],
      ["8.45am", { hour: 8, minute: 45 }],
      ["12am", { hour: 0, minute: 0 }],
      ["12pm", { hour: 12, minute: 0 }]
    ];

    it.each(cases)("Pick up: %s 要正确解析成时分", (raw, expected) => {
      const parsed = parseBookingText(`Date: 1/8\nPick up: ${raw}`);
      const [outbound] = parsed.legs!;
      expect(outbound.scheduledAt!.hour()).toBe(expected.hour);
      expect(outbound.scheduledAt!.minute()).toBe(expected.minute);
    });
  });

  describe("Mobile UAT Round 5：Duration 格式（Time: 栏位）", () => {
    const cases: [string, number][] = [
      ["3hour", 180],
      ["3 hour", 180],
      ["3hours", 180],
      ["3 hours", 180],
      ["3hr", 180],
      ["3 hrs", 180],
      ["3h", 180],
      ["3小时", 180],
      ["3个小时", 180],
      ["3 jam", 180],
      ["3jam", 180],
      ["1.5 hours", 90],
      ["1 hour 30 minutes", 90],
      ["1h 30m", 90],
      ["9 hrs", 540]
    ];

    it.each(cases)("Time: %s 要正确解析成 %i 分钟", (raw, expectedMinutes) => {
      const parsed = parseBookingText(`Date: 27/7\nPick up: 9:30\nTime: ${raw}`);
      expect(parsed.legs![0].estimatedDurationMinutes).toBe(expectedMinutes);
    });
  });

  describe("日期格式", () => {
    it("支援 26-7（用 - 隔开）", () => {
      const parsed = parseBookingText("Date: 26-7\nPick up: 10pm");
      expect(parsed.legs![0].scheduledAt!.date()).toBe(26);
      expect(parsed.legs![0].scheduledAt!.month()).toBe(6);
    });

    it("支援 26/07/2026（带完整年份）", () => {
      const parsed = parseBookingText("Date: 26/07/2026\nPick up: 10pm");
      expect(parsed.legs![0].scheduledAt!.year()).toBe(2026);
      expect(parsed.legs![0].scheduledAt!.date()).toBe(26);
      expect(parsed.legs![0].scheduledAt!.month()).toBe(6);
    });

    it("支援 26 July（月份英文名）", () => {
      const parsed = parseBookingText("Date: 26 July\nPick up: 10pm");
      expect(parsed.legs![0].scheduledAt!.date()).toBe(26);
      expect(parsed.legs![0].scheduledAt!.month()).toBe(6);
    });

    it("支援 today", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 27, 12, 0, 0));
      const parsed = parseBookingText("Date: today\nPick up: 10pm");
      expect(parsed.legs![0].scheduledAt!.date()).toBe(27);
      expect(parsed.legs![0].scheduledAt!.month()).toBe(6);
      expect(parsed.legs![0].scheduledAt!.year()).toBe(2026);
    });

    it("支援 tomorrow", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 27, 12, 0, 0));
      const parsed = parseBookingText("Date: tomorrow\nPick up: 10pm");
      expect(parsed.legs![0].scheduledAt!.date()).toBe(28);
      expect(parsed.legs![0].scheduledAt!.month()).toBe(6);
    });
  });

  it("Collect 金额会存进 notes，方便使用者核对（不建立独立的 Collection 栏位，Collection Module 尚未开始）", () => {
    const parsed = parseBookingText("Girl: Kara\nCollect: 1170");
    expect(parsed.notes).toBe("Collect: 1170");
  });

  it("Address 会分别填进去程终点跟回程起点", () => {
    const parsed = parseBookingText("Address:\n====================\nElement by marriot\n====================\nCar fee: 80");
    expect(parsed.legs![0].dropoffLocation).toBe("Element by marriot");
    expect(parsed.legs![1].pickupLocation).toBe("Element by marriot");
    expect(parsed.totalAmountCents).toBe(8000);
  });

  it("完全没有可辨识内容时不回传 legs", () => {
    const parsed = parseBookingText("random unrelated text");
    expect(parsed.legs).toBeUndefined();
  });

  it("dayjs 的月份索引确认：7 月对应 month()===6", () => {
    expect(dayjs("2026-07-26").month()).toBe(6);
  });
});
