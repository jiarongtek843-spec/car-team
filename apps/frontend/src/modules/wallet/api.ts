import { http } from "../../api/http";
import type { PagedResult } from "../../types/booking";
import type { DriverWalletSummary, UnsettledByDriverItem, WalletTransaction, WalletTransactionStatus } from "./types";

export interface TransactionFilters {
  driverId?: number;
  status?: WalletTransactionStatus;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

function toQueryString(params: object) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchAdminTransactions(filters: TransactionFilters) {
  return http.get<PagedResult<WalletTransaction>>(`/api/admin/wallet/transactions${toQueryString(filters)}`);
}

export function fetchUnsettledByDriver() {
  return http.get<UnsettledByDriverItem[]>("/api/admin/wallet/unsettled-by-driver");
}

export interface CreateAdjustmentInput {
  driverId: number;
  amountCents: number;
  reason: string;
  effectiveDate: string;
}

export interface CreateSettlementAdjustmentInput extends CreateAdjustmentInput {
  relatedSettlementId?: number;
}

export function createManualAdjustment(input: CreateAdjustmentInput) {
  return http.post<WalletTransaction>("/api/admin/wallet/adjustments", input);
}

export function createSettlementAdjustment(input: CreateSettlementAdjustmentInput) {
  return http.post<WalletTransaction>("/api/admin/wallet/settlement-adjustments", input);
}

export function fetchMyWalletSummary() {
  return http.get<DriverWalletSummary>("/api/driver/wallet/summary");
}

export function fetchMyTransactions(filters: Omit<TransactionFilters, "driverId">) {
  return http.get<PagedResult<WalletTransaction>>(`/api/driver/wallet/transactions${toQueryString(filters)}`);
}
