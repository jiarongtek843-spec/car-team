import { http } from "../../api/http";
import type { PagedResult } from "../../types/booking";
import type { Collection, CollectionPaymentMethod, CollectionPurpose, CollectionStatus } from "./types";

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

export interface AdminCollectionFilters {
  driverId?: number;
  bookingId?: number;
  status?: CollectionStatus;
  paymentMethod?: CollectionPaymentMethod;
  purpose?: CollectionPurpose;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export function fetchAdminCollections(filters: AdminCollectionFilters) {
  return http.get<PagedResult<Collection>>(`/api/admin/collections${toQueryString(filters)}`);
}

export function fetchAdminCollection(id: number) {
  return http.get<Collection>(`/api/admin/collections/${id}`);
}

export function verifyCollection(id: number) {
  return http.post<Collection>(`/api/admin/collections/${id}/verify`);
}

export function voidCollection(id: number, reason: string) {
  return http.post<Collection>(`/api/admin/collections/${id}/void`, { reason });
}

export interface CreateCollectionInput {
  bookingId: number;
  legId?: number;
  customerName?: string;
  purpose: CollectionPurpose;
  amountCents: number;
  paymentMethod: CollectionPaymentMethod;
  collectedAt?: string;
  remark?: string;
}

export function createMyCollection(input: CreateCollectionInput) {
  return http.post<Collection>("/api/driver/collections", input);
}

export function fetchMyCollections(filters: { status?: CollectionStatus; page?: number; pageSize?: number }) {
  return http.get<PagedResult<Collection>>(`/api/driver/collections${toQueryString(filters)}`);
}

export function uploadMyCollectionProof(id: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return http.postForm<Collection>(`/api/driver/collections/${id}/proof-image`, formData);
}
