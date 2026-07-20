import type { BookingStatus, LegStatus } from "@prisma/client";

interface LegLike {
  status: LegStatus;
}

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

  if (activeLegs.some((leg) => leg.status === "IN_PROGRESS" || leg.status === "COMPLETED")) {
    return "IN_PROGRESS";
  }

  return "PENDING";
}
