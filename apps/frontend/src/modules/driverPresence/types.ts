export type DriverPresenceState = "OFFLINE" | "AVAILABLE" | "PENDING_OFFER" | "ACCEPTED_JOB" | "ON_TRIP" | "BREAK";

export interface DriverPresenceEntry {
  driverId: number;
  driverName: string;
  vehiclePlateNumber: string | null;
  status: DriverPresenceState;
  currentBooking: { id: number; girlName: string } | null;
  currentLeg: { id: number; sequence: number; legType: string } | null;
  lastSeenAt: string | null;
}

export const PRESENCE_STATE_LABELS: Record<DriverPresenceState, string> = {
  OFFLINE: "Offline",
  AVAILABLE: "Available",
  PENDING_OFFER: "Pending Offer",
  ACCEPTED_JOB: "Accepted Job",
  ON_TRIP: "On Trip",
  BREAK: "Break"
};

// 用户明确指定的颜色：Green = Available / Blue = On Trip / Orange = Pending Offer /
// Gray = Offline。Accepted Job 跟 On Trip 都算「正在忙、路上」，用同一个 processing 蓝色
// 系但 Accepted Job 用较浅的 cyan 区分「还没出发」跟「已经在跑」。Break 保留但这次没有
// 任何触发点会设成这个状态，颜色先给个中性的 default。
export const PRESENCE_STATE_COLOR: Record<DriverPresenceState, string> = {
  OFFLINE: "default",
  AVAILABLE: "success",
  PENDING_OFFER: "orange",
  ACCEPTED_JOB: "cyan",
  ON_TRIP: "blue",
  BREAK: "default"
};
