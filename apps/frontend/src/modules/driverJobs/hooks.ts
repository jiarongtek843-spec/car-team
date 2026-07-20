import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as driverJobsApi from "./api";

const MY_LEGS_KEY = ["driver-legs"];

export function useMyLegsQuery() {
  return useQuery({
    queryKey: MY_LEGS_KEY,
    queryFn: driverJobsApi.fetchMyLegs
  });
}

export function useAcceptLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.acceptLeg(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useRejectLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ legId, reason }: { legId: number; reason: string }) => driverJobsApi.rejectLeg(legId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useMarkArrivingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.markArriving(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useMarkOnBoardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.markOnBoard(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}

export function useCompleteLegMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: number) => driverJobsApi.completeLeg(legId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_LEGS_KEY })
  });
}
