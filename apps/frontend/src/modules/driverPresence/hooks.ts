import { useQuery } from "@tanstack/react-query";
import * as driverPresenceApi from "./api";

// 跟既有 dispatch/hooks.ts 的 Driver List 用同一个 5000ms 轮询节奏——这次明确不做
// Push/WebSocket 即时更新，用既有的 Polling 惯例就好。
const POLL_INTERVAL_MS = 5000;

export function useDriverPresenceQuery() {
  return useQuery({
    queryKey: ["driverPresence", "list"],
    queryFn: driverPresenceApi.fetchDriverPresence,
    refetchInterval: POLL_INTERVAL_MS
  });
}
