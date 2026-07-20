import { http } from "../../api/http";
import type { PagedResult } from "../../types/booking";
import type { Settlement, SettlementPreview } from "./types";

function toQueryString(params: object) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchSettlementPreview(driverId: number, periodStart: string, periodEnd: string) {
  return http.get<SettlementPreview>(
    `/api/admin/settlements/preview${toQueryString({ driverId, periodStart, periodEnd })}`
  );
}

export function confirmSettlement(driverId: number, periodStart: string, periodEnd: string) {
  return http.post<Settlement>("/api/admin/settlements", { driverId, periodStart, periodEnd });
}

export function fetchSettlements(params: { driverId?: number; page?: number; pageSize?: number }) {
  return http.get<PagedResult<Settlement>>(`/api/admin/settlements${toQueryString(params)}`);
}

export function fetchSettlementById(id: number) {
  return http.get<Settlement>(`/api/admin/settlements/${id}`);
}

export function voidSettlement(id: number, reason: string) {
  return http.post<Settlement>(`/api/admin/settlements/${id}/void`, { reason });
}

export function fetchMySettlements() {
  return http.get<Settlement[]>("/api/driver/settlements");
}
