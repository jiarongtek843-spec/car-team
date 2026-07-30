import { http } from "../../api/http";
import type { DriverLocationEntry, DriverPresence } from "./types";

export function fetchDriverPresenceList(onlineOnly = true) {
  return http.get<DriverPresence[]>(`/api/admin/gps/drivers?onlineOnly=${onlineOnly}`);
}

/** GPS Foundation：Live Dispatch Map 用来画 Driver Marker 的座标来源。 */
export function fetchDriverLocations() {
  return http.get<DriverLocationEntry[]>("/api/admin/gps/locations");
}

export function fetchDriverPresence(driverId: number) {
  return http.get<DriverPresence>(`/api/admin/gps/drivers/${driverId}`);
}

export function fetchMyPresence() {
  return http.get<DriverPresence>("/api/driver/presence/me");
}

export function goOnline() {
  return http.post<DriverPresence>("/api/driver/presence/online");
}

export function goOffline() {
  return http.post<DriverPresence>("/api/driver/presence/offline");
}

export interface PingInput {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  batteryPercent?: number;
  recordedAt?: string;
}

export function sendPing(input: PingInput) {
  return http.post<void>("/api/driver/presence/ping", input);
}
