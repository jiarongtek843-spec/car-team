import type { BookingStatus, LegStatus } from "@prisma/client";

interface LegLike {
  status: LegStatus;
}

/**
 * Leg 正在被处理中、尚未结束的状态。REJECTED 刻意不算在内：
 * 被拒绝的 Leg 要退回「需要处理」的状态，不能让 Booking 误以为有进度。
 */
export const ACTIVE_LEG_STATUSES: LegStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "PASSENGER_ON_BOARD",
  "COMPLETED"
];

/**
 * 「这个司机手上还有没做完的工作」用这个：跟 ACTIVE_LEG_STATUSES 不同，
 * 不包含 COMPLETED（已完成不算未完成）。
 */
export const UNFINISHED_LEG_STATUSES: LegStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "DRIVER_ARRIVING",
  "PASSENGER_ON_BOARD"
];

/**
 * Booking status 不是手动设定的字段，而是每次 Leg 变动时从当下所有 Leg 重新推导。
 * 规则见 docs/modules/booking.md。
 */
export function deriveBookingStatus(currentStatus: BookingStatus, legs: LegLike[]): BookingStatus {
  if (currentStatus === "CANCELLED") {
    return "CANCELLED";
  }

  if (legs.length === 0) {
    return "PENDING";
  }

  const activeLegs = legs.filter((leg) => leg.status !== "CANCELLED");

  if (activeLegs.length === 0) {
    return "CANCELLED";
  }

  if (activeLegs.every((leg) => leg.status === "COMPLETED")) {
    return "COMPLETED";
  }

  if (activeLegs.some((leg) => ACTIVE_LEG_STATUSES.includes(leg.status))) {
    return "IN_PROGRESS";
  }

  return "PENDING";
}
