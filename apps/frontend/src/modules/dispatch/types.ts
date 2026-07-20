import type { LegStatus } from "../../types/booking";

export type BookingDispatchFilter = "WAITING" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS";
export type DriverDispatchFilter = "ONLINE" | "OFFLINE" | "CONNECTION_LOST" | "BUSY" | "IDLE";
export type DispatchPriority = "NORMAL" | "HIGH" | "URGENT";
export type DispatchGpsStatus = "ONLINE" | "OFFLINE" | "CONNECTION_LOST";

export interface DispatchWaitingLeg {
  legId: number;
  bookingId: number;
  girlName: string;
  bookingStatus: string;
  sequence: number;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  scheduledAt: string | null;
  bookingCreatedAt: string;
  priority: DispatchPriority;
  status: LegStatus;
  rejectionReason: string | null;
  driver: { id: number; name: string; vehiclePlateNumber: string | null } | null;
}

export interface DispatchDriver {
  driver: { id: number; name: string; phone: string | null; vehiclePlateNumber: string | null };
  gpsStatus: DispatchGpsStatus;
  secondsSinceUpdate: number | null;
  location: { latitude: number; longitude: number } | null;
  currentJobs: number;
  pendingJobs: number;
  completedToday: number;
  workloadStatus: "BUSY" | "IDLE";
}

export interface DispatchStatistics {
  waitingBookings: number;
  assigned: number;
  accepted: number;
  inProgress: number;
  completedToday: number;
  onlineDrivers: number;
  offlineDrivers: number;
}

export const PRIORITY_LABELS: Record<DispatchPriority, string> = {
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent"
};

export const PRIORITY_COLOR: Record<DispatchPriority, string> = {
  NORMAL: "default",
  HIGH: "warning",
  URGENT: "error"
};

export const GPS_STATUS_LABELS: Record<DispatchGpsStatus, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  CONNECTION_LOST: "Connection Lost"
};

export const GPS_STATUS_COLOR: Record<DispatchGpsStatus, string> = {
  ONLINE: "success",
  OFFLINE: "default",
  CONNECTION_LOST: "warning"
};
