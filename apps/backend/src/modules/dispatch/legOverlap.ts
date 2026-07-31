/**
 * acceptOffer 用来判断「这个 Driver 已经有的行程」跟「他正要接的这个 Leg」时间上会不会
 * 撞在一起。刻意保守：任一边缺 scheduledAt 就视为不冲突（宁可漏挡也不要因为资料不全而
 * 误挡合法的接单），符合既有 Booking 时间栏位本来就是 nullable 的设计。
 */
export interface LegTimeWindow {
  scheduledAt: Date | null;
  estimatedDurationMinutes: number | null;
  estimatedFinishAt: Date | null;
}

function resolveEnd(leg: LegTimeWindow): Date | null {
  if (!leg.scheduledAt) {
    return null;
  }
  if (leg.estimatedFinishAt) {
    return leg.estimatedFinishAt;
  }
  if (leg.estimatedDurationMinutes) {
    return new Date(leg.scheduledAt.getTime() + leg.estimatedDurationMinutes * 60_000);
  }
  return leg.scheduledAt;
}

export function legsOverlap(a: LegTimeWindow, b: LegTimeWindow): boolean {
  if (!a.scheduledAt || !b.scheduledAt) {
    return false;
  }
  const aEnd = resolveEnd(a);
  const bEnd = resolveEnd(b);
  if (!aEnd || !bEnd) {
    return false;
  }
  // 用 <=（不是严格 <）——两个 Leg 都没有 Duration/Finish 資料时（例如去程 Leg 目前
  // 前端已经不给手动填 Duration，只有 OCR 识别到才有值），resolveEnd 会退化成
  // scheduledAt 本身，变成一个「零长度」的时间点。严格 `<` 对两个零长度区间永远算不出
  // 「重叠」（哪怕两个 scheduledAt 完全相同），会让这个规则形同虚设——同一个 Driver
  // 明明被排到同一分钟出车两趟，也不会被挡下来。改成 <= 之后，两个时间点完全相同會被
  // 正确判定为冲突；对有 Duration 的正常区间，代价只是「首尾恰好相接」也会被当成冲突，
  // 这在派车场景本来就是合理的保守判断（司机不可能在同一秒结束一趟又开始下一趟）。
  return a.scheduledAt <= bEnd && b.scheduledAt <= aEnd;
}
