import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { message } from "antd";
import * as collectionApi from "./api";
import type { AdminCollectionFilters, CreateCollectionInput } from "./api";
import type { CollectionStatus } from "./types";
import { ApiError } from "../../api/http";

// Stabilization Bug Fix：Verify/Void 这两个动作之前完全没有 onError，失败时按钮只是
// 停止 loading，Admin 完全看不出这笔代收款到底有没有真的被确认/作废——加在 hook 层级，
// 保证不管未来在哪个画面呼叫都会有提示，不用每个呼叫点各自记得包 try/catch。
function reportMutationError(err: unknown, fallback: string) {
  message.error(err instanceof ApiError ? err.message : fallback);
}

export function useAdminCollectionsQuery(filters: AdminCollectionFilters) {
  return useQuery({
    queryKey: ["collections", "admin-list", filters],
    queryFn: () => collectionApi.fetchAdminCollections(filters)
  });
}

export function useVerifyCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => collectionApi.verifyCollection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
    onError: (err) => reportMutationError(err, "确认失败，请重试")
  });
}

export function useVoidCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => collectionApi.voidCollection(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
    onError: (err) => reportMutationError(err, "作废失败，请重试")
  });
}

export function useMyCollectionsQuery(filters: { status?: CollectionStatus; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ["collections", "my-list", filters],
    queryFn: () => collectionApi.fetchMyCollections(filters)
  });
}

export function useCreateMyCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCollectionInput) => collectionApi.createMyCollection(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] }),
    onError: (err) => reportMutationError(err, "记录失败，请重试")
  });
}

export function useUploadMyCollectionProofMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => collectionApi.uploadMyCollectionProof(id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] })
  });
}
