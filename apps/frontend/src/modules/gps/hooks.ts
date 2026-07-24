import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as gpsApi from "./api";

const POLL_INTERVAL_MS = 5000;

export function useDriverPresenceListQuery(onlineOnly = true) {
  return useQuery({
    queryKey: ["gps", "list", onlineOnly],
    queryFn: () => gpsApi.fetchDriverPresenceList(onlineOnly),
    refetchInterval: POLL_INTERVAL_MS
  });
}

export function useDriverPresenceQuery(driverId: number | undefined) {
  return useQuery({
    queryKey: ["gps", "driver", driverId],
    queryFn: () => gpsApi.fetchDriverPresence(driverId!),
    enabled: driverId !== undefined,
    refetchInterval: POLL_INTERVAL_MS
  });
}

export function useMyPresenceQuery() {
  return useQuery({
    queryKey: ["gps", "my-presence"],
    queryFn: gpsApi.fetchMyPresence,
    refetchInterval: POLL_INTERVAL_MS
  });
}

// Mobile UAT Bug Fix（Driver Online 状态同步）：goOnline/goOffline 现在直接回传跟 GET /me
// 同一份 DriverPresence（见 driverPresence.controller.ts），这里直接拿这个回应
// setQueryData 写回 ["gps","my-presence"] 的 cache——Header 徽章跟首页 Switch 立刻拿到
// 确定是最新的状态，不用再等一次额外的网路来回（原本靠 invalidateQueries 触发的那次
// 重新 fetch，在真实设备上量测到会跟 5 秒轮询、网路环境等因素产生竞态，导致 Toast 显示
// 成功但 UI 没跟着变）。invalidateQueries 还是要留着，因为 Admin 端的 GPS Dashboard/
// Dispatch Center 用的是另外几个 query（["gps","list",...]/["gps","driver",id]），
// 这支 mutation 拿不到那些资料，还是得让它们照旧标记成 stale、下次显示时重新拉。
export function useGoOnlineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOnline,
    onSuccess: (presence) => {
      queryClient.setQueryData(["gps", "my-presence"], presence);
      queryClient.invalidateQueries({ queryKey: ["gps"] });
    }
  });
}

export function useGoOfflineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOffline,
    onSuccess: (presence) => {
      queryClient.setQueryData(["gps", "my-presence"], presence);
      queryClient.invalidateQueries({ queryKey: ["gps"] });
    }
  });
}
