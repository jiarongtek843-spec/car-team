import { http } from "../../api/http";
import type {
  Booking,
  BookingListItem,
  BookingStatus,
  CreateBookingInput,
  CreateLegInput,
  PagedResult,
  UpdateBookingInput,
  UpdateLegInput
} from "../../types/booking";

export interface ListBookingsParams {
  status?: BookingStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

function toQueryString(params: ListBookingsParams) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchBookings(params: ListBookingsParams) {
  return http.get<PagedResult<BookingListItem>>(`/api/bookings${toQueryString(params)}`);
}

export function fetchBooking(id: number) {
  return http.get<Booking>(`/api/bookings/${id}`);
}

export function createBooking(input: CreateBookingInput) {
  return http.post<Booking>("/api/bookings", input);
}

export function updateBooking(id: number, input: UpdateBookingInput) {
  return http.patch<Booking>(`/api/bookings/${id}`, input);
}

export function cancelBooking(id: number) {
  return http.post<Booking>(`/api/bookings/${id}/cancel`);
}

export function addLeg(bookingId: number, input: CreateLegInput) {
  return http.post<Booking>(`/api/bookings/${bookingId}/legs`, input);
}

export function updateLeg(bookingId: number, legId: number, input: UpdateLegInput) {
  return http.patch<Booking>(`/api/bookings/${bookingId}/legs/${legId}`, input);
}

export function assignDriver(bookingId: number, legId: number, driverId: number) {
  return http.post<Booking>(`/api/bookings/${bookingId}/legs/${legId}/assign`, { driverId });
}

export function startLeg(bookingId: number, legId: number) {
  return http.post<Booking>(`/api/bookings/${bookingId}/legs/${legId}/start`);
}

export function completeLeg(bookingId: number, legId: number) {
  return http.post<Booking>(`/api/bookings/${bookingId}/legs/${legId}/complete`);
}

export function cancelLeg(bookingId: number, legId: number) {
  return http.post<Booking>(`/api/bookings/${bookingId}/legs/${legId}/cancel`);
}

export function deleteLeg(bookingId: number, legId: number) {
  return http.delete<Booking>(`/api/bookings/${bookingId}/legs/${legId}`);
}
