import { http } from "../../api/http";
import type {
  BookingDispatchFilter,
  DispatchDriver,
  DispatchStatistics,
  DispatchWaitingLeg,
  DriverDispatchFilter,
  SuggestedDriversResult
} from "./types";

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

export function fetchWaitingBookings(params: { filter?: BookingDispatchFilter; search?: string; date?: string }) {
  return http.get<DispatchWaitingLeg[]>(`/api/admin/dispatch/waiting-bookings${toQueryString(params)}`);
}

export function fetchDispatchDrivers(params: { filter?: DriverDispatchFilter; search?: string }) {
  return http.get<DispatchDriver[]>(`/api/admin/dispatch/drivers${toQueryString(params)}`);
}

export function fetchDispatchStatistics() {
  return http.get<DispatchStatistics>("/api/admin/dispatch/statistics");
}

export function fetchSuggestedDrivers(legId: number) {
  return http.get<SuggestedDriversResult>(`/api/admin/dispatch/legs/${legId}/suggested-drivers`);
}
