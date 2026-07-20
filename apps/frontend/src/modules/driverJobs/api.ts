import { http } from "../../api/http";
import type { DriverLeg } from "./types";

export function fetchMyLegs() {
  return http.get<DriverLeg[]>("/api/driver/legs");
}

export function acceptLeg(legId: number) {
  return http.post<DriverLeg>(`/api/driver/legs/${legId}/accept`);
}

export function rejectLeg(legId: number, reason: string) {
  return http.post<DriverLeg>(`/api/driver/legs/${legId}/reject`, { reason });
}

export function markArriving(legId: number) {
  return http.post<DriverLeg>(`/api/driver/legs/${legId}/arriving`);
}

export function markOnBoard(legId: number) {
  return http.post<DriverLeg>(`/api/driver/legs/${legId}/on-board`);
}

export function completeLeg(legId: number) {
  return http.post<DriverLeg>(`/api/driver/legs/${legId}/complete`);
}
