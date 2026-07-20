import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as driversApi from "./api";
import type { DriverStatus } from "../../types/booking";

export function useDriversQuery(status?: DriverStatus) {
  return useQuery({
    queryKey: ["drivers", status ?? "all"],
    queryFn: () => driversApi.fetchDrivers(status)
  });
}

export function useCreateDriverMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; phone?: string }) => driversApi.createDriver(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });
}
