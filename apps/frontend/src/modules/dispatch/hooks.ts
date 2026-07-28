import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as dispatchApi from "./api";
import * as bookingsApi from "../bookings/api";
import type { BookingDispatchFilter, DriverDispatchFilter } from "./types";

// Dispatch Center 的画面每 5 秒轮询刷新，跟 GPS 模块的节奏一致——不用「每秒重新载入」，
// 在 100+ Driver / 500+ Booking 的规模下这个频率对 Backend/DB 是合理的负担。
const POLL_INTERVAL_MS = 5000;

export function useWaitingBookingsQuery(filter: BookingDispatchFilter | undefined, search: string, date?: string) {
  return useQuery({
    queryKey: ["dispatch", "waiting-bookings", filter, search, date],
    queryFn: () => dispatchApi.fetchWaitingBookings({ filter, search: search || undefined, date }),
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
 * Phase 1 Driver Eligibility + Ranking Engine（docs/design/phase2-gps-dispatch-architecture.md
 * §3.1/§3.2）：只在 Dispatcher 选好一笔等派车的 Leg 之后才查——纯粹是排序建议，不建立
 * DispatchOffer、不自动指派，Quick Assign 手动流程完全不受影响。
 */
export function useSuggestedDriversQuery(legId: number | null) {
  return useQuery({
    queryKey: ["dispatch", "suggested-drivers", legId],
    queryFn: () => dispatchApi.fetchSuggestedDrivers(legId as number),
    enabled: legId !== null,
    refetchInterval: POLL_INTERVAL_MS
  });
}

/**
 * Phase 1 Dispatch Engine（简化版）：一笔 Leg 目前的 Offer 名单——送出后的 PENDING 会
 * 比 5 秒的一般轮询更需要即时性（Driver 可能几秒内就 Accept），改用跟 Driver 端一致的
 * 3 秒频率。
 */
export function useOffersForLegQuery(legId: number | null) {
  return useQuery({
    queryKey: ["dispatch", "offers", legId],
    queryFn: () => dispatchApi.fetchOffersForLeg(legId as number),
    enabled: legId !== null,
    refetchInterval: 3000
  });
}

export function useSendOfferMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => dispatchApi.sendOffer(legId),
    onSuccess: (_data, legId) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch", "offers", legId] });
      queryClient.invalidateQueries({ queryKey: ["dispatch", "waiting-bookings"] });
    }
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
