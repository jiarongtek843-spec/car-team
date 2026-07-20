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

export function useGoOnlineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOnline,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gps"] })
  });
}

export function useGoOfflineMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: gpsApi.goOffline,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gps"] })
  });
}
