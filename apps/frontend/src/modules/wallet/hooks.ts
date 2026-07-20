import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as walletApi from "./api";
import type { TransactionFilters, CreateAdjustmentInput, CreateSettlementAdjustmentInput } from "./api";

export function useAdminTransactionsQuery(filters: TransactionFilters) {
  return useQuery({
    queryKey: ["wallet", "admin-transactions", filters],
    queryFn: () => walletApi.fetchAdminTransactions(filters)
  });
}

export function useUnsettledByDriverQuery() {
  return useQuery({
    queryKey: ["wallet", "unsettled-by-driver"],
    queryFn: walletApi.fetchUnsettledByDriver
  });
}

export function useCreateManualAdjustmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAdjustmentInput) => walletApi.createManualAdjustment(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  });
}

export function useCreateSettlementAdjustmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSettlementAdjustmentInput) => walletApi.createSettlementAdjustment(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
    }
  });
}

export function useMyWalletSummaryQuery() {
  return useQuery({
    queryKey: ["wallet", "my-summary"],
    queryFn: walletApi.fetchMyWalletSummary
  });
}

export function useMyTransactionsQuery(filters: Omit<TransactionFilters, "driverId">) {
  return useQuery({
    queryKey: ["wallet", "my-transactions", filters],
    queryFn: () => walletApi.fetchMyTransactions(filters)
  });
}
