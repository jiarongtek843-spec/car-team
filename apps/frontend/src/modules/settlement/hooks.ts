import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as settlementApi from "./api";

export function useSettlementPreviewQuery(
  driverId: number | undefined,
  periodStart: string | undefined,
  periodEnd: string | undefined
) {
  return useQuery({
    queryKey: ["settlements", "preview", driverId, periodStart, periodEnd],
    queryFn: () => settlementApi.fetchSettlementPreview(driverId!, periodStart!, periodEnd!),
    enabled: Boolean(driverId && periodStart && periodEnd)
  });
}

export function useConfirmSettlementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ driverId, periodStart, periodEnd }: { driverId: number; periodStart: string; periodEnd: string }) =>
      settlementApi.confirmSettlement(driverId, periodStart, periodEnd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}

export function useSettlementsQuery(params: { driverId?: number; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ["settlements", "list", params],
    queryFn: () => settlementApi.fetchSettlements(params)
  });
}

export function useSettlementQuery(id: number | undefined) {
  return useQuery({
    queryKey: ["settlements", "detail", id],
    queryFn: () => settlementApi.fetchSettlementById(id!),
    enabled: Boolean(id)
  });
}

export function useVoidSettlementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => settlementApi.voidSettlement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}

export function useMySettlementsQuery() {
  return useQuery({
    queryKey: ["settlements", "mine"],
    queryFn: settlementApi.fetchMySettlements
  });
}
