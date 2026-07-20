import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as dispatchApi from "./api";
import * as bookingsApi from "../bookings/api";
import type { BookingDispatchFilter, DriverDispatchFilter } from "./types";

// Dispatch Center 的画面每 5 秒轮询刷新，跟 GPS 模块的节奏一致——不用「每秒重新载入」，
// 在 100+ Driver / 500+ Booking 的规模下这个频率对 Backend/DB 是合理的负担。
const POLL_INTERVAL_MS = 5000;

export function useWaitingBookingsQuery(filter: BookingDispatchFilter | undefined, search: string) {
  return useQuery({
    queryKey: ["dispatch", "waiting-bookings", filter, search],
    queryFn: () => dispatchApi.fetchWaitingBookings({ filter, search: search || undefined }),
    refetchInterval: POLL_INTERVAL_MS
  });
}

export function useDispatchDriversQuery(filter: DriverDispatchFilter | undefined, search: string) {
  return useQuery({
    queryKey: ["dispatch", "drivers", filter, search],
    queryFn: () => dispatchApi.fetchDispatchDrivers({ filter, search: search || undefined }),
    refetchInterval: POLL_INTERVAL_MS
  });
}

export function useDispatchStatisticsQuery() {
  return useQuery({
    queryKey: ["dispatch", "statistics"],
    queryFn: dispatchApi.fetchDispatchStatistics,
    refetchInterval: POLL_INTERVAL_MS
  });
}

/**
 * Quick Assign/Reassign 直接复用 Module 1/2 既有的 assignDriver API（bookings/api.ts），
 * 不重新实现指派逻辑——Dispatch Center 只是换一种更快的方式呼叫同一个既有 API。
 */
export function useDispatchAssignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, legId, driverId }: { bookingId: number; legId: number; driverId: number }) =>
      bookingsApi.assignDriver(bookingId, legId, driverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch"] });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
    }
  });
}
