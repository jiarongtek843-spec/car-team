import { http } from "../../api/http";
import type {
  BookingDispatchFilter,
  DispatchDriver,
  DispatchOffer,
  DispatchStatistics,
  DispatchWaitingLeg,
  DriverDispatchFilter,
  MatchingResult,
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

export function fetchOffersForLeg(legId: number) {
  return http.get<DispatchOffer[]>(`/api/admin/dispatch/legs/${legId}/offers`);
}

export function sendOffer(legId: number) {
  return http.post<DispatchOffer[]>(`/api/admin/dispatch/legs/${legId}/send-offer`);
}

/** Driver Matching Engine（NOT Auto Assignment）：Live Dispatch Map 点选 Booking Marker 用。 */
export function fetchMatching(bookingId: number) {
  return http.get<MatchingResult>(`/api/admin/dispatch/matching/${bookingId}`);
}
