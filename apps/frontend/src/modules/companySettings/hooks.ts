import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as companySettingsApi from "./api";
import type { UpdateCompanySettingsInput } from "./types";

export function useCompanySettingsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["companySettings"],
    queryFn: companySettingsApi.fetchCompanySettings,
    enabled: options.enabled ?? true
  });
}

export function useUpdateCompanySettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanySettingsInput) => companySettingsApi.updateCompanySettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["companySettings"] })
  });
}
