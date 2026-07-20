import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as collectionApi from "./api";
import type { AdminCollectionFilters, CreateCollectionInput } from "./api";
import type { CollectionStatus } from "./types";

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] })
  });
}

export function useVoidCollectionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => collectionApi.voidCollection(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] })
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] })
  });
}

export function useUploadMyCollectionProofMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => collectionApi.uploadMyCollectionProof(id, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["collections"] })
  });
}
