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

/** GPS Foundation：Live Dispatch Map 用，跟其他 Dispatch/GPS 画面同一个 5 秒轮询节奏。 */
export function useDriverLocationsQuery() {
  return useQuery({
    queryKey: ["gps", "locations"],
    queryFn: gpsApi.fetchDriverLocations,
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

// Mobile UAT Bug Fix（Driver Online 状态同步，第二轮根因）：goOnline/goOffline 回传跟
// GET /me 同一份 DriverPresence，理论上可以直接 setQueryData 写回 cache，但真实手机上
// 还是会被盖掉——真正的根因是 DriverPresenceToggle 在呼叫这支 mutation 之前，会先
// await navigator.geolocation.getCurrentPosition({maximumAge:0})（强制要一个全新的定位，
// 不能用快取），这在真实装置上普遍要花好几秒（甚至到 iOS 权限对话框本身的等待时间）。
// useMyPresenceQuery 的 5 秒 refetchInterval 完全不知道这件事，还是照样在背景一直发
// GET /me。等到定位终于拿到、mutation 真的送出并成功、我们 setQueryData 写入「已上线」
// 的当下，很可能有一个「使用者点击当下就已经飞在空中」的旧 GET 请求（当时状态还是
// Offline）这时候才回来，直接把我们刚写好的新资料盖掉——这不是偶发 race，因为「要一个
// GPS 全新定位」这个操作本身的耗时，跟 5 秒轮询周期在真实装置上高机率会重叠。
// 解法：`onMutate` 一开始就 cancelQueries 把当下所有还没回来的 my-presence 请求取消掉
// （即使底层 fetch 没有接 AbortSignal，react-query 也会忽略它稍后才回来的结果，不会
// 写进 cache），mutation 成功后只用它自己拿到的、保证最新的资料写入，不再另外发一次
// invalidateQueries 去刷新同一个 query（那样反而会製造新的竞态窗口）。Admin 端的
// GPS Dashboard/Dispatch Center 用的是另外几个 query（["gps","list",...]/
// ["gps","driver",id]），不受这个竞态影响，维持原本的 invalidate。
export function useGoOnlineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOnline,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["gps", "my-presence"] });
    },
    onSuccess: (presence) => {
      queryClient.setQueryData(["gps", "my-presence"], presence);
      queryClient.invalidateQueries({ queryKey: ["gps", "list"] });
      queryClient.invalidateQueries({ queryKey: ["gps", "driver"] });
    }
  });
}

export function useGoOfflineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOffline,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["gps", "my-presence"] });
    },
    onSuccess: (presence) => {
      queryClient.setQueryData(["gps", "my-presence"], presence);
      queryClient.invalidateQueries({ queryKey: ["gps", "list"] });
      queryClient.invalidateQueries({ queryKey: ["gps", "driver"] });
    }
  });
}
