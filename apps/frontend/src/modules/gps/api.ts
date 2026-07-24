import { http } from "../../api/http";
import type { DriverPresence } from "./types";

export function fetchDriverPresenceList(onlineOnly = true) {
  return http.get<DriverPresence[]>(`/api/admin/gps/drivers?onlineOnly=${onlineOnly}`);
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
