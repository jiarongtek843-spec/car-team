import type { LegStatus, LegType } from "../../types/booking";

export type BookingDispatchFilter = "WAITING" | "ASSIGNED" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED";
export type DriverDispatchFilter = "ONLINE" | "OFFLINE" | "CONNECTION_LOST" | "BUSY" | "IDLE";
export type DispatchPriority = "NORMAL" | "HIGH" | "URGENT";
export type DispatchGpsStatus = "ONLINE" | "OFFLINE" | "CONNECTION_LOST";

export interface DispatchWaitingLeg {
  legId: number;
  bookingId: number;
  girlName: string;
  bookingStatus: string;
  sequence: number;
  legType: LegType;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  scheduledAt: string | null;
  completedAt: string | null;
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

export interface SuggestedDriver {
  rank: number;
  driver: { id: number; name: string; vehiclePlateNumber: string | null };
  distanceKm: number | null;
  gpsStatus: DispatchGpsStatus;
  secondsSinceUpdate: number | null;
  completedToday: number;
}

export interface SuggestedDriversResult {
  legId: number;
  bookingId: number;
  girlName: string;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  suggestions: SuggestedDriver[];
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

/**
 * Phase 1 Dispatch Engine（简化版，见 apps/backend/.../dispatchOffer.service.ts 顶部注解）：
 * 一次 Send Offer = 同一批合格 Driver 各一笔 Offer，没有 Wave/Round。
 */
export type DispatchOfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export interface DispatchOffer {
  id: number;
  legId: number;
  driverId: number;
  status: DispatchOfferStatus;
  distanceKm: number | null;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
  driver: { id: number; name: string; vehiclePlateNumber: string | null };
}

export const OFFER_STATUS_LABELS: Record<DispatchOfferStatus, string> = {
  PENDING: "等待回应",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝",
  EXPIRED: "已失效"
};

export const OFFER_STATUS_COLOR: Record<DispatchOfferStatus, string> = {
  PENDING: "processing",
  ACCEPTED: "success",
  DECLINED: "default",
  EXPIRED: "default"
};

/**
 * Driver Matching Engine（NOT Auto Assignment）：`status` 目前一定是 "AVAILABLE"——
 * 后端 matchDriversForBooking 只回传 Driver Presence 状态是 AVAILABLE 的候选人，
 * 型别上仍然写成字面量而不是硬编字串，方便未来后端真的多回几种状态时一眼看出要改哪里。
 */
export interface MatchedDriverCandidate {
  rank: number;
  driverId: number;
  driverName: string;
  vehiclePlateNumber: string | null;
  distanceKm: number | null;
  status: "AVAILABLE";
  currentBooking: { id: number; girlName: string } | null;
  lastGpsUpdateAt: string | null;
}

export interface MatchingResult {
  bookingId: number;
  legId: number | null;
  pickupLocation: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  candidates: MatchedDriverCandidate[];
}
