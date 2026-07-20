import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as driversApi from "./api";
import type { CreateDriverInput, UpdateDriverInput } from "./api";
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
    mutationFn: (input: CreateDriverInput) => driversApi.createDriver(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });
}

export function useUpdateDriverMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateDriverInput }) => driversApi.updateDriver(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });
}

export function useSetDriverStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: DriverStatus }) => driversApi.setDriverStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });
}

export function useResetDriverPasswordMutation() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => driversApi.resetDriverPassword(id, password)
  });
}
