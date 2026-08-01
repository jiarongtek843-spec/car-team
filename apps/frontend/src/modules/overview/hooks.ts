import { useQuery } from "@tanstack/react-query";
import * as overviewApi from "./api";
import type { SummaryFilters } from "./api";

export function useCompanyCommissionSummaryQuery(filters: SummaryFilters) {
  return useQuery({
    queryKey: ["overview", "companyCommission", filters],
    queryFn: () => overviewApi.fetchCompanyCommissionSummary(filters)
  });
}

export function useCollectionSummaryQuery(filters: SummaryFilters) {
  return useQuery({
    queryKey: ["overview", "collection", filters],
    queryFn: () => overviewApi.fetchCollectionSummary(filters)
  });
}
