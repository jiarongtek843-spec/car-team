import { http } from "../../api/http";
import type { CollectionSummary, CompanyCommissionSummary } from "./types";

export interface SummaryFilters {
  dateFrom?: string;
  dateTo?: string;
}

function toQueryString(params: SummaryFilters) {
  const search = new URLSearchParams();
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchCompanyCommissionSummary(filters: SummaryFilters) {
  return http.get<CompanyCommissionSummary>(`/api/admin/revenue-sharing/summary${toQueryString(filters)}`);
}

export function fetchCollectionSummary(filters: SummaryFilters) {
  return http.get<CollectionSummary>(`/api/admin/collections/summary${toQueryString(filters)}`);
}
