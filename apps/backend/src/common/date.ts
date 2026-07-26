// "YYYY-MM-DD" 字串直接丢给 `new Date()` 会被当成 UTC 午夜解析（ISO 8601 date-only
// 字串的规定行为），但接下来如果用伺服器的「本地」时区（`getFullYear()`/`setHours()`）
// 运算这个结果，只要伺服器时区不是 UTC（Railway/本地开发常见是 UTC+8），这两者混在一起
// 会让算出来的日期区间悄悄偏移几个小时，偏移方向依时区而定：可能让「明明选进这个周期/这天
// 的资料」被排除在外，也可能让周期外的资料被误算进来。直接照 Y/M/D 数字组一个本地时间的
// Date，从源头避开「UTC 解析 + 本地时区运算」这组混用陷阱——settlement.service.ts 最早发现
// 并修好这个坑，dispatch.service.ts 的 Completed 日期 Filter 之前没有套用同一个修法，
// 两处后来都改成共用这里，不要各自维护一份。
export function parseLocalDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
