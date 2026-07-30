export type DriverPresenceStatus =
  | "OFFLINE"
  | "CONNECTION_LOST"
  | "ONLINE"
  | "ASSIGNED"
  | "ACCEPTED"
  | "DRIVER_ARRIVING"
  | "PASSENGER_ON_BOARD"
  | "COMPLETED"
  | "BREAK";

export interface DriverPresenceLocation {
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  batteryPercent: number | null;
  recordedAt: string;
  receivedAt: string;
}

export interface DriverPresenceActiveLeg {
  id: number;
  bookingId: number;
  sequence: number;
  status: string;
  bookingGirlName: string;
}

export interface DriverPresence {
  driver: { id: number; name: string; vehiclePlateNumber: string | null };
  status: DriverPresenceStatus;
  secondsSinceUpdate: number | null;
  location: DriverPresenceLocation | null;
  activeLeg: DriverPresenceActiveLeg | null;
}

export const PRESENCE_STATUS_LABELS: Record<DriverPresenceStatus, string> = {
  OFFLINE: "Offline",
  CONNECTION_LOST: "Connection Lost",
  ONLINE: "Online",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  DRIVER_ARRIVING: "Driver Arriving",
  PASSENGER_ON_BOARD: "Passenger On Board",
  COMPLETED: "Completed",
  BREAK: "Break"
};

export const PRESENCE_STATUS_COLOR: Record<DriverPresenceStatus, string> = {
  OFFLINE: "default",
  CONNECTION_LOST: "warning",
  ONLINE: "success",
  ASSIGNED: "processing",
  ACCEPTED: "processing",
  DRIVER_ARRIVING: "processing",
  PASSENGER_ON_BOARD: "processing",
  COMPLETED: "success",
  BREAK: "default"
};

export const PRESENCE_STATUS_DOT: Record<DriverPresenceStatus, string> = {
  OFFLINE: "⚪",
  CONNECTION_LOST: "🟡",
  ONLINE: "🟢",
  ASSIGNED: "🔵",
  ACCEPTED: "🔵",
  DRIVER_ARRIVING: "🔵",
  PASSENGER_ON_BOARD: "🔵",
  COMPLETED: "🟢",
  BREAK: "⚪"
};

/** GPS Foundation：Admin Get Driver Locations API 的回传形状——只有 latest location，
 * 只列出目前仍在报点状态（AVAILABLE/PENDING_OFFER/ACCEPTED_JOB/ON_TRIP）的 Driver。 */
export interface DriverLocationEntry {
  driverId: number;
  driverName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: string;
}
