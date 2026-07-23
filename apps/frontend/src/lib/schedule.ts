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
