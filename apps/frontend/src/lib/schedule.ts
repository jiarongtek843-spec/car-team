import dayjs from "dayjs";

// 「待确认」比原本的「未设定时间」更明确：告诉使用者这是一个还没决定的状态，
// 不是系统忘记显示什么东西。日期跟时间分开回传，让呼叫端各自排版
// （去程/回程 Card、Dispatch 列表、Driver Job Card 都需要清楚分开显示日期与时间）。
export function formatLegDate(scheduledAt: string | null): string {
  return scheduledAt ? dayjs(scheduledAt).format("YYYY-MM-DD (ddd)") : "待确认";
}

export function formatLegTime(scheduledAt: string | null): string {
  return scheduledAt ? dayjs(scheduledAt).format("HH:mm") : "待确认";
}

export function formatLegDateTime(scheduledAt: string | null): string {
  return scheduledAt ? dayjs(scheduledAt).format("YYYY-MM-DD (ddd) HH:mm") : "待确认";
}

export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return "待确认";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} 分钟`;
  if (mins === 0) return `${hours} 小时`;
  return `${hours} 小时 ${mins} 分钟`;
}

export function formatEstimatedFinish(estimatedFinishAt: string | null | undefined): string {
  return estimatedFinishAt ? dayjs(estimatedFinishAt).format("YYYY-MM-DD (ddd) HH:mm") : "待确认";
}

/** Pickup Time + Estimated Duration 自动算出 Estimated Finish Time；缺一个就不算。 */
export function calculateEstimatedFinish(
  scheduledAt: dayjs.Dayjs | null | undefined,
  estimatedDurationMinutes: number | null | undefined
): dayjs.Dayjs | undefined {
  if (!scheduledAt || !estimatedDurationMinutes) return undefined;
  return scheduledAt.add(estimatedDurationMinutes, "minute");
}
