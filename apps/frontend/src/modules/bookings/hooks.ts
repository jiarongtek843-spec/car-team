import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as bookingsApi from "./api";
import type { Booking, CreateBookingInput, CreateLegInput, UpdateBookingInput, UpdateLegInput } from "../../types/booking";
import type { ListBookingsParams } from "./api";

export const bookingKeys = {
  list: (params: ListBookingsParams) => ["bookings", "list", params] as const,
  detail: (id: number) => ["bookings", "detail", id] as const
};

export function useBookingsQuery(params: ListBookingsParams) {
  return useQuery({
    queryKey: bookingKeys.list(params),
    queryFn: () => bookingsApi.fetchBookings(params)
  });
}

export function useBookingQuery(id: number) {
  return useQuery({
    queryKey: bookingKeys.detail(id),
    queryFn: () => bookingsApi.fetchBooking(id),
    enabled: Number.isInteger(id)
  });
}

function useApplyBookingResult() {
  const queryClient = useQueryClient();
  return (booking: Booking) => {
    queryClient.setQueryData(bookingKeys.detail(booking.id), booking);
    queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
  };
}

export function useCreateBookingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBookingInput) => bookingsApi.createBooking(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings", "list"] });
    }
  });
}

export function useUpdateBookingMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: (input: UpdateBookingInput) => bookingsApi.updateBooking(bookingId, input),
    onSuccess: apply
  });
}

export function useCancelBookingMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: () => bookingsApi.cancelBooking(bookingId),
    onSuccess: apply
  });
}

export function useAddLegMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: (input: CreateLegInput) => bookingsApi.addLeg(bookingId, input),
    onSuccess: apply
  });
}

export function useUpdateLegMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: ({ legId, input }: { legId: number; input: UpdateLegInput }) =>
      bookingsApi.updateLeg(bookingId, legId, input),
    onSuccess: apply
  });
}

export function useAssignDriverMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: ({ legId, driverId }: { legId: number; driverId: number }) =>
      bookingsApi.assignDriver(bookingId, legId, driverId),
    onSuccess: apply
  });
}

export function useCancelLegMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: (legId: number) => bookingsApi.cancelLeg(bookingId, legId),
    onSuccess: apply
  });
}

export function useDeleteLegMutation(bookingId: number) {
  const apply = useApplyBookingResult();
  return useMutation({
    mutationFn: (legId: number) => bookingsApi.deleteLeg(bookingId, legId),
    onSuccess: apply
  });
}
