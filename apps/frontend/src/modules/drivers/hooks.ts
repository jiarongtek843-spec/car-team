import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { message } from "antd";
import * as driversApi from "./api";
import type { CreateDriverInput, UpdateDriverInput } from "./api";
import type { DriverStatus } from "../../types/booking";
import { ApiError } from "../../api/http";

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
    },
    // Stabilization Bug Fix：之前没有任何 onError，Popconfirm 里的 mutateAsync 失败
    // 就只是静默 reject，Admin 完全看不出启用/停用到底有没有成功。
    onError: (err) => {
      message.error(err instanceof ApiError ? err.message : "状态更新失败，请重试");
    }
  });
}

export function useResetDriverPasswordMutation() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => driversApi.resetDriverPassword(id, password)
  });
}

export function useDeleteDriverMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => driversApi.deleteDriver(id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });
}
